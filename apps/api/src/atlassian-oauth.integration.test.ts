import {randomUUID} from "node:crypto";
import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from "vitest";
import {prisma} from "@vaettir/db";
import type {Context} from "./trpc.js";
import {assertOwnedTestDatabase} from "./testOnlyDatabaseSafety.js";
import {atlassianConnectionsRouter} from "./routers/atlassianConnections.js";
import {jiraConnectionsRouter} from "./routers/jiraConnections.js";
import {decryptToken} from "./services/tokenEncryption.js";
import {jiraOAuthCredentials} from "./services/atlassianOAuthConnection.js";
import * as provider from "./services/atlassianOAuth.js";

vi.mock("./services/atlassianOAuth.js",async original=>{
  const real=await original<typeof import("./services/atlassianOAuth.js")>();
  return {...real,exchangeAtlassianCode:vi.fn(),refreshAtlassianToken:vi.fn(),verifyAtlassianToken:vi.fn(),listAtlassianSites:vi.fn(),listAtlassianResources:vi.fn()};
});
const site={id:"01234567-89ab-cdef-0123-456789abcdef",name:"Synthetic site",url:"https://synthetic.atlassian.net",products:["jira","confluence"] as ("jira"|"confluence")[]};
const resource={id:"123",key:"QA",name:"Synthetic QA",url:site.url+"/browse/QA"};
const token=()=>({accessToken:"synthetic-access",refreshToken:"synthetic-refresh",expiresAt:Date.now()+3600000,accountId:"synthetic-account",accountName:"Synthetic tester"});
const issued={access_token:"synthetic-access",refresh_token:"synthetic-refresh",token_type:"Bearer",expires_in:3600};
type Caller=ReturnType<typeof atlassianConnectionsRouter.createCaller>;
let ctx:Context,caller:Caller,projectId:string,organizationId:string,clerkActorId:string;
const input=()=>({projectId,originalOrganizationId:organizationId,expectedClerkActorId:clerkActorId,product:"jira" as const,requestId:randomUUID(),approveMetadataAccess:true as const});
const begin=async()=>{const result=await caller.begin(input());return {...result,state:new URL(result.url).searchParams.get("state")!};};
const verified=async()=>{const result=await begin();await caller.finish({state:result.state,code:"synthetic-code"});return result;};
const selected=async()=>{const result=await verified(),row=await caller.status({id:result.id});await caller.selectSite({id:result.id,siteId:site.id,version:row.version});return result;};
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
    vi.clearAllMocks();
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
    const a=await begin();const exchanges=await Promise.allSettled([caller.finish({state:a.state,code:"code"}),caller.finish({state:a.state,code:"code"})]);expect(exchanges.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(provider.exchangeAtlassianCode).toHaveBeenCalledTimes(1);
    const refreshes=await Promise.allSettled([caller.refresh({id:a.id}),caller.refresh({id:a.id})]);expect(refreshes.filter(x=>x.status==="fulfilled")).toHaveLength(1);expect(provider.refreshAtlassianToken).toHaveBeenCalledTimes(1);
  });
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
    const a=await verified();vi.mocked(provider.verifyAtlassianToken).mockRejectedValue(Error("identity changed"));await expect(caller.refresh({id:a.id})).rejects.toThrow();expect(provider.verifyAtlassianToken).toHaveBeenLastCalledWith({...issued,refresh_token:"synthetic-rotated"},"synthetic-account");const row=await prisma.atlassianOAuthConnection.findUniqueOrThrow({where:{id:a.id}});expect(row.status).toBe("RECOVERY_REQUIRED");expect(decryptToken(row.encryptedToken as {iv:string;ciphertext:string;authTag:string})).toContain("synthetic-rotated");
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
});
