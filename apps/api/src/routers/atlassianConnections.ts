import { z } from "@vaettir/core/dist/validation.js";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { atlassianApplication, atlassianProduct } from "../services/atlassianOAuth.js";
import { atlassianStorageReady, ownAtlassian, publicAtlassian, beginAtlassian, finishAtlassian, renewAtlassian, selectAtlassianSite, atlassianCatalog, approveAtlassian, disconnectAtlassian } from "../services/atlassianOAuthConnection.js";

const id=z.string().min(1).max(200),project=z.object({projectId:id}),connection=z.object({id});
export const atlassianConnectionsRouter=router({
  capabilities:protectedProcedure.input(project).query(async({ctx,input})=>{
    const {project,membership}=await requireProjectAccess(ctx,input.projectId);
    const human=!!ctx.authenticatedClerkSubject&&ctx.authenticatedClerkSubject===ctx.user.clerkUserId&&!ctx.authenticatedApiKeyId;
    return {available:!!atlassianApplication()&&atlassianStorageReady(),canConnect:human&&membership.seatType==="FULL"&&["OWNER","ADMIN","EDITOR"].includes(membership.role),organizationId:project.organizationId,clerkActorId:human?ctx.authenticatedClerkSubject:null};
  }),
  mine:protectedProcedure.input(project.extend({product:atlassianProduct})).query(async({ctx,input})=>{
    await requireProjectAccess(ctx,input.projectId,"EDITOR");
    const rows=await ctx.prisma.atlassianOAuthConnection.findMany({where:{projectId:input.projectId,actorId:ctx.user.id,clerkActorId:ctx.authenticatedClerkSubject??"",product:input.product},orderBy:{createdAt:"desc"},take:20});
    const result=[];for(const row of rows)result.push(publicAtlassian(await ownAtlassian(ctx,row.id)));return result;
  }),
  status:protectedProcedure.input(connection).query(async({ctx,input})=>publicAtlassian(await ownAtlassian(ctx,input.id))),
  begin:protectedProcedure.input(project.extend({originalOrganizationId:id,expectedClerkActorId:id,product:atlassianProduct,requestId:z.string().uuid(),approveMetadataAccess:z.literal(true)})).mutation(({ctx,input})=>beginAtlassian(ctx,input)),
  finish:protectedProcedure.input(z.object({state:z.string().regex(/^[A-Za-z0-9_-]{43}$/),code:z.string().min(1).max(10000).regex(/^[!-~]+$/).optional(),denied:z.literal(true).optional()}).strict().refine(v=>!!v.code!==!!v.denied)).mutation(({ctx,input})=>finishAtlassian(ctx,input)),
  refresh:protectedProcedure.input(connection).mutation(({ctx,input})=>renewAtlassian(ctx,input.id)),
  selectSite:protectedProcedure.input(connection.extend({siteId:id,version:z.number().int().nonnegative()})).mutation(({ctx,input})=>selectAtlassianSite(ctx,input)),
  catalog:protectedProcedure.input(connection.extend({after:z.union([z.number().int().min(1).max(1000000),z.string().min(1).max(1024).regex(/^[!-~]+$/)]).nullable().default(null)})).query(({ctx,input})=>atlassianCatalog(ctx,input)),
  approve:protectedProcedure.input(connection.extend({version:z.number().int().nonnegative(),resourceIds:z.array(id).min(1).max(100),requestId:z.string().uuid(),approved:z.literal(true)})).mutation(({ctx,input})=>approveAtlassian(ctx,input)),
  disconnect:protectedProcedure.input(connection.extend({confirmed:z.literal(true)})).mutation(({ctx,input})=>disconnectAtlassian(ctx,input.id)),
});
