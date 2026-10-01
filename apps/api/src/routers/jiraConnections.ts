import {z} from "zod";
import {TRPCError} from "@trpc/server";
import {Prisma} from "@vaettir/db";
import {router,protectedProcedure,requireProjectAccess,type Context} from "../trpc.js";
import {encryptToken,decryptToken} from "../services/tokenEncryption.js";
import {hashOAuthState} from "../services/gitlabRepositoryOAuth.js";
import {jiraSiteOrigin,jiraCatalogSchema,jiraProjectSchema,listJiraProjects} from "../services/jiraSourceConnection.js";

const projectInput=z.object({projectId:z.string()});
const cursor=z.number().int().min(1).max(1000000);
const catalogSchema=jiraCatalogSchema.and(z.object({cursors:z.array(cursor).max(10)}));
const receiptsSchema=z.array(z.object({requestId:z.string().uuid(),hash:z.string(),count:z.number()})).max(50);
const cipherSchema=z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()});
const credentialSchema=z.object({siteUrl:z.string().max(300),email:z.string().email().max(254).refine(v=>!v.includes(":")),apiToken:z.string().min(1).max(10000).regex(/^[!-~]+$/)});
const storageReady=()=>{try{encryptToken("availability-probe");return true;}catch{return false;}};
export async function editor(ctx:Context,projectId:string){
  if(!ctx.user)throw new TRPCError({code:"UNAUTHORIZED"});
  const access=await requireProjectAccess({...ctx,user:ctx.user},projectId,"EDITOR");
  if(access.membership.seatType!=="FULL")throw new TRPCError({code:"FORBIDDEN",message:"A full editor seat is required."});
  return access;
}
export async function liveEditor(tx:Prisma.TransactionClient,orgId:string,actorId:string){
  const orgs=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${orgId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${orgId} AND "userId"=${actorId} FOR UPDATE`;
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:orgId,userId:actorId}}});
  if(!orgs[0]||orgs[0].suspendedAt||!member||member.seatType!=="FULL"||!["OWNER","ADMIN","EDITOR"].includes(member.role))throw new TRPCError({code:"FORBIDDEN",message:"Workspace access changed. Refresh before connecting."});
}
export async function own(ctx:Context,id:string){
  const row=await ctx.prisma.ticketSourceConnection.findFirst({where:{id,provider:"jira",actorId:ctx.user!.id}});
  if(!row)throw new TRPCError({code:"NOT_FOUND"});
  const {project}=await editor(ctx,row.projectId);
  if(project.organizationId!==row.organizationId)throw new TRPCError({code:"NOT_FOUND"});
  return row;
}
export function verified(row:{status:string;tokenExpiresAt:Date|null;encryptedToken:unknown}){
  if(row.status!=="VERIFIED"||!row.encryptedToken||!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+30000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Verify Jira access again. Previously approved scope is retained."});
}
export const decrypt=(token:unknown)=>credentialSchema.parse(JSON.parse(decryptToken(cipherSchema.parse(token))));

export const jiraConnectionsRouter=router({
  capabilities:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    const {membership}=await requireProjectAccess(ctx,input.projectId);
    return {credentialStorageReady:storageReady(),tokenImplemented:true,oauthAvailable:false,scopedTokensAvailable:false,selfHostedAvailable:false,issueImportAvailable:true,canConnect:membership.seatType==="FULL"&&["OWNER","ADMIN","EDITOR"].includes(membership.role)};
  }),
  mine:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    await editor(ctx,input.projectId);
    const rows=await ctx.prisma.ticketSourceConnection.findMany({where:{projectId:input.projectId,actorId:ctx.user.id,provider:"jira"},orderBy:{createdAt:"desc"},take:20});
    return rows.map(row=>({id:row.id,status:row.status==="VERIFIED"&&(!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+30000)||row.status==="VERIFYING"&&row.authorizationExpiresAt.getTime()<=Date.now()?"EXPIRED":row.status,workspace:catalogSchema.safeParse(row.catalog).data?.workspace??null,approvedProjects:z.array(jiraProjectSchema).parse(row.approvedProjects),approvedAt:row.approvedAt,siteUrl:row.providerOrigin}));
  }),
  verify:protectedProcedure.input(projectInput.merge(credentialSchema).extend({requestId:z.string().uuid(),approveMetadataAccess:z.literal(true)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    if(!storageReady())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Secure credential storage is unavailable. Ask Vaettir support to enable Jira connections."});
    let siteUrl:string;
    try{siteUrl=jiraSiteOrigin(input.siteUrl);}catch{throw new TRPCError({code:"BAD_REQUEST",message:"Use your Jira Cloud HTTPS site, such as https://your-team.atlassian.net. Self-hosted Jira is not supported by this connector."});}
    const credentials={siteUrl,email:input.email,apiToken:input.apiToken};
    const requestKey=hashOAuthState(JSON.stringify(["jira",ctx.user.id,input.projectId,input.requestId]));
    const requestHash=hashOAuthState(JSON.stringify(credentials));
    const row=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id);
      await tx.ticketSourceConnection.updateMany({where:{projectId:input.projectId,actorId:ctx.user.id,provider:"jira",status:"VERIFYING",authorizationExpiresAt:{lte:new Date()}},data:{status:"EXPIRED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null}});
      const prior=await tx.ticketSourceConnection.findUnique({where:{requestKey}});
      if(prior){if(prior.requestHash!==requestHash)throw new TRPCError({code:"CONFLICT",message:"This request changed. Start a new verification."});verified(prior);return prior;}
      if(await tx.ticketSourceConnection.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}})>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS"});
      if(await tx.ticketSourceConnection.count({where:{projectId:input.projectId,actorId:ctx.user.id,provider:"jira",providerOrigin:siteUrl,OR:[{status:"VERIFYING",authorizationExpiresAt:{gt:new Date()}},{status:"VERIFIED",tokenExpiresAt:{gt:new Date()}}]}}))throw new TRPCError({code:"CONFLICT",message:"Resume or remove saved access to this Jira site before verifying another token."});
      return tx.ticketSourceConnection.create({data:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,provider:"jira",providerOrigin:siteUrl,requestKey,requestHash,authorizationExpiresAt:new Date(Date.now()+600000),tokenExpiresAt:new Date(Date.now()+28800000)}});
    });
    if(row.status==="VERIFIED")return{id:row.id};
    try{
      const result=await listJiraProjects(credentials);
      if(result.workspace.id!==siteUrl)throw new Error("Site changed");
      const catalog=catalogSchema.parse({...result,cursors:result.hasMore?[result.nextCursor]:[]});
      await ctx.prisma.$transaction(async tx=>{
        await liveEditor(tx,project.organizationId,ctx.user.id);
        const saved=await tx.ticketSourceConnection.updateMany({where:{id:row.id,status:"VERIFYING",authorizationExpiresAt:{gt:new Date()}},data:{status:"VERIFIED",encryptedToken:{...encryptToken(JSON.stringify(credentials))},verifiedAt:new Date(),catalog,catalogAt:new Date(),version:1}});
        if(saved.count!==1)throw new Error("Verification changed");
      });
      return{id:row.id};
    }catch{
      await ctx.prisma.ticketSourceConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{status:"FAILED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null}});
      throw new TRPCError({code:"BAD_REQUEST",message:"Jira access could not be verified. Check the site, account email and standard API token. No project scope was saved."});
    }
  }),
  list:protectedProcedure.input(z.object({id:z.string(),after:cursor.nullable().default(null)})).query(async({ctx,input})=>{
    const row=await own(ctx,input.id);verified(row);
    const prior=catalogSchema.parse(row.catalog);
    if(input.after!==null&&!prior.cursors.includes(input.after))throw new TRPCError({code:"BAD_REQUEST",message:"Use the next page from this verified list."});
    const fresh=input.after!==null&&!!row.catalogAt&&row.catalogAt.getTime()>=Date.now()-600000;
    if(input.after!==null&&!fresh)throw new TRPCError({code:"PRECONDITION_FAILED",message:"The catalog expired. Refresh the first page before continuing."});
    await ctx.prisma.$transaction(tx=>liveEditor(tx,row.organizationId,ctx.user.id));
    let result;
    try{result=await listJiraProjects(decrypt(row.encryptedToken),input.after??0);}catch{throw new TRPCError({code:"BAD_REQUEST",message:"Jira metadata is unavailable. Previously approved scope is retained."});}
    if(result.workspace.id!==row.providerOrigin||result.workspace.id!==prior.workspace.id||result.account.id!==prior.account.id)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Jira account or site changed. Verify access again."});
    if(input.after!==null&&result.hasMore&&result.nextCursor!==null&&(result.nextCursor<=input.after||prior.cursors.includes(result.nextCursor)))throw new TRPCError({code:"BAD_REQUEST",message:"Jira pagination did not advance. Refresh the first page."});
    const projects=new Map((fresh?prior.projects:[]).map(p=>[p.id,p]));
    for(const p of result.projects)projects.set(p.id,p);
    if(projects.size>500)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Review a smaller batch of Jira projects."});
    const cursors=fresh?new Set(prior.cursors):new Set<number>();
    if(result.hasMore&&result.nextCursor!==null)cursors.add(result.nextCursor);
    const bounded=result.hasMore&&(cursors.size>=10||projects.size>=500);
    // Never persist a next page we deliberately did not offer. Hiding the
    // cursor in the UI is not an API pagination limit.
    const catalog=catalogSchema.parse({workspace:result.workspace,account:result.account,projects:[...projects.values()],cursors:bounded?[...cursors].filter(c=>c!==result.nextCursor):[...cursors]});
    const updated=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "TicketSourceConnection" WHERE id=${row.id} FOR UPDATE`;
      const current=await tx.ticketSourceConnection.findUniqueOrThrow({where:{id:row.id}});verified(current);
      if(current.version!==row.version)throw new TRPCError({code:"CONFLICT",message:"Jira choices changed. Refresh and review again."});
      return tx.ticketSourceConnection.update({where:{id:row.id},data:{catalog,catalogAt:fresh?row.catalogAt:new Date(),version:{increment:1}}});
    });
    return {workspace:result.workspace,account:result.account,projects:result.projects,version:updated.version,catalogReset:!fresh,nextCursor:bounded?null:result.hasMore?result.nextCursor:null,bounded};
  }),
  approve:protectedProcedure.input(z.object({id:z.string(),version:z.number().int().min(1),projectIds:z.array(z.string().regex(/^[1-9]\d{0,31}$/)).min(1).max(100),requestId:z.string().uuid(),approved:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await own(ctx,input.id);
    const ids=[...new Set(input.projectIds)].sort();
    const hash=hashOAuthState(JSON.stringify([input.version,ids]));
    return ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "TicketSourceConnection" WHERE id=${row.id} FOR UPDATE`;
      const current=await tx.ticketSourceConnection.findUniqueOrThrow({where:{id:row.id}});
      const receipts=receiptsSchema.parse(current.approvalReceipts);
      const receipt=receipts.find(r=>r.requestId===input.requestId);
      if(receipt){if(receipt.hash!==hash)throw new TRPCError({code:"CONFLICT",message:"This approval request changed."});return {savedProjects:receipt.count};}
      verified(current);
      if(current.version!==input.version)throw new TRPCError({code:"CONFLICT",message:"Jira choices changed. Refresh before approving."});
      if(!current.catalogAt||current.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh Jira metadata before approving."});
      const catalog=catalogSchema.parse(current.catalog);
      const selected=ids.map(id=>catalog.projects.find(p=>p.id===id));
      if(selected.some(p=>!p))throw new TRPCError({code:"BAD_REQUEST",message:"Choose projects from the verified catalog."});
      if(receipts.length>=50)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Start a new connection to review additional scope."});
      const combined=new Map(z.array(jiraProjectSchema).parse(current.approvedProjects).map(p=>[p.id,p]));
      for(const p of selected)if(p)combined.set(p.id,p);
      if(combined.size>500)throw new TRPCError({code:"PRECONDITION_FAILED",message:"The saved scope reached its safe limit."});
      await tx.ticketSourceConnection.update({where:{id:current.id},data:{approvedProjects:[...combined.values()],approvedAt:new Date(),approvalReceipts:[...receipts,{requestId:input.requestId,hash,count:combined.size}],version:{increment:1}}});
      return {savedProjects:combined.size};
    });
  }),
  forget:protectedProcedure.input(z.object({id:z.string(),confirmed:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await own(ctx,input.id);
    await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.ticketSourceConnection.update({where:{id:row.id},data:{status:"DISCONNECTED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null,version:{increment:1}}});
    });
    return {removed:true,providerRevocationRequired:true};
  }),
});
