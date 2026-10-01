import {randomUUID} from "node:crypto";
import {beforeEach,afterEach,describe,it,expect,vi} from "vitest";
import {prisma,type OrgRole,type SeatType} from "@vaettir/db";
import {jiraConnectionsRouter} from "./routers/jiraConnections.js";
import {jiraIssueIntakeRouter} from "./routers/jiraIssueIntake.js";
import {requirementsRouter} from "./routers/requirements.js";
import {listJiraProjects} from "./services/jiraSourceConnection.js";
import {listJiraIssuePage} from "./services/jiraIssueIntake.js";
vi.mock("./services/jiraSourceConnection.js",async original=>({...await original<typeof import("./services/jiraSourceConnection.js")>(),listJiraProjects:vi.fn()}));
vi.mock("./services/jiraIssueIntake.js",async original=>({...await original<typeof import("./services/jiraIssueIntake.js")>(),listJiraIssuePage:vi.fn()}));
const url=process.env.DATABASE_URL?new URL(process.env.DATABASE_URL):null;
const isolated=url&&["localhost","127.0.0.1"].includes(url.hostname)&&/test/i.test(url.pathname)&&!url.searchParams.has("host");
const site="https://synthetic.atlassian.net";
const projectA={id:"10001",key:"SYN",name:"Synthetic tickets",url:site+"/browse/SYN"};
const issue=(n=1)=>({id:String(20000+n),projectId:projectA.id,key:"SYN-"+n,title:"Synthetic requirement "+n,status:"To do",updatedAt:"2026-10-01T00:00:00.000Z",url:site+"/browse/SYN-"+n});
describe.skipIf(!isolated)("Jira reviewed issue intake",()=>{
  let projectId:string;let orgId:string;let actorId:string;let connectionId:string;
  let owner:ReturnType<typeof jiraIssueIntakeRouter.createCaller>;
  let metadata:ReturnType<typeof jiraConnectionsRouter.createCaller>;
  async function actor(role?:OrgRole,seatType:SeatType="FULL"){
    const suffix=randomUUID();
    const user=await prisma.user.create({data:{email:suffix+"@example.invalid",clerkUserId:suffix,...(role?{memberships:{create:{organizationId:orgId,role,seatType}}}:{})},include:{memberships:true}});
    const ctx={prisma,user,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}};
    return {user,caller:jiraIssueIntakeRouter.createCaller(ctx),metadata:jiraConnectionsRouter.createCaller(ctx),requirements:requirementsRouter.createCaller(ctx)};
  }
  const startInput=()=>({connectionId,projectIds:[projectA.id],requestId:randomUUID(),approveIssueRead:true as const});
  async function page(runId:string){
    const run=await owner.get({runId});
    await owner.nextPage({runId,version:run.version,requestId:randomUUID()});
    return owner.get({runId});
  }
  async function reviewed(count=1){
    vi.mocked(listJiraIssuePage).mockResolvedValue({issues:Array.from({length:count},(_,i)=>issue(i+1)),nextPageToken:null});
    const {id}=await owner.start(startInput());
    const staged=await page(id);
    await owner.finishPreview({runId:id,version:staged.version});
    return owner.get({runId:id});
  }
  async function approved(count=1){
    const run=await reviewed(count);
    await owner.approve({runId:run.id,version:run.version,issueIds:run.issues.map(i=>i.id),requestId:randomUUID(),approved:true});
    return run.id;
  }
  beforeEach(async()=>{
    vi.resetAllMocks();vi.stubEnv("PRODUCTION_SIGNAL_ENCRYPTION_KEY",Buffer.alloc(32,13).toString("base64"));
    const suffix=randomUUID();const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    orgId=(await prisma.organization.create({data:{name:"Jira import fixture",slug:"jira-import-"+suffix,planTierId:tier.id}})).id;
    projectId=(await prisma.project.create({data:{organizationId:orgId,name:"Synthetic",slug:"synthetic-"+suffix}})).id;
    const actorResult=await actor("OWNER");actorId=actorResult.user.id;owner=actorResult.caller;metadata=actorResult.metadata;
    vi.mocked(listJiraProjects).mockResolvedValue({workspace:{id:site,name:site},account:{id:"account-synthetic",name:"Synthetic"},projects:[projectA],nextCursor:null,hasMore:false});
    const verified=await metadata.verify({projectId,siteUrl:site,email:"fixture@example.invalid",apiToken:"synthetic-token-not-live",requestId:randomUUID(),approveMetadataAccess:true});
    connectionId=verified.id;
    const catalog=await metadata.list({id:connectionId});
    await metadata.approve({id:connectionId,version:catalog.version,projectIds:[projectA.id],requestId:randomUUID(),approved:true});
    vi.mocked(listJiraIssuePage).mockResolvedValue({issues:[issue()],nextPageToken:null});
  });
  afterEach(()=>vi.unstubAllEnvs());
  it("requires separate literal read permission and approved projects before I/O",async()=>{
    await expect(owner.start({...startInput(),approveIssueRead:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.start({...startInput(),projectIds:["99999"]})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(listJiraIssuePage).not.toHaveBeenCalled();expect(await prisma.jiraIssueImportRun.count({where:{projectId}})).toBe(0);
  });
  it("metadata/start/read preview create no requirements; import needs separate reviewed approval",async()=>{
    const started=await owner.start(startInput());expect(listJiraIssuePage).not.toHaveBeenCalled();
    const staged=await page(started.id);expect(staged.issues[0]).toMatchObject({classification:"new",requirementId:null});
    expect(await prisma.requirement.count({where:{projectId}})).toBe(0);
    await expect(owner.processBatch({runId:started.id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    await expect(owner.approve({runId:started.id,version:staged.version,issueIds:[issue().id],requestId:randomUUID(),approved:true})).rejects.toMatchObject({code:"CONFLICT"});
  });
  it("retains durable start/page/approval receipts and rejects changed retries",async()=>{
    const input=startInput();const first=await owner.start(input);expect(await owner.start(input)).toEqual(first);
    await expect(owner.start({...input,projectIds:["99999"]})).rejects.toMatchObject({code:"CONFLICT"});
    const read={runId:first.id,version:1,requestId:randomUUID()};
    await owner.nextPage(read);await owner.nextPage(read);expect(listJiraIssuePage).toHaveBeenCalledTimes(1);
    await expect(owner.nextPage({...read,version:2})).rejects.toMatchObject({code:"CONFLICT"});
    const run=await owner.get({runId:first.id});await owner.finishPreview({runId:run.id,version:run.version});
    const review=await owner.get({runId:run.id});
    const approval={runId:run.id,version:review.version,issueIds:[issue().id],requestId:randomUUID(),approved:true as const};
    await owner.approve(approval);await owner.approve(approval);
    await expect(owner.approve({...approval,issueIds:[issue(2).id]})).rejects.toMatchObject({code:"CONFLICT"});
  });
  it("imports reviewed summaries with provenance and durable batch retries",async()=>{
    const id=await approved();await owner.processBatch({runId:id});await owner.processBatch({runId:id});
    const result=await owner.get({runId:id});expect(result.status).toBe("COMPLETE");expect(result.results).toHaveLength(1);
    const records=await prisma.requirement.findMany({where:{projectId}});
    expect(records).toHaveLength(1);expect(records[0]).toMatchObject({title:issue().title,externalRef:issue().url,description:null,jiraIssueKey:null});
    expect(await prisma.jiraIssueIdentity.findFirst({where:{projectId}})).toMatchObject({importedRunId:id,externalId:issue().id,requirementId:records[0]!.id});
    expect(await prisma.auditLog.count({where:{projectId,entityType:"Requirement",action:"CREATE"}})).toBe(1);
  });
  it("identical reruns are unchanged across JSONB key order and never duplicate",async()=>{
    const first=await approved();await owner.processBatch({runId:first});const r=await reviewed();
    expect(r.issues[0]!.classification).toBe("unchanged");
    await owner.approve({runId:r.id,version:r.version,issueIds:[issue().id],requestId:randomUUID(),approved:true});await owner.processBatch({runId:r.id});
    expect((await owner.get({runId:r.id})).results[0]!.kind).toBe("unchanged");
    expect(await prisma.requirement.count({where:{projectId}})).toBe(1);
  });
  it("changed evidence and human edits are conflicts, never overwrites",async()=>{
    const first=await approved();await owner.processBatch({runId:first});
    const record=await prisma.requirement.findFirstOrThrow({where:{projectId}});
    await prisma.requirement.update({where:{id:record.id},data:{title:"Human business requirement",description:"Manual approved details"}});
    const r=await reviewed();expect(r.issues[0]!.classification).toBe("conflicting");
    await owner.approve({runId:r.id,version:r.version,issueIds:[issue().id],requestId:randomUUID(),approved:true});await owner.processBatch({runId:r.id});
    expect((await owner.get({runId:r.id})).results[0]!.kind).toBe("conflicting");
    expect(await prisma.requirement.findUnique({where:{id:record.id}})).toMatchObject({title:"Human business requirement",description:"Manual approved details"});
  });
  it("detects provider changes while preserving original native binding",async()=>{
    const first=await approved();await owner.processBatch({runId:first});
    const changed={...issue(),title:"Changed documented intent",status:"Done",updatedAt:"2026-10-01T01:00:00.000Z"};
    const {id}=await owner.start(startInput());vi.mocked(listJiraIssuePage).mockResolvedValue({issues:[changed],nextPageToken:null});const r=await page(id);
    expect(r.issues[0]!.classification).toBe("conflicting");expect((await prisma.requirement.findFirstOrThrow({where:{projectId}})).title).toBe(issue().title);
  });
  it("tombstones deleted requirements and preserves ambiguous legacy links",async()=>{
    const first=await approved();await owner.processBatch({runId:first});
    const record=await prisma.requirement.findFirstOrThrow({where:{projectId}});await prisma.requirement.delete({where:{id:record.id}});
    const tombstone=await reviewed();expect(tombstone.issues[0]).toMatchObject({classification:"conflicting",requirementId:null});
    const manual=await prisma.requirement.create({data:{projectId,title:"Human legacy link",jiraIssueKey:issue(2).key}});
    const {id}=await owner.start(startInput());vi.mocked(listJiraIssuePage).mockResolvedValue({issues:[issue(2)],nextPageToken:null});const r=await page(id);
    expect(r.issues[0]).toMatchObject({classification:"conflicting",requirementId:manual.id});expect(await prisma.requirement.count({where:{projectId}})).toBe(1);
  });
  it("serializes concurrent runs and uses one canonical native identity",async()=>{
    const a=await approved(),b=await approved();
    await Promise.all([owner.processBatch({runId:a}),owner.processBatch({runId:b})]);
    expect(await prisma.requirement.count({where:{projectId}})).toBe(1);expect(await prisma.jiraIssueIdentity.count({where:{projectId}})).toBe(1);
  });
  it("keeps prior batches on cancellation and prevents further writes",async()=>{
    const id=await approved(12);await owner.processBatch({runId:id});
    expect((await owner.get({runId:id})).results).toHaveLength(10);
    await owner.cancel({runId:id,confirmed:true});
    await expect(owner.processBatch({runId:id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(await prisma.requirement.count({where:{projectId}})).toBe(10);
    expect((await owner.get({runId:id})).issues).toHaveLength(12);
  });
  it("processes bounded batches safely after a lost client response",async()=>{
    const id=await approved(12);await owner.processBatch({runId:id});await owner.processBatch({runId:id});await owner.processBatch({runId:id});
    expect((await owner.get({runId:id})).results).toHaveLength(12);expect(await prisma.requirement.count({where:{projectId}})).toBe(12);
  });
  it("retains partial pages and retries safely after provider failure",async()=>{
    const {id}=await owner.start(startInput());vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[issue()],nextPageToken:"next-A"});await page(id);
    const before=await owner.get({runId:id});vi.mocked(listJiraIssuePage).mockRejectedValueOnce(new Error("provider secret not to leak"));
    const next={runId:id,version:before.version,requestId:randomUUID()};
    await expect(owner.nextPage(next)).rejects.toMatchObject({code:"BAD_REQUEST",message:expect.not.stringContaining("secret")});
    expect(await owner.get({runId:id})).toMatchObject({status:"PARTIAL",pageCount:1,issues:[expect.objectContaining({id:issue().id})]});
    vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[issue(2)],nextPageToken:null});await owner.nextPage(next);
    expect((await owner.get({runId:id})).issues).toHaveLength(2);
  });
  it("cancelled in-flight pages cannot resurrect or save returned content",async()=>{
    const {id}=await owner.start(startInput());let resolvePage!:(v:Awaited<ReturnType<typeof listJiraIssuePage>>)=>void;
    vi.mocked(listJiraIssuePage).mockImplementationOnce(()=>new Promise(resolve=>{resolvePage=resolve;}));
    const pending=owner.nextPage({runId:id,version:1,requestId:randomUUID()});
    await vi.waitFor(()=>expect(resolvePage).toBeDefined());await owner.cancel({runId:id,confirmed:true});
    resolvePage({issues:[issue()],nextPageToken:null});await expect(pending).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect(await owner.get({runId:id})).toMatchObject({status:"CANCELLED",issues:[]});
  });
  it("blocks tenant/actor/viewer/read-only operations and access removal",async()=>{
    const {id}=await owner.start(startInput());
    for(const a of [await actor("EDITOR"),await actor("VIEWER"),await actor("ADMIN","READ_ONLY"),await actor()]){
      await expect(a.caller.get({runId:id})).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(a.caller.start(startInput())).rejects.toMatchObject({code:"NOT_FOUND"});
    }
    await metadata.forget({id:connectionId,confirmed:true});
    await expect(owner.nextPage({runId:id,version:1,requestId:randomUUID()})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(listJiraIssuePage).not.toHaveBeenCalled();expect((await owner.get({runId:id})).issues).toEqual([]);
  });
  it("rechecks membership after provider I/O without retaining content",async()=>{
    const {id}=await owner.start(startInput());
    vi.mocked(listJiraIssuePage).mockImplementationOnce(async()=>{await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:actorId}},data:{role:"VIEWER"}});return {issues:[issue()],nextPageToken:null};});
    await expect(owner.nextPage({runId:id,version:1,requestId:randomUUID()})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect((await prisma.jiraIssueImportRun.findUniqueOrThrow({where:{id}})).issues).toEqual([]);
  });
  it("rechecks project tenant under transaction lock after provider I/O",async()=>{
    const {id}=await owner.start(startInput());const tier=await prisma.planTier.findUniqueOrThrow({where:{key:"free"}});
    const other=await prisma.organization.create({data:{name:"Different synthetic tenant",slug:"different-"+randomUUID(),planTierId:tier.id}});
    vi.mocked(listJiraIssuePage).mockImplementationOnce(async()=>{await prisma.project.update({where:{id:projectId},data:{organizationId:other.id}});return {issues:[issue()],nextPageToken:null};});
    await expect(owner.nextPage({runId:id,version:1,requestId:randomUUID()})).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect((await prisma.jiraIssueImportRun.findUniqueOrThrow({where:{id}})).issues).toEqual([]);
    expect(await prisma.requirement.count({where:{projectId}})).toBe(0);
  });
  it("rejects cross-scope pages and pagination loops without losing earlier pages",async()=>{
    const {id}=await owner.start(startInput());vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[issue()],nextPageToken:"loop"});await page(id);
    vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[{...issue(2),projectId:"99999"}],nextPageToken:null});
    await expect(page(id)).rejects.toMatchObject({code:"BAD_REQUEST"});
    vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[issue(2)],nextPageToken:"loop"});
    await expect(page(id)).rejects.toMatchObject({code:"BAD_REQUEST"});
    expect((await owner.get({runId:id})).issues).toHaveLength(1);
  });
  it("caps pages independently of sparse/empty native results",async()=>{
    const {id}=await owner.start(startInput());
    for(let n=1;n<=5;n++){vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[issue(n)],nextPageToken:"cursor-"+n});await page(id);}
    const calls=vi.mocked(listJiraIssuePage).mock.calls.length;
    await expect(page(id)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(listJiraIssuePage).toHaveBeenCalledTimes(calls);
  });
  it("expiry blocks new reads/writes but retains provenance for inspection",async()=>{
    const id=await approved();await prisma.jiraIssueImportRun.update({where:{id},data:{expiresAt:new Date(0)}});
    await expect(owner.processBatch({runId:id})).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect((await owner.get({runId:id})).issues).toHaveLength(1);expect(await prisma.requirement.count({where:{projectId}})).toBe(0);
  });
  it("approval rejects false permission/unstaged IDs and concurrent version changes",async()=>{
    const run=await reviewed();const input={runId:run.id,version:run.version,issueIds:[issue().id],requestId:randomUUID(),approved:true as const};
    await expect(owner.approve({...input,approved:false as never})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.approve({...input,issueIds:[issue(9).id]})).rejects.toMatchObject({code:"BAD_REQUEST"});
    await expect(owner.approve({...input,version:run.version+1})).rejects.toMatchObject({code:"CONFLICT"});
    expect(await prisma.requirement.count({where:{projectId}})).toBe(0);
  });
  it("a crashed expired lease can be resumed without discarding prior state",async()=>{
    const {id}=await owner.start(startInput());
    await prisma.jiraIssueImportRun.update({where:{id},data:{status:"READING",leaseRequestId:randomUUID(),leaseUntil:new Date(0),readAttempts:1}});
    expect(await owner.get({runId:id})).toMatchObject({status:"READING",readInFlight:false});
    await page(id);expect(await owner.get({runId:id})).toMatchObject({status:"PREVIEW",pageCount:1});
  });
  it("concurrent reads cannot reuse the provider while a lease is active",async()=>{
    const {id}=await owner.start(startInput());let finish!:(v:Awaited<ReturnType<typeof listJiraIssuePage>>)=>void;
    vi.mocked(listJiraIssuePage).mockImplementationOnce(()=>new Promise(resolve=>{finish=resolve;}));
    const pending=owner.nextPage({runId:id,version:1,requestId:randomUUID()});
    await vi.waitFor(()=>expect(finish).toBeDefined());
    expect(await owner.get({runId:id})).toMatchObject({readInFlight:true});
    await expect(owner.nextPage({runId:id,version:1,requestId:randomUUID()})).rejects.toMatchObject({code:"CONFLICT"});
    finish({issues:[issue()],nextPageToken:null});await pending;expect(listJiraIssuePage).toHaveBeenCalledTimes(1);
  });
  it("failed page attempts are capped and partial preview can still be reviewed",async()=>{
    const {id}=await owner.start(startInput());
    await prisma.jiraIssueImportRun.update({where:{id},data:{readAttempts:10,status:"PARTIAL"}});
    await expect(page(id)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});expect(listJiraIssuePage).not.toHaveBeenCalled();
    await owner.finishPreview({runId:id,version:1});expect(await owner.get({runId:id})).toMatchObject({status:"REVIEW"});
  });
  it("new-source enrichment adds only previously unseen native issues",async()=>{
    const first=await approved();await owner.processBatch({runId:first});
    const run=await reviewed(2);expect(run.issues.map(i=>i.classification)).toEqual(["unchanged","new"]);
    await owner.approve({runId:run.id,version:run.version,issueIds:run.issues.map(i=>i.id),requestId:randomUUID(),approved:true});await owner.processBatch({runId:run.id});
    expect(await prisma.requirement.count({where:{projectId}})).toBe(2);
  });
  it("inaccessible or missing issues do not delete previously imported records",async()=>{
    const first=await approved();await owner.processBatch({runId:first});
    const {id}=await owner.start(startInput());vi.mocked(listJiraIssuePage).mockResolvedValueOnce({issues:[],nextPageToken:null});await page(id);
    expect((await owner.get({runId:id})).issues).toEqual([]);expect(await prisma.requirement.count({where:{projectId}})).toBe(1);
  });
  it("rechecks human changes between preview and import instead of overwriting",async()=>{
    const id=await approved();
    const human=await prisma.requirement.create({data:{projectId,title:"Human approved",externalRef:issue().url,description:"Preserve this"}});
    await owner.processBatch({runId:id});
    expect((await owner.get({runId:id})).results[0]).toMatchObject({kind:"conflicting",requirementId:human.id});
    expect(await prisma.requirement.count({where:{projectId}})).toBe(1);
  });
  it("manual requirement mutations participate in the same project lock",async()=>{
    const id=await approved();const person=await actor("EDITOR");
    let unlock!:()=>void;let held=false;
    const holder=prisma.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${projectId} FOR UPDATE`;held=true;await new Promise<void>(resolve=>{unlock=resolve;});},{timeout:10000});
    await vi.waitFor(()=>expect(held).toBe(true));
    let inserted=false;
    const manual=person.requirements.create({projectId,title:"Human link",externalRef:issue().url}).then(r=>{inserted=true;return r;});
    const waiting=await person.requirements.list({projectId});expect(waiting).toHaveLength(0);expect(inserted).toBe(false);
    unlock();await holder;await manual;await owner.processBatch({runId:id});
    expect(await prisma.requirement.count({where:{projectId}})).toBe(1);
    expect((await owner.get({runId:id})).results[0]!.kind).toBe("conflicting");
  });
  it("rolls back a failed batch completely while preserving prior progress",async()=>{
    const id=await approved(12);await owner.processBatch({runId:id});
    let attempted=0;
    const failingPrisma=prisma.$extends({query:{requirement:{create({args,query}){
      attempted++;if(attempted===2)throw new Error("Synthetic database write failure");
      return query(args);
    }}}});
    const user=await prisma.user.findUniqueOrThrow({where:{id:actorId},include:{memberships:true}});
    const failing=jiraIssueIntakeRouter.createCaller({prisma:failingPrisma as unknown as typeof prisma,user,staff:null,securityLogger:undefined,staffAttempt:{tokenConfigured:false,tokenPresented:false,actorHeaderPresented:false}});
    await expect(failing.processBatch({runId:id})).rejects.toThrow("Synthetic database write failure");
    expect(attempted).toBe(2);expect(await prisma.requirement.count({where:{projectId}})).toBe(10);
    expect(await prisma.jiraIssueIdentity.count({where:{projectId}})).toBe(10);
    expect((await owner.get({runId:id})).results).toHaveLength(10);
    await owner.processBatch({runId:id});expect(await prisma.requirement.count({where:{projectId}})).toBe(12);
    expect(await owner.get({runId:id})).toMatchObject({status:"COMPLETE",results:expect.arrayContaining([expect.objectContaining({issueId:issue(12).id,kind:"created"})])});
  });
  it("manual edits reject a revoked cached membership inside the writer transaction",async()=>{
    const person=await actor("EDITOR");
    await prisma.membership.update({where:{organizationId_userId:{organizationId:orgId,userId:person.user.id}},data:{role:"VIEWER"}});
    await expect(person.requirements.create({projectId,title:"Do not write",externalRef:issue().url})).rejects.toMatchObject({code:"FORBIDDEN"});
    const record=await prisma.requirement.create({data:{projectId,title:"Preserve"}});
    await expect(person.requirements.update({id:record.id,title:"Do not change"})).rejects.toMatchObject({code:"FORBIDDEN"});
    await expect(person.requirements.delete({id:record.id})).rejects.toMatchObject({code:"FORBIDDEN"});
    expect(await prisma.requirement.findUnique({where:{id:record.id}})).toMatchObject({title:"Preserve"});
  });
});
