import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess, type Context } from "../trpc.js";
import { lockedProcessingEditor } from "../services/repositoryProcessingApproval.js";
import { admitConnectedGitlab, assertGitlabProjectIdentity, connectedSourceBindingSchema } from "../services/connectedRepositoryAccess.js";
import { repositoryProviderJson } from "../services/repositoryProviderHttp.js";
import { scanConnectedGitlab } from "../services/connectedGitlabScan.js";
import { repositoryFileCoverageScope,repositoryFileCoverageConsent,repositoryFileCoverageHash,repositoryFileCoverageResult,compareRepositoryFiles } from "../services/repositoryFileCoverage.js";

const request=z.object({projectId:z.string(),scope:repositoryFileCoverageScope});
const receipt=z.object({protocol:z.literal("repository-file-coverage/v1"),scope:repositoryFileCoverageScope,scopeHash:z.string(),binding:connectedSourceBindingSchema,expiresAt:z.string().datetime()});
async function access(ctx:Context,projectId:string,repositoryId:string) {
  if(!ctx.user||!ctx.authenticatedClerkSubject||ctx.authenticatedClerkSubject!==ctx.user.clerkUserId)throw new TRPCError({code:"FORBIDDEN"});
  const {project}=await requireProjectAccess({...ctx,user:ctx.user},projectId,"EDITOR");
  return ctx.prisma.$transaction(async tx=>{
    await lockedProcessingEditor(tx,project.organizationId,ctx.user!.id,projectId);
    return admitConnectedGitlab(tx,{projectId,organizationId:project.organizationId,actorId:ctx.user!.id,clerkSubject:ctx.authenticatedClerkSubject!,repositoryId});
  });
}

/** Immutable audit start/completion receipts make retries read retained results,
 * never silently reread source. No AI call, credits or case/requirement edits. */
