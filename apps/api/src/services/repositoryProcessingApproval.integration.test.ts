import {randomUUID} from "node:crypto";
import {afterEach,beforeEach,describe,it,expect,vi} from "vitest";
import {prisma,type OrgRole,type SeatType} from "@vaettir/db";
import {agentRouter} from "../routers/agent.js";
import {requirementsRouter} from "../routers/requirements.js";
import {processingScopeHash,beginRepositoryProcessing,assertRepositoryProcessingApproval} from "./repositoryProcessingApproval.js";
import {scanRepoForTestFiles,hashFileContent} from "./repoScan.js";
import {scanRepoForRequirementDocs} from "./repoDocScan.js";
import {reverseEngineerTestFile,extractRequirementsFromMarkdown} from "@vaettir/ai-agent";
import {runReverseEngineerJob} from "../jobs/reverseEngineerWorker.js";
import {persistReverseEngineerResult} from "./reverseEngineerPersist.js";
import type {Context} from "../trpc.js";
import * as Sentry from "@sentry/node";

vi.mock("./repoScan.js",async original=>({...await original<typeof import("./repoScan.js")>(),scanRepoForTestFiles:vi.fn()}));
vi.mock("./repoDocScan.js",()=>({scanRepoForRequirementDocs:vi.fn()}));
vi.mock("@vaettir/ai-agent",()=>({reverseEngineerTestFile:vi.fn(),extractRequirementsFromMarkdown:vi.fn(),inferCustomFrameworkHeuristic:vi.fn(),generateTestCasesFromRequirement:vi.fn()}));
vi.mock("../jobs/reverseEngineerWorker.js",async original=>({...await original<typeof import("../jobs/reverseEngineerWorker.js")>(),kickReverseEngineerQueue:vi.fn()}));
vi.mock("./aiCredits.js",async original=>({...await original<typeof import("./aiCredits.js")>(),meterAiCall:vi.fn((_db,_charge,fn:()=>Promise<unknown>)=>fn())}));
vi.mock("./webhookDelivery.js",()=>({dispatchWebhookEvent:vi.fn().mockResolvedValue(undefined)}));
vi.mock("./slackEventNotify.js",()=>({notifySlackEvent:vi.fn().mockResolvedValue(undefined)}));
vi.mock("@sentry/node",()=>({captureException:vi.fn()}));

const database=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=database&&["127.0.0.1","localhost"].includes(database.hostname)&&/test/i.test(database.pathname)&&!database.searchParams.has("host");
const repoUrl="https://github.com/synthetic/repository";
const headSha="a".repeat(40);
const content="describe('synthetic login',()=>{});";
const scope={repoUrl,ref:"release-synthetic",pathPrefixes:["tests"],maxItems:2};
const requirementScope={...scope,pathPrefixes:["docs"],maxItems:2};
const aiResult={detectedFramework:"jest",detectedFrameworkFamily:"JEST",testCases:[{title:"Synthetic inferred login",given:["a user"],when:["logging in"],then:["signed in"],tags:[],testType:"FUNCTIONAL" as const,confidence:0.8,sourceFunctionName:"login"}]};

