import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {prisma,type OrgRole,type SeatType} from "@vaettir/db";
import {jiraConnectionsRouter} from "./routers/jiraConnections.js";
import {listJiraProjects} from "./services/jiraSourceConnection.js";
import {decryptToken,encryptToken,type EncryptedToken} from "./services/tokenEncryption.js";
vi.mock("./services/jiraSourceConnection.js",async original=>({...await original<typeof import("./services/jiraSourceConnection.js")>(),listJiraProjects:vi.fn()}));
const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=url&&["localhost","127.0.0.1"].includes(url.hostname)&&/test/i.test(url.pathname)&&!url.searchParams.has("host");
const workspace={id:"https://synthetic.atlassian.net",name:"https://synthetic.atlassian.net"};const account={id:randomUUID(),name:"Synthetic account"};
const projectA={id:"10001",key:"SYNTA",name:"Synthetic A",url:"https://synthetic.atlassian.net/browse/SYNTA"};
const projectB={id:"10002",key:"SYNTB",name:"Synthetic B",url:"https://synthetic.atlassian.net/browse/SYNTB"};
const listing=(projects=[projectA],nextCursor:number|null=null)=>({workspace,account,projects,hasMore:!!nextCursor,nextCursor});
const key="synthetic-jira-key-not-live";

