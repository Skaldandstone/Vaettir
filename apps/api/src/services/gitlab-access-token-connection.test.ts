import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient, type RepositoryConnection } from "@vaettir/db";
import { repositoryConnectionsRouter } from "../routers/repositoryConnections.js";
import type { Context } from "../trpc.js";
import { decryptToken, encryptToken, type EncryptedToken } from "./tokenEncryption.js";
import { repositoryProviderJson, repositoryProviderRevokeGitlabToken } from "./repositoryProviderHttp.js";
import { hashOAuthState } from "./gitlabRepositoryOAuth.js";
vi.mock("./repositoryProviderHttp.js", async importOriginal => ({
  ...await importOriginal<typeof import("./repositoryProviderHttp.js")>(), repositoryProviderJson: vi.fn(), repositoryProviderRevokeGitlabToken: vi.fn(),
}));
const origin="https://gitlab.revyrie.co", token="glpat-synthetic-not-a-real-credential", requestId="00000000-0000-4000-8000-000000000001";
const request={projectId:"project",provider:"gitlab" as const,instanceUrl:origin,token,requestId,originalOrganizationId:"organization",expectedClerkActorId:"clerk",approveMetadataAccess:true as const};
const repositories=[{id:19,path_with_namespace:"atwist/api",web_url:`${origin}/atwist/api`,default_branch:"main"},{id:20,path_with_namespace:"atwist/web",web_url:`${origin}/atwist/web`,default_branch:"develop"}];
beforeEach(()=>{
  vi.resetAllMocks(); vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64")); vi.stubEnv("WEB_APP_URL","");
  vi.mocked(repositoryProviderJson).mockImplementation(async (_origin,path)=>path==="/api/v4/user"?{id:17,username:"synthetic-user"}:repositories);
  vi.mocked(repositoryProviderRevokeGitlabToken).mockResolvedValue(undefined);
});
afterEach(()=>vi.unstubAllEnvs());

