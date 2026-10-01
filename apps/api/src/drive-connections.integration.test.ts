import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {prisma,type OrgRole,type SeatType} from "@vaettir/db";
import {driveConnectionsRouter} from "./routers/driveConnections.js";
import {verifyDriveAuthorization,listDriveFiles} from "./services/googleDriveConnection.js";
import {decryptToken,type EncryptedToken} from "./services/tokenEncryption.js";
vi.mock("./services/googleDriveConnection.js",async original=>({...await original<typeof import("./services/googleDriveConnection.js")>(),verifyDriveAuthorization:vi.fn(),listDriveFiles:vi.fn()}));
const db=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=db&&["localhost","127.0.0.1"].includes(db.hostname)&&/test/i.test(db.pathname)&&!db.searchParams.has("host");
const account={id:"native-account",name:"Synthetic Google account",email:"synthetic@example.invalid"};
const file=(id="file_A",name="Synthetic document")=>({id,name,mimeType:"application/vnd.google-apps.document",url:`https://docs.google.com/document/d/${id}/edit`,modifiedTime:"2026-10-01T10:00:00.000Z",parents:["root"]});
const folder={...file("folder_A","Synthetic folder"),mimeType:"application/vnd.google-apps.folder",url:"https://drive.google.com/drive/folders/folder_A"};
const token="synthetic-drive-access-not-live";
const deferred=<T,>()=>{let resolve!:(value:T)=>void;let reject!:(reason:unknown)=>void;const promise=new Promise<T>((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

describe.skipIf(!isolated)("Drive metadata authorization and reviewed scope",()=>{
  let orgId:string;let projectId:string;let ownerId:string;
  let owner:ReturnType<typeof driveConnectionsRouter.createCaller>;let editor:typeof owner;let viewer:typeof owner;let readOnly:typeof owner;let outsider:typeof owner;
  async function actor(role?:OrgRole,seatType:SeatType="FULL"){
    const id=randomUUID();const user=await prisma.user.create({data:{email:`${id}@example.invalid`,clerkUserId:id,...(role?{memberships:{create:{organizationId:orgId,role,seatType}}}:{})},include:{memberships:true}});
    return {id:user.id,caller:driveConnectionsRouter.createCaller({prisma,user,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}})};
  }
  const request=()=>({projectId,requestId:randomUUID(),approveMetadataAccess:true as const});
  async function pending(){const row=await owner.begin(request());return {...row,state:new URL(row.authorizationUrl).searchParams.get("state")!};}
  async function ready(){const row=await pending();await owner.complete({state:row.state,code:"synthetic-code"});return row;}
  async function listed(){const row=await ready();return {...row,...await owner.list({id:row.id,requestId:randomUUID()})};}
  beforeEach(async()=>{
    vi.resetAllMocks();vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,17).toString("base64"));vi.stubEnv("GOOGLE_DRIVE_CLIENT_ID","synthetic-client.apps.googleusercontent.com");vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET","synthetic-client-secret");vi.stubEnv("WEB_APP_URL","https://vaettir.example.com");
    vi.mocked(verifyDriveAuthorization).mockImplementation(async()=>({token,expiresAt:new Date(Date.now()+3600000),account}));vi.mocked(listDriveFiles).mockResolvedValue({files:[file(),folder],nextCursor:null});
    const suffix=randomUUID();const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    orgId=(await prisma.organization.create({data:{name:"Drive fixture",slug:`drive-${suffix}`,planTierId:tier.id}})).id;
    projectId=(await prisma.project.create({data:{organizationId:orgId,name:"Synthetic Drive project",slug:`drive-${suffix}`}})).id;
    const own=await actor("OWNER");owner=own.caller;ownerId=own.id;editor=(await actor("EDITOR")).caller;viewer=(await actor("VIEWER")).caller;readOnly=(await actor("ADMIN","READ_ONLY")).caller;outsider=(await actor()).caller;
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("requires explicit consent/full editor seat and honest configured capability",async()=>{
    for(const caller of[viewer,readOnly,outsider])await expect(caller.begin(request())).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(owner.begin({...request(),approveMetadataAccess:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(await viewer.capabilities({projectId})).toMatchObject({canConnect:false,oauthAvailable:true,contentReadAvailable:false});
    expect(verifyDriveAuthorization).not.toHaveBeenCalled();expect(listDriveFiles).not.toHaveBeenCalled();
  });
  it.each(["GOOGLE_DRIVE_CLIENT_ID","GOOGLE_DRIVE_CLIENT_SECRET","WEB_APP_URL","PRODUCTION_SIGNAL_ENCRYPTION_KEY"])("fails closed without %s",async name=>{
    vi.stubEnv(name,"");await expect(owner.begin(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(await prisma.driveSourceConnection.count({where:{projectId}})).toBe(0);expect(verifyDriveAuthorization).not.toHaveBeenCalled();
  });
  it("durably retries begin without duplicate state or exposing verifier",async()=>{
    const input=request();const first=await owner.begin(input);expect(await owner.begin(input)).toEqual(first);
    const stored=await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:first.id}});
    expect(JSON.stringify(stored)).not.toContain(new URL(first.authorizationUrl).searchParams.get("state"));
    expect(decryptToken(stored.encryptedAuthorization as unknown as EncryptedToken)).toBe(first.authorizationUrl);
    expect(stored.encryptedVerifier).not.toBeNull();expect(await prisma.driveSourceConnection.count({where:{projectId}})).toBe(1);
  });
  it("actor-bound one-use callback verifies account without reading files",async()=>{
    const row=await pending();await expect(editor.complete({state:row.state,code:"synthetic-code"})).rejects.toMatchObject({code:"NOT_FOUND"});
    await owner.complete({state:row.state,code:"synthetic-code"});await expect(owner.complete({state:row.state,code:"synthetic-code"})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    const stored=await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}});
    expect(stored.status).toBe("VERIFIED");expect(stored.encryptedVerifier).toBeNull();expect(stored.encryptedAuthorization).toBeNull();expect(decryptToken(stored.encryptedToken as unknown as EncryptedToken)).toBe(token);
    expect(await owner.snapshot({id:row.id})).toMatchObject({account,files:[],approvedFiles:[]});expect(JSON.stringify(await owner.mine({projectId}))).not.toContain(token);expect(listDriveFiles).not.toHaveBeenCalled();
  });
  it("denial and expired callback never contact Google",async()=>{
    const denied=await pending();await owner.complete({state:denied.state,denied:true});expect((await owner.snapshot({id:denied.id})).status).toBe("CANCELED");
    const expired=await pending();await prisma.driveSourceConnection.update({where:{id:expired.id},data:{authorizationExpiresAt:new Date(0)}});
    await expect(owner.complete({state:expired.state,code:"synthetic-code"})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(verifyDriveAuthorization).not.toHaveBeenCalled();
  });
  it("rejects changed OAuth registration after begin",async()=>{
    const row=await pending();vi.stubEnv("GOOGLE_DRIVE_CLIENT_SECRET","rotated-synthetic-secret");await expect(owner.complete({state:row.state,code:"synthetic-code"})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(verifyDriveAuthorization).not.toHaveBeenCalled();
  });
  it("retains safe failure status with no provider secrets",async()=>{
    const row=await pending();vi.mocked(verifyDriveAuthorization).mockRejectedValueOnce(new Error(token));
    await expect(owner.complete({state:row.state,code:"synthetic-code"})).rejects.toMatchObject({code:"BAD_REQUEST",message:expect.not.stringContaining(token)});
    expect((await owner.snapshot({id:row.id})).status).toBe("FAILED");expect((await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}})).encryptedToken).toBeNull();
  });
  it("cancellation during account verification cannot restore access",async()=>{
    const row=await pending();const delayed=deferred<Awaited<ReturnType<typeof verifyDriveAuthorization>>>();vi.mocked(verifyDriveAuthorization).mockReturnValueOnce(delayed.promise);
    const completion=owner.complete({state:row.state,code:"synthetic-code"});const caught=expect(completion).rejects.toMatchObject({code:"BAD_REQUEST"});await vi.waitFor(()=>expect(verifyDriveAuthorization).toHaveBeenCalledTimes(1));
    await owner.forget({id:row.id,confirmed:true});delayed.resolve({token,expiresAt:new Date(Date.now()+3600000),account});await caught;
    expect((await owner.snapshot({id:row.id})).status).toBe("DISCONNECTED");expect((await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}})).encryptedToken).toBeNull();
  });
  it("reviews multi-file additions, idempotent approval and preserves prior evidence",async()=>{
    const row=await listed();const approval={id:row.id,version:row.version,fileIds:[file().id],requestId:randomUUID(),approved:true as const};
    expect((await owner.snapshot({id:row.id})).approvedFiles).toEqual([]);expect(await owner.approve(approval)).toEqual({savedFiles:1});expect(await owner.approve(approval)).toEqual({savedFiles:1});
    vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file("file_A","Changed human-source title"),file("file_B")],nextCursor:null});
    const next=await owner.list({id:row.id,requestId:randomUUID()});await owner.approve({id:row.id,version:next.version,fileIds:["file_A","file_B"],requestId:randomUUID(),approved:true});
    const saved=await owner.snapshot({id:row.id});expect(saved.approvedFiles).toHaveLength(2);expect(saved.approvedFiles.find(f=>f.id==="file_A")?.name).toBe(file().name);
    expect(await prisma.requirement.count({where:{projectId}})).toBe(0);expect(await prisma.projectPopulationDocument.count({where:{projectId}})).toBe(0);
  });
  it("rejects forged IDs, folders, unapproved/stale writes and changed retries",async()=>{
    const row=await listed();const approval={id:row.id,version:row.version,fileIds:[file().id],requestId:randomUUID(),approved:true as const};
    await expect(owner.approve({...approval,approved:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    for(const fileIds of[["forged_id"],[folder.id]])await expect(owner.approve({...approval,fileIds})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await owner.approve(approval);await expect(owner.approve({...approval,fileIds:[folder.id]})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(owner.approve({...approval,requestId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
  });
  it("approval freshness expires without deleting approved scope",async()=>{
    const row=await listed();await prisma.driveSourceConnection.update({where:{id:row.id},data:{catalogAt:new Date(0)}});
    await expect(owner.approve({id:row.id,version:row.version,fileIds:[file().id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
  });
  it("only offered folder/cursor is read and receipts recover lost responses",async()=>{
    const row=await ready();vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file(),folder],nextCursor:"page_two"});
    const input={id:row.id,requestId:randomUUID()};const first=await owner.list(input);expect(await owner.list(input)).toEqual(first);expect(listDriveFiles).toHaveBeenCalledTimes(1);
    await expect(owner.list({...input,search:"changed"})).rejects.toMatchObject({code:"CONFLICT"});
    await expect(owner.list({id:row.id,requestId:randomUUID(),after:"forged"})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.list({id:row.id,requestId:randomUUID(),folderId:"forged_folder"})).rejects.toMatchObject({code:"BAD_REQUEST"});
    vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file("child_A")],nextCursor:null});const child=await owner.list({id:row.id,requestId:randomUUID(),folderId:folder.id});expect(child.catalogReset).toBe(true);
    expect(listDriveFiles).toHaveBeenLastCalledWith(token,{folderId:folder.id,search:"",after:null});
  });
  it("caps pages at five, rejects unoffered continuation and query mismatch",async()=>{
    const row=await ready();let after:string|null=null;
    for(let index=0;index<5;index++){
      vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file(`page_${index}`)],nextCursor:`cursor_${index}`});
      const page=await owner.list({id:row.id,requestId:randomUUID(),after});after=page.nextCursor;
      if(index===4)expect(page).toMatchObject({bounded:true,nextCursor:null});
    }
    await expect(owner.list({id:row.id,requestId:randomUUID(),after:"cursor_4"})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(listDriveFiles).toHaveBeenCalledTimes(5);
  });
  it("caps metadata attempts including failed reads and permits review of retained catalog",async()=>{
    const row=await ready();await owner.list({id:row.id,requestId:randomUUID()});vi.mocked(listDriveFiles).mockRejectedValue(new Error(token));
    for(let i=0;i<9;i++)await expect(owner.list({id:row.id,requestId:randomUUID()})).rejects.toMatchObject({code:"BAD_REQUEST",message:expect.not.stringContaining(token)});
    await expect(owner.list({id:row.id,requestId:randomUUID()})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect((await owner.snapshot({id:row.id})).files).toHaveLength(2);
  });
  it("rejects pagination loops and duplicate native IDs without losing previous preview",async()=>{
    const row=await ready();vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file()],nextCursor:"same"});await owner.list({id:row.id,requestId:randomUUID()});
    vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file("second")],nextCursor:"same"});await expect(owner.list({id:row.id,requestId:randomUUID(),after:"same"})).rejects.toMatchObject({code:"BAD_REQUEST"});
    vi.mocked(listDriveFiles).mockResolvedValueOnce({files:[file()],nextCursor:null});await expect(owner.list({id:row.id,requestId:randomUUID(),after:"same"})).rejects.toMatchObject({code:"BAD_REQUEST"});expect((await owner.snapshot({id:row.id})).files).toHaveLength(1);
  });
  it("enforces live authorization with stale session membership and tenant boundaries",async()=>{
    const row=await listed();for(const caller of[editor,viewer,readOnly,outsider])await expect(caller.snapshot({id:row.id})).rejects.toMatchObject({code:"NOT_FOUND"});
    await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:ownerId}},data:{role:"VIEWER"}});
    await expect(owner.snapshot({id:row.id})).rejects.toMatchObject({code:"FORBIDDEN"});await expect(owner.mine({projectId})).rejects.toMatchObject({code:"FORBIDDEN"});await expect(owner.begin(request())).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("rejects post-read revocation and tenant reassignment before storing metadata",async()=>{
    const row=await ready();const delayed=deferred<Awaited<ReturnType<typeof listDriveFiles>>>();vi.mocked(listDriveFiles).mockReturnValueOnce(delayed.promise);
    const operation=owner.list({id:row.id,requestId:randomUUID()});const caught=expect(operation).rejects.toMatchObject({code:"BAD_REQUEST"});await vi.waitFor(()=>expect(listDriveFiles).toHaveBeenCalledTimes(1));
    const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});const other=await prisma.organization.create({data:{name:"Other fixture",slug:`other-${randomUUID()}`,planTierId:tier.id}});
    await prisma.project.update({where:{id:projectId},data:{organizationId:other.id}});delayed.resolve({files:[file()],nextCursor:null});await caught;
    expect((await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}})).catalog).toBeNull();await expect(owner.snapshot({id:row.id})).rejects.toMatchObject({code:"FORBIDDEN"});
  });
  it("cancels loading pages while retaining approved files and rejecting late result",async()=>{
    const row=await listed();await owner.approve({id:row.id,version:row.version,fileIds:[file().id],requestId:randomUUID(),approved:true});
    const delayed=deferred<Awaited<ReturnType<typeof listDriveFiles>>>();vi.mocked(listDriveFiles).mockReturnValueOnce(delayed.promise);
    const operation=owner.list({id:row.id,requestId:randomUUID()});const caught=expect(operation).rejects.toMatchObject({code:"BAD_REQUEST"});await vi.waitFor(()=>expect(listDriveFiles).toHaveBeenCalledTimes(2));
    expect(await owner.forget({id:row.id,confirmed:true})).toMatchObject({providerRevocationRequired:true});delayed.resolve({files:[file("late")],nextCursor:null});await caught;
    const saved=await owner.snapshot({id:row.id});expect(saved.status).toBe("DISCONNECTED");expect(saved.approvedFiles).toHaveLength(1);expect(saved.files.map(f=>f.id)).not.toContain("late");
  });
  it("expired leases permit safe retry but active leases reject overlapping reads",async()=>{
    const row=await ready();await prisma.driveSourceConnection.update({where:{id:row.id},data:{readLeaseRequestId:randomUUID(),readLeaseUntil:new Date(Date.now()+60000)}});
    await expect(owner.list({id:row.id,requestId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});await prisma.driveSourceConnection.update({where:{id:row.id},data:{readLeaseUntil:new Date(0)}});
    await expect(owner.list({id:row.id,requestId:randomUUID()})).resolves.toHaveProperty("version");
  });
  it("token expiry blocks reads without removing approved file identities",async()=>{
    const row=await listed();await owner.approve({id:row.id,version:row.version,fileIds:[file().id],requestId:randomUUID(),approved:true});await prisma.driveSourceConnection.update({where:{id:row.id},data:{tokenExpiresAt:new Date(0)}});
    expect(await owner.snapshot({id:row.id})).toMatchObject({status:"EXPIRED",approvedFiles:[file()]});await expect(owner.list({id:row.id,requestId:randomUUID()})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
  });
  it("same-request lease recovery fences delayed former execution and cleanup",async()=>{
    const row=await ready();const oldRead=deferred<Awaited<ReturnType<typeof listDriveFiles>>>();const newRead=deferred<Awaited<ReturnType<typeof listDriveFiles>>>();
    vi.mocked(listDriveFiles).mockReturnValueOnce(oldRead.promise).mockReturnValueOnce(newRead.promise);
    const input={id:row.id,requestId:randomUUID()};const oldOperation=owner.list(input);const oldCaught=expect(oldOperation).rejects.toMatchObject({code:"BAD_REQUEST"});
    await vi.waitFor(()=>expect(listDriveFiles).toHaveBeenCalledTimes(1));const oldLease=(await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}})).readLeaseRequestId;
    await prisma.driveSourceConnection.update({where:{id:row.id},data:{readLeaseUntil:new Date(0)}});
    const retry=owner.list(input);await vi.waitFor(()=>expect(listDriveFiles).toHaveBeenCalledTimes(2));const newLease=(await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}})).readLeaseRequestId;expect(newLease).not.toBe(oldLease);
    oldRead.resolve({files:[file("old")],nextCursor:null});await oldCaught;
    const stillReading=await prisma.driveSourceConnection.findUniqueOrThrow({where:{id:row.id}});expect(stillReading.readLeaseRequestId).toBe(newLease);expect(stillReading.catalog).toBeNull();
    newRead.resolve({files:[file("new")],nextCursor:null});expect((await retry).files.map(f=>f.id)).toEqual(["new"]);expect(await owner.list(input)).toMatchObject({files:[file("new")]});
  });
});
