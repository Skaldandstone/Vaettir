import {z} from "zod";
import {TRPCError} from "@trpc/server";
import {Prisma} from "@vaettir/db";
import {router,protectedProcedure,requireProjectAccess,type Context} from "../trpc.js";
import {encryptToken,decryptToken} from "../services/tokenEncryption.js";
import {hashOAuthState} from "../services/gitlabRepositoryOAuth.js";
import {linearCatalogSchema,linearProjectSchema,listLinearProjects} from "../services/linearSourceConnection.js";

const projectInput=z.object({projectId:z.string()});
const catalogSchema=linearCatalogSchema.extend({cursors:z.array(z.string().min(1).max(1000)).max(10)});
const receiptsSchema=z.array(z.object({requestId:z.string().uuid(),hash:z.string(),count:z.number()})).max(50);
const cipherSchema=z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()});
const storageReady=()=>{try{encryptToken("availability-probe");return true;}catch{return false;}};
async function editor(ctx:Context,projectId:string){
  if(!ctx.user)throw new TRPCError({code:"UNAUTHORIZED"});
  const access=await requireProjectAccess({...ctx,user:ctx.user},projectId,"EDITOR");
  if(access.membership.seatType!=="FULL")throw new TRPCError({code:"FORBIDDEN",message:"A full editor seat is required."});
  return access;
}
async function liveEditor(tx:Prisma.TransactionClient,orgId:string,actorId:string){
  const orgs=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${orgId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${orgId} AND "userId"=${actorId} FOR UPDATE`;
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:orgId,userId:actorId}}});
  if(!orgs[0]||orgs[0].suspendedAt||!member||member.seatType!=="FULL"||!["OWNER","ADMIN","EDITOR"].includes(member.role))throw new TRPCError({code:"FORBIDDEN",message:"Workspace access changed. Refresh before connecting."});
}
async function own(ctx:Context,id:string){
  const row=await ctx.prisma.ticketSourceConnection.findFirst({where:{id,provider:"linear",actorId:ctx.user!.id}});
  if(!row)throw new TRPCError({code:"NOT_FOUND"});
  const {project}=await editor(ctx,row.projectId);
  if(project.organizationId!==row.organizationId)throw new TRPCError({code:"NOT_FOUND"});
  return row;
}
function verified(row:{status:string;tokenExpiresAt:Date|null;encryptedToken:unknown}){
  if(row.status!=="VERIFIED"||!row.encryptedToken||!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+30000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Verify Linear access again. Previously approved scope is retained."});
}
const decrypt=(token:unknown)=>decryptToken(cipherSchema.parse(token));
const unavailable=()=>new TRPCError({code:"PRECONDITION_FAILED",message:"Secure credential storage is unavailable. Ask Vaettir support to enable Linear connections."});

export const linearConnectionsRouter=router({
  capabilities:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    const {membership}=await requireProjectAccess(ctx,input.projectId);
    return {credentialStorageReady:storageReady(),tokenImplemented:true,oauthAvailable:false,issueImportAvailable:false,canConnect:membership.seatType==="FULL"&&["OWNER","ADMIN","EDITOR"].includes(membership.role)};
  }),
  mine:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    await editor(ctx,input.projectId);
    const rows=await ctx.prisma.ticketSourceConnection.findMany({where:{projectId:input.projectId,actorId:ctx.user.id,provider:"linear"},orderBy:{createdAt:"desc"},take:20});
    return rows.map(row=>{const catalog=catalogSchema.safeParse(row.catalog).data;return {id:row.id,status:row.status==="VERIFIED"&&(!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+30000)||row.status==="VERIFYING"&&row.authorizationExpiresAt.getTime()<=Date.now()?"EXPIRED":row.status,workspace:catalog?.workspace??null,approvedProjects:z.array(linearProjectSchema).parse(row.approvedProjects),approvedAt:row.approvedAt};});
  }),
  verify:protectedProcedure.input(projectInput.extend({requestId:z.string().uuid(),apiKey:z.string().min(1).max(10000).regex(/^[!-~]+$/),approveMetadataAccess:z.literal(true)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    if(!storageReady())throw unavailable();
    const requestKey=hashOAuthState(JSON.stringify(["linear",ctx.user.id,input.projectId,input.requestId]));
    const requestHash=hashOAuthState(input.apiKey);
    const row=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,project.organizationId,ctx.user.id);
      await tx.ticketSourceConnection.updateMany({where:{projectId:input.projectId,actorId:ctx.user.id,provider:"linear",status:"VERIFYING",authorizationExpiresAt:{lte:new Date()}},data:{status:"EXPIRED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null}});
      const prior=await tx.ticketSourceConnection.findUnique({where:{requestKey}});
      if(prior){if(prior.requestHash!==requestHash)throw new TRPCError({code:"CONFLICT",message:"This request changed. Start a new verification."});verified(prior);return prior;}
      if(await tx.ticketSourceConnection.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}})>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS"});
      if(await tx.ticketSourceConnection.count({where:{projectId:input.projectId,actorId:ctx.user.id,provider:"linear",OR:[{status:"VERIFYING",authorizationExpiresAt:{gt:new Date()}},{status:"VERIFIED",tokenExpiresAt:{gt:new Date()}}]}}))throw new TRPCError({code:"CONFLICT",message:"Resume or remove saved Linear access before verifying another key."});
      return tx.ticketSourceConnection.create({data:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,provider:"linear",requestKey,requestHash,authorizationExpiresAt:new Date(Date.now()+600000),tokenExpiresAt:new Date(Date.now()+28800000)}});
    });
    if(row.status==="VERIFIED")return{id:row.id};
    try{
      const result=await listLinearProjects(input.apiKey);
      const catalog=catalogSchema.parse({...result,cursors:result.hasMore?[result.nextCursor]:[]});
      await ctx.prisma.$transaction(async tx=>{
        await liveEditor(tx,project.organizationId,ctx.user.id);
        const saved=await tx.ticketSourceConnection.updateMany({where:{id:row.id,status:"VERIFYING",authorizationExpiresAt:{gt:new Date()}},data:{status:"VERIFIED",encryptedToken:{...encryptToken(input.apiKey)},verifiedAt:new Date(),catalog,catalogAt:new Date(),version:1}});
        if(saved.count!==1)throw new Error("Verification changed");
      });
      return{id:row.id};
    }catch{
      await ctx.prisma.ticketSourceConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{status:"FAILED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null}});
      throw new TRPCError({code:"BAD_REQUEST",message:"Linear access could not be verified. Check the key's permissions. No project scope was saved."});
    }
  }),
  list:protectedProcedure.input(z.object({id:z.string(),after:z.string().min(1).max(1000).nullable().default(null)})).query(async({ctx,input})=>{
    const row=await own(ctx,input.id);verified(row);
    const prior=catalogSchema.parse(row.catalog);
    if(input.after&&!prior.cursors.includes(input.after))throw new TRPCError({code:"BAD_REQUEST",message:"Use the next page from this verified list."});
    await ctx.prisma.$transaction(tx=>liveEditor(tx,row.organizationId,ctx.user.id));
    let result;
    try{result=await listLinearProjects(decrypt(row.encryptedToken),input.after);}catch{throw new TRPCError({code:"BAD_REQUEST",message:"Linear metadata is unavailable. Previously approved scope is retained."});}
    if(result.workspace.id!==prior.workspace.id||result.account.id!==prior.account.id)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Linear account or workspace changed. Verify access again."});
    const fresh=!!input.after&&!!row.catalogAt&&row.catalogAt.getTime()>=Date.now()-600000;
    if(input.after&&!fresh)throw new TRPCError({code:"PRECONDITION_FAILED",message:"The catalog expired. Refresh the first page before continuing."});
    if(input.after&&result.hasMore&&result.nextCursor&&prior.cursors.includes(result.nextCursor))throw new TRPCError({code:"BAD_REQUEST",message:"Linear pagination did not advance. Refresh the first page."});
    const projects=new Map((fresh?prior.projects:[]).map(p=>[p.id,p]));
    for(const p of result.projects)projects.set(p.id,p);
    if(projects.size>500)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Review a smaller batch of Linear projects."});
    const cursors=fresh?new Set(prior.cursors):new Set<string>();
    if(result.hasMore&&result.nextCursor)cursors.add(result.nextCursor);
    // At most ten metadata pages per batch. Never label a truncated catalog complete.
    const bounded=result.hasMore&&(cursors.size>=10||projects.size>=500);
    const catalog=catalogSchema.parse({workspace:result.workspace,account:result.account,projects:[...projects.values()],cursors:bounded?[...cursors].slice(0,10):[...cursors]});
    const updated=await ctx.prisma.$transaction(async tx=>{
      await liveEditor(tx,row.organizationId,ctx.user.id);
      await tx.$queryRaw`SELECT id FROM "TicketSourceConnection" WHERE id=${row.id} FOR UPDATE`;
      const current=await tx.ticketSourceConnection.findUniqueOrThrow({where:{id:row.id}});verified(current);
      if(current.version!==row.version)throw new TRPCError({code:"CONFLICT",message:"Linear choices changed. Refresh and review again."});
      return tx.ticketSourceConnection.update({where:{id:row.id},data:{catalog,catalogAt:fresh?row.catalogAt:new Date(),version:{increment:1}}});
    });
    return {workspace:result.workspace,account:result.account,projects:result.projects,version:updated.version,catalogReset:!fresh,nextCursor:bounded?null:result.hasMore?result.nextCursor:null,bounded};
  }),
  approve:protectedProcedure.input(z.object({id:z.string(),version:z.number().int().min(1),projectIds:z.array(z.string().uuid()).min(1).max(100),requestId:z.string().uuid(),approved:z.literal(true)})).mutation(async({ctx,input})=>{
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
      if(current.version!==input.version)throw new TRPCError({code:"CONFLICT",message:"Linear choices changed. Refresh before approving."});
      if(!current.catalogAt||current.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh Linear metadata before approving."});
      const catalog=catalogSchema.parse(current.catalog);
      const selected=ids.map(id=>catalog.projects.find(p=>p.id===id));
      if(selected.some(p=>!p))throw new TRPCError({code:"BAD_REQUEST",message:"Choose projects from the verified catalog."});
      if(receipts.length>=50)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Start a new connection to review additional scope."});
      const existing=z.array(linearProjectSchema).parse(current.approvedProjects);
      const combined=new Map(existing.map(p=>[p.id,p]));
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
