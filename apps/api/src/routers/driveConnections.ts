import {z} from "zod";
import {randomUUID} from "node:crypto";
import {TRPCError} from "@trpc/server";
import {Prisma,type DriveSourceConnection} from "@vaettir/db";
import {router,protectedProcedure,requireProjectAccess,type Context} from "../trpc.js";
import {encryptToken,decryptToken} from "../services/tokenEncryption.js";
import {hashOAuthState} from "../services/gitlabRepositoryOAuth.js";
import {createDriveAuthorization,driveOAuthConfigured,driveOAuthRedirect,driveAccountSchema,driveFileSchema,listDriveFiles,verifyDriveAuthorization} from "../services/googleDriveConnection.js";

const projectInput=z.object({projectId:z.string()});
const fileId=z.string().min(1).max(200).regex(/^[A-Za-z0-9_-]+$/);
const catalogSchema=z.object({files:z.array(driveFileSchema).max(125),folderId:fileId.nullable(),search:z.string().max(100),nextCursor:z.string().nullable(),cursors:z.array(z.string()).max(5),pageCount:z.number().int().min(1).max(5),bounded:z.boolean()});
const approvalReceipts=z.array(z.object({requestId:z.string().uuid(),hash:z.string(),count:z.number()})).max(50);
const responseSchema=z.object({account:driveAccountSchema,files:z.array(driveFileSchema).max(125),version:z.number(),nextCursor:z.string().nullable(),bounded:z.boolean(),catalogReset:z.boolean()});
const listReceipts=z.array(z.object({requestId:z.string().uuid(),hash:z.string(),response:responseSchema})).max(10);
const cipher=z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()});
const decrypt=(value:unknown)=>decryptToken(cipher.parse(value));
function storageReady(){try{encryptToken("drive-storage-probe");return true;}catch{return false;}}
const configHash=()=>hashOAuthState(JSON.stringify([process.env.GOOGLE_DRIVE_CLIENT_ID,process.env.GOOGLE_DRIVE_CLIENT_SECRET,driveOAuthRedirect()]));
const unavailable=()=>new TRPCError({code:"PRECONDITION_FAILED",message:"Google Drive authorization is unavailable. Vaettir support must configure its OAuth application and secure credential storage."});
function publicStatus(row:DriveSourceConnection){return row.status==="VERIFIED"&&(!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+30000)||["PENDING","VERIFYING"].includes(row.status)&&row.authorizationExpiresAt.getTime()<=Date.now()?"EXPIRED":row.status;}
function verified(row:DriveSourceConnection){if(publicStatus(row)!=="VERIFIED"||!row.encryptedToken)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Authorize Drive again to check current access. Approved file scope is retained."});}
async function editor(ctx:Context,projectId:string){
  if(!ctx.user)throw new TRPCError({code:"UNAUTHORIZED"});
  const access=await requireProjectAccess({...ctx,user:ctx.user},projectId,"EDITOR");
  if(access.membership.seatType!=="FULL")throw new TRPCError({code:"FORBIDDEN",message:"A full editor seat is required."});
  return access;
}
async function liveProject(tx:Prisma.TransactionClient,organizationId:string,actorId:string,projectId:string){
  const orgs=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR UPDATE`;
  const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId,userId:actorId}}});
  if(!orgs[0]||orgs[0].suspendedAt||!member||member.seatType!=="FULL"||!["OWNER","ADMIN","EDITOR"].includes(member.role))throw new TRPCError({code:"FORBIDDEN",message:"Workspace access changed. Refresh before connecting."});
  const projects=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  if(projects[0]?.organizationId!==organizationId)throw new TRPCError({code:"NOT_FOUND"});
}
async function own(ctx:Context,id:string){
  const row=await ctx.prisma.driveSourceConnection.findFirst({where:{id,actorId:ctx.user!.id}});
  if(!row)throw new TRPCError({code:"NOT_FOUND"});
  const {project}=await editor(ctx,row.projectId);
  if(project.organizationId!==row.organizationId)throw new TRPCError({code:"NOT_FOUND"});
  return row;
}
async function locked(tx:Prisma.TransactionClient,row:DriveSourceConnection,actorId:string){
  await liveProject(tx,row.organizationId,actorId,row.projectId);
  await tx.$queryRaw`SELECT id FROM "DriveSourceConnection" WHERE id=${row.id} FOR UPDATE`;
  const current=await tx.driveSourceConnection.findUnique({where:{id:row.id}});
  if(!current||current.actorId!==actorId||current.projectId!==row.projectId||current.organizationId!==row.organizationId)throw new TRPCError({code:"NOT_FOUND"});
  return current;
}
const clear={encryptedToken:Prisma.DbNull,encryptedVerifier:Prisma.DbNull,encryptedAuthorization:Prisma.DbNull,tokenExpiresAt:null,readLeaseUntil:null,readLeaseRequestId:null};

export const driveConnectionsRouter=router({
  capabilities:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    const {membership}=await requireProjectAccess(ctx,input.projectId);
    return {credentialStorageReady:storageReady(),oauthAvailable:driveOAuthConfigured(),canConnect:membership.seatType==="FULL"&&["OWNER","ADMIN","EDITOR"].includes(membership.role),contentReadAvailable:false};
  }),
  mine:protectedProcedure.input(projectInput).query(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    return ctx.prisma.$transaction(async tx=>{
      await liveProject(tx,project.organizationId,ctx.user.id,input.projectId);
      const rows=await tx.driveSourceConnection.findMany({where:{projectId:input.projectId,actorId:ctx.user.id,organizationId:project.organizationId},orderBy:{createdAt:"desc"},take:20});
      return rows.map(row=>({id:row.id,status:publicStatus(row),account:driveAccountSchema.safeParse(row.account).data??null,approvedFiles:z.array(driveFileSchema).parse(row.approvedFiles),approvedAt:row.approvedAt}));
    });
  }),
  snapshot:protectedProcedure.input(z.object({id:z.string()})).query(async({ctx,input})=>{
    const row=await own(ctx,input.id);
    return ctx.prisma.$transaction(async tx=>{
      const current=await locked(tx,row,ctx.user.id);const catalog=catalogSchema.safeParse(current.catalog).data;
      return {id:current.id,status:publicStatus(current),account:driveAccountSchema.safeParse(current.account).data??null,files:catalog?.files??[],version:current.version,nextCursor:catalog?.nextCursor??null,bounded:catalog?.bounded??false,folderId:catalog?.folderId??null,search:catalog?.search??"",approvedFiles:z.array(driveFileSchema).parse(current.approvedFiles)};
    });
  }),
  begin:protectedProcedure.input(projectInput.extend({requestId:z.string().uuid(),approveMetadataAccess:z.literal(true)})).mutation(async({ctx,input})=>{
    const {project}=await editor(ctx,input.projectId);
    if(!storageReady()||!driveOAuthConfigured())throw unavailable();
    const requestKey=hashOAuthState(JSON.stringify(["drive",ctx.user.id,input.projectId,input.requestId]));
    return ctx.prisma.$transaction(async tx=>{
      await liveProject(tx,project.organizationId,ctx.user.id,input.projectId);
      const prior=await tx.driveSourceConnection.findUnique({where:{requestKey}});
      if(prior){if(prior.status!=="PENDING"||prior.authorizationExpiresAt.getTime()<=Date.now()||prior.configurationHash!==configHash())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Start a new authorization attempt."});return {id:prior.id,authorizationUrl:decrypt(prior.encryptedAuthorization)};}
      if(await tx.driveSourceConnection.count({where:{actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}})>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS"});
      if(await tx.driveSourceConnection.count({where:{projectId:input.projectId,actorId:ctx.user.id,OR:[{status:{in:["PENDING","VERIFYING"]},authorizationExpiresAt:{gt:new Date()}},{status:"VERIFIED",tokenExpiresAt:{gt:new Date(Date.now()+30000)}}]}}))throw new TRPCError({code:"CONFLICT",message:"Resume or cancel your current Drive connection before starting another."});
      const auth=createDriveAuthorization(process.env.GOOGLE_DRIVE_CLIENT_ID!,driveOAuthRedirect());
      const row=await tx.driveSourceConnection.create({data:{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,requestKey,stateHash:hashOAuthState(auth.state),configurationHash:configHash(),encryptedVerifier:{...encryptToken(auth.verifier)},encryptedAuthorization:{...encryptToken(auth.url)},authorizationExpiresAt:new Date(Date.now()+600000)}});
      return {id:row.id,authorizationUrl:auth.url};
    });
  }),
  complete:protectedProcedure.input(z.object({state:z.string().min(30).max(200).regex(/^[A-Za-z0-9_-]+$/),code:z.string().min(1).max(4000).regex(/^[!-~]+$/).optional(),denied:z.boolean().default(false)})).mutation(async({ctx,input})=>{
    const row=await ctx.prisma.driveSourceConnection.findFirst({where:{stateHash:hashOAuthState(input.state),actorId:ctx.user.id}});
    if(!row)throw new TRPCError({code:"NOT_FOUND"});
    const verifier=await ctx.prisma.$transaction(async tx=>{
      const current=await locked(tx,row,ctx.user.id);
      if(current.status!=="PENDING"||current.authorizationExpiresAt.getTime()<=Date.now())throw new TRPCError({code:"PRECONDITION_FAILED",message:"This authorization expired or was already used."});
      if(input.denied){await tx.driveSourceConnection.update({where:{id:row.id},data:{...clear,status:"CANCELED",version:{increment:1}}});return null;}
      if(!input.code||!storageReady()||!driveOAuthConfigured()||current.configurationHash!==configHash())throw unavailable();
      const value=decrypt(current.encryptedVerifier);
      await tx.driveSourceConnection.update({where:{id:row.id},data:{status:"VERIFYING",encryptedVerifier:Prisma.DbNull,encryptedAuthorization:Prisma.DbNull,version:{increment:1}}});
      return value;
    });
    if(verifier===null)return {id:row.id};
    try{
      const result=await verifyDriveAuthorization({clientId:process.env.GOOGLE_DRIVE_CLIENT_ID!,clientSecret:process.env.GOOGLE_DRIVE_CLIENT_SECRET!,redirectUri:driveOAuthRedirect(),code:input.code!,verifier});
      await ctx.prisma.$transaction(async tx=>{
        const current=await locked(tx,row,ctx.user.id);
        if(current.status!=="VERIFYING"||current.authorizationExpiresAt.getTime()<=Date.now()||current.configurationHash!==configHash())throw new TRPCError({code:"CONFLICT"});
        await tx.driveSourceConnection.update({where:{id:row.id},data:{status:"VERIFIED",encryptedToken:{...encryptToken(result.token)},tokenExpiresAt:result.expiresAt,account:result.account,verifiedAt:new Date(),version:{increment:1}}});
      });
      return {id:row.id};
    }catch{
      await ctx.prisma.driveSourceConnection.updateMany({where:{id:row.id,status:"VERIFYING"},data:{...clear,status:"FAILED",version:{increment:1}}});
      throw new TRPCError({code:"BAD_REQUEST",message:"Drive account verification failed. Start again and check the approved permissions. No files were selected."});
    }
  }),
  list:protectedProcedure.input(z.object({id:z.string(),requestId:z.string().uuid(),version:z.number().int().min(0).optional(),folderId:fileId.nullable().default(null),search:z.string().trim().max(100).default(""),after:z.string().min(1).max(2048).regex(/^[!-~]+$/).nullable().default(null)})).mutation(async({ctx,input})=>{
    const row=await own(ctx,input.id);const hash=hashOAuthState(JSON.stringify([input.version??null,input.folderId,input.search,input.after]));
    const claim=await ctx.prisma.$transaction(async tx=>{
      const current=await locked(tx,row,ctx.user.id);verified(current);
      const receipt=listReceipts.parse(current.listReceipts).find(r=>r.requestId===input.requestId);
      if(receipt){if(receipt.hash!==hash)throw new TRPCError({code:"CONFLICT",message:"This page request changed."});return {receipt:receipt.response,current};}
      if(input.version!==undefined&&input.version!==current.version)throw new TRPCError({code:"CONFLICT",message:"Drive choices changed. Refresh before continuing."});
      if(current.readLeaseUntil&&current.readLeaseUntil.getTime()>Date.now())throw new TRPCError({code:"CONFLICT",message:"A Drive page is still loading. Retry shortly."});
      if(current.readAttempts>=10)throw new TRPCError({code:"PRECONDITION_FAILED",message:"This connection reached its metadata request limit. Review what is loaded or authorize a new connection."});
      const prior=catalogSchema.safeParse(current.catalog).data;
      if(input.after&&(!prior||prior.folderId!==input.folderId||prior.search!==input.search||prior.nextCursor!==input.after||prior.bounded||!current.catalogAt||current.catalogAt.getTime()<Date.now()-600000))throw new TRPCError({code:"BAD_REQUEST",message:"Use the current next page or refresh this folder."});
      if(input.folderId&&input.folderId!==prior?.folderId&&!(prior?.files.some(f=>f.id===input.folderId&&f.mimeType==="application/vnd.google-apps.folder")))throw new TRPCError({code:"BAD_REQUEST",message:"Choose a folder from the verified catalog."});
      // A retry keeps its durable request ID, but every execution owns a new
      // lease nonce. A delayed former execution cannot consume/clear its retry.
      const updated=await tx.driveSourceConnection.update({where:{id:current.id},data:{readAttempts:{increment:1},readLeaseRequestId:randomUUID(),readLeaseUntil:new Date(Date.now()+60000)}});
      return {receipt:null,current:updated};
    });
    if(claim.receipt)return claim.receipt;
    const current=claim.current;
    try{
      const result=await listDriveFiles(decrypt(current.encryptedToken),{folderId:input.folderId,search:input.search,after:input.after});
      return await ctx.prisma.$transaction(async tx=>{
        const saved=await locked(tx,row,ctx.user.id);verified(saved);
        if(saved.version!==current.version||saved.readLeaseRequestId!==current.readLeaseRequestId||!saved.readLeaseUntil||saved.readLeaseUntil.getTime()<=Date.now())throw new TRPCError({code:"CONFLICT",message:"Drive choices changed. Refresh and review again."});
        const prior=catalogSchema.safeParse(saved.catalog).data;const fresh=!!input.after;
        if(fresh&&result.nextCursor&&(prior?.cursors.includes(result.nextCursor)||result.nextCursor===input.after))throw new Error("Pagination loop");
        const rows=fresh?[...(prior?.files??[]),...result.files]:result.files;
        if(new Set(rows.map(f=>f.id)).size!==rows.length)throw new Error("Duplicate file identity");
        const pageCount=fresh?(prior?.pageCount??0)+1:1;
        const bounded=!!result.nextCursor&&pageCount>=5;
        const catalog=catalogSchema.parse({files:rows,folderId:input.folderId,search:input.search,nextCursor:bounded?null:result.nextCursor,cursors:fresh?[...(prior?.cursors??[]),input.after!]:[],pageCount,bounded});
        const response=responseSchema.parse({account:driveAccountSchema.parse(saved.account),files:result.files,version:saved.version+1,nextCursor:catalog.nextCursor,bounded,catalogReset:!fresh});
        await tx.driveSourceConnection.update({where:{id:row.id},data:{catalog,catalogAt:fresh?saved.catalogAt:new Date(),version:{increment:1},readLeaseRequestId:null,readLeaseUntil:null,listReceipts:[...listReceipts.parse(saved.listReceipts),{requestId:input.requestId,hash,response}]}});
        return response;
      });
    }catch{
      await ctx.prisma.driveSourceConnection.updateMany({where:{id:row.id,readLeaseRequestId:current.readLeaseRequestId},data:{readLeaseRequestId:null,readLeaseUntil:null}});
      throw new TRPCError({code:"BAD_REQUEST",message:"Drive metadata could not be loaded. Retry or review the saved scope. Previously approved files are unchanged."});
    }
  }),
  approve:protectedProcedure.input(z.object({id:z.string(),version:z.number().int().min(1),fileIds:z.array(fileId).min(1).max(100),requestId:z.string().uuid(),approved:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await own(ctx,input.id);const ids=[...new Set(input.fileIds)].sort();const hash=hashOAuthState(JSON.stringify([input.version,ids]));
    return ctx.prisma.$transaction(async tx=>{
      const current=await locked(tx,row,ctx.user.id);const receipts=approvalReceipts.parse(current.approvalReceipts);
      const receipt=receipts.find(r=>r.requestId===input.requestId);
      if(receipt){if(receipt.hash!==hash)throw new TRPCError({code:"CONFLICT",message:"This approval request changed."});return {savedFiles:receipt.count};}
      verified(current);
      if(current.version!==input.version||current.readLeaseUntil&&current.readLeaseUntil.getTime()>Date.now())throw new TRPCError({code:"CONFLICT",message:"Drive choices changed. Refresh and review again."});
      if(!current.catalogAt||current.catalogAt.getTime()<Date.now()-600000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Refresh Drive metadata before approving."});
      const catalog=catalogSchema.parse(current.catalog);const selected=ids.map(id=>catalog.files.find(f=>f.id===id));
      if(selected.some(f=>!f||f.mimeType==="application/vnd.google-apps.folder"||f.mimeType==="application/vnd.google-apps.shortcut"))throw new TRPCError({code:"BAD_REQUEST",message:"Choose files from the current verified catalog. Folders and shortcuts are not recursive approvals."});
      const combined=new Map(z.array(driveFileSchema).parse(current.approvedFiles).map(f=>[f.id,f]));
      // Approved identities and prior evidence are never silently replaced.
      for(const f of selected)if(f&&!combined.has(f.id))combined.set(f.id,f);
      if(combined.size>500||receipts.length>=50)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Saved Drive scope reached its safe limit."});
      await tx.driveSourceConnection.update({where:{id:row.id},data:{approvedFiles:[...combined.values()],approvedAt:new Date(),approvalReceipts:[...receipts,{requestId:input.requestId,hash,count:combined.size}],version:{increment:1}}});
      return {savedFiles:combined.size};
    });
  }),
  forget:protectedProcedure.input(z.object({id:z.string(),confirmed:z.literal(true)})).mutation(async({ctx,input})=>{
    const row=await own(ctx,input.id);
    await ctx.prisma.$transaction(async tx=>{await locked(tx,row,ctx.user.id);await tx.driveSourceConnection.update({where:{id:row.id},data:{...clear,status:"DISCONNECTED",version:{increment:1}}});});
    return {removed:true,providerRevocationRequired:true};
  }),
});