// Actual registered router/middleware/callbacks and real local AES-GCM codec.
// In-memory Prisma spies model selectors only, not native locks/rollback/auth.
function fixture(){
  let row:RepositoryConnection|null=null;
  const member={id:"membership",organizationId:"organization",userId:"actor",role:"OWNER",seatType:"FULL"};
  const project={id:"project",organizationId:"organization",organization:{suspendedAt:null as Date|null}},actor={clerkUserId:"clerk"};
  const links:Array<Record<string,unknown>>=[];
  const json=(value:unknown):Prisma.JsonValue=>value===Prisma.DbNull?null:value as Prisma.JsonValue;
  const find=()=>row;
  const create=vi.fn(async ({data}:Prisma.RepositoryConnectionCreateArgs)=>{
    row={id:"connection",projectId:String(data.projectId),organizationId:String(data.organizationId),actorId:String(data.actorId),configurationId:null,
      provider:data.provider,origin:data.origin,stateHash:data.stateHash,status:data.status??"PENDING",encryptedVerifier:json(data.encryptedVerifier),encryptedToken:null,
      accountLabel:null,authorizationExpiresAt:new Date(data.authorizationExpiresAt),tokenExpiresAt:data.tokenExpiresAt?new Date(data.tokenExpiresAt):null,
      verifiedAt:null,catalog:null,catalogAt:null,createdAt:new Date()};
    return row;
  });
  function update(data:Prisma.RepositoryConnectionUpdateManyMutationInput){
    if(!row)throw Error("Missing synthetic row");
    Object.assign(row,data);
    for(const key of ["encryptedVerifier","encryptedToken","catalog"] as const)if(Object.hasOwn(data,key))row[key]=json(data[key]);
    return row;
  }
  const updateMany=vi.fn(async ({where,data}:Prisma.RepositoryConnectionUpdateManyArgs)=>{
    if(!row || where?.id && where.id!==row.id || typeof where?.status==="string" && where.status!==row.status)return{count:0};
    update(data??{});return{count:1};
  });
  const configuration=vi.fn(async ()=>({id:"oauth-app",organizationId:"organization",provider:"gitlab",origin,clientId:"synthetic-client",encryptedSecret:encryptToken("synthetic-app-secret")}));
  const connectionRows=vi.fn(async ()=>row?[{...row,project:{name:"Synthetic project"}}]:[]);
  const db={
    project:{findUnique:vi.fn(async ()=>project),findUniqueOrThrow:vi.fn(async ()=>project)},organization:{findUnique:vi.fn(async ()=>({suspendedAt:null}))},membership:{findUnique:vi.fn(async ()=>member)},
    $queryRaw:vi.fn(async (strings:TemplateStringsArray)=>{const sql=strings.join("");return sql.includes('FROM "User"')?[actor]:sql.includes('FROM "Project"')?[{organizationId:project.organizationId}]:sql.includes('"Organization"')?[{suspendedAt:null}]:[];}),
    repositoryConnection:{findUnique:vi.fn(async ({where}:{where:{stateHash?:string;id?:string}})=>row&&(where.id===row.id||where.stateHash===row.stateHash)?row:null),
      findUniqueOrThrow:vi.fn(async ()=>{if(!row)throw Error("Missing synthetic row");return row;}),findFirst:vi.fn(async ()=>find()),count:vi.fn(async ()=>0),create,updateMany,
      update:vi.fn(async ({data}:Prisma.RepositoryConnectionUpdateArgs)=>update(data)),findMany:connectionRows},
    repositoryProviderConfiguration:{findFirst:configuration,findMany:vi.fn(async ()=>[])},
    projectRepository:{findUnique:vi.fn(async ()=>null),findMany:vi.fn(async ()=>[]),create:vi.fn(async ({data}:{data:Record<string,unknown>})=>{links.push(data);return data;}),
      update:vi.fn(async ()=>undefined),updateMany:vi.fn(async ()=>({count:links.length}))},
    $transaction:async (callback:(tx:Prisma.TransactionClient)=>Promise<unknown>)=>callback(db as unknown as Prisma.TransactionClient),
  };
  const user={id:"actor",clerkUserId:"clerk",email:"synthetic@example.invalid",memberships:[{...member}]};
  const ctx={prisma:db as unknown as PrismaClient,user,authenticatedClerkSubject:"clerk",staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}} as unknown as Context;
  return{caller:repositoryConnectionsRouter.createCaller(ctx),ctx,db,user,member,project,actor,create,updateMany,configuration,connectionRows,links,
    get row(){return row!;},seed(values:Partial<RepositoryConnection>){if(!row)throw Error("Create a row first");Object.assign(row,values);}};
}

