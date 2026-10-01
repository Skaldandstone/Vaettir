import {randomUUID} from "node:crypto";
import {z} from "zod";
import {TRPCError} from "@trpc/server";
import {Prisma,type JiraIssueImportRun} from "@vaettir/db";
import {router,protectedProcedure,type Context} from "../trpc.js";
import {hashOAuthState} from "../services/gitlabRepositoryOAuth.js";
import {jiraProjectSchema} from "../services/jiraSourceConnection.js";
import {jiraIssueSchema,listJiraIssuePage} from "../services/jiraIssueIntake.js";
import {own,verified,decrypt,liveEditor} from "./jiraConnections.js";

const ids=z.array(z.string().regex(/^[1-9]\d{0,31}$/)).min(1).max(100);
const runInput=z.object({runId:z.string()});
const versioned=runInput.extend({version:z.number().int().min(1)});
const issuesSchema=z.array(jiraIssueSchema).max(100);
const resultsSchema=z.array(z.object({issueId:z.string(),kind:z.enum(["created","unchanged","conflicting"]),requirementId:z.string().nullable()})).max(100);
const pagesSchema=z.array(z.object({requestId:z.string().uuid(),hash:z.string()})).max(5);
const fingerprint=(value:unknown)=>hashOAuthState(JSON.stringify(value));
const issueFingerprint=(value:unknown)=>{
  const issue=jiraIssueSchema.safeParse(value);
  return issue.success?fingerprint([issue.data.id,issue.data.projectId,issue.data.key,issue.data.title,issue.data.status,issue.data.updatedAt,issue.data.url]):null;
};
const scope=(run:JiraIssueImportRun)=>z.array(jiraProjectSchema).min(1).max(20).parse(run.selectedProjects);
function active(run:JiraIssueImportRun){
  if(run.expiresAt.getTime()<=Date.now())throw new TRPCError({code:"PRECONDITION_FAILED",message:"This preview expired. Start a new run; saved requirements are retained."});
}
async function runOwn(ctx:Context,id:string){
  const run=await ctx.prisma.jiraIssueImportRun.findFirst({where:{id,actorId:ctx.user!.id}});
  if(!run)throw new TRPCError({code:"NOT_FOUND"});
  const connection=await own(ctx,run.connectionId);
  if(run.projectId!==connection.projectId||run.organizationId!==connection.organizationId)throw new TRPCError({code:"NOT_FOUND"});
  return {run,connection};
}
async function lockRun(tx:Prisma.TransactionClient,run:JiraIssueImportRun){
  await liveEditor(tx,run.organizationId,run.actorId);
  const projects=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${run.projectId} FOR UPDATE`;
  if(projects[0]?.organizationId!==run.organizationId)throw new TRPCError({code:"FORBIDDEN",message:"Project workspace changed. Refresh your access."});
  await tx.$queryRaw`SELECT id FROM "JiraIssueImportRun" WHERE id=${run.id} FOR UPDATE`;
  return tx.jiraIssueImportRun.findUniqueOrThrow({where:{id:run.id}});
}
async function liveConnection(tx:Prisma.TransactionClient,run:JiraIssueImportRun){
  await tx.$queryRaw`SELECT id FROM "TicketSourceConnection" WHERE id=${run.connectionId} FOR UPDATE`;
  const connection=await tx.ticketSourceConnection.findUniqueOrThrow({where:{id:run.connectionId}});
  if(connection.actorId!==run.actorId||connection.projectId!==run.projectId||connection.organizationId!==run.organizationId||connection.provider!=="jira"||!connection.providerOrigin)throw new TRPCError({code:"NOT_FOUND"});
  verified(connection);
  const approved=z.array(jiraProjectSchema).parse(connection.approvedProjects);
  if(scope(run).some(p=>!approved.some(a=>a.id===p.id)))throw new TRPCError({code:"FORBIDDEN",message:"The issue-read scope is no longer approved."});
  return connection;
}
async function classify(tx:Prisma.TransactionClient,projectId:string,site:string,issue:z.infer<typeof jiraIssueSchema>){
  const binding=await tx.jiraIssueIdentity.findUnique({where:{projectId_providerOrigin_externalId:{projectId,providerOrigin:site,externalId:issue.id}},include:{requirement:true}});
  if(binding){
    const r=binding.requirement;
    const unchanged=r&&r.projectId===projectId&&r.title===issue.title&&r.description===null&&r.externalRef===issue.url&&issueFingerprint(binding.importedSnapshot)===issueFingerprint(issue);
    return {classification:unchanged?"unchanged" as const:"conflicting" as const,requirementId:r?.projectId===projectId?r.id:null};
  }
  // Conservatively flag legacy/manual links, including ambiguous same-key sites.
  // Never adopt or overwrite a human record based on title matching.
  const existing=await tx.requirement.findFirst({where:{projectId,OR:[{externalRef:issue.url},{jiraIssueKey:issue.key},{externalRef:issue.key}]}});
  return {classification:existing?"conflicting" as const:"new" as const,requirementId:existing?.id??null};
}

export const jiraIssueIntakeRouter=router({
  mine:protectedProcedure.input(z.object({connectionId:z.string()})).query(async({ctx,input})=>{
    const connection=await own(ctx,input.connectionId);
    const runs=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,connection.organizationId,ctx.user.id);
      const project=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${connection.projectId} FOR UPDATE`;
      if(project[0]?.organizationId!==connection.organizationId)throw new TRPCError({code:"FORBIDDEN"});
      return tx.jiraIssueImportRun.findMany({where:{connectionId:input.connectionId,actorId:ctx.user.id},orderBy:{createdAt:"desc"},take:20});
    });
    return runs.map(r=>({id:r.id,status:r.status,version:r.version,createdAt:r.createdAt,issueCount:issuesSchema.parse(r.issues).length,completedCount:resultsSchema.parse(r.results).length,lastError:r.lastError}));
  }),
  get:protectedProcedure.input(runInput).query(async({ctx,input})=>{
    const owned=await runOwn(ctx,input.runId);
    const snapshot=await ctx.prisma.$transaction(async tx=>{
      const current=await lockRun(tx,owned.run);
      const issues=await Promise.all(issuesSchema.parse(current.issues).map(async i=>({...i,...await classify(tx,current.projectId,owned.connection.providerOrigin!,i)})));
      return {run:current,issues};
    });
    const {run,issues}=snapshot;
    return {id:run.id,status:run.status,version:run.version,projects:scope(run),issues,readInFlight:run.status==="READING"&&!!run.leaseUntil&&run.leaseUntil.getTime()>Date.now(),nextPageAvailable:run.pageCount===0||!!run.nextCursor,pageCount:run.pageCount,bounded:run.pageCount>=5||issues.length>=100,results:resultsSchema.parse(run.results),lastError:run.lastError};
  }),
  start:protectedProcedure.input(z.object({connectionId:z.string(),projectIds:ids.refine(v=>v.length<=20),requestId:z.string().uuid(),approveIssueRead:z.literal(true)})).mutation(async({ctx,input})=>{
    const connection=await own(ctx,input.connectionId);
    const projectIds=[...new Set(input.projectIds)].sort();
    const requestKey=fingerprint(["jira-issue-read",ctx.user.id,input.connectionId,input.requestId]);
    const requestHash=fingerprint(projectIds);
    const result=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,connection.organizationId,ctx.user.id);
      const projectsNow=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${connection.projectId} FOR UPDATE`;
      if(projectsNow[0]?.organizationId!==connection.organizationId)throw new TRPCError({code:"FORBIDDEN"});
      await tx.$queryRaw`SELECT id FROM "TicketSourceConnection" WHERE id=${connection.id} FOR UPDATE`;
      const prior=await tx.jiraIssueImportRun.findUnique({where:{requestKey}});
      if(prior){if(prior.requestHash!==requestHash)throw new TRPCError({code:"CONFLICT"});return prior;}
      const current=await tx.ticketSourceConnection.findUniqueOrThrow({where:{id:connection.id}});verified(current);
      const approved=z.array(jiraProjectSchema).parse(current.approvedProjects);
      const projects=projectIds.map(id=>approved.find(p=>p.id===id));
      if(projects.some(p=>!p))throw new TRPCError({code:"FORBIDDEN",message:"Approve project scope before reading issues."});
      if(await tx.jiraIssueImportRun.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}})>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS"});
      return tx.jiraIssueImportRun.create({data:{connectionId:current.id,projectId:current.projectId,organizationId:current.organizationId,actorId:ctx.user.id,requestKey,requestHash,selectedProjects:projects as Prisma.InputJsonValue,expiresAt:new Date(Date.now()+86400000)}});
    });
    return {id:result.id};
  }),
  nextPage:protectedProcedure.input(versioned.extend({requestId:z.string().uuid()})).mutation(async({ctx,input})=>{
    const {run}=await runOwn(ctx,input.runId);
    const requestHash=fingerprint(input.version);
    const lease=randomUUID();
    const claimed=await ctx.prisma.$transaction(async tx=>{
      const current=await lockRun(tx,run);active(current);
      const receipts=pagesSchema.parse(current.pageReceipts);
      const prior=receipts.find(r=>r.requestId===input.requestId);
      if(prior){if(prior.hash!==requestHash)throw new TRPCError({code:"CONFLICT"});return null;}
      if(!["PREVIEW","PARTIAL","READING"].includes(current.status))throw new TRPCError({code:"PRECONDITION_FAILED"});
      if(current.leaseUntil&&current.leaseUntil.getTime()>Date.now())throw new TRPCError({code:"CONFLICT",message:"A preview page is already running."});
      if(current.version!==input.version)throw new TRPCError({code:"CONFLICT",message:"Refresh this preview before reading another page."});
      if(current.pageCount>=5||issuesSchema.parse(current.issues).length>=100||current.pageCount>0&&!current.nextCursor||current.readAttempts>=10)throw new TRPCError({code:"PRECONDITION_FAILED",message:"This preview reached its safe limit. Review the retained batch."});
      const access=await liveConnection(tx,current);
      await tx.jiraIssueImportRun.update({where:{id:current.id},data:{status:"READING",leaseRequestId:lease,leaseUntil:new Date(Date.now()+60000),lastError:null,readAttempts:{increment:1}}});
      return {run:current,access};
    });
    if(!claimed)return {id:run.id};
    try{
      const page=await listJiraIssuePage(decrypt(claimed.access.encryptedToken),scope(claimed.run).map(p=>p.id),claimed.run.nextCursor);
      const fresh=z.array(jiraIssueSchema).max(20).parse(page.issues);
      if(fresh.some(i=>!scope(claimed.run).some(p=>p.id===i.projectId)||new URL(i.url).origin!==claimed.access.providerOrigin))throw new Error("Out-of-scope Jira response");
      const seen=z.array(z.string()).max(5).parse(claimed.run.seenCursors);
      if(page.nextPageToken&&(page.nextPageToken===claimed.run.nextCursor||seen.includes(page.nextPageToken)))throw new Error("Pagination loop");
      const previous=issuesSchema.parse(claimed.run.issues);
      if(fresh.some(i=>previous.some(p=>p.id===i.id||p.key===i.key)))throw new Error("Repeated issue identity");
      const combined=issuesSchema.parse([...previous,...fresh]);
      await ctx.prisma.$transaction(async tx=>{
        const current=await lockRun(tx,run);active(current);await liveConnection(tx,current);
        if(current.status!=="READING"||current.leaseRequestId!==lease||!current.leaseUntil||current.leaseUntil.getTime()<=Date.now())throw new TRPCError({code:"CONFLICT",message:"This preview was cancelled or changed."});
        await tx.jiraIssueImportRun.update({where:{id:run.id},data:{issues:combined,nextCursor:page.nextPageToken,seenCursors:page.nextPageToken?[...seen,page.nextPageToken]:seen,pageCount:{increment:1},pageReceipts:[...pagesSchema.parse(current.pageReceipts),{requestId:input.requestId,hash:requestHash}],status:"PREVIEW",leaseRequestId:null,leaseUntil:null,version:{increment:1}}});
      });
      return {id:run.id};
    }catch{
      await ctx.prisma.jiraIssueImportRun.updateMany({where:{id:run.id,status:"READING",leaseRequestId:lease},data:{status:"PARTIAL",leaseRequestId:null,leaseUntil:null,lastError:"Jira page unavailable or inconsistent. Retained pages are unchanged; retry or review this partial batch."}});
      throw new TRPCError({code:"BAD_REQUEST",message:"Could not read this Jira page. Retained pages are safe; retry or review the partial preview."});
    }
  }),
  finishPreview:protectedProcedure.input(versioned).mutation(async({ctx,input})=>{
    const {run}=await runOwn(ctx,input.runId);
    await ctx.prisma.$transaction(async tx=>{
      const current=await lockRun(tx,run);active(current);
      if(current.version!==input.version||!["PREVIEW","PARTIAL","READING"].includes(current.status)||current.leaseUntil&&current.leaseUntil.getTime()>Date.now())throw new TRPCError({code:"CONFLICT",message:"Wait for the page, then refresh and review."});
      await tx.jiraIssueImportRun.update({where:{id:run.id},data:{status:"REVIEW",leaseRequestId:null,leaseUntil:null,version:{increment:1}}});
    });return {id:run.id};
  }),
  approve:protectedProcedure.input(versioned.extend({issueIds:ids,requestId:z.string().uuid(),approved:z.literal(true)})).mutation(async({ctx,input})=>{
    const {run}=await runOwn(ctx,input.runId);
    const selected=[...new Set(input.issueIds)].sort();
    const hash=fingerprint([input.version,selected]);
    await ctx.prisma.$transaction(async tx=>{
      const current=await lockRun(tx,run);
      if(current.approvalRequestId===input.requestId){if(current.approvalHash!==hash)throw new TRPCError({code:"CONFLICT"});return;}
      active(current);await liveConnection(tx,current);
      if(current.status!=="REVIEW"||current.version!==input.version)throw new TRPCError({code:"CONFLICT",message:"Refresh and review this batch again."});
      const staged=issuesSchema.parse(current.issues);
      if(selected.some(id=>!staged.some(i=>i.id===id)))throw new TRPCError({code:"BAD_REQUEST"});
      await tx.jiraIssueImportRun.update({where:{id:run.id},data:{status:"IMPORTING",approvedIssueIds:selected,approvalRequestId:input.requestId,approvalHash:hash,importApprovedAt:new Date(),version:{increment:1},lastError:null}});
    });return {id:run.id};
  }),
  processBatch:protectedProcedure.input(runInput).mutation(async({ctx,input})=>{
    const {run}=await runOwn(ctx,input.runId);
    await ctx.prisma.$transaction(async tx=>{
      const current=await lockRun(tx,run);
      if(current.status==="COMPLETE")return;
      active(current);const access=await liveConnection(tx,current);
      if(current.status!=="IMPORTING"||!current.importApprovedAt)throw new TRPCError({code:"PRECONDITION_FAILED"});
      const staged=issuesSchema.parse(current.issues);
      const approved=ids.parse(current.approvedIssueIds);
      const results=resultsSchema.parse(current.results);
      const remaining=approved.filter(id=>!results.some(r=>r.issueId===id)).slice(0,10);
      for(const issueId of remaining){
        const issue=staged.find(i=>i.id===issueId);if(!issue)throw new TRPCError({code:"PRECONDITION_FAILED"});
        const comparison=await classify(tx,current.projectId,access.providerOrigin!,issue);
        if(comparison.classification!=="new"){results.push({issueId,kind:comparison.classification,requirementId:comparison.requirementId});continue;}
        const requirement=await tx.requirement.create({data:{projectId:current.projectId,title:issue.title,externalRef:issue.url}});
        await tx.jiraIssueIdentity.create({data:{projectId:current.projectId,providerOrigin:access.providerOrigin!,externalId:issue.id,requirementId:requirement.id,importedSnapshot:issue,importedRunId:current.id}});
        await tx.auditLog.create({data:{organizationId:current.organizationId,projectId:current.projectId,actorId:current.actorId,entityType:"Requirement",entityId:requirement.id,action:"CREATE",summary:"Imported reviewed Jira issue summary",metadata:{runId:current.id,site:access.providerOrigin,issueId:issue.id,key:issue.key}}});
        results.push({issueId,kind:"created",requirementId:requirement.id});
      }
      await tx.jiraIssueImportRun.update({where:{id:current.id},data:{results,status:results.length===approved.length?"COMPLETE":"IMPORTING",version:{increment:1},lastError:null}});
    },{timeout:15000});
    return {id:run.id};
  }),
  cancel:protectedProcedure.input(runInput.extend({confirmed:z.literal(true)})).mutation(async({ctx,input})=>{
    const {run}=await runOwn(ctx,input.runId);
    await ctx.prisma.$transaction(async tx=>{
      const current=await lockRun(tx,run);
      if(["COMPLETE","CANCELLED"].includes(current.status))return;
      await tx.jiraIssueImportRun.update({where:{id:current.id},data:{status:"CANCELLED",leaseRequestId:null,leaseUntil:null,version:{increment:1}}});
    });return {id:run.id};
  }),
});
