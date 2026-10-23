import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { qualityRiskOverviewInput, qualityRiskOverviewDetailInput } from "../services/qualityRiskOverviewSchema.js";
import { withRiskOverviewAccess, qualityRiskOverview, qualityRiskOverviewDetail } from "../services/qualityRiskOverview.js";
export const qualityRiskOverviewRouter = router({
  summary: protectedProcedure.input(qualityRiskOverviewInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRiskOverviewAccess(ctx.prisma, input, ctx.user.id, project.organizationId, async (tx, scope) => ({ ...(await qualityRiskOverview(tx, scope.organizationId, input)), ...scope }));
  }),
  byId: protectedProcedure.input(qualityRiskOverviewDetailInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRiskOverviewAccess(ctx.prisma, input, ctx.user.id, project.organizationId, async (tx, scope) => ({ ...(await qualityRiskOverviewDetail(tx, scope.organizationId, input)), ...scope }));
  }),
});
