import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient, type AtlassianOAuthConnection } from "@vaettir/db";
import { z } from "@vaettir/core/dist/validation.js";
import type { Context } from "../trpc.js";
import { lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";
import { encryptToken, decryptToken } from "./tokenEncryption.js";
import { atlassianApplication, atlassianApplicationSchema, atlassianFingerprint, atlassianSiteSchema, atlassianResourceSchema, atlassianTokenSchema, createAtlassianAuthorization, exchangeAtlassianCode, refreshAtlassianToken, verifyAtlassianToken, listAtlassianSites, listAtlassianResources, reportAtlassianPrivacy, readAtlassianAccount, ATLASSIAN_PRIVACY_DAY_MS, type AtlassianProduct, type AtlassianToken } from "./atlassianOAuth.js";

const cipher = z.object({ciphertext:z.string(),iv:z.string(),authTag:z.string()});
const encrypted = (value:unknown) => ({...encryptToken(JSON.stringify(value))});
const decrypted = (value:unknown):unknown => JSON.parse(decryptToken(cipher.parse(value)));
const sites = z.array(atlassianSiteSchema).max(100);
const resources = z.array(atlassianResourceSchema).max(500);
const catalog = z.object({resources,cursors:z.array(z.union([z.string(),z.number()])).max(10),at:z.number().int(),siteId:z.string()}).strict();
const receipts = z.array(z.object({requestId:z.string().uuid(),hash:z.string(),count:z.number().int()})).max(50);
const denied = () => new TRPCError({code:"FORBIDDEN",message:"Restore the original account and workspace."});
const stale = () => new TRPCError({code:"PRECONDITION_FAILED",message:"Reconnect Atlassian to continue."});
type Scope = Pick<AtlassianOAuthConnection,"projectId"|"organizationId"|"actorId"|"clerkActorId">;

function human(ctx:Context) {
  if(!ctx.user || !ctx.authenticatedClerkSubject || ctx.authenticatedClerkSubject!==ctx.user.clerkUserId || ctx.authenticatedApiKeyId) throw denied();
  return {actorId:ctx.user.id,clerkActorId:ctx.authenticatedClerkSubject};
}
/** Shared org -> membership -> project -> actor lock order; never across HTTP. */
export async function lockAtlassianScope(tx:Prisma.TransactionClient,ctx:Context,scope:Scope) {
  const actor=human(ctx);
  if(actor.actorId!==scope.actorId || actor.clerkActorId!==scope.clerkActorId || ctx.workspaceOrganizationId && ctx.workspaceOrganizationId!==scope.organizationId) throw denied();
  await lockStoredAtlassianScope(tx,scope);
}
/** Maintenance uses the stored human pins and the same fresh permission locks;
 * it never constructs an authenticated user context or reads project content. */
export async function lockStoredAtlassianScope(tx:Prisma.TransactionClient,scope:Scope) {
  await lockCaseFieldProject(tx,scope.actorId,scope.projectId);
  await lockCurrentCaseFieldActor(tx,scope.actorId,{clerkActorId:scope.clerkActorId});
  const project=await tx.project.findUniqueOrThrow({where:{id:scope.projectId},select:{organizationId:true}});
  if(project.organizationId!==scope.organizationId)throw denied();
}
export async function ownAtlassian(ctx:Context,id:string) {
  const actor=human(ctx);
  const row=await ctx.prisma.atlassianOAuthConnection.findFirst({where:{id,...actor}});
  if(!row)throw new TRPCError({code:"NOT_FOUND"});
  await ctx.prisma.$transaction(tx=>lockAtlassianScope(tx,ctx,row));
  return row;
}
async function locked(tx:Prisma.TransactionClient,ctx:Context,row:Scope&{id:string}) {
  await lockAtlassianScope(tx,ctx,row);
  await tx.$queryRaw`SELECT id FROM "AtlassianOAuthConnection" WHERE id=${row.id} FOR UPDATE`;
  return tx.atlassianOAuthConnection.findUniqueOrThrow({where:{id:row.id}});
}
export function atlassianPrivacyFresh(row:Pick<AtlassianOAuthConnection,"privacyCheckedAt"|"privacyCycleDays">){
  return !!row.privacyCheckedAt&&!!row.privacyCycleDays&&row.privacyCheckedAt.getTime()+row.privacyCycleDays*ATLASSIAN_PRIVACY_DAY_MS>Date.now();
}
export function requireAtlassianVerified(row:Pick<AtlassianOAuthConnection,"status"|"tokenExpiresAt"|"encryptedToken"|"privacyCheckedAt"|"privacyCycleDays">) {
  if(row.status!=="VERIFIED" || !row.tokenExpiresAt || row.tokenExpiresAt.getTime()<=Date.now()+60000 || !row.encryptedToken || !atlassianPrivacyFresh(row))throw stale();
}
export function publicAtlassian(row:AtlassianOAuthConnection) {
  const expired=row.status==="VERIFIED"&&(!row.tokenExpiresAt||row.tokenExpiresAt.getTime()<=Date.now()+60000||!atlassianPrivacyFresh(row))||row.status==="PENDING"&&row.authorizationExpiresAt.getTime()<=Date.now();
  return {id:row.id,projectId:row.projectId,product:row.product,status:expired?"EXPIRED":row.status,accountName:row.accountName,version:row.version,sites:sites.parse(row.sites),selectedSite:row.selectedSite?atlassianSiteSchema.parse(row.selectedSite):null,approvedResources:resources.parse(row.approvedResources),canRefresh:row.status==="VERIFIED"&&!!row.encryptedToken};
}
export function atlassianStorageReady(){try{encryptToken("availability-check");return true;}catch{return false;}}
export async function beginAtlassian(ctx:Context,input:{projectId:string;originalOrganizationId:string;expectedClerkActorId:string;product:AtlassianProduct;requestId:string}) {
  const actor=human(ctx),app=atlassianApplication();
  if(!app||!atlassianStorageReady())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Atlassian connection setup is required."});
  if(input.expectedClerkActorId!==actor.clerkActorId)throw denied();
  const scope={...actor,projectId:input.projectId,organizationId:input.originalOrganizationId};
  const requestKey=atlassianFingerprint([actor.actorId,actor.clerkActorId,input.projectId,input.originalOrganizationId,input.product,input.requestId]);
  return ctx.prisma.$transaction(async tx=>{
    await lockAtlassianScope(tx,ctx,scope);
    const prior=await tx.atlassianOAuthConnection.findUnique({where:{requestKey}});
    if(prior){
      if(prior.status!=="PENDING"||prior.authorizationExpiresAt.getTime()<=Date.now())throw stale();
      const state=z.string().regex(/^[A-Za-z0-9_-]{43}$/).parse(decrypted(prior.encryptedState));
      const savedApp=atlassianApplicationSchema.parse(decrypted(prior.encryptedApplication));
      const url=new URL(createAtlassianAuthorization(savedApp).url);url.searchParams.set("state",state);
      return {id:prior.id,url:url.href};
    }
    if(await tx.atlassianOAuthConnection.count({where:{actorId:actor.actorId,createdAt:{gt:new Date(Date.now()-3600000)}}})>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS"});
    const auth=createAtlassianAuthorization(app);
    const row=await tx.atlassianOAuthConnection.create({data:{...scope,product:input.product,requestKey,stateHash:atlassianFingerprint(auth.state),encryptedState:encrypted(auth.state),encryptedApplication:encrypted(app),authorizationExpiresAt:new Date(Date.now()+300000)}});
    return {id:row.id,url:auth.url};
  });
}
/** Claim once before exchange. An uncertain response is never replayed. */
export async function finishAtlassian(ctx:Context,input:{state:string;code?:string;denied?:true}) {
  const actor=human(ctx);
  const found=await ctx.prisma.atlassianOAuthConnection.findFirst({where:{stateHash:atlassianFingerprint(input.state),...actor}});
  if(!found)throw new TRPCError({code:"NOT_FOUND"});
  const operationId=randomUUID();
  const row=await ctx.prisma.$transaction(async tx=>{
    const current=await locked(tx,ctx,found);
    if(current.status!=="PENDING"||current.authorizationExpiresAt.getTime()<=Date.now())throw stale();
    return tx.atlassianOAuthConnection.update({where:{id:current.id},data:{status:input.denied?"CANCELLED":"EXCHANGING",operationId,encryptedState:Prisma.DbNull,version:{increment:1}}});
  });
  if(input.denied)return {connected:false};
  const app=atlassianApplicationSchema.parse(decrypted(row.encryptedApplication));
  return issueAndVerify(ctx,row,operationId,()=>exchangeAtlassianCode(app,input.code!));
}
/** Preserve issued/rotated tokens encrypted before any identity/network checks.
 * Loss of permission, disconnect, or an unknown HTTP result never grants access. */
async function issueAndVerify(ctx:Context,row:AtlassianOAuthConnection,operationId:string,issue:()=>Promise<unknown>) {
  try{
    const response=await issue();
    const saved=await ctx.prisma.atlassianOAuthConnection.updateMany({where:{id:row.id,operationId,status:{in:["EXCHANGING","REFRESHING","DISCONNECTING"]}},data:{encryptedToken:encrypted({issued:response}),tokenExpiresAt:null}});
    if(saved.count!==1)throw stale();
    const issued=z.object({access_token:z.string().min(1).max(10000).regex(/^[!-~]+$/),refresh_token:z.string().min(1).max(10000).regex(/^[!-~]+$/),token_type:z.string().max(20),expires_in:z.number().int().positive().max(86400)}).parse(response);
    let token=await verifyAtlassianToken(issued,row.accountId??undefined);
    const privacy=await checkStoredAtlassianPrivacy(ctx.prisma,row,operationId,token,new Date());
    token=privacy.token;const observedAt=privacy.observedAt;
    const available=await listAtlassianSites(token.accessToken);
    const productSites=available.filter(site=>site.products.includes(row.product as AtlassianProduct));
    if(!productSites.length)throw stale();
    if(row.selectedSite){const selected=atlassianSiteSchema.parse(row.selectedSite);if(!available.some(site=>site.id===selected.id&&site.url===selected.url&&site.products.includes(row.product as AtlassianProduct)))throw stale();}
    await ctx.prisma.$transaction(async tx=>{
      const current=await locked(tx,ctx,row);
      if(current.operationId!==operationId||!["EXCHANGING","REFRESHING"].includes(current.status))throw stale();
      await tx.atlassianOAuthConnection.update({where:{id:row.id},data:{status:"VERIFIED",operationId:null,encryptedToken:encrypted(token),tokenExpiresAt:new Date(token.expiresAt),accountId:token.accountId,accountName:token.accountName,sites:available,selectedSite:current.selectedSite??(productSites.length===1?productSites[0]:Prisma.DbNull),verifiedAt:observedAt,privacyCheckedAt:privacy.checkedAt,privacyCycleDays:privacy.cycleDays,privacyDueAt:privacy.dueAt,catalog:Prisma.DbNull,version:{increment:1}}});
      await tx.ticketSourceConnection.updateMany({where:{oauthConnectionId:row.id,status:"VERIFIED"},data:{tokenExpiresAt:new Date(token.expiresAt),catalog:Prisma.DbNull,catalogAt:null}});
    });
    return {connected:true};
  }catch{
    await ctx.prisma.atlassianOAuthConnection.updateMany({where:{id:row.id,operationId,status:{in:["EXCHANGING","REFRESHING","DISCONNECTING"]}},data:{status:"RECOVERY_REQUIRED",tokenExpiresAt:null,version:{increment:1}}});
    throw new TRPCError({code:"PRECONDITION_FAILED",message:"Authorization could not be confirmed. Reconnect; this attempt will not be replayed."});
  }
}
export async function renewAtlassian(ctx:Context,id:string) {
  const row=await ownAtlassian(ctx,id),operationId=randomUUID();
  const claimed=await ctx.prisma.$transaction(async tx=>{
    const current=await locked(tx,ctx,row);
    if(current.status!=="VERIFIED"||current.version!==row.version)throw stale();
    const token=atlassianTokenSchema.parse(decrypted(current.encryptedToken));
    const app=atlassianApplicationSchema.parse(decrypted(current.encryptedApplication));
    await tx.atlassianOAuthConnection.update({where:{id},data:{status:"REFRESHING",operationId,version:{increment:1}}});
    return {token,app};
  });
  return issueAndVerify(ctx,row,operationId,()=>refreshAtlassianToken(claimed.app,claimed.token));
}
export async function selectAtlassianSite(ctx:Context,input:{id:string;siteId:string;version:number}) {
  const row=await ownAtlassian(ctx,input.id);requireAtlassianVerified(row);
  const token=atlassianTokenSchema.parse(decrypted(row.encryptedToken));
  const available=await listAtlassianSites(token.accessToken);
  const site=available.find(x=>x.id===input.siteId&&x.products.includes(row.product as AtlassianProduct));
  if(!site)throw stale();
  return ctx.prisma.$transaction(async tx=>{
    const current=await locked(tx,ctx,row);requireAtlassianVerified(current);
    if(current.version!==input.version||current.selectedSite&&atlassianSiteSchema.parse(current.selectedSite).id!==site.id)throw stale();
    return publicAtlassian(await tx.atlassianOAuthConnection.update({where:{id:row.id},data:{selectedSite:site,sites:available,catalog:Prisma.DbNull,version:{increment:1}}}));
  });
}
export async function atlassianCatalog(ctx:Context,input:{id:string;after:number|string|null}) {
  const row=await ownAtlassian(ctx,input.id);requireAtlassianVerified(row);
  const selected=atlassianSiteSchema.parse(row.selectedSite),prior=catalog.safeParse(row.catalog).data;
  const fresh=prior&&prior.siteId===selected.id&&prior.at>Date.now()-600000;
  if(input.after!==null&&(!fresh||!prior.cursors.includes(input.after)))throw stale();
  const token=atlassianTokenSchema.parse(decrypted(row.encryptedToken));
  const page=await listAtlassianResources(token.accessToken,selected,row.product as AtlassianProduct,input.after??0);
  const all=new Map((input.after!==null&&fresh?prior.resources:[]).map(x=>[x.id,x]));
  for(const resource of page.resources)all.set(resource.id,resource);
  if(all.size>500)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Choose a smaller source scope."});
  const cursors=input.after!==null&&fresh?[...prior.cursors]:[];
  if(page.next!==null){if(cursors.includes(page.next))throw stale();cursors.push(page.next);}
  const next=cursors.length>=10||all.size>=500?null:page.next;
  const saved=await ctx.prisma.$transaction(async tx=>{
    const current=await locked(tx,ctx,row);requireAtlassianVerified(current);if(current.version!==row.version)throw stale();
    return tx.atlassianOAuthConnection.update({where:{id:row.id},data:{catalog:{resources:[...all.values()],cursors:next===null?cursors.filter(c=>c!==page.next):cursors,at:input.after!==null&&fresh?prior.at:Date.now(),siteId:selected.id},version:{increment:1}}});
  });
  return {resources:page.resources,next,version:saved.version,reset:input.after===null};
}
export async function approveAtlassian(ctx:Context,input:{id:string;version:number;resourceIds:string[];requestId:string}) {
  const row=await ownAtlassian(ctx,input.id),ids=[...new Set(input.resourceIds)].sort(),hash=atlassianFingerprint([input.version,ids]);
  return ctx.prisma.$transaction(async tx=>{
    const current=await locked(tx,ctx,row);requireAtlassianVerified(current);
    const savedReceipts=receipts.parse(current.approvalReceipts),receipt=savedReceipts.find(r=>r.requestId===input.requestId);
    if(receipt){if(receipt.hash!==hash)throw stale();return {saved:receipt.count};}
    if(current.version!==input.version||savedReceipts.length>=50)throw stale();
    const reviewed=catalog.parse(current.catalog),site=atlassianSiteSchema.parse(current.selectedSite);
    if(reviewed.at<Date.now()-600000||reviewed.siteId!==site.id)throw stale();
    const selected=ids.map(id=>reviewed.resources.find(r=>r.id===id));if(selected.some(x=>!x))throw stale();
    const all=new Map(resources.parse(current.approvedResources).map(r=>[r.id,r]));for(const r of selected)if(r)all.set(r.id,r);
    if(all.size>500)throw stale();
    const approved=[...all.values()];
    await tx.atlassianOAuthConnection.update({where:{id:row.id},data:{approvedResources:approved,approvalReceipts:[...savedReceipts,{requestId:input.requestId,hash,count:approved.length}],version:{increment:1}}});
    if(current.product==="jira"){
      const ticketCatalog={workspace:{id:site.url,name:site.url},account:{id:current.accountId!,name:current.accountName!},projects:reviewed.resources,cursors:[]};
      const data={status:"VERIFIED",encryptedToken:encrypted({kind:"atlassian-oauth/v1",id:row.id}),tokenExpiresAt:current.tokenExpiresAt,verifiedAt:current.verifiedAt,catalog:ticketCatalog,catalogAt:new Date(reviewed.at),approvedProjects:approved,approvedAt:new Date()};
      await tx.ticketSourceConnection.upsert({where:{oauthConnectionId:row.id},create:{...data,version:1,oauthConnectionId:row.id,projectId:row.projectId,organizationId:row.organizationId,actorId:row.actorId,provider:"jira",providerOrigin:site.url,requestKey:`atlassian:${row.id}`,requestHash:row.stateHash,authorizationExpiresAt:row.authorizationExpiresAt},update:{...data,version:{increment:1}}});
    }
    return {saved:approved.length};
  });
}
export async function disconnectAtlassian(ctx:Context,id:string) {
  const row=await ownAtlassian(ctx,id);
  await ctx.prisma.$transaction(async tx=>{
    const current=await locked(tx,ctx,row),inFlight=["EXCHANGING","REFRESHING","DISCONNECTING","PRIVACY_CHECKING"].includes(current.status);
    await tx.atlassianOAuthConnection.update({where:{id},data:{status:inFlight?"DISCONNECTING":"DISCONNECTED",encryptedState:Prisma.DbNull,tokenExpiresAt:null,...(!inFlight?{encryptedToken:Prisma.DbNull,operationId:null}:{}),version:{increment:1}}});
    await tx.ticketSourceConnection.updateMany({where:{oauthConnectionId:id},data:{status:"DISCONNECTED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null,version:{increment:1}}});
  });
  return {disconnected:true,providerRevocationRequired:true,manageAccessUrl:"https://id.atlassian.com/manage-profile/apps"};
}

/** No provider user profile or credential survives an erasure decision.
 * Imported project content and resource/audit references are separate records. */
export async function eraseAtlassianPersonalData(tx:Prisma.TransactionClient,id:string){
  await tx.atlassianOAuthConnection.update({where:{id},data:{status:"DISCONNECTED",operationId:null,encryptedApplication:{},encryptedState:Prisma.DbNull,encryptedToken:Prisma.DbNull,tokenExpiresAt:null,accountId:null,accountName:null,catalog:Prisma.DbNull,privacyDueAt:null,privacyAccountKey:null,privacyClaimId:null,version:{increment:1}}});
  await tx.ticketSourceConnection.updateMany({where:{oauthConnectionId:id},data:{status:"DISCONNECTED",encryptedToken:Prisma.DbNull,tokenExpiresAt:null,catalog:Prisma.DbNull,catalogAt:null,version:{increment:1}}});
}

export class AtlassianPrivacyBusyError extends Error{constructor(){super("Atlassian account-data check is already in progress.");}}
/** All copies for the same provider app/account share one cycle and one claim.
 * The hash separates different apps without persisting another raw account ID.
 * Account erasure covers every project copy; project content is never read. */
export async function checkStoredAtlassianPrivacy(db:PrismaClient,row:AtlassianOAuthConnection,operationId:string,initialToken:AtlassianToken,initialObservedAt:Date){
  const app=atlassianApplicationSchema.parse(decrypted(row.encryptedApplication));
  const key=atlassianFingerprint(["atlassian-privacy/v1",app.clientId,initialToken.accountId]);
  const claim=await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
    await tx.$queryRaw`SELECT id FROM "AtlassianOAuthConnection" WHERE id=${row.id} FOR UPDATE`;
    const current=await tx.atlassianOAuthConnection.findUniqueOrThrow({where:{id:row.id}});
    if(current.operationId!==operationId||!["EXCHANGING","REFRESHING","PRIVACY_CHECKING"].includes(current.status))return {kind:"denied" as const};
    const cached=await tx.atlassianOAuthConnection.findFirst({where:{privacyAccountKey:key,privacyCheckedAt:{not:null},privacyCycleDays:{not:null}},orderBy:{privacyCheckedAt:"desc"}});
    const fresh=!!cached&&atlassianPrivacyFresh(cached);
    const active=fresh?null:await tx.atlassianOAuthConnection.findFirst({where:{privacyAccountKey:key,privacyClaimId:{not:null},id:{not:row.id}}});
    // One update retains the issued token and optional lease atomically. A
    // second update of this row makes PostgreSQL recheck its parent FKs while
    // holding the connection lock, inverting a duplicate callback's lock order.
    await tx.atlassianOAuthConnection.update({where:{id:row.id},data:{accountId:initialToken.accountId,accountName:initialToken.accountName,privacyAccountKey:key,encryptedToken:encrypted(initialToken),tokenExpiresAt:new Date(initialToken.expiresAt),verifiedAt:initialObservedAt,...(!fresh&&!active?{privacyClaimId:operationId,privacyDueAt:new Date(Date.now()+600000)}:{})}});
    if(cached&&fresh)return {kind:"cached" as const,checkedAt:cached.privacyCheckedAt!,cycleDays:cached.privacyCycleDays!,dueAt:new Date(cached.privacyCheckedAt!.getTime()+cached.privacyCycleDays!*ATLASSIAN_PRIVACY_DAY_MS)};
    if(active)return {kind:"busy" as const};
    const oldest=await tx.atlassianOAuthConnection.aggregate({where:{privacyAccountKey:key},_min:{verifiedAt:true}});
    return {kind:"report" as const,oldestAt:oldest._min.verifiedAt??initialObservedAt};
  });
  if(claim.kind==="denied")throw stale();
  if(claim.kind==="busy")throw new AtlassianPrivacyBusyError();
  if(claim.kind==="cached")return {...claim,token:initialToken,observedAt:initialObservedAt};
  let token=initialToken,observedAt=initialObservedAt;
  const result=await reportAtlassianPrivacy(token.accessToken,token.accountId,claim.oldestAt);
  if(result.decision==="updated"){
    const account=await readAtlassianAccount(token.accessToken,token.accountId);
    if(account.account_id!==token.accountId)throw stale();
    token={...token,accountName:account.name};observedAt=new Date();
  }
  const checkedAt=new Date(),dueAt=new Date(checkedAt.getTime()+result.cycleDays*ATLASSIAN_PRIVACY_DAY_MS);
  await db.$transaction(async tx=>{
    await tx.$queryRaw`SELECT 1 FROM pg_advisory_xact_lock(hashtextextended(${key},0))`;
    const copies=await tx.atlassianOAuthConnection.findMany({where:{privacyAccountKey:key},orderBy:{id:"asc"},select:{id:true}});
    if(result.decision!=="clear")for(const copy of copies)if(result.decision==="closed"||copy.id!==row.id)await eraseAtlassianPersonalData(tx,copy.id);
    await tx.atlassianOAuthConnection.updateMany({where:{privacyAccountKey:key},data:{privacyCheckedAt:checkedAt,privacyCycleDays:result.cycleDays,privacyDueAt:dueAt,privacyClaimId:null}});
  });
  if(result.decision==="closed")throw stale();
  return {token,observedAt,checkedAt,dueAt,cycleDays:result.cycleDays};
}
/** Resolve only the actor's linked Jira grant; this is not an org-wide service credential. */
export async function jiraOAuthCredentials(ctx:Context,connection:{oauthConnectionId:string|null;providerOrigin:string|null;projectId:string;organizationId:string;actorId:string;approvedProjects:unknown}) {
  if(!connection.oauthConnectionId)throw stale();
  const row=await ownAtlassian(ctx,connection.oauthConnectionId);requireAtlassianVerified(row);
  const site=atlassianSiteSchema.parse(row.selectedSite),token=atlassianTokenSchema.parse(decrypted(row.encryptedToken));
  if(row.product!=="jira"||row.projectId!==connection.projectId||row.organizationId!==connection.organizationId||row.actorId!==connection.actorId||site.url!==connection.providerOrigin)throw denied();
  const allowed=resources.parse(row.approvedResources),projected=resources.parse(connection.approvedProjects);
  if(!projected.length||projected.some(project=>!allowed.some(resource=>resource.id===project.id&&resource.key===project.key&&resource.url===project.url)))throw denied();
  return {kind:"oauth" as const,siteUrl:site.url,cloudId:site.id,accessToken:token.accessToken,accountId:token.accountId,accountName:token.accountName};
}
