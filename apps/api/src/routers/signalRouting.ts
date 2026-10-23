import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import {encryptToken} from "../services/tokenEncryption.js";

// Configuration is not provider acceptance. This query does not inspect the
// incident receipt ledger or verify delivery, so it never claims one.
export const signalRoutingRouter = router({
  save:protectedProcedure.input(z.object({
    projectId:z.string(),provider:z.enum(["pagerduty","datadog"]),route:z.string().trim().min(1).max(100),
    expectedRoute:z.string().nullable(),newDatadogSecret:z.string().min(16).max(2000).optional(),
  })).mutation(async({ctx,input})=>{
    const {project}=await requireProjectAccess(ctx,input.projectId,"EDITOR");
    try{return await ctx.prisma.$transaction(async tx=>{
      const rows=await tx.$queryRaw<Array<{suspendedAt:Date|null;datadogWebhookSecret:string|null;encryptedDatadogWebhookSecret:unknown}>>`SELECT "suspendedAt","datadogWebhookSecret","encryptedDatadogWebhookSecret" FROM "Organization" WHERE id=${project.organizationId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${project.organizationId} AND "userId"=${ctx.user.id} FOR UPDATE`;
      const member=await tx.membership.findUnique({where:{organizationId_userId:{organizationId:project.organizationId,userId:ctx.user.id}}});
      if(!rows[0]||rows[0].suspendedAt||!member||member.seatType!=="FULL"||!["OWNER","ADMIN","EDITOR"].includes(member.role))
        throw new TRPCError({code:"FORBIDDEN",message:"Your workspace permissions changed. Refresh and try again."});
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${project.id} FOR UPDATE`;
      const current=await tx.project.findUniqueOrThrow({where:{id:project.id},select:{pagerdutyServiceId:true,datadogProjectTag:true}});
      const previous=input.provider==="pagerduty"?current.pagerdutyServiceId:current.datadogProjectTag;
      if(previous!==input.expectedRoute)throw new TRPCError({code:"CONFLICT",message:"Another member changed this route. Refresh and review their changes before saving."});
      if(input.provider==="pagerduty"){
        if(!process.env.PAGERDUTY_WEBHOOK_SECRET?.trim())throw new TRPCError({code:"PRECONDITION_FAILED",message:"The platform PagerDuty signing secret must be configured first."});
        if(input.newDatadogSecret)throw new TRPCError({code:"BAD_REQUEST"});
      }else if(input.newDatadogSecret){
        if(!["OWNER","ADMIN"].includes(member.role))throw new TRPCError({code:"FORBIDDEN",message:"An owner or administrator must configure the webhook secret."});
        if(rows[0].datadogWebhookSecret||rows[0].encryptedDatadogWebhookSecret)throw new TRPCError({code:"CONFLICT",message:"A workspace secret is already configured. Refresh before continuing."});
        await tx.organization.update({where:{id:project.organizationId},data:{encryptedDatadogWebhookSecret:{...encryptToken(input.newDatadogSecret)}}});
      }else if(!rows[0].datadogWebhookSecret&&!rows[0].encryptedDatadogWebhookSecret)throw new TRPCError({code:"PRECONDITION_FAILED",message:"Configure the workspace signing secret first."});
      await tx.project.update({where:{id:project.id},data:input.provider==="pagerduty"?{pagerdutyServiceId:input.route}:{datadogProjectTag:input.route}});
      return{saved:true,deliveryVerified:false as const};
    });}catch(error){
      if(error instanceof TRPCError)throw error;
      if(error&&typeof error==="object"&&"code" in error&&error.code==="P2002")throw new TRPCError({code:"CONFLICT",message:"This provider route belongs to another project. Choose a unique route."});
      throw error;
    }
  }),
  readiness: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      const membership = await ctx.prisma.membership.findUnique({
        where: { organizationId_userId: { organizationId: project.organizationId, userId: ctx.user.id } },
      });
      if (!membership) throw new TRPCError({ code: "FORBIDDEN", message: "Your workspace access changed. Refresh and try again." });
      const [saved, organization, release] = await Promise.all([
        ctx.prisma.project.findUniqueOrThrow({ where: { id: project.id }, select: { pagerdutyServiceId: true, datadogProjectTag: true } }),
        ctx.prisma.organization.findUniqueOrThrow({ where: { id: project.organizationId }, select: { datadogWebhookSecret: true,encryptedDatadogWebhookSecret:true } }),
        ctx.prisma.release.findFirst({ where: { projectId: project.id, status: "SHIPPED" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } }),
      ]);
      const full = membership.seatType === "FULL";
      return {
        organizationId: project.organizationId,
        canEdit: full && ["OWNER", "ADMIN", "EDITOR"].includes(membership.role),
        canConfigureSecret: full && ["OWNER", "ADMIN"].includes(membership.role),
        shippedRelease: release,
        pagerduty: {
          route: saved.pagerdutyServiceId,
          secretConfigured: Boolean(process.env.PAGERDUTY_WEBHOOK_SECRET?.trim()),
          endpointPath: "/webhooks/pagerduty",
        },
        datadog: {
          route: saved.datadogProjectTag,
          secretConfigured: Boolean(organization.datadogWebhookSecret?.trim()||organization.encryptedDatadogWebhookSecret),
          endpointPath: `/webhooks/datadog/${encodeURIComponent(project.organizationId)}`,
        },
        deliveryVerified: false as const,
      };
    }),
});
