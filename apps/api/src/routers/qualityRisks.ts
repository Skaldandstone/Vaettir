import { z } from "zod";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { qualityRiskWriteInput, qualityRiskLookupInput } from "../services/qualityRiskSchema.js";
import { withQualityRiskAccess, withQualityRiskReadAccess, qualityRiskList, qualityRiskDetail, writeQualityRisk, lookupQualityRiskLinks } from "../services/qualityRisks.js";
const projectId = z.string().min(1).max(120);
const originalOrganizationId = z.string().min(1).max(120).optional();
export const qualityRisksRouter = router({
  list: protectedProcedure.input(z.object({ projectId, originalOrganizationId, offset: z.number().int().min(0).max(950).default(0) }).strict())
    .query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      return withQualityRiskReadAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId, input.originalOrganizationId,
        async (tx, access) => ({ ...await qualityRiskList(tx, access, input.projectId, input.offset), actorClerkUserId: ctx.user.clerkUserId }));
    }),
  byId: protectedProcedure.input(z.object({ projectId, originalOrganizationId, id: z.string().min(1).max(120),
    historyOffset: z.number().int().min(0).max(90).default(0) }).strict()).query(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      return withQualityRiskReadAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId, input.originalOrganizationId,
        async (tx, access) => ({ ...await qualityRiskDetail(tx, access, input.projectId, input.id, input.historyOffset), actorClerkUserId: ctx.user.clerkUserId }));
    }),
  lookup: protectedProcedure.input(qualityRiskLookupInput.extend({ originalOrganizationId })).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withQualityRiskReadAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId, input.originalOrganizationId,
      async (tx, access) => ({ ...await lookupQualityRiskLinks(tx, input.projectId, input.kind, input.search),
        organizationId: access.organizationId, actorClerkUserId: ctx.user.clerkUserId }));
  }),
  write: protectedProcedure.input(qualityRiskWriteInput).mutation(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withQualityRiskAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId,
      (tx, access) => writeQualityRisk(tx, access, input));
  }),
});
