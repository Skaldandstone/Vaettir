import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess, type Context } from "../trpc.js";
import { lockedProcessingEditor } from "../services/repositoryProcessingApproval.js";
import { admitConnectedGitlab, assertGitlabProjectIdentity } from "../services/connectedRepositoryAccess.js";
import { repositoryProviderJson } from "../services/repositoryProviderHttp.js";
import { gitlabRepositoryReleases } from "../services/gitlabRepositoryReleases.js";

type ActorContext=Context&{user:NonNullable<Context["user"]>};
async function readReleasePage(ctx:ActorContext,input:{projectId:string;repositoryId:string;page:number}) {
    const {project,membership}=await requireProjectAccess(ctx,input.projectId,"EDITOR");
    if(membership.seatType!=="FULL"||!ctx.authenticatedClerkSubject||ctx.authenticatedClerkSubject!==ctx.user.clerkUserId)
      throw new TRPCError({code:"FORBIDDEN",message:"Current full editor access is required to read provider releases."});
    const access=()=>ctx.prisma.$transaction(async tx=>{
      await lockedProcessingEditor(tx,project.organizationId,ctx.user.id,input.projectId);
      return admitConnectedGitlab(tx,{projectId:input.projectId,organizationId:project.organizationId,actorId:ctx.user.id,clerkSubject:ctx.authenticatedClerkSubject!,repositoryId:input.repositoryId});
    });
    const original=await access();
    const read=async(path:string)=>{
      const before=await access();
      if(JSON.stringify(before.binding)!==JSON.stringify(original.binding))throw new TRPCError({code:"CONFLICT"});
      const response=await repositoryProviderJson(original.binding.origin,path,{token:before.token()});
      const after=await access();
      if(JSON.stringify(after.binding)!==JSON.stringify(original.binding))throw new TRPCError({code:"CONFLICT"});
      return response;
    };
    try {
      assertGitlabProjectIdentity(original.binding,await read(`/api/v4/projects/${original.binding.externalId}`));
      return {binding:original.binding,result:{projectId:input.projectId,repositoryId:input.repositoryId,observedAt:new Date().toISOString(),...await gitlabRepositoryReleases(original.binding,input.page,read)}};
    } catch(error) {
      if(error instanceof TRPCError)throw error;
      throw new TRPCError({code:"PRECONDITION_FAILED",message:"Repository releases could not be verified. Refresh the connection; no empty or complete release list is inferred."});
    }
}
type ReleaseBatchRow={repositoryId:string;url:string;status:"CHECKED"|"UNAVAILABLE"|"UNSUPPORTED"|"NOT_INSPECTED";releases:Awaited<ReturnType<typeof readReleasePage>>["result"]["releases"];hasMore:boolean;observedAt:string|null};
export const repositoryIntelligenceRouter=router({
  releases:protectedProcedure.input(z.object({projectId:z.string(),repositoryId:z.string(),page:z.number().int().min(1).max(10).default(1)})).query(async({ctx,input})=>(await readReleasePage(ctx,input)).result),
  projectReleases:protectedProcedure.input(z.object({projectId:z.string(),offset:z.number().int().min(0).max(1000).default(0)})).query(async({ctx,input})=>{
    const {project,membership}=await requireProjectAccess(ctx,input.projectId,"EDITOR");
    if(membership.seatType!=="FULL"||!ctx.authenticatedClerkSubject||ctx.authenticatedClerkSubject!==ctx.user.clerkUserId)throw new TRPCError({code:"FORBIDDEN"});
    const repositories=await ctx.prisma.projectRepository.findMany({where:{projectId:input.projectId},orderBy:[{createdAt:"asc"},{id:"asc"}],skip:input.offset,take:6});
    const started=Date.now(),results:ReleaseBatchRow[]=[];
    const admitted:Array<Awaited<ReturnType<typeof readReleasePage>>["binding"]>=[];
    // Five repositories maximum per batch, sequential provider reads and a
    // bounded admission window. A failed read is never an empty success.
    for(const repo of repositories.slice(0,5)){
      const row:ReleaseBatchRow={repositoryId:repo.id,url:repo.url,status:"NOT_INSPECTED",releases:[],hasMore:false,observedAt:null};
      if(repo.provider!=="gitlab"){results.push({...row,status:"UNSUPPORTED"});continue;}
      if(Date.now()-started>60000){results.push(row);continue;}
      try{const value=await readReleasePage(ctx,{projectId:input.projectId,repositoryId:repo.id,page:1});admitted.push(value.binding);results.push({...row,status:"CHECKED",releases:value.result.releases,hasMore:value.result.hasMore,observedAt:value.result.observedAt});}
      catch{results.push({...row,status:"UNAVAILABLE"});}
    }
    await ctx.prisma.$transaction(async tx=>{
      await lockedProcessingEditor(tx,project.organizationId,ctx.user.id,input.projectId);
      for(const binding of admitted){
        try{await admitConnectedGitlab(tx,binding,binding);}
        catch{const row=results.find(item=>item.repositoryId===binding.repositoryId);if(row){row.status="UNAVAILABLE";row.releases=[];row.observedAt=null;}}
      }
    });
    return {projectId:input.projectId,offset:input.offset,repositories:results,nextOffset:repositories.length>5?input.offset+5:null};
  }),
});
