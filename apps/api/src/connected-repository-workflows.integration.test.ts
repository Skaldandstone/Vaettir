import { createHash, randomUUID } from "node:crypto";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { prisma } from "@vaettir/db";
import type { Context } from "./trpc.js";
import { agentRouter } from "./routers/agent.js";
import { requirementsRouter } from "./routers/requirements.js";
import { repositoryIntelligenceRouter } from "./routers/repositoryIntelligence.js";
import { repositoryCoverageChecksRouter } from "./routers/repositoryCoverageChecks.js";
import { repositoryProviderJson } from "./services/repositoryProviderHttp.js";
import { encryptToken } from "./services/tokenEncryption.js";
import { extractRequirementsFromMarkdown } from "@vaettir/ai-agent";
vi.mock("./services/repositoryProviderHttp.js",async original=>({...await original<typeof import("./services/repositoryProviderHttp.js")>(),repositoryProviderJson:vi.fn()}));
vi.mock("./jobs/reverseEngineerWorker.js",async original=>({...await original<typeof import("./jobs/reverseEngineerWorker.js")>(),kickReverseEngineerQueue:vi.fn()}));
vi.mock("@vaettir/ai-agent",()=>({extractRequirementsFromMarkdown:vi.fn(),reverseEngineerTestFile:vi.fn(),inferCustomFrameworkHeuristic:vi.fn(),generateTestCasesFromRequirement:vi.fn()}));
vi.mock("./services/aiCredits.js",async original=>({...await original<typeof import("./services/aiCredits.js")>(),meterAiCall:vi.fn((_db,_charge,fn:()=>Promise<unknown>)=>fn())}));
const database=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=database&&["localhost","127.0.0.1"].includes(database.hostname)&&/test/i.test(database.pathname)&&!database.searchParams.has("host");
const origin="https://gitlab.synthetic.example",url=origin+"/synthetic/service",commit="a".repeat(40);
const source="describe('synthetic login',()=>{});";
const bytes=Buffer.from(source),blob=createHash("sha1").update(`blob ${bytes.length}\0`).update(bytes).digest("hex");
const hash=createHash("sha256").update(bytes).digest("hex");
describe.skipIf(!isolated)("shared project connections and admitted source workflows (isolated synthetic PostgreSQL)",()=>{
  let orgId:string,projectId:string,userId:string,repoId:string,connectionId:string,ctx:Context&{user:NonNullable<Context["user"]>};
  const createdUsers:string[]=[];
  async function actor(role:"OWNER"|"EDITOR"|"VIEWER"="OWNER",seatType:"FULL"|"READ_ONLY"="FULL"){
    const key=randomUUID();const user=await prisma.user.create({data:{email:`connected-${key}@example.com`,clerkUserId:key,memberships:{create:{organizationId:orgId,role,seatType}}},include:{memberships:true}});createdUsers.push(user.id);
    return {prisma,user,authenticatedClerkSubject:key,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}};
  }
  beforeEach(async()=>{
    vi.clearAllMocks();vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,9).toString("base64"));
    const key=randomUUID();const tier=await prisma.planTier.findFirstOrThrow();orgId=(await prisma.organization.create({data:{name:`Connected ${key}`,slug:`connected-${key}`,planTierId:tier.id}})).id;
    projectId=(await prisma.project.create({data:{organizationId:orgId,name:"Synthetic connected project",slug:"connected"}})).id;
    ctx=await actor();userId=ctx.user.id;
    const config=await prisma.repositoryProviderConfiguration.create({data:{organizationId:orgId,provider:"gitlab",origin,clientId:"synthetic-id",encryptedSecret:{...encryptToken("synthetic-secret")},createdById:userId}});
    connectionId=(await prisma.repositoryConnection.create({data:{projectId,organizationId:orgId,actorId:userId,configurationId:config.id,provider:"gitlab",origin,stateHash:randomUUID(),status:"VERIFIED",verifiedAt:new Date(),authorizationExpiresAt:new Date(Date.now()+3600000),tokenExpiresAt:new Date(Date.now()+3600000),encryptedToken:{...encryptToken("synthetic-grant")}}})).id;
    repoId=(await prisma.projectRepository.create({data:{projectId,provider:"gitlab",url,connectionId,externalId:"47",verifiedAt:new Date()}})).id;
    await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"GRANT",amount:1000,description:"Synthetic isolated fixture"}});
    vi.mocked(extractRequirementsFromMarkdown).mockResolvedValue([{title:"Synthetic requirement",description:"Must preserve source identity."}]);
    vi.mocked(repositoryProviderJson).mockImplementation(async(_origin,path)=>{
      if(path==="/api/v4/projects/47")return{id:47,web_url:url,path_with_namespace:"synthetic/service"};
      if(path.includes("/commits/"))return{id:commit};
      if(path.includes("/tree?"))return[{id:blob,path:"tests/login.test.ts",type:"blob",mode:"100644"},{id:blob,path:"docs/spec.md",type:"blob",mode:"100644"}];
      if(path.endsWith(`/blobs/${blob}`))return{sha:blob,encoding:"base64",size:bytes.length,content:bytes.toString("base64")};
      if(path.includes("/releases?"))return[{tag_name:"v1",name:"Synthetic release",released_at:"2026-10-09T12:00:00Z",commit:{id:commit},_links:{self:url+"/-/releases/v1"}}];
      throw Error("Unexpected synthetic provider request");
    });
  });
  afterEach(async()=>{
    await prisma.auditLog.deleteMany({where:{organizationId:orgId}});await prisma.reverseEngineerJob.deleteMany({where:{projectId}});await prisma.repositoryProcessingApproval.deleteMany({where:{organizationId:orgId}});
    await prisma.testCase.deleteMany({where:{projectId}});await prisma.projectRepository.deleteMany({where:{projectId}});await prisma.repositoryConnection.deleteMany({where:{organizationId:orgId}});await prisma.repositoryProviderConfiguration.deleteMany({where:{organizationId:orgId}});
    await prisma.aiCreditTransaction.deleteMany({where:{organizationId:orgId}});await prisma.project.deleteMany({where:{organizationId:orgId}});await prisma.membership.deleteMany({where:{organizationId:orgId}});await prisma.organization.delete({where:{id:orgId}});await prisma.user.deleteMany({where:{id:{in:createdUsers}}});createdUsers.length=0;vi.unstubAllEnvs();
  });
  const scope=()=>({repositoryId:repoId,repoUrl:url,ref:"main",pathPrefixes:["tests"],maxItems:2});
  const consent=(scopeHash:string)=>({requestId:randomUUID(),expectedScopeHash:scopeHash,approveSourceRead:true as const,approveAiProcessing:true as const,approveVariableCredits:true as const});
  it("does no source IO for previews and reuses the connected grant only after exact approval",async()=>{
    const agent=agentRouter.createCaller(ctx);const preview=await agent.previewRepoProcessing({projectId,purpose:"TEST_CASES",scope:scope()});expect(repositoryProviderJson).not.toHaveBeenCalled();
    const approval=consent(preview.scopeHash);const result=await agent.scanRepo({projectId,scope:scope(),consent:approval});expect(result.scannedFileCount).toBe(1);expect(result.resolvedCommitSha).toBe(commit);
    const row=await prisma.repositoryProcessingApproval.findUniqueOrThrow({where:{id:result.approvalId}});expect(row.results).toMatchObject({sourceBinding:{repositoryId:repoId,externalId:"47",actorId:userId}});
    const calls=vi.mocked(repositoryProviderJson).mock.calls.length;expect(await agent.scanRepo({projectId,scope:scope(),consent:approval})).toEqual(result);expect(repositoryProviderJson).toHaveBeenCalledTimes(calls);
    expect(await prisma.aiCreditTransaction.count({where:{organizationId:orgId,type:"CONSUMPTION"}})).toBe(0);
  });
  it("requirements use the same registered repository and preserve source binding with paid drafts",async()=>{
    const selected={...scope(),pathPrefixes:["docs"]};const preview=await agentRouter.createCaller(ctx).previewRepoProcessing({projectId,purpose:"REQUIREMENTS",scope:selected});
    const input={projectId,scope:selected,consent:consent(preview.scopeHash)};const caller=requirementsRouter.createCaller(ctx);expect(await caller.extractFromRepo(input)).toHaveLength(1);
    const row=await prisma.repositoryProcessingApproval.findUniqueOrThrow({where:{projectId_actorId_requestId:{projectId,actorId:userId,requestId:input.consent.requestId}}});expect(row.results).toMatchObject({sourceBinding:{repositoryId:repoId},drafts:[{title:"Synthetic requirement"}]});
    await caller.extractFromRepo(input);expect(extractRequirementsFromMarkdown).toHaveBeenCalledOnce();
  });
  it("rejects other actors, foreign projects, changed URLs, expired grants and missing source consent without provider requests",async()=>{
    for(const context of [await actor("EDITOR"),await actor("VIEWER"),await actor("OWNER","READ_ONLY"),{...ctx,authenticatedClerkSubject:null}])await expect(agentRouter.createCaller(context).previewRepoProcessing({projectId,purpose:"TEST_CASES",scope:scope()})).rejects.toThrow();
    const other=(await prisma.project.create({data:{organizationId:orgId,name:"Synthetic other",slug:"other"}})).id;await expect(agentRouter.createCaller(ctx).previewRepoProcessing({projectId:other,purpose:"TEST_CASES",scope:scope()})).rejects.toThrow();
    await expect(agentRouter.createCaller(ctx).scanRepo({projectId,scope:scope(),consent:{approveMetadataAccess:true}} as never)).rejects.toThrow();
    await prisma.repositoryConnection.update({where:{id:connectionId},data:{tokenExpiresAt:new Date(0)}});await expect(agentRouter.createCaller(ctx).previewRepoProcessing({projectId,purpose:"TEST_CASES",scope:scope()})).rejects.toThrow();expect(repositoryProviderJson).not.toHaveBeenCalled();
  });
  it("reads release metadata but no blobs, AI, assets or customer release writes",async()=>{
    const result=await repositoryIntelligenceRouter.createCaller(ctx).releases({projectId,repositoryId:repoId,page:1});expect(result.releases[0]!.tag).toBe("v1");expect(repositoryProviderJson).toHaveBeenCalledTimes(2);expect(await prisma.release.count({where:{projectId}})).toBe(0);expect(extractRequirementsFromMarkdown).not.toHaveBeenCalled();
  });
  it("automatically checks only a bounded project batch and reports unavailable and unsupported references",async()=>{
    await prisma.projectRepository.create({data:{projectId,provider:"github",url:"https://github.com/synthetic/service"}});
    await prisma.projectRepository.create({data:{projectId,provider:"gitlab",url:origin+"/synthetic/expired",externalId:"48"}});
    for(let i=0;i<3;i++)await prisma.projectRepository.create({data:{projectId,provider:"github",url:`https://github.com/synthetic/service-${i}`}});
    const caller=repositoryIntelligenceRouter.createCaller(ctx);
    const result=await caller.projectReleases({projectId,offset:0});
    expect(result.repositories).toHaveLength(5);expect(result.nextOffset).toBe(5);
    expect(result.repositories.find(row=>row.repositoryId===repoId)).toMatchObject({status:"CHECKED",releases:[{tag:"v1"}]});
    expect(result.repositories.some(row=>row.status==="UNAVAILABLE")).toBe(true);expect(result.repositories.some(row=>row.status==="UNSUPPORTED")).toBe(true);
    expect(repositoryProviderJson).toHaveBeenCalledTimes(2);expect(JSON.stringify(result)).not.toMatch(/credentialFingerprint|synthetic-grant|sourceBinding/);
    const second=await caller.projectReleases({projectId,offset:5});expect(second.repositories).toHaveLength(1);expect(second.nextOffset).toBe(null);
    expect(await prisma.release.count({where:{projectId}})).toBe(0);expect(extractRequirementsFromMarkdown).not.toHaveBeenCalled();
    await expect(repositoryIntelligenceRouter.createCaller(await actor("VIEWER")).projectReleases({projectId})).rejects.toThrow();
  });
  it("keeps no-AI file comparison durable and idempotent, matching only approved project source links",async()=>{
    await prisma.testCase.create({data:{projectId,title:"Synthetic linked case",given:[],when:[],then:[],tags:[],testType:"FUNCTIONAL",source:{create:{repoUrl:url,filePath:"tests/login.test.ts",contentHash:hash,framework:"jest"}}}});
    const checks=repositoryCoverageChecksRouter.createCaller(ctx);const selected={repositoryId:repoId,ref:"main",pathPrefixes:["tests"],maxItems:2};const preview=await checks.preview({projectId,scope:selected});expect(repositoryProviderJson).not.toHaveBeenCalled();
    const input={projectId,scope:selected,consent:{requestId:randomUUID(),expectedScopeHash:preview.scopeHash,approveSourceRead:true as const}};const result=await checks.compare(input);expect(result.files[0]!.state).toBe("CURRENT_SOURCE_LINKS");
    const count=vi.mocked(repositoryProviderJson).mock.calls.length;expect(await checks.compare(input)).toEqual(result);expect(repositoryProviderJson).toHaveBeenCalledTimes(count);expect(await prisma.auditLog.count({where:{projectId,entityType:"RepositoryCoverageCheck"}})).toBe(2);expect(await prisma.aiCreditTransaction.count({where:{organizationId:orgId,type:"CONSUMPTION"}})).toBe(0);
  });
  it("withholds a late provider response after grant revocation and retains the original failed source read",async()=>{
    const checks=repositoryCoverageChecksRouter.createCaller(ctx);const selected={repositoryId:repoId,ref:"main",pathPrefixes:["tests"],maxItems:2};const preview=await checks.preview({projectId,scope:selected});
    vi.mocked(repositoryProviderJson).mockImplementationOnce(async()=>{await prisma.repositoryConnection.update({where:{id:connectionId},data:{status:"DISCONNECTED"}});return{id:47,web_url:url,path_with_namespace:"synthetic/service"};});
    await expect(checks.compare({projectId,scope:selected,consent:{requestId:randomUUID(),expectedScopeHash:preview.scopeHash,approveSourceRead:true}})).rejects.toThrow();
    expect(await prisma.auditLog.count({where:{projectId,entityType:"RepositoryCoverageCheck",action:"CREATE"}})).toBe(1);expect(await prisma.auditLog.count({where:{projectId,entityType:"RepositoryCoverageCheck",action:"UPDATE"}})).toBe(1);expect(extractRequirementsFromMarkdown).not.toHaveBeenCalled();
  });
});