describe.skipIf(!isolated)("durable explicit repository processing (synthetic disposable database)",()=>{
  let orgId:string,projectId:string,actorId:string,ctx:Context&{user:NonNullable<Context["user"]>};
  let agent:ReturnType<typeof agentRouter.createCaller>,requirements:ReturnType<typeof requirementsRouter.createCaller>;
  const orgs:string[]=[];const actors:string[]=[];
  async function actor(role:OrgRole="OWNER",seatType:SeatType="FULL",organizationId=orgId){
    const key=randomUUID();const user=await prisma.user.create({data:{email:`processing-${key}@example.com`,clerkUserId:key,memberships:{create:{organizationId,role,seatType}}},include:{memberships:true}});actors.push(user.id);
    return{prisma,user,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}};
  }
  function consent(purpose:"TEST_CASES"|"REQUIREMENTS"="TEST_CASES",selected=scope,requestId=randomUUID()){
    return{requestId,expectedScopeHash:processingScopeHash(projectId,purpose,selected),approveSourceRead:true as const,approveAiProcessing:true as const,approveVariableCredits:true as const};
  }
  async function charges(){return prisma.aiCreditTransaction.count({where:{organizationId:orgId,type:"CONSUMPTION"}});}
  beforeEach(async()=>{
    vi.clearAllMocks();vi.mocked(scanRepoForTestFiles).mockResolvedValue({files:[{relativePath:"tests/login.test.ts",content,contentHash:hashFileContent(content)}],headSha});
    vi.mocked(scanRepoForRequirementDocs).mockResolvedValue({files:[{relativePath:"docs/spec.md",content:"Synthetic requirements document"}],headSha});
    vi.mocked(reverseEngineerTestFile).mockResolvedValue(aiResult);vi.mocked(extractRequirementsFromMarkdown).mockResolvedValue([{title:"Synthetic requirement",description:"Synthetic description"}]);
    const key=randomUUID();const tier=await prisma.planTier.findFirstOrThrow();orgId=(await prisma.organization.create({data:{name:`Processing ${key}`,slug:`processing-${key}`,planTierId:tier.id}})).id;orgs.push(orgId);
    projectId=(await prisma.project.create({data:{organizationId:orgId,name:"Synthetic source permission",slug:"processing"}})).id;
    ctx=await actor();actorId=ctx.user.id;agent=agentRouter.createCaller(ctx);requirements=requirementsRouter.createCaller(ctx);
    await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"GRANT",amount:1000,description:"Synthetic local fixture only"}});
  });
  afterEach(async()=>{
    const projects=await prisma.project.findMany({where:{organizationId:{in:orgs}},select:{id:true}});const ids=projects.map(p=>p.id);
    await prisma.reverseEngineerJob.deleteMany({where:{projectId:{in:ids}}});await prisma.repositoryProcessingApproval.deleteMany({where:{organizationId:{in:orgs}}});
    await prisma.testCase.deleteMany({where:{projectId:{in:ids}}});await prisma.project.deleteMany({where:{id:{in:ids}}});await prisma.aiCreditTransaction.deleteMany({where:{organizationId:{in:orgs}}});await prisma.membership.deleteMany({where:{organizationId:{in:orgs}}});await prisma.organization.deleteMany({where:{id:{in:orgs}}});await prisma.user.deleteMany({where:{id:{in:actors}}});orgs.length=0;actors.length=0;
  });

  it("does no source I/O or spending for missing consent, stale scope, viewer or read-only admin",async()=>{
    await expect(agent.scanRepo({projectId,repoUrl} as never)).rejects.toThrow();
    await expect(agent.scanRepo({projectId,scope,consent:{...consent(),expectedScopeHash:"b".repeat(64)}})).rejects.toThrow("changed");
    for(const context of [await actor("VIEWER"),await actor("ADMIN","READ_ONLY")])await expect(agentRouter.createCaller(context).scanRepo({projectId,scope,consent:consent()})).rejects.toThrow();
    expect(scanRepoForTestFiles).not.toHaveBeenCalled();expect(await charges()).toBe(0);expect(await prisma.repositoryProcessingApproval.count({where:{projectId}})).toBe(0);
  });
  it("does no source I/O for a self-hosted URL or metadata-only grant",async()=>{
    const selected={...scope,repoUrl:"https://gitlab.synthetic.example/team/repo"};await expect(agent.scanRepo({projectId,scope:selected,consent:consent("TEST_CASES",selected)})).rejects.toThrow("credential-free");
    await expect(requirements.extractFromRepo({projectId,scope:requirementScope,consent:{approveMetadataAccess:true}} as never)).rejects.toThrow();expect(scanRepoForTestFiles).not.toHaveBeenCalled();expect(scanRepoForRequirementDocs).not.toHaveBeenCalled();expect(await charges()).toBe(0);
  });
  it("shares one actor-bound request receipt across concurrent retries",async()=>{
    const approved=consent();const values=await Promise.all(Array.from({length:5},()=>beginRepositoryProcessing(ctx,projectId,"TEST_CASES",scope,approved)));
    expect(new Set(values.map(value=>value.approval.id)).size).toBe(1);expect(values.filter(value=>!value.replayed)).toHaveLength(1);
    await expect(beginRepositoryProcessing(ctx,projectId,"TEST_CASES",{...scope,ref:"changed"},{...approved,expectedScopeHash:processingScopeHash(projectId,"TEST_CASES",{...scope,ref:"changed"})})).rejects.toThrow("another approved scope");
  });
  it("replays queued work without cloning or charging, retaining literal path/ref and pinned SHA",async()=>{
    const approved=consent();const first=await agent.scanRepo({projectId,scope,consent:approved});const retry=await agent.scanRepo({projectId,scope,consent:approved});expect(retry).toEqual(first);
    expect(scanRepoForTestFiles).toHaveBeenCalledOnce();expect(scanRepoForTestFiles).toHaveBeenCalledWith(repoUrl,scope.ref,expect.any(Map),["tests"],2);
    const job=await prisma.reverseEngineerJob.findUniqueOrThrow({where:{id:first.queuedJobIds[0]}});expect(job.processingApprovalId).toBe(first.approvalId);expect(first.resolvedCommitSha).toBe(headSha);expect(await charges()).toBe(0);
  });
  it("deduplicates same content across simultaneous differently approved runs",async()=>{
    const results=await Promise.all([agent.scanRepo({projectId,scope,consent:consent()}),agent.scanRepo({projectId,scope,consent:consent()})]);
    expect(results[0]!.queuedJobIds).toEqual(results[1]!.queuedJobIds);expect(await prisma.reverseEngineerJob.count({where:{projectId}})).toBe(1);expect(await charges()).toBe(0);
  });
  it("stops queued AI after seat revocation, expiration or cancellation",async()=>{
    const queued=await agent.scanRepo({projectId,scope,consent:consent()});await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"READ_ONLY"}});
    await runReverseEngineerJob(queued.queuedJobIds[0]!);expect(reverseEngineerTestFile).not.toHaveBeenCalled();expect(await charges()).toBe(0);
    await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{seatType:"FULL"}});
    await prisma.repositoryProcessingApproval.update({where:{id:queued.approvalId},data:{expiresAt:new Date(0)}});await expect(prisma.$transaction(tx=>assertRepositoryProcessingApproval(tx,queued.approvalId,projectId,"TEST_CASES"))).rejects.toThrow("expired");
    const next=consent();vi.mocked(scanRepoForTestFiles).mockResolvedValueOnce({files:[{relativePath:"tests/second.test.ts",content,contentHash:hashFileContent(content)}],headSha});const second=await agent.scanRepo({projectId,scope,consent:next});await agent.cancelRepositoryProcessing({projectId,requestId:next.requestId});await runReverseEngineerJob(second.queuedJobIds[0]!);expect(reverseEngineerTestFile).not.toHaveBeenCalled();expect(await charges()).toBe(0);
  });
  it("fails closed for legacy REPO_SCAN without approval but leaves PASTE behavior intact",async()=>{
    const legacy=await prisma.reverseEngineerJob.create({data:{projectId,inputType:"REPO_SCAN",inputRef:"tests/legacy.test.ts",content}});await runReverseEngineerJob(legacy.id);expect(reverseEngineerTestFile).not.toHaveBeenCalled();expect(await charges()).toBe(0);
    const paste=await prisma.reverseEngineerJob.create({data:{projectId,inputType:"PASTE",inputRef:"tests/paste.test.ts",content}});await runReverseEngineerJob(paste.id);expect(reverseEngineerTestFile).toHaveBeenCalledOnce();expect(await charges()).toBe(1);
  });
  it("retains paid worker result, reuses it on retry and skips identical later paid scans",async()=>{
    const result=await agent.scanRepo({projectId,scope,consent:consent()});const id=result.queuedJobIds[0]!;await runReverseEngineerJob(id);
    const completed=await prisma.reverseEngineerJob.findUniqueOrThrow({where:{id}});expect(completed.paidProcessingResult).not.toBeNull();expect(completed.status,completed.error??"Expected paid worker success").toBe("SUCCEEDED");expect(await charges()).toBe(1);
    await prisma.reverseEngineerJob.update({where:{id},data:{status:"PENDING"}});await runReverseEngineerJob(id);expect(reverseEngineerTestFile).toHaveBeenCalledOnce();expect(await charges()).toBe(1);expect(await prisma.testCase.count({where:{projectId}})).toBe(1);
    vi.mocked(scanRepoForTestFiles).mockImplementationOnce(async(_url,_ref,hashes)=>({files:hashes?.get("tests/login.test.ts")===hashFileContent(content)?[]:[{relativePath:"tests/login.test.ts",content,contentHash:hashFileContent(content)}],headSha}));
    expect((await agent.scanRepo({projectId,scope,consent:consent()})).queuedJobIds).toHaveLength(0);expect(await charges()).toBe(1);
  });
  it("quarantines an uncertain paid worker attempt instead of calling AI again",async()=>{
    const result=await agent.scanRepo({projectId,scope,consent:consent()});const id=result.queuedJobIds[0]!;await prisma.reverseEngineerJob.update({where:{id},data:{aiProcessingStartedAt:new Date()}});await runReverseEngineerJob(id);
    expect(reverseEngineerTestFile).not.toHaveBeenCalled();expect(await charges()).toBe(0);expect((await prisma.reverseEngineerJob.findUniqueOrThrow({where:{id}})).error).toContain("already started");
  });
  it("preserves approved human edits including legacy ambiguous sources and different repository identities",async()=>{
    const existing=await prisma.testCase.create({data:{projectId,title:"Human-edited case",given:["human"],when:["manual"],then:["approved"],testType:"FUNCTIONAL",reviewStatus:"APPROVED",reviewedById:actorId,reviewedAt:new Date(),source:{create:{filePath:"tests/login.test.ts",functionName:"login",framework:"jest",contentHash:"old",repoUrl:null}}}});
    const result=await agent.scanRepo({projectId,scope,consent:consent()});await runReverseEngineerJob(result.queuedJobIds[0]!);expect(await prisma.testCase.count({where:{projectId}})).toBe(1);expect(await prisma.testCase.findUniqueOrThrow({where:{id:existing.id}})).toMatchObject({title:"Human-edited case",given:["human"],reviewStatus:"APPROVED",reviewedById:actorId});
    await prisma.testCaseSource.update({where:{testCaseId:existing.id},data:{repoUrl:"https://github.com/synthetic/other"}});
    const approval=await prisma.repositoryProcessingApproval.findUniqueOrThrow({where:{id:result.approvalId}});await persistReverseEngineerResult(prisma,{projectId,filePath:"tests/login.test.ts",contentHash:hashFileContent(content),result:aiResult,preserveExisting:true,repoUrl,commitSha:headSha,processingApprovalId:approval.id});expect(await prisma.testCase.count({where:{projectId}})).toBe(2);
    await expect(persistReverseEngineerResult(prisma,{projectId,filePath:"tests/ambiguous.test.ts",contentHash:"hash",result:{...aiResult,testCases:[aiResult.testCases[0]!,aiResult.testCases[0]!]},preserveExisting:true,repoUrl,commitSha:headSha,processingApprovalId:approval.id})).rejects.toThrow("ambiguous");expect(await prisma.testCase.count({where:{projectId}})).toBe(2);
  });
  it("retains requirements drafts across partial failure and replay without rereading or recharging",async()=>{
    vi.mocked(scanRepoForRequirementDocs).mockResolvedValueOnce({files:[{relativePath:"docs/one.md",content:"One"},{relativePath:"docs/two.md",content:"Two"}],headSha});vi.mocked(extractRequirementsFromMarkdown).mockResolvedValueOnce([{title:"Paid first draft",description:"Retained"}]).mockRejectedValueOnce(new Error("Synthetic provider failure"));
    const approved=consent("REQUIREMENTS",requirementScope);await expect(requirements.extractFromRepo({projectId,scope:requirementScope,consent:approved})).rejects.toThrow("Repository source processing failed");expect(await charges()).toBe(2);
    const saved=await agent.repositoryProcessingStatus({projectId,requestId:approved.requestId});expect(saved?.status).toBe("FAILED");expect(saved?.results).toMatchObject({drafts:[{title:"Paid first draft",description:"Retained",sourceFile:"docs/one.md"}],inFlightPath:"docs/two.md"});
    expect(await requirements.extractFromRepo({projectId,scope:requirementScope,consent:approved})).toHaveLength(1);expect(scanRepoForRequirementDocs).toHaveBeenCalledOnce();expect(extractRequirementsFromMarkdown).toHaveBeenCalledTimes(2);expect(await charges()).toBe(2);
    const runs=await agent.repositoryProcessingRuns({projectId,purpose:"REQUIREMENTS"});expect(runs[0]?.requestId).toBe(approved.requestId);
  });
  it("reuses identical paid requirement documents and quarantines uncertain repeated document attempts",async()=>{
    const first=await requirements.extractFromRepo({projectId,scope:requirementScope,consent:consent("REQUIREMENTS",requirementScope)});const retry=await requirements.extractFromRepo({projectId,scope:requirementScope,consent:consent("REQUIREMENTS",requirementScope)});expect(retry).toEqual(first);expect(extractRequirementsFromMarkdown).toHaveBeenCalledOnce();expect(await charges()).toBe(1);
    vi.mocked(scanRepoForRequirementDocs).mockResolvedValue({files:[{relativePath:"docs/lost.md",content:"Lost"}],headSha});vi.mocked(extractRequirementsFromMarkdown).mockRejectedValueOnce(new Error("Unknown delivery outcome"));
    await expect(requirements.extractFromRepo({projectId,scope:requirementScope,consent:consent("REQUIREMENTS",requirementScope)})).rejects.toThrow("Repository source processing failed");await expect(requirements.extractFromRepo({projectId,scope:requirementScope,consent:consent("REQUIREMENTS",requirementScope)})).rejects.toThrow("already has");expect(extractRequirementsFromMarkdown).toHaveBeenCalledTimes(2);expect(await charges()).toBe(2);
  });
  it("does not disclose prior-workspace receipts after a project moves tenants",async()=>{
    const approved=consent("REQUIREMENTS",requirementScope);await requirements.extractFromRepo({projectId,scope:requirementScope,consent:approved});
    const scan=await agent.scanRepo({projectId,scope,consent:consent()});await runReverseEngineerJob(scan.queuedJobIds[0]!);expect(await agent.listJobs({projectId})).toHaveLength(1);
    const key=randomUUID();const tier=await prisma.planTier.findFirstOrThrow();const moved=(await prisma.organization.create({data:{name:key,slug:`moved-${key}`,planTierId:tier.id}})).id;orgs.push(moved);
    await prisma.membership.create({data:{organizationId:moved,userId:actorId,role:"OWNER",seatType:"FULL"}});await prisma.project.update({where:{id:projectId},data:{organizationId:moved}});ctx.user=await prisma.user.findUniqueOrThrow({where:{id:actorId},include:{memberships:true}});agent=agentRouter.createCaller(ctx);requirements=requirementsRouter.createCaller(ctx);
    await expect(agent.repositoryProcessingStatus({projectId,requestId:approved.requestId})).rejects.toThrow();await expect(agent.cancelRepositoryProcessing({projectId,requestId:approved.requestId})).rejects.toThrow();await expect(requirements.extractFromRepo({projectId,scope:requirementScope,consent:approved})).rejects.toThrow("different workspace");expect(await agent.repositoryProcessingRuns({projectId,purpose:"REQUIREMENTS"})).toEqual([]);expect(await agent.listJobs({projectId})).toEqual([]);
  });
  it("allows recovery after provably unpaid insufficient credits without leaving ambiguous attempt markers",async()=>{
    const approved=consent();const queued=await agent.scanRepo({projectId,scope,consent:approved});const id=queued.queuedJobIds[0]!;
    await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"ADJUSTMENT",amount:-1000,description:"Synthetic depleted balance"}});await runReverseEngineerJob(id);expect(await charges()).toBe(0);expect((await prisma.reverseEngineerJob.findUniqueOrThrow({where:{id}})).aiProcessingStartedAt).toBeNull();
    await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"TOPUP",amount:100,description:"Synthetic topup"}});await prisma.reverseEngineerJob.update({where:{id},data:{status:"PENDING"}});await runReverseEngineerJob(id);expect((await prisma.reverseEngineerJob.findUniqueOrThrow({where:{id}})).status).toBe("SUCCEEDED");expect(await charges()).toBe(1);
    vi.mocked(scanRepoForRequirementDocs).mockResolvedValue({files:[{relativePath:"docs/one.md",content:"One"},{relativePath:"docs/two.md",content:"Two"}],headSha});
    vi.mocked(extractRequirementsFromMarkdown).mockImplementationOnce(async()=>{const balance=await prisma.aiCreditTransaction.aggregate({where:{organizationId:orgId},_sum:{amount:true}});await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"ADJUSTMENT",amount:-(balance._sum.amount??0),description:"Synthetic balance depleted between documents"}});return[{title:"Retain first",description:"Paid"}];});
    const reqConsent=consent("REQUIREMENTS",requirementScope);expect(await requirements.extractFromRepo({projectId,scope:requirementScope,consent:reqConsent})).toHaveLength(1);const saved=await agent.repositoryProcessingStatus({projectId,requestId:reqConsent.requestId});expect(saved?.results).toMatchObject({inFlightPath:null,inFlightHash:null});
    await prisma.aiCreditTransaction.create({data:{organizationId:orgId,type:"TOPUP",amount:100,description:"Synthetic second topup"}});expect(await requirements.extractFromRepo({projectId,scope:requirementScope,consent:consent("REQUIREMENTS",requirementScope)})).toHaveLength(2);expect(extractRequirementsFromMarkdown).toHaveBeenCalledTimes(2);expect(await charges()).toBe(3);
  });
  it("never stores or reports raw customer proposal/provider failure details",async()=>{
    const queued=await agent.scanRepo({projectId,scope,consent:consent()});vi.mocked(reverseEngineerTestFile).mockRejectedValueOnce(Object.assign(new Error("PRIVATE CUSTOMER PROPOSAL synthetic-token-not-live"),{name:"PrismaClientKnownRequestError",code:"P2002"}));await runReverseEngineerJob(queued.queuedJobIds[0]!);
    const job=await prisma.reverseEngineerJob.findUniqueOrThrow({where:{id:queued.queuedJobIds[0]}});expect(job.status).toBe("FAILED");expect(job.error).toContain("P2002");expect(job.error).not.toContain("PRIVATE CUSTOMER");expect(job.error).not.toContain("synthetic-token");expect(Sentry.captureException).toHaveBeenCalledOnce();const calls=vi.mocked(Sentry.captureException).mock.calls;expect(String(calls[0]?.[0])).toBe("Error: Scoped repository processing failed");expect(JSON.stringify(calls)).not.toContain("PRIVATE CUSTOMER");expect(JSON.stringify(calls)).not.toContain("synthetic-token");
    vi.mocked(extractRequirementsFromMarkdown).mockRejectedValueOnce(new Error("PRIVATE CUSTOMER PROPOSAL synthetic-token-not-live"));const rejection=await requirements.extractFromRepo({projectId,scope:requirementScope,consent:consent("REQUIREMENTS",requirementScope)}).catch(error=>error as Error&{cause?:unknown});expect(rejection).toBeInstanceOf(Error);expect(String(rejection)).not.toContain("PRIVATE CUSTOMER");expect(String(rejection)).not.toContain("synthetic-token");expect((rejection as Error&{cause?:unknown}).cause).toBeUndefined();
    vi.mocked(scanRepoForTestFiles).mockRejectedValueOnce(Object.assign(new Error("Invalid job write contains PRIVATE CUSTOMER SOURCE synthetic-token-not-live"),{name:"PrismaClientKnownRequestError",code:"P2002"}));const scanFailure=await agent.scanRepo({projectId,scope,consent:consent()}).catch(error=>error as Error&{cause?:unknown});expect(scanFailure).toBeInstanceOf(Error);expect(String(scanFailure)).toContain("P2002");expect(String(scanFailure)).not.toContain("PRIVATE CUSTOMER");expect(String(scanFailure)).not.toContain("synthetic-token");expect((scanFailure as Error&{cause?:unknown}).cause).toBeUndefined();
  });
});
