import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient, type RepositoryProcessingApproval } from "@vaettir/db";
import { requireProjectAccess, type Context } from "../trpc.js";
import { assertScannableRepoUrl,canonicalProcessingRepositoryUrl } from "./repositoryTransport.js";
import { AI_OPERATION_COSTS, getAiCreditBalance } from "./aiCredits.js";
import {safeSourcePath} from "./repositorySourceSafety.js";
import { admitConnectedGitlab, connectedSourceBinding } from "./connectedRepositoryAccess.js";
export {safeSourcePath,sourcePathInScope} from "./repositorySourceSafety.js";
export const repositoryProcessingScope=z.object({
  repositoryId:z.string().min(1).max(100).optional(),
  repoUrl:z.string().trim().min(1).max(2000).transform(value=>{try{assertScannableRepoUrl(value);return canonicalProcessingRepositoryUrl(value);}catch{return value;}}),ref:z.string().trim().min(1).max(200).refine(value=>!value.startsWith("-")&&!/\s/.test(value)&&!Array.from(value).some(char=>char.charCodeAt(0)<32||char.charCodeAt(0)===127)),
  pathPrefixes:z.array(z.string().trim().min(1).max(500).refine(safeSourcePath)).min(1).max(20).refine(values=>new Set(values).size===values.length),
  maxItems:z.number().int().min(1).max(25),
});
export const repositoryProcessingConsent=z.object({requestId:z.string().uuid(),expectedScopeHash:z.string().length(64),approveSourceRead:z.literal(true),approveAiProcessing:z.literal(true),approveVariableCredits:z.literal(true)});
export type ProcessingPurpose="TEST_CASES"|"REQUIREMENTS";
type ActorContext=Pick<Context,"prisma"|"authenticatedClerkSubject">&{user:NonNullable<Context["user"]>};
const price=(purpose:ProcessingPurpose)=>purpose==="TEST_CASES"?AI_OPERATION_COSTS.reverseEngineerTestFile:AI_OPERATION_COSTS.extractRequirementsFromMarkdown;
export function processingScopeHash(projectId:string,purpose:ProcessingPurpose,scope:z.infer<typeof repositoryProcessingScope>,binding?:unknown){
  return createHash("sha256").update(JSON.stringify([projectId,purpose,canonicalProcessingRepositoryUrl(scope.repoUrl),scope.ref,[...scope.pathPrefixes].sort(),scope.maxItems,price(purpose),...(scope.repositoryId?[scope.repositoryId,binding]:[])])).digest("hex");
}
export async function lockedProcessingEditor(tx:Prisma.TransactionClient,organizationId:string,actorId:string,projectId:string){
  const orgs=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR UPDATE`;
  const members=await tx.$queryRaw<Array<{role:string;seatType:string}>>`SELECT "role","seatType" FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR UPDATE`;
  const projects=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  if(!orgs[0]||orgs[0].suspendedAt||!members[0]||members[0].seatType!=="FULL"||!["OWNER","ADMIN","EDITOR"].includes(members[0].role)||projects[0]?.organizationId!==organizationId)throw new TRPCError({code:"FORBIDDEN",message:"Current full editor access is required to process source and use credits."});
}
export async function lockedProcessingReader(tx:Prisma.TransactionClient,organizationId:string,actorId:string,projectId:string){
  const orgs=await tx.$queryRaw<Array<{suspendedAt:Date|null}>>`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR SHARE`;
  const members=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR SHARE`;
  const projects=await tx.$queryRaw<Array<{organizationId:string}>>`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR SHARE`;
  if(!orgs[0]||orgs[0].suspendedAt||!members[0]||projects[0]?.organizationId!==organizationId)throw new TRPCError({code:"FORBIDDEN"});
}
function validateScope(purpose:ProcessingPurpose,scope:z.infer<typeof repositoryProcessingScope>){
  if(!scope.repositoryId)try{assertScannableRepoUrl(scope.repoUrl);}catch{throw new TRPCError({code:"BAD_REQUEST",message:"Only credential-free hosted HTTPS repositories can be scanned without a verified project connection."});}
  if(purpose==="REQUIREMENTS"&&scope.maxItems>10)throw new TRPCError({code:"BAD_REQUEST",message:"Choose at most ten documents."});
}
export async function repositoryProcessingPreview(ctx:ActorContext,projectId:string,purpose:ProcessingPurpose,scope:z.infer<typeof repositoryProcessingScope>){
  scope=repositoryProcessingScope.parse(scope);
  const {project}=await requireProjectAccess(ctx,projectId);validateScope(purpose,scope);
  return ctx.prisma.$transaction(async tx=>{
    await lockedProcessingReader(tx,project.organizationId,ctx.user.id,projectId);
    const sourceBinding=scope.repositoryId?(await admitConnectedGitlab(tx,{projectId,organizationId:project.organizationId,actorId:ctx.user.id,clerkSubject:ctx.authenticatedClerkSubject??"",repositoryId:scope.repositoryId})).binding:undefined;
    if(sourceBinding&&sourceBinding.repositoryUrl!==scope.repoUrl)throw new TRPCError({code:"CONFLICT",message:"Choose the current registered repository URL."});
    const membership=await tx.membership.findUniqueOrThrow({where:{organizationId_userId:{organizationId:project.organizationId,userId:ctx.user.id}}});
    const balance=await getAiCreditBalance(tx as unknown as PrismaClient,project.organizationId);
    return{scopeHash:processingScopeHash(projectId,purpose,scope,sourceBinding),unitCreditEstimate:price(purpose),estimatedCredits:price(purpose)*scope.maxItems,balance,
      canSpend:membership.seatType==="FULL"&&["OWNER","ADMIN","EDITOR"].includes(membership.role),variableCost:true as const};
  });
}
export async function beginRepositoryProcessing(ctx:ActorContext,projectId:string,purpose:ProcessingPurpose,scope:z.infer<typeof repositoryProcessingScope>,consent:z.infer<typeof repositoryProcessingConsent>){
  // Parse again so internal callers cannot accidentally treat metadata consent
  // or an old boolean field as client-source/AI/cost approval.
  repositoryProcessingConsent.parse(consent);scope=repositoryProcessingScope.parse(scope);validateScope(purpose,scope);
  const {project}=await requireProjectAccess(ctx,projectId,"EDITOR");
  return ctx.prisma.$transaction(async tx=>{
    await lockedProcessingEditor(tx,project.organizationId,ctx.user.id,projectId);
    const sourceBinding=scope.repositoryId?(await admitConnectedGitlab(tx,{projectId,organizationId:project.organizationId,actorId:ctx.user.id,clerkSubject:ctx.authenticatedClerkSubject??"",repositoryId:scope.repositoryId})).binding:undefined;
    if(sourceBinding&&sourceBinding.repositoryUrl!==scope.repoUrl)throw new TRPCError({code:"CONFLICT",message:"Choose the current registered repository URL."});
    const scopeHash=processingScopeHash(projectId,purpose,scope,sourceBinding);
    if(consent.expectedScopeHash!==scopeHash)throw new TRPCError({code:"CONFLICT",message:"Repository scope or credit estimate changed. Review and approve again."});
    const existing=await tx.repositoryProcessingApproval.findUnique({where:{projectId_actorId_requestId:{projectId,actorId:ctx.user.id,requestId:consent.requestId}}});
    if(existing){if(existing.organizationId!==project.organizationId)throw new TRPCError({code:"FORBIDDEN",message:"This saved run belongs to a different workspace."});if(existing.scopeHash!==scopeHash||existing.purpose!==purpose)throw new TRPCError({code:"CONFLICT",message:"This request was already used for another approved scope."});return{approval:existing,replayed:true};}
    const recent=await tx.repositoryProcessingApproval.count({where:{organizationId:project.organizationId,actorId:ctx.user.id,createdAt:{gt:new Date(Date.now()-3600000)}}});
    if(recent>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS",message:"Too many source-processing attempts. Try later."});
    const balance=await getAiCreditBalance(tx as unknown as PrismaClient,project.organizationId);
    if(balance<price(purpose)*scope.maxItems)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Credit balance is below the reviewed estimate. Reduce the file limit or ask your administrator."});
    const now=new Date();
    const approval=await tx.repositoryProcessingApproval.create({data:{projectId,organizationId:project.organizationId,actorId:ctx.user.id,requestId:consent.requestId,purpose,repositoryUrl:scope.repoUrl,ref:scope.ref,pathPrefixes:scope.pathPrefixes,scopeHash,unitCreditEstimate:price(purpose),maxItems:scope.maxItems,sourceApprovedAt:now,aiApprovedAt:now,costApprovedAt:now,expiresAt:new Date(now.getTime()+3600000),...(sourceBinding?{results:{sourceBinding}}:{})}});
    return{approval,replayed:false};
  });
}
export async function assertRepositoryProcessingApproval(tx:Prisma.TransactionClient,approvalId:string,projectId:string,purpose:ProcessingPurpose):Promise<RepositoryProcessingApproval>{
  const row=await tx.repositoryProcessingApproval.findUnique({where:{id:approvalId}});
  if(!row||row.projectId!==projectId||row.purpose!==purpose)throw new TRPCError({code:"FORBIDDEN",message:"Explicit source-processing approval is required."});
  await lockedProcessingEditor(tx,row.organizationId,row.actorId,projectId);
  const locked=await tx.$queryRaw`SELECT id FROM "RepositoryProcessingApproval" WHERE id=${row.id} FOR UPDATE`;
  if(!Array.isArray(locked)||!locked.length)throw new TRPCError({code:"FORBIDDEN"});
  const current=await tx.repositoryProcessingApproval.findUniqueOrThrow({where:{id:row.id}});
  if(!["READING","QUEUED"].includes(current.status)||current.expiresAt.getTime()<=Date.now())throw new TRPCError({code:"PRECONDITION_FAILED",message:"Source-processing approval expired, was canceled or requires review."});
  const binding=connectedSourceBinding(current.results);
  if(binding){
    if(binding.projectId!==current.projectId||binding.organizationId!==current.organizationId||binding.actorId!==current.actorId||binding.repositoryUrl!==current.repositoryUrl)throw new TRPCError({code:"FORBIDDEN"});
    await admitConnectedGitlab(tx,binding,binding);
  }
  return current;
}