describe.skipIf(!isolated)("Jira native metadata connection",()=>{
  let orgId:string;let projectId:string;let ownerId:string;
  let owner:ReturnType<typeof jiraConnectionsRouter.createCaller>;let editor:typeof owner;let viewer:typeof owner;let readOnly:typeof owner;let outsider:typeof owner;
  async function actor(role?:OrgRole,seatType:SeatType="FULL"){
    const id=randomUUID();const user=await prisma.user.create({data:{email:`${id}@example.invalid`,clerkUserId:id,...(role?{memberships:{create:{organizationId:orgId,role,seatType}}}:{})},include:{memberships:true}});
    return {id:user.id,caller:jiraConnectionsRouter.createCaller({prisma,user,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}})};
  }
  const request=()=>({projectId,requestId:randomUUID(),siteUrl:workspace.id,email:"synthetic@example.invalid",apiToken:key,approveMetadataAccess:true as const});
  async function ready(){
    // A pre-existing encrypted connection is fixture input, not a new token enrollment.
    const row=await prisma.ticketSourceConnection.create({data:{projectId,organizationId:orgId,actorId:ownerId,provider:"jira",providerOrigin:workspace.id,requestKey:randomUUID(),requestHash:"legacy-fixture",status:"VERIFIED",encryptedToken:{...encryptToken(JSON.stringify({siteUrl:workspace.id,email:"synthetic@example.invalid",apiToken:key}))},authorizationExpiresAt:new Date(Date.now()+600000),tokenExpiresAt:new Date(Date.now()+28800000),verifiedAt:new Date(),catalog:{workspace,account,projects:[projectA],cursors:[]},catalogAt:new Date(),version:1}});
    return {id:row.id,...await owner.list({id:row.id})};
  }
  beforeEach(async()=>{
    vi.resetAllMocks();vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,11).toString("base64"));
    vi.mocked(listJiraProjects).mockResolvedValue(listing());
    const suffix=randomUUID();const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    orgId=(await prisma.organization.create({data:{name:"Jira fixture",slug:`jira-${suffix}`,planTierId:tier.id}})).id;
    projectId=(await prisma.project.create({data:{organizationId:orgId,name:"Synthetic project",slug:`jira-${suffix}`}})).id;
    const own=await actor("OWNER");owner=own.caller;ownerId=own.id;
    editor=(await actor("EDITOR")).caller;viewer=(await actor("VIEWER")).caller;readOnly=(await actor("ADMIN","READ_ONLY")).caller;outsider=(await actor()).caller;
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("requires consent and a full editor role before any provider request",async()=>{
    for(const caller of [viewer,readOnly,outsider])await expect(caller.verify(request())).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(owner.verify({...request(),approveMetadataAccess:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(listJiraProjects).not.toHaveBeenCalled();
    expect(await viewer.capabilities({projectId})).toMatchObject({canConnect:false,oauthAvailable:false,issueImportAvailable:true});
  });
  it("refuses every new token without calling the provider or storing credentials",async()=>{
    for(const siteUrl of [workspace.id,"https://other.atlassian.net","https://jira.example.invalid","http://127.0.0.1"]){await expect(owner.verify({...request(),siteUrl})).rejects.toMatchObject({code:"PRECONDITION_FAILED",message:expect.stringContaining("browser sign-in")});}
    expect(listJiraProjects).not.toHaveBeenCalled();expect(await prisma.ticketSourceConnection.count({where:{projectId}})).toBe(0);expect(await owner.capabilities({projectId})).toMatchObject({tokenImplemented:false});
  });
  it("fails closed when encrypted storage is unconfigured",async()=>{
    vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY","");
    expect(await owner.capabilities({projectId})).toMatchObject({credentialStorageReady:false});
    await expect(owner.verify(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(listJiraProjects).not.toHaveBeenCalled();expect(await prisma.ticketSourceConnection.count({where:{projectId}})).toBe(0);
  });
  it("retains encrypted legacy access and requires explicit project-scope approval",async()=>{
    const result=await ready();const row=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:result.id}});
    expect(JSON.stringify(row)).not.toContain(key);expect(JSON.parse(decryptToken(row.encryptedToken as EncryptedToken))).toEqual({siteUrl:workspace.id,email:"synthetic@example.invalid",apiToken:key});
    expect(row.approvedProjects).toEqual([]);expect(await prisma.requirement.count({where:{projectId}})).toBe(0);
    await owner.approve({id:row.id,version:result.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true});
    expect((await owner.mine({projectId}))[0]!.approvedProjects).toEqual([projectA]);
  });
  it("binds metadata and approval to actor and tenant",async()=>{
    const result=await ready();for(const caller of [editor,outsider]){
      await expect(caller.list({id:result.id})).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(caller.approve({id:result.id,version:result.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(caller.forget({id:result.id,confirmed:true})).rejects.toMatchObject({code:"NOT_FOUND"});
    }
    expect(await editor.mine({projectId})).toEqual([]);
  });
  it("preserves completed scope on identical approval retries and enriches incrementally",async()=>{
    const first=await ready();const approval={id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true as const};
    expect(await owner.approve(approval)).toEqual({savedProjects:1});expect(await owner.approve(approval)).toEqual({savedProjects:1});
    vi.mocked(listJiraProjects).mockResolvedValue(listing([projectB]));const second=await owner.list({id:first.id});
    await owner.approve({id:first.id,version:second.version,projectIds:[projectB.id],requestId:randomUUID(),approved:true});
    expect((await owner.mine({projectId}))[0]!.approvedProjects.map(p=>p.id).sort()).toEqual([projectA.id,projectB.id].sort());
    expect(await owner.approve(approval)).toEqual({savedProjects:1});
    const row=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});expect((row.approvalReceipts as unknown[])).toHaveLength(2);
    expect(await prisma.requirement.count({where:{projectId}})).toBe(0);
  });
  it("rejects forged identities, unapproved writes and changed replay bodies",async()=>{
    const first=await ready();const approval={id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true as const};
    await expect(owner.approve({...approval,approved:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.approve({...approval,projectIds:[randomUUID()]})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await owner.approve(approval);await expect(owner.approve({...approval,projectIds:[projectB.id]})).rejects.toMatchObject({code:"CONFLICT"});
  });
  it("removes disappeared identities from refreshed catalog but not approved scope",async()=>{
    const first=await ready();await owner.approve({id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true});
    vi.mocked(listJiraProjects).mockResolvedValue(listing([projectB]));const next=await owner.list({id:first.id});expect(next.catalogReset).toBe(true);
    await expect(owner.approve({id:first.id,version:next.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect((await owner.mine({projectId}))[0]!.approvedProjects).toEqual([projectA]);
  });
  it("rejects stale reviews and safe concurrent approvals",async()=>{
    const first=await ready();await owner.list({id:first.id});
    await expect(owner.approve({id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"CONFLICT"});
    const fresh=await owner.list({id:first.id});const results=await Promise.allSettled([1,2].map(()=>owner.approve({id:first.id,version:fresh.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})));
    expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(1);expect(results.filter(r=>r.status==="rejected")).toHaveLength(1);
  });
  it("rejects expired catalog/token and retains approved scope after removal",async()=>{
    const first=await ready();await owner.approve({id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true});
    const fresh=await owner.list({id:first.id});await prisma.ticketSourceConnection.update({where:{id:first.id},data:{catalogAt:new Date(Date.now()-660000)}});
    await expect(owner.approve({id:first.id,version:fresh.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await prisma.ticketSourceConnection.update({where:{id:first.id},data:{tokenExpiresAt:new Date(Date.now()-1000)}});
    await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect((await owner.mine({projectId}))[0]!.status).toBe("EXPIRED");await owner.forget({id:first.id,confirmed:true});
    const row=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});expect(row.encryptedToken).toBeNull();expect(row.approvedProjects).toEqual([projectA]);
  });
  it("rejects cross-workspace identity drift and unavailable provider without deleting approvals",async()=>{
    const first=await ready();await owner.approve({id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true});
    vi.mocked(listJiraProjects).mockResolvedValue({...listing(),workspace:{...workspace,id:randomUUID()}});await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    vi.mocked(listJiraProjects).mockRejectedValue(new Error(key));await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"BAD_REQUEST",message:expect.not.stringContaining(key)});
    expect((await owner.mine({projectId}))[0]!.approvedProjects).toEqual([projectA]);
  });
  it("uses visited opaque cursors, rejects pagination loops and preserves freshness epoch",async()=>{
    vi.mocked(listJiraProjects).mockResolvedValue(listing([projectA],50));const first=await ready();
    const baseline=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});
    await expect(owner.list({id:first.id,after:"https://internal.example" as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.list({id:first.id,after:50})).rejects.toMatchObject({code:"BAD_REQUEST"});
    vi.mocked(listJiraProjects).mockResolvedValue(listing([projectB],100));const next=await owner.list({id:first.id,after:50});
    expect(next.catalogReset).toBe(false);expect((await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}})).catalogAt).toEqual(baseline.catalogAt);
    await owner.approve({id:first.id,version:next.version,projectIds:[projectA.id,projectB.id],requestId:randomUUID(),approved:true});
  });
  it("retains expired legacy evidence while refusing a new token registration",async()=>{
    const first=await ready();await prisma.ticketSourceConnection.update({where:{id:first.id},data:{status:"VERIFYING",authorizationExpiresAt:new Date(Date.now()-1000),encryptedToken:undefined}});
    expect((await owner.mine({projectId}))[0]!.status).toBe("EXPIRED");await expect(owner.verify(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(await prisma.ticketSourceConnection.count({where:{projectId}})).toBe(1);expect((await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}})).encryptedToken).not.toBeNull();
  });
  it("reports the exact safe pagination boundary instead of offering a failing next page",async()=>{
    let native=20000;const batch=()=>Array.from({length:50},()=>{const id=String(++native);return {id,key:`P${id}`,name:`Synthetic batch ${id}`,url:`https://synthetic.atlassian.net/browse/P${id}`};});
    vi.mocked(listJiraProjects).mockResolvedValue(listing(batch(),50));const first=await ready();
    let result=first;
    for(let page=2;page<=10;page++){vi.mocked(listJiraProjects).mockResolvedValue(listing(batch(),page*50));result={id:first.id,...await owner.list({id:first.id,after:(page-1)*50})};}
    expect(result.bounded).toBe(true);expect(result.nextCursor).toBeNull();
    const row=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});expect((row.catalog as {projects:unknown[]}).projects).toHaveLength(500);
  });
  it("does not save stale list results after access is removed during provider I/O",async()=>{
    const first=await ready();vi.mocked(listJiraProjects).mockImplementationOnce(async()=>{await owner.forget({id:first.id,confirmed:true});return listing([projectB]);});
    await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    const row=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});expect(row.status).toBe("DISCONNECTED");expect(row.encryptedToken).toBeNull();
    expect((row.catalog as {projects:Array<{id:string}>}).projects.map(p=>p.id)).toEqual([projectA.id]);
  });
  it("enforces the ten-page limit server-side even when pages repeat native identities",async()=>{
    vi.mocked(listJiraProjects).mockResolvedValue(listing([projectA],50));const first=await ready();
    let page=first;
    for(let i=2;i<=10;i++){
      vi.mocked(listJiraProjects).mockResolvedValue(listing([projectA],i*50));
      page={id:first.id,...await owner.list({id:first.id,after:(i-1)*50})};
    }
    expect(page.bounded).toBe(true);expect(page.nextCursor).toBeNull();
    const calls=vi.mocked(listJiraProjects).mock.calls.length;
    await expect(owner.list({id:first.id,after:500})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(listJiraProjects).toHaveBeenCalledTimes(calls);
  });
  it("rejects suspended-workspace approval and stale context role changes",async()=>{
    const first=await ready();await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:ownerId}},data:{role:"VIEWER"}});
    await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(owner.approve({id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"FORBIDDEN"});
    await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:ownerId}},data:{role:"OWNER"}});
    await prisma.organization.update({where:{id:orgId},data:{suspendedAt:new Date()}});
    await expect(owner.approve({id:first.id,version:first.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect((await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}})).approvedProjects).toEqual([]);
  });
  it("cannot read or remove another provider's connection",async()=>{
    const first=await ready();await prisma.ticketSourceConnection.update({where:{id:first.id},data:{provider:"linear"}});
    await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"NOT_FOUND"});
    await expect(owner.forget({id:first.id,confirmed:true})).rejects.toMatchObject({code:"NOT_FOUND"});
    expect(await owner.mine({projectId})).toEqual([]);
  });
  it("rejects live role and read-only-seat changes during catalog I/O",async()=>{
    const first=await ready();
    const before=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});
    for(const data of [{role:"VIEWER" as const},{seatType:"READ_ONLY" as const}]){
      vi.mocked(listJiraProjects).mockImplementationOnce(async()=>{
        await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:ownerId}},data});return listing([projectB]);
      });
      await expect(owner.list({id:first.id})).rejects.toMatchObject({code:"FORBIDDEN"});
      const after=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:first.id}});
      expect(after.version).toBe(before.version);expect(after.catalog).toEqual(before.catalog);
      await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:ownerId}},data:{role:"OWNER",seatType:"FULL"}});
    }
  });
  it("rejects stale continuation before provider I/O and refuses new token enrollment",async()=>{
    vi.mocked(listJiraProjects).mockResolvedValue(listing([projectA],50));const first=await ready();
    await prisma.ticketSourceConnection.update({where:{id:first.id},data:{catalogAt:new Date(Date.now()-660000)}});
    const calls=vi.mocked(listJiraProjects).mock.calls.length;
    await expect(owner.list({id:first.id,after:50})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(listJiraProjects).toHaveBeenCalledTimes(calls);
    await owner.forget({id:first.id,confirmed:true});
    await expect(owner.verify(request())).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(listJiraProjects).toHaveBeenCalledTimes(calls);
  });
});