export const repositoryCoverageChecksRouter=router({
  preview:protectedProcedure.input(request).query(async({ctx,input})=>{
    const current=await access(ctx,input.projectId,input.scope.repositoryId);
    return {scopeHash:repositoryFileCoverageHash(input.projectId,ctx.user.id,input.scope,current.binding),repositoryUrl:current.binding.repositoryUrl,aiProcessing:false as const,credits:0 as const};
  }),
  compare:protectedProcedure.input(request.extend({consent:repositoryFileCoverageConsent})).output(repositoryFileCoverageResult).mutation(async({ctx,input})=>{
    const original=await access(ctx,input.projectId,input.scope.repositoryId);
    const scopeHash=repositoryFileCoverageHash(input.projectId,ctx.user.id,input.scope,original.binding);
    if(scopeHash!==input.consent.expectedScopeHash)throw new TRPCError({code:"CONFLICT",message:"Repository scope or access changed. Review the current scope again."});
    const id="repo-coverage-"+createHash("sha256").update(JSON.stringify([input.projectId,ctx.user.id,input.consent.requestId])).digest("hex");
    const expiresAt=new Date(Date.now()+120000).toISOString();
    const started=await ctx.prisma.$transaction(async tx=>{
      await lockedProcessingEditor(tx,original.binding.organizationId,ctx.user.id,input.projectId);
      await admitConnectedGitlab(tx,original.binding,original.binding);
      const prior=await tx.auditLog.findUnique({where:{id}});
      if(prior){
        const saved=receipt.parse(prior.metadata);
        if(prior.actorId!==ctx.user.id||prior.projectId!==input.projectId||prior.organizationId!==original.binding.organizationId||saved.scopeHash!==scopeHash)throw new TRPCError({code:"CONFLICT"});
        const completed=await tx.auditLog.findUnique({where:{id:id+"-completed"}});
        if(completed&&completed.projectId===input.projectId&&completed.actorId===ctx.user.id&&completed.organizationId===original.binding.organizationId)return {retained:repositoryFileCoverageResult.parse(completed.metadata)};
        throw new TRPCError({code:"PRECONDITION_FAILED",message:"This source read already started. Its failed or pending evidence is retained; no automatic reread occurs. Review a new scope explicitly to start another check."});
      }
      const count=await tx.auditLog.count({where:{organizationId:original.binding.organizationId,actorId:ctx.user.id,entityType:"RepositoryCoverageCheck",action:"CREATE",createdAt:{gt:new Date(Date.now()-3600000)}}});
      if(count>=20)throw new TRPCError({code:"TOO_MANY_REQUESTS"});
      await tx.auditLog.create({data:{id,organizationId:original.binding.organizationId,projectId:input.projectId,actorId:ctx.user.id,entityType:"RepositoryCoverageCheck",entityId:input.scope.repositoryId,action:"CREATE",summary:"Approved bounded repository file comparison. No AI processing or case edits.",metadata:{protocol:"repository-file-coverage/v1",scope:input.scope,scopeHash,binding:original.binding,expiresAt}}});
      return {retained:null};
    });
    if(started.retained)return started.retained;
    async function check(){
      if(Date.now()>=Date.parse(expiresAt))throw new TRPCError({code:"PRECONDITION_FAILED",message:"The bounded source-read approval expired."});
      const current=await access(ctx,input.projectId,input.scope.repositoryId);
      if(JSON.stringify(current.binding)!==JSON.stringify(original.binding))throw new TRPCError({code:"CONFLICT"});
      return current;
    }
    const read=async(path:string)=>{
      const current=await check();const response=await repositoryProviderJson(current.binding.origin,path,{token:current.token()});await check();return response;
    };
    try {
      assertGitlabProjectIdentity(original.binding,await read(`/api/v4/projects/${original.binding.externalId}`));
      const scanned=await scanConnectedGitlab(read,original.binding.externalId,input.scope.ref,"TEST_CASES",input.scope.pathPrefixes,input.scope.maxItems);
      const result=await ctx.prisma.$transaction(async tx=>{
        await lockedProcessingEditor(tx,original.binding.organizationId,ctx.user.id,input.projectId);
        await admitConnectedGitlab(tx,original.binding,original.binding);
        const sources=await tx.testCaseSource.findMany({where:{repoUrl:original.binding.repositoryUrl,filePath:{in:scanned.observedFiles.map(file=>file.path)},testCase:{projectId:input.projectId,archived:false,reviewStatus:"APPROVED"}},select:{filePath:true,contentHash:true,testCase:{select:{id:true,title:true}}},take:5001});
        if(sources.length>5000)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Case mappings exceed the bounded comparison."});
        const value=repositoryFileCoverageResult.parse({commitSha:scanned.headSha,observedAt:new Date().toISOString(),eligibleFileCount:scanned.eligibleFileCount,inspectedFileCount:scanned.inspectedFileCount,truncated:scanned.truncated,files:compareRepositoryFiles(scanned.observedFiles,sources)});
        await tx.auditLog.create({data:{id:id+"-completed",organizationId:original.binding.organizationId,projectId:input.projectId,actorId:ctx.user.id,entityType:"RepositoryCoverageCheck",entityId:input.scope.repositoryId,action:"UPDATE",summary:"Completed pinned file comparison. Source links are not functional coverage or passing execution.",metadata:value}});
        return value;
      });
      await check();return result;
    }catch(error){
      // Append failure evidence; never modify the original approval or erase a
      // completion that committed before a later access/transport refusal.
      await ctx.prisma.auditLog.create({data:{id:id+"-failed",organizationId:original.binding.organizationId,projectId:input.projectId,actorId:ctx.user.id,entityType:"RepositoryCoverageCheck",entityId:input.scope.repositoryId,action:"UPDATE",summary:"Repository file comparison was not accepted. No automatic source-read retry or AI charge.",metadata:{scopeHash,diagnostic:"SOURCE_CHECK_NOT_ACCEPTED"}}});
      if(error instanceof TRPCError)throw error;
      throw new TRPCError({code:"PRECONDITION_FAILED",message:"The source comparison could not be verified. Failed evidence is retained; no complete coverage result is inferred."});
    }
  }),
});