describe("actual GitLab token metadata connection callbacks",()=>{
  it("verifies exact self-host account and repositories without OAuth setup/callback, stores raw encrypted token and explicit marker",async()=>{
    const f=fixture(),ack=await f.caller.connectToken(request);
    expect(ack).toEqual({id:"connection",accountLabel:"synthetic-user",requestId,projectId:"project",originalOrganizationId:"organization",expectedClerkActorId:"clerk"});
    expect(repositoryProviderJson).toHaveBeenNthCalledWith(1,origin,"/api/v4/user",{token});
    const call=vi.mocked(repositoryProviderJson).mock.calls[1]!;
    expect(call[0]).toBe(origin);expect(new URL(call[1],origin).pathname).toBe("/api/v4/projects");expect(call[2]).toEqual({token});
    expect(f.row.configurationId).toBeNull();expect(f.row.status).toBe("VERIFIED");
    expect(f.row.encryptedVerifier).toEqual({accessMethod:"gitlab-token/v1",requestHash:hashOAuthState(JSON.stringify(["gitlab",origin,token,"","","organization","clerk"]))});
    expect(decryptToken(f.row.encryptedToken as unknown as EncryptedToken)).toBe(token);
    expect(JSON.stringify(f.row)).not.toContain(token);expect(JSON.stringify(f.row.catalog)).toContain("atwist/api");
    expect(f.configuration).not.toHaveBeenCalled();expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();expect(f.links).toEqual([]);
  });
  it("exact prior VERIFIED request recovers its original scoped acknowledgement without provider I/O or duplicate rows",async()=>{
    const f=fixture(),first=await f.caller.connectToken(request),calls=vi.mocked(repositoryProviderJson).mock.calls.length;
    expect(await f.caller.connectToken(request)).toEqual(first);expect(repositoryProviderJson).toHaveBeenCalledTimes(calls);expect(f.create).toHaveBeenCalledOnce();
    await expect(f.caller.connectToken({...request,token:"different-synthetic-token"})).rejects.toMatchObject({code:"CONFLICT"});
    expect(repositoryProviderJson).toHaveBeenCalledTimes(calls);
  });
  it.each(["missing-org","missing-actor","foreign-org","foreign-actor"])("%s original scope refuses before encryption/create/provider I/O",async mode=>{
    const f=fixture(),input={...request,originalOrganizationId:mode==="missing-org"?undefined:mode==="foreign-org"?"other":request.originalOrganizationId,
      expectedClerkActorId:mode==="missing-actor"?undefined:mode==="foreign-actor"?"other":request.expectedClerkActorId};
    await expect(f.caller.connectToken(input)).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.create).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("same native user remapped to another Clerk subject cannot reinterpret an old token UUID",async()=>{
    const f=fixture();await f.caller.connectToken(request);f.user.clerkUserId="changed-subject";
    await expect(f.caller.connectToken({...request,expectedClerkActorId:"changed-subject"})).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.create).toHaveBeenCalledOnce();
    f.ctx.authenticatedClerkSubject="changed-subject";f.actor.clerkUserId="changed-subject";
    await expect(f.caller.connectToken({...request,expectedClerkActorId:"changed-subject"})).rejects.toMatchObject({code:"CONFLICT"});expect(f.create).toHaveBeenCalledOnce();
  });
  it.each([undefined,null,"another-authenticated-subject"])("missing/foreign verified transport subject %s cannot use client pins or cached native identity as authorization",async subject=>{
    const f=fixture();f.ctx.authenticatedClerkSubject=subject;
    await expect(f.caller.connectToken(request)).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.create).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it.each(["actor","organization"])("changed locked native %s before receipt lookup cannot recover or persist credentials",async scope=>{
    const f=fixture();await f.caller.connectToken(request);const calls=vi.mocked(repositoryProviderJson).mock.calls.length;
    if(scope==="actor")f.actor.clerkUserId="remapped-native-subject";
    else f.db.project.findUniqueOrThrow.mockResolvedValue({...f.project,organizationId:"different-org"});
    await expect(f.caller.connectToken(request)).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.create).toHaveBeenCalledOnce();expect(repositoryProviderJson).toHaveBeenCalledTimes(calls);
  });
  it("same UUID recovery rechecks the live full-editor role before returning an old acknowledgement",async()=>{
    const f=fixture();await f.caller.connectToken(request);const calls=vi.mocked(repositoryProviderJson).mock.calls.length;
    f.member.role="VIEWER";
    await expect(f.caller.connectToken(request)).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(repositoryProviderJson).toHaveBeenCalledTimes(calls);expect(f.create).toHaveBeenCalledOnce();expect(f.row.status).toBe("VERIFIED");
  });
  it.each(["VIEWER","READ_ONLY","SUSPENDED"])("current %s authority cannot verify a token",async mode=>{
    const f=fixture();if(mode==="VIEWER")f.user.memberships[0]!.role="VIEWER";
    if(mode==="READ_ONLY")f.user.memberships[0]!.seatType="READ_ONLY";
    if(mode==="SUSPENDED")f.db.organization.findUnique.mockResolvedValue({suspendedAt:new Date()} as never);
    await expect(f.caller.connectToken(request)).rejects.toMatchObject({code:"FORBIDDEN"});expect(f.create).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it.each(["user","repositories"])("failed %s read never persists credentials or claims remote token revocation",async stage=>{
    const f=fixture();vi.mocked(repositoryProviderJson).mockImplementation(async (_origin,path)=>{if(stage==="user"||path!=="/api/v4/user")throw Error(token);return{id:17,username:"synthetic-user"};});
    const failure=f.caller.connectToken(request);await expect(failure).rejects.toMatchObject({code:"BAD_REQUEST"});await expect(failure).rejects.not.toThrow(token);
    expect(f.row.status).toBe("FAILED");expect(f.row.encryptedToken).toBeNull();expect(f.row.encryptedVerifier).toMatchObject({accessMethod:"gitlab-token/v1"});
    expect(JSON.stringify(f.row)).not.toContain(token);expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();expect(f.links).toEqual([]);
  });
  it("live full-seat loss during provider lookup refuses credential persistence",async()=>{
    const f=fixture();vi.mocked(repositoryProviderJson).mockImplementation(async (_origin,path)=>{f.member.seatType="READ_ONLY";return path==="/api/v4/user"?{id:17,username:"synthetic-user"}:repositories;});
    await expect(f.caller.connectToken(request)).rejects.toMatchObject({code:"BAD_REQUEST"});expect(f.row.status).toBe("FAILED");expect(f.row.encryptedToken).toBeNull();
  });
  it.each(["actor","organization","suspension"])("native %s change during provider I/O refuses secret persistence under the original body",async scope=>{
    const f=fixture();vi.mocked(repositoryProviderJson).mockImplementation(async (_origin,path)=>{
      if(scope==="actor")f.actor.clerkUserId="remapped-native-subject";
      if(scope==="organization")f.project.organizationId="different-org";
      if(scope==="suspension")f.project.organization.suspendedAt=new Date();
      return path==="/api/v4/user"?{id:17,username:"synthetic-user"}:repositories;
    });
    await expect(f.caller.connectToken(request)).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(f.row.status).toBe("FAILED");expect(f.row.encryptedToken).toBeNull();expect(f.configuration).not.toHaveBeenCalled();
  });
  it.each(["",`${origin}/dashboard/projects`,"http://gitlab.revyrie.co",`https://user:pass@gitlab.revyrie.co`,`${origin}?x=1`])("invalid instance %s refuses before provider request",async instanceUrl=>{
    const f=fixture();await expect(f.caller.connectToken({...request,instanceUrl})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(f.create).not.toHaveBeenCalled();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("listing uses OAuth-compatible raw decryption and reviewed multi-selection links metadata only",async()=>{
    const f=fixture();await f.caller.connectToken(request);vi.mocked(repositoryProviderJson).mockClear();
    const page=await f.caller.list({id:f.row.id,page:2,search:"atwist"});
    expect(repositoryProviderJson).toHaveBeenCalledExactlyOnceWith(origin,expect.stringContaining("/api/v4/projects?"),{token});
    expect(page.repositories).toHaveLength(2);expect(page.catalogVersion).toMatch(/^[a-f0-9]{64}$/);
    expect(await f.caller.connectSelected({id:f.row.id,repositoryIds:["19","20"],catalogVersion:page.catalogVersion,approved:true})).toEqual({connected:2});
    expect(f.links.map(row=>row.externalId)).toEqual(["19","20"]);expect(f.links.every(row=>row.projectId==="project"&&row.provider==="gitlab")).toBe(true);
    expect(f.configuration).not.toHaveBeenCalled();expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("PAT removal clears local credential/links, keeps exact method marker for repeated removal, and explicitly requires provider revocation",async()=>{
    const f=fixture();await f.caller.connectToken(request);const marker=structuredClone(f.row.encryptedVerifier);
    await expect(f.caller.disconnect({id:f.row.id})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(f.row.encryptedToken).not.toBeNull();
    expect(await f.caller.forgetToken({id:f.row.id,confirmed:true})).toEqual({removed:true,providerRevocationRequired:true});
    expect(f.row.status).toBe("DISCONNECTED");expect(f.row.encryptedToken).toBeNull();expect(f.row.encryptedVerifier).toEqual(marker);
    expect(await f.caller.forgetToken({id:f.row.id,confirmed:true})).toEqual({removed:true,providerRevocationRequired:true});
    expect(f.db.projectRepository.updateMany).toHaveBeenCalled();expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("token removal revalidates the explicit method after its native row lock instead of erasing a changed OAuth grant",async()=>{
    const f=fixture();await f.caller.connectToken(request);const credential=structuredClone(f.row.encryptedToken);
    f.db.repositoryConnection.findUniqueOrThrow.mockImplementationOnce(async()=>{f.seed({configurationId:"oauth-app",encryptedVerifier:null});return f.row;});
    await expect(f.caller.forgetToken({id:f.row.id,confirmed:true})).rejects.toMatchObject({code:"CONFLICT"});
    expect(f.row.encryptedToken).toEqual(credential);expect(f.db.projectRepository.updateMany).not.toHaveBeenCalled();expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("expired local verification refuses provider listing but preserves explicit local removal and manual-revocation distinction",async()=>{
    const f=fixture();await f.caller.connectToken(request);f.seed({tokenExpiresAt:new Date(Date.now()+10000)});vi.mocked(repositoryProviderJson).mockClear();
    await expect(f.caller.list({id:f.row.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(repositoryProviderJson).not.toHaveBeenCalled();
    expect((await f.caller.mine({projectId:"project"}))[0]).toMatchObject({status:"EXPIRED",accessMethod:"token"});
    expect(await f.caller.forgetToken({id:f.row.id,confirmed:true})).toEqual({removed:true,providerRevocationRequired:true});
    expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("OAuth uses exact existing remote revocation and cannot be erased by token removal",async()=>{
    const f=fixture();await f.caller.connectToken(request);f.seed({configurationId:"oauth-app",encryptedVerifier:null});
    await expect(f.caller.forgetToken({id:f.row.id,confirmed:true})).rejects.toMatchObject({code:"BAD_REQUEST"});expect(f.row.encryptedToken).not.toBeNull();
    expect(await f.caller.disconnect({id:f.row.id})).toEqual({disconnected:true});
    expect(repositoryProviderRevokeGitlabToken).toHaveBeenCalledExactlyOnceWith(origin,"synthetic-client","synthetic-app-secret",token);
    expect(f.row.encryptedToken).toBeNull();
  });
  it.each([null,{}, {accessMethod:"gitlab-token/v2",requestHash:"a".repeat(64)}, {accessMethod:"gitlab-token/v1",requestHash:"bad"}])("unmarked/corrupt GitLab method %j fails closed for listing/removal/revocation",async marker=>{
    const f=fixture();await f.caller.connectToken(request);f.seed({encryptedVerifier:marker});vi.mocked(repositoryProviderJson).mockClear();
    await expect(f.caller.list({id:f.row.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await expect(f.caller.forgetToken({id:f.row.id,confirmed:true})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(f.caller.disconnect({id:f.row.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(f.row.encryptedToken).not.toBeNull();expect(repositoryProviderJson).not.toHaveBeenCalled();expect(repositoryProviderRevokeGitlabToken).not.toHaveBeenCalled();
  });
  it("secret-free mine distinguishes explicit token/configured OAuth/unavailable, and admin OAuth grants exclude PAT",async()=>{
    const f=fixture();await f.caller.connectToken(request);
    expect(await f.caller.mine({projectId:"project"})).toEqual([{id:f.row.id,provider:"gitlab",origin,status:"VERIFIED",accountLabel:"synthetic-user",accessMethod:"token",authorizationKind:"token",installationUrl:null}]);
    expect(await f.caller.revocableGrants({projectId:"project",provider:"gitlab"})).toEqual([]);
    f.seed({configurationId:"oauth-app",encryptedVerifier:null});expect((await f.caller.mine({projectId:"project"}))[0]!.accessMethod).toBe("oauth");
    expect(await f.caller.revocableGrants({projectId:"project",provider:"gitlab"})).toHaveLength(1);
    f.seed({configurationId:null});expect((await f.caller.mine({projectId:"project"}))[0]!.accessMethod).toBe("unavailable");
    expect(JSON.stringify(await f.caller.mine({projectId:"project"}))).not.toContain(token);
  });
  it("configuration discovery exposes authorized organization and separate token storage readiness without callback",async()=>{
    const f=fixture();expect(await f.caller.configurations({projectId:"project"})).toMatchObject({organizationId:"organization",credentialStorageReady:true,callbackReady:false,storageReady:false});
  });
});
