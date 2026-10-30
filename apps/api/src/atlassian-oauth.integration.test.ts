import {randomUUID} from "node:crypto";
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from "vitest";
import {prisma,type PrismaClient} from "@vaettir/db";
import type {Context} from "./trpc.js";
import {assertOwnedTestDatabase} from "./testOnlyDatabaseSafety.js";
import {atlassianConnectionsRouter} from "./routers/atlassianConnections.js";
import {jiraConnectionsRouter} from "./routers/jiraConnections.js";
import {decryptToken,encryptToken} from "./services/tokenEncryption.js";
import {jiraOAuthCredentials} from "./services/atlassianOAuthConnection.js";
import * as provider from "./services/atlassianOAuth.js";
import {runDueAtlassianPrivacy} from "./jobs/atlassianPrivacyWorker.js";
import {ProviderStatusError} from "./services/repositoryProviderHttp.js";

vi.mock("./services/atlassianOAuth.js",async original=>{
  const real=await original<typeof import("./services/atlassianOAuth.js")>();
  return {...real,exchangeAtlassianCode:vi.fn(),refreshAtlassianToken:vi.fn(),verifyAtlassianToken:vi.fn(),listAtlassianSites:vi.fn(),listAtlassianResources:vi.fn(),reportAtlassianPrivacy:vi.fn(),readAtlassianAccount:vi.fn()};
});
const site={id:"01234567-89ab-cdef-0123-456789abcdef",name:"Synthetic site",url:"https://synthetic.atlassian.net",products:["jira","confluence"] as ("jira"|"confluence")[]};
const resource={id:"123",key:"QA",name:"Synthetic QA",url:site.url+"/browse/QA"};
let providerAccountId="synthetic-account";
const token=()=>({accessToken:"synthetic-access",refreshToken:"synthetic-refresh",expiresAt:Date.now()+3600000,accountId:providerAccountId,accountName:"Synthetic tester"});
const issued={access_token:"synthetic-access",refresh_token:"synthetic-refresh",token_type:"Bearer",expires_in:3600};
type Caller=ReturnType<typeof atlassianConnectionsRouter.createCaller>;
let ctx:Context,caller:Caller,projectId:string,organizationId:string,clerkActorId:string;
const input=()=>({projectId,originalOrganizationId:organizationId,expectedClerkActorId:clerkActorId,product:"jira" as const,requestId:randomUUID(),approveMetadataAccess:true as const});
const begin=async()=>{const result=await caller.begin(input());return {...result,state:new URL(result.url).searchParams.get("state")!};};
const verified=async()=>{const result=await begin();await caller.finish({state:result.state,code:"synthetic-code"});return result;};
const selected=async()=>{const result=await verified(),row=await caller.status({id:result.id});await caller.selectSite({id:result.id,siteId:site.id,version:row.version});return result;};
// Maintenance runs against the actual owned database and real transactions;
// the test client restricts its candidate scan to this test's fresh project.
const privacyDb=()=>prisma.$extends({query:{atlassianOAuthConnection:{findMany({args,query}){return query(args.where&&"OR" in args.where?{...args,where:{AND:[args.where,{projectId}]}}:args);}}}}) as unknown as PrismaClient;
const duePrivacy=async(id:string)=>prisma.atlassianOAuthConnection.update({where:{id},data:{privacyDueAt:new Date(0),privacyCheckedAt:new Date(Date.now()-7*86400000-60000)}});
function observedTransactions(){
  const failures:Array<{name:string;code:string|null}>=[];
  const db=new Proxy(prisma,{get(target,key){
    const value=Reflect.get(target,key,target);
    if(key!=="$transaction")return value;
    return (...args:unknown[])=>Reflect.apply(value,target,args).catch((error:unknown)=>{
      failures.push({name:error instanceof Error?error.name:"UnknownError",code:error&&typeof error==="object"&&"code" in error?String(error.code):null});throw error;
    });
  }});
  return {db,failures};
}
function gate(){let resolve!:()=>void;const promise=new Promise<void>(done=>{resolve=done;});return {promise,resolve};}
async function blockedTransactions(count:number){
  const deadline=Date.now()+3000;
  while(Date.now()<deadline){
    const [row]=await prisma.$queryRaw<Array<{count:number}>>`SELECT count(*)::int AS count FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND backend_type='client backend'`;
    if(row.count>=count)return;
    await new Promise(done=>setTimeout(done,10));
  }
  throw Error("Expected owned database lock contention was not observed");
}
function ownedDatabase(){
  try{return assertOwnedTestDatabase(process.env.DATABASE_URL);}catch{
    // This suite additionally owns one separately initialized native PG17 fixture.
    // Never broaden the shared admission helper or admit a customer/server URL.
    const url=new URL(process.env.DATABASE_URL??"");
    if(url.protocol!=="postgresql:"||url.hostname!=="127.0.0.1"||url.port!=="61200"||url.username!=="oauth_test"||!/^\/vaettir_oauth_test_[0-9]{13}$/.test(url.pathname)||url.hash||url.search!=="?schema=public&connection_limit=5")throw Error("Exact owned OAuth test database required");
  }
}
describe("Atlassian OAuth durable authorization boundaries",()=>{
  beforeAll(()=>{ownedDatabase();vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,7).toString("base64"));vi.stubEnv("ATLASSIAN_OAUTH_PUBLIC_URL","https://app.vaettir.app");vi.stubEnv("ATLASSIAN_OAUTH_CLIENT_ID","synthetic-client");vi.stubEnv("ATLASSIAN_OAUTH_CLIENT_SECRET","synthetic-secret");});
  beforeEach(async()=>{
    vi.clearAllMocks();providerAccountId="synthetic-"+randomUUID();
    vi.mocked(provider.reportAtlassianPrivacy).mockResolvedValue({decision:"clear",cycleDays:7});
    vi.mocked(provider.readAtlassianAccount).mockResolvedValue({account_id:providerAccountId,name:"Updated synthetic user",account_type:"atlassian",account_status:"active"});
    vi.mocked(provider.exchangeAtlassianCode).mockResolvedValue(issued);vi.mocked(provider.refreshAtlassianToken).mockResolvedValue({...issued,refresh_token:"synthetic-rotated"});vi.mocked(provider.verifyAtlassianToken).mockImplementation(async()=>token());vi.mocked(provider.listAtlassianSites).mockResolvedValue([site]);vi.mocked(provider.listAtlassianResources).mockResolvedValue({resources:[resource],next:null});
    const tag=`oauth-${randomUUID()}`,tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    const org=await prisma.organization.create({data:{name:tag,slug:tag,planTierId:tier.id}});organizationId=org.id;clerkActorId=tag;
    const user=await prisma.user.create({data:{clerkUserId:clerkActorId,email:tag+"@example.com",memberships:{create:{organizationId,role:"OWNER",seatType:"FULL"}}},include:{memberships:true}});
    const project=await prisma.project.create({data:{organizationId,name:tag,slug:tag}});projectId=project.id;
    ctx={prisma,user,authenticatedClerkSubject:clerkActorId,authenticatedApiKeyId:null,workspaceOrganizationId:organizationId} as Context;caller=atlassianConnectionsRouter.createCaller(ctx);
  });
  afterAll(async()=>{vi.unstubAllEnvs();await prisma.$disconnect();});
  it("resumes one begin receipt with the original state and encrypted application",async()=>{
    const request=input(),a=await caller.begin(request),b=await caller.begin(request);expect(b).toEqual(a);
    const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(JSON.stringify(row)).not.toContain("synthetic-secret");expect(new URL(a.url).searchParams.has("client_secret")).toBe(false);expect(await prisma.atlassianOAuthConnection.count({where:{projectId}})).toBe(1);
  });
  it("refuses service tokens, foreign ingress and forged human pins before issuing state",async()=>{
    for(const changed of [{...ctx,authenticatedClerkSubject:null},{...ctx,authenticatedApiKeyId:"service-token"},{...ctx,workspaceOrganizationId:"foreign"}])await expect(atlassianConnectionsRouter.createCaller(changed).begin(input())).rejects.toThrow();
    await expect(caller.begin({...input(),expectedClerkActorId:"wrong"})).rejects.toThrow();expect(await prisma.atlassianOAuthConnection.count({where:{projectId}})).toBe(0);
  });
  it("exchanges a code at most once and never returns tokens in public status",async()=>{
    const result=await verified();await expect(caller.finish({state:result.state,code:"synthetic-code"})).rejects.toThrow();expect(provider.exchangeAtlassianCode).toHaveBeenCalledTimes(1);const status=await caller.status({id:result.id});expect(status.status).toBe("VERIFIED");expect(status.selectedSite).toEqual(site);expect(JSON.stringify(status)).not.toMatch(/synthetic-access|synthetic-refresh|clientSecret|ciphertext/);
  });
  it("serializes simultaneous code exchanges and refresh rotations",async()=>{
    const {db,failures}=observedTransactions(),concurrent=atlassianConnectionsRouter.createCaller({...ctx,prisma:db});
    const a=await begin();const exchanges=await Promise.allSettled([concurrent.finish({state:a.state,code:"code"}),concurrent.finish({state:a.state,code:"code"})]);expect(exchanges.filter(x=>x.status==="fulfilled"),JSON.stringify({failures,exchangeCalls:vi.mocked(provider.exchangeAtlassianCode).mock.calls.length,verifyCalls:vi.mocked(provider.verifyAtlassianToken).mock.calls.length,privacyCalls:vi.mocked(provider.reportAtlassianPrivacy).mock.calls.length})).toHaveLength(1);expect(provider.exchangeAtlassianCode).toHaveBeenCalledTimes(1);
    const refreshes=await Promise.allSettled([concurrent.refresh({id:a.id}),concurrent.refresh({id:a.id})]);expect(refreshes.filter(x=>x.status==="fulfilled"),JSON.stringify({failures})).toHaveLength(1);expect(provider.refreshAtlassianToken).toHaveBeenCalledTimes(1);
  });
  it("keeps callback privacy writes in parent-before-connection lock order",async()=>{
    const {db,failures}=observedTransactions(),concurrent=atlassianConnectionsRouter.createCaller({...ctx,prisma:db});
    const issue=gate(),issuedStarted=gate(),actorHeld=gate(),releaseActor=gate();
    vi.mocked(provider.exchangeAtlassianCode).mockImplementationOnce(async()=>{issuedStarted.resolve();await issue.promise;return issued;});
    const a=await begin(),winner=concurrent.finish({state:a.state,code:"code"});
    let holder:Promise<unknown>|undefined,contender:Promise<unknown>|undefined;
    try{
      await issuedStarted.promise;
      holder=prisma.$transaction(async tx=>{
        await tx.$queryRaw`SELECT id FROM "User" WHERE id=${ctx.user.id} FOR UPDATE`;
        actorHeld.resolve();await releaseActor.promise;
      },{timeout:10000});
      await actorHeld.promise;
      contender=concurrent.finish({state:a.state,code:"code"});
      // The duplicate callback holds its project lock while waiting for actor
      // admission. Release provider I/O only after that real lock is observed.
      await blockedTransactions(1);issue.resolve();await blockedTransactions(2);
      releaseActor.resolve();await holder;
      const outcomes=await Promise.allSettled([winner,contender]);
      expect(failures.filter(row=>row.name.startsWith("Prisma")),JSON.stringify(failures)).toEqual([]);
      expect(outcomes.filter(row=>row.status==="fulfilled")).toHaveLength(1);
      expect(provider.exchangeAtlassianCode).toHaveBeenCalledTimes(1);
    }finally{
      issue.resolve();releaseActor.resolve();await Promise.allSettled([winner,...(holder?[holder]:[]),...(contender?[contender]:[])]);
    }
  },15000);
  it("refuses expired, cancelled and unknown states without exchange",async()=>{
    const a=await begin();await prisma.atlassianOAuthConnection.update({where:{id:a.id},data:{authorizationExpiresAt:new Date(0)}});await expect(caller.finish({state:a.state,code:"code"})).rejects.toThrow();
    const b=await begin();await caller.finish({state:b.state,denied:true});await expect(caller.finish({state:b.state,code:"code"})).rejects.toThrow();await expect(caller.finish({state:"x".repeat(43),code:"code"})).rejects.toThrow();expect(provider.exchangeAtlassianCode).not.toHaveBeenCalled();
  });
  it("refuses another actor and a changed native Clerk mapping",async()=>{
    const a=await begin();await prisma.user.update({where:{id:ctx.user!.id},data:{clerkUserId:clerkActorId+"-remapped"}});await expect(caller.finish({state:a.state,code:"code"})).rejects.toThrow();expect(provider.exchangeAtlassianCode).not.toHaveBeenCalled();
  });
  it("retains encrypted issued credentials when membership is lost during exchange",async()=>{
    const a=await begin();vi.mocked(provider.exchangeAtlassianCode).mockImplementation(async()=>{await prisma.membership.delete({where:{organizationId_userId:{organizationId,userId:ctx.user!.id}}});return issued;});
    await expect(caller.finish({state:a.state,code:"code"})).rejects.toThrow();const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row.status).toBe("RECOVERY_REQUIRED");expect(row.tokenExpiresAt).toBeNull();expect(row.encryptedToken).toBeTruthy();expect(JSON.stringify(row)).not.toContain("synthetic-access");await expect(caller.status({id:a.id})).rejects.toThrow();
  });
  it("a disconnect during exchange admits no late verified grant",async()=>{
    const a=await begin();vi.mocked(provider.exchangeAtlassianCode).mockImplementation(async()=>{await caller.disconnect({id:a.id,confirmed:true});return issued;});await expect(caller.finish({state:a.state,code:"code"})).rejects.toThrow();const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row.status).toBe("RECOVERY_REQUIRED");expect(row.tokenExpiresAt).toBeNull();expect(row.encryptedToken).toBeTruthy();expect(await prisma.ticketSourceConnection.count({where:{oauthConnectionId:a.id}})).toBe(0);
  });
  it("unknown exchange outcomes are retained and never automatically replayed",async()=>{
    const a=await begin();vi.mocked(provider.exchangeAtlassianCode).mockRejectedValue(Error("transport timeout"));await expect(caller.finish({state:a.state,code:"code"})).rejects.toThrow();await expect(caller.finish({state:a.state,code:"code"})).rejects.toThrow();expect(provider.exchangeAtlassianCode).toHaveBeenCalledTimes(1);expect((await caller.status({id:a.id})).status).toBe("RECOVERY_REQUIRED");
  });
  it("refresh rotation is single-use and preserves selected scope on failure",async()=>{
    const a=await selected();vi.mocked(provider.refreshAtlassianToken).mockRejectedValue(Error("unknown refresh"));await expect(caller.refresh({id:a.id})).rejects.toThrow();await expect(caller.refresh({id:a.id})).rejects.toThrow();expect(provider.refreshAtlassianToken).toHaveBeenCalledTimes(1);const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row.status).toBe("RECOVERY_REQUIRED");expect(row.selectedSite).toMatchObject({id:site.id});expect(row.encryptedToken).toBeTruthy();
  });
  it("checks the same account when rotating, and retains encrypted rotated credentials",async()=>{
    const a=await verified();vi.mocked(provider.verifyAtlassianToken).mockRejectedValue(Error("identity changed"));await expect(caller.refresh({id:a.id})).rejects.toThrow();expect(provider.verifyAtlassianToken).toHaveBeenLastCalledWith({...issued,refresh_token:"synthetic-rotated"},providerAccountId);const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row.status).toBe("RECOVERY_REQUIRED");expect(decryptToken(row.encryptedToken as {iv:string;ciphertext:string;authTag:string})).toContain("synthetic-rotated");
  });
  it("requires an observed site and rejects a catalog response after revocation",async()=>{
    const a=await verified(),status=await caller.status({id:a.id});await expect(caller.selectSite({id:a.id,siteId:"foreign-site",version:status.version})).rejects.toThrow();await caller.selectSite({id:a.id,siteId:site.id,version:status.version});vi.mocked(provider.listAtlassianResources).mockImplementation(async()=>{await caller.disconnect({id:a.id,confirmed:true});return {resources:[resource],next:null};});await expect(caller.catalog({id:a.id,after:null})).rejects.toThrow();expect((await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}})).catalog).toBeNull();
  });
  it("approves Confluence spaces without creating Jira or Forge sharing access",async()=>{
    const a=await caller.begin({...input(),product:"confluence"}),state=new URL(a.url).searchParams.get("state")!;await caller.finish({state,code:"code"});const status=await caller.status({id:a.id});await caller.selectSite({id:a.id,siteId:site.id,version:status.version});
    const space={id:"321",key:"QA",name:"Synthetic space",url:site.url+"/wiki/spaces/QA"};vi.mocked(provider.listAtlassianResources).mockResolvedValue({resources:[space],next:null});const page=await caller.catalog({id:a.id,after:null});await caller.approve({id:a.id,version:page.version,resourceIds:[space.id],requestId:randomUUID(),approved:true});expect((await caller.status({id:a.id})).approvedResources).toEqual([space]);expect(await prisma.ticketSourceConnection.count({where:{projectId}})).toBe(0);
  });
  it("approves only observed resources and idempotently links the existing Jira reader",async()=>{
    const a=await selected(),page=await caller.catalog({id:a.id,after:null});const request={id:a.id,version:page.version,resourceIds:[resource.id],requestId:randomUUID(),approved:true as const};await expect(caller.approve({...request,resourceIds:["999"]})).rejects.toThrow();const first=await caller.approve(request);expect(await caller.approve(request)).toEqual(first);expect(first.saved).toBe(1);
    const linked=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{oauthConnectionId:a.id}});expect(linked.approvedProjects).toEqual([resource]);expect(linked.status).toBe("VERIFIED");expect(await jiraOAuthCredentials(ctx,linked)).toMatchObject({kind:"oauth",cloudId:site.id,siteUrl:site.url});await caller.disconnect({id:a.id,confirmed:true});await expect(jiraOAuthCredentials(ctx,linked)).rejects.toThrow();expect((await prisma.ticketSourceConnection.findUniqueOrThrow({where:{id:linked.id}})).status).toBe("DISCONNECTED");
  });
  it("atomic ticket projection failure rolls back both approval and receipt",async()=>{
    const a=await selected(),page=await caller.catalog({id:a.id,after:null});const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});
    await prisma.ticketSourceConnection.create({data:{projectId,organizationId,actorId:ctx.user!.id,provider:"jira",providerOrigin:site.url,requestKey:`atlassian:${a.id}`,requestHash:row.stateHash,authorizationExpiresAt:row.authorizationExpiresAt}});
    await expect(caller.approve({id:a.id,version:page.version,resourceIds:[resource.id],requestId:randomUUID(),approved:true})).rejects.toThrow();const after=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(after.approvedResources).toEqual([]);expect(after.approvalReceipts).toEqual([]);
  });
  it("legacy endpoints cannot broaden an OAuth approval or keep it live after removal",async()=>{
    const a=await selected(),page=await caller.catalog({id:a.id,after:null});await caller.approve({id:a.id,version:page.version,resourceIds:[resource.id],requestId:randomUUID(),approved:true});const linked=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{oauthConnectionId:a.id}});
    await expect(jiraConnectionsRouter.createCaller(ctx).approve({id:linked.id,version:linked.version,projectIds:["999"],requestId:randomUUID(),approved:true})).rejects.toThrow("browser connection");await expect(jiraOAuthCredentials(ctx,{...linked,approvedProjects:[{...resource,id:"999"}]})).rejects.toThrow();await jiraConnectionsRouter.createCaller(ctx).forget({id:linked.id,confirmed:true});expect((await caller.status({id:a.id})).status).toBe("DISCONNECTED");
  });
  it("project transfer, suspension and downgraded seats stop reads",async()=>{
    const a=await selected();await prisma.organization.update({where:{id:organizationId},data:{suspendedAt:new Date()}});await expect(caller.status({id:a.id})).rejects.toThrow();await prisma.organization.update({where:{id:organizationId},data:{suspendedAt:null}});await prisma.membership.update({where:{organizationId_userId:{organizationId,userId:ctx.user!.id}},data:{seatType:"READ_ONLY"}});await expect(caller.catalog({id:a.id,after:null})).rejects.toThrow();expect(provider.listAtlassianResources).not.toHaveBeenCalled();
    await prisma.membership.update({where:{organizationId_userId:{organizationId,userId:ctx.user!.id}},data:{seatType:"FULL"}});const original=await prisma.organization.findUniqueOrThrow({where:{id:organizationId}}),other=await prisma.organization.create({data:{name:"Synthetic transfer",slug:randomUUID(),planTierId:original.planTierId}});await prisma.project.update({where:{id:projectId},data:{organizationId:other.id}});await expect(caller.status({id:a.id})).rejects.toThrow();expect(provider.listAtlassianResources).not.toHaveBeenCalled();
  });
  it("requires initial provider privacy acknowledgement before a grant is usable",async()=>{
    const a=await verified(),row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});
    expect(row.privacyCheckedAt).not.toBeNull();expect(row.privacyDueAt!.getTime()).toBeGreaterThan(Date.now());
    await duePrivacy(a.id);vi.mocked(provider.reportAtlassianPrivacy).mockResolvedValue({decision:"closed",cycleDays:7});
    const closed=await begin();await expect(caller.finish({state:closed.state,code:"synthetic-closed"})).rejects.toThrow();
    const erased=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:closed.id}});
    expect(erased.status).toBe("DISCONNECTED");expect(erased.encryptedToken).toBeNull();expect(erased.accountId).toBeNull();
  });
  it("reports a due account once across simultaneous maintenance workers",async()=>{
    const a=await verified(),before=await duePrivacy(a.id);vi.mocked(provider.reportAtlassianPrivacy).mockClear();
    await Promise.all([runDueAtlassianPrivacy(privacyDb()),runDueAtlassianPrivacy(privacyDb())]);
    const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});
    expect(provider.reportAtlassianPrivacy).toHaveBeenCalledTimes(1);expect(row.status).toBe("VERIFIED");expect(row.operationId).toBeNull();expect(row.version).toBeGreaterThan(before.version);expect(row.privacyDueAt!.getTime()).toBeGreaterThan(Date.now());
  });
  it("refreshes changed profile data and invalidates the linked cached account",async()=>{
    const a=await selected(),page=await caller.catalog({id:a.id,after:null});await caller.approve({id:a.id,version:page.version,resourceIds:[resource.id],requestId:randomUUID(),approved:true});
    await duePrivacy(a.id);vi.mocked(provider.reportAtlassianPrivacy).mockResolvedValueOnce({decision:"updated",cycleDays:7}).mockResolvedValue({decision:"clear",cycleDays:7});
    await runDueAtlassianPrivacy(privacyDb());
    const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}}),linked=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{oauthConnectionId:a.id}});
    expect(row.accountName).toBe("Updated synthetic user");expect(linked.catalog).toBeNull();expect(row.status).toBe("VERIFIED");expect(row.approvedResources).toEqual([resource]);
  });
  it("erases closed-account identity, credentials and linked profile copies",async()=>{
    const a=await selected(),page=await caller.catalog({id:a.id,after:null});await caller.approve({id:a.id,version:page.version,resourceIds:[resource.id],requestId:randomUUID(),approved:true});
    await duePrivacy(a.id);vi.mocked(provider.reportAtlassianPrivacy).mockResolvedValue({decision:"closed",cycleDays:7});await runDueAtlassianPrivacy(privacyDb());
    const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}}),linked=await prisma.ticketSourceConnection.findUniqueOrThrow({where:{oauthConnectionId:a.id}});
    expect(row).toMatchObject({status:"DISCONNECTED",accountId:null,accountName:null,encryptedToken:null,encryptedApplication:{},encryptedState:null,catalog:null,privacyDueAt:null});expect(linked).toMatchObject({status:"DISCONNECTED",catalog:null,encryptedToken:null});
  });
  it("never restores a connection disconnected during a privacy request",async()=>{
    const a=await verified();await duePrivacy(a.id);let release!:(value:Awaited<ReturnType<typeof provider.reportAtlassianPrivacy>>)=>void,entered!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;});
    vi.mocked(provider.reportAtlassianPrivacy).mockImplementationOnce(()=>{entered();return new Promise(resolve=>{release=resolve;});});
    const maintenance=runDueAtlassianPrivacy(privacyDb());await started;await caller.disconnect({id:a.id,confirmed:true});release({decision:"clear",cycleDays:7});await maintenance;
    const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row).toMatchObject({status:"DISCONNECTED",accountId:null,accountName:null,encryptedToken:null,operationId:null});
  });
  it("honors rate-limit delay while a recent successful check remains valid",async()=>{
    const a=await verified(),before=await duePrivacy(a.id);vi.mocked(provider.reportAtlassianPrivacy).mockRejectedValue(new ProviderStatusError(429,7200));await runDueAtlassianPrivacy(privacyDb());
    const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row.status).toBe("VERIFIED");expect(row.privacyCheckedAt).toEqual(before.privacyCheckedAt);expect(row.privacyDueAt!.getTime()).toBeGreaterThan(Date.now()+7100000);expect(row.encryptedToken).not.toBeNull();
  });
  it("blocks and erases when successful checks are too old and the provider is unavailable",async()=>{
    const a=await verified();await prisma.atlassianOAuthConnection.update({where:{id:a.id},data:{privacyCheckedAt:new Date(Date.now()-8*86400000),privacyDueAt:new Date(0)}});
    await expect(caller.catalog({id:a.id,after:null})).rejects.toThrow();vi.mocked(provider.reportAtlassianPrivacy).mockRejectedValue(new ProviderStatusError(503));await runDueAtlassianPrivacy(privacyDb());
    expect(await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({status:"DISCONNECTED",encryptedToken:null,accountId:null});
  });
  it("does not replay an uncertain rotating refresh during maintenance",async()=>{
    const a=await verified();await prisma.atlassianOAuthConnection.update({where:{id:a.id},data:{privacyDueAt:new Date(0),tokenExpiresAt:new Date(0),encryptedToken:{...encryptToken(JSON.stringify({...token(),expiresAt:1}))}}});
    vi.mocked(provider.refreshAtlassianToken).mockRejectedValue(new Error("Unknown token exchange result"));await runDueAtlassianPrivacy(privacyDb());await runDueAtlassianPrivacy(privacyDb());
    expect(provider.refreshAtlassianToken).toHaveBeenCalledTimes(1);expect(await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({status:"DISCONNECTED",encryptedToken:null,accountId:null});
  });
  it("erases an expired maintenance claim without repeating its provider calls",async()=>{
    const a=await verified();await prisma.atlassianOAuthConnection.update({where:{id:a.id},data:{status:"PRIVACY_CHECKING",operationId:randomUUID(),privacyDueAt:new Date(0)}});vi.mocked(provider.reportAtlassianPrivacy).mockClear();
    await runDueAtlassianPrivacy(privacyDb());expect(provider.reportAtlassianPrivacy).not.toHaveBeenCalled();expect(await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({status:"DISCONNECTED",accountId:null,encryptedToken:null});
  });
  it("erases instead of using credentials after the owner loses permission",async()=>{
    const a=await verified();await duePrivacy(a.id);await prisma.membership.update({where:{organizationId_userId:{organizationId,userId:ctx.user!.id}},data:{role:"VIEWER"}});vi.mocked(provider.reportAtlassianPrivacy).mockClear();
    await runDueAtlassianPrivacy(privacyDb());expect(provider.reportAtlassianPrivacy).not.toHaveBeenCalled();expect(await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}})).toMatchObject({status:"DISCONNECTED",accountName:null,accountId:null,encryptedToken:null});
  });
  it("shares the reporting cycle across new connections and sign-in renewals",async()=>{
    vi.mocked(provider.reportAtlassianPrivacy).mockResolvedValue({decision:"clear",cycleDays:3.5});
    const a=await verified(),b=await verified();await caller.refresh({id:a.id});
    expect(provider.reportAtlassianPrivacy).toHaveBeenCalledTimes(1);
    const rows=await prisma.atlassianOAuthConnection.findMany({where:{id:{in:[a.id,b.id]}}});
    expect(rows[0].privacyAccountKey).toBe(rows[1].privacyAccountKey);
    for(const row of rows){expect(row.privacyCycleDays).toBe(3.5);expect(row.privacyDueAt!.getTime()-row.privacyCheckedAt!.getTime()).toBe(3.5*86400000);}
  });
  it("erases every project copy for a closed account while retaining a different app's grant",async()=>{
    const a=await verified(),other=await prisma.project.create({data:{organizationId,name:"Synthetic second project",slug:randomUUID()}});
    const b=await caller.begin({...input(),projectId:other.id});await caller.finish({state:new URL(b.url).searchParams.get("state")!,code:"synthetic-second-project"});
    let independent:string;
    vi.stubEnv("ATLASSIAN_OAUTH_CLIENT_ID","synthetic-other-client");
    try{independent=(await verified()).id;}finally{vi.stubEnv("ATLASSIAN_OAUTH_CLIENT_ID","synthetic-client");}
    await duePrivacy(a.id);await duePrivacy(b.id);vi.mocked(provider.reportAtlassianPrivacy).mockClear();vi.mocked(provider.reportAtlassianPrivacy).mockResolvedValue({decision:"closed",cycleDays:7});
    await runDueAtlassianPrivacy(privacyDb());
    for(const id of [a.id,b.id])expect(await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id}})).toMatchObject({status:"DISCONNECTED",accountId:null,accountName:null,encryptedToken:null,privacyAccountKey:null});
    expect(await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:independent}})).toMatchObject({status:"VERIFIED",accountId:providerAccountId});expect(provider.reportAtlassianPrivacy).toHaveBeenCalledTimes(1);
  });
});
