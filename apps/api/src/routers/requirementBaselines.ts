import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { requirementBaselineListInput, requirementBaselineDetailInput, requirementBaselineCaptureInput } from "../services/requirementBaselineSchema.js";
import { withRequirementBaselineAccess, requirementBaselineList, requirementBaselineDetail, captureRequirementBaseline } from "../services/requirementBaselines.js";
export const requirementBaselinesRouter = router({
  access: protectedProcedure.input(requirementBaselineListInput.pick({ projectId: true, expectedScope: true })).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementBaselineAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId,
      async (_tx, access) => ({ projectId: input.projectId, canWrite: access.canWrite }), { expectedScope: input.expectedScope, verifiedClerkActorId: ctx.user.clerkUserId });
  }),
  list: protectedProcedure.input(requirementBaselineListInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementBaselineAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId,
      (tx, access) => requirementBaselineList(tx, access, input.projectId, input.offset, input.search), { expectedScope: input.expectedScope, verifiedClerkActorId: ctx.user.clerkUserId });
  }),
  byId: protectedProcedure.input(requirementBaselineDetailInput).query(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementBaselineAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId,
      (tx, access) => requirementBaselineDetail(tx, access, input), { expectedScope: input.expectedScope, verifiedClerkActorId: ctx.user.clerkUserId });
  }),
  capture: protectedProcedure.input(requirementBaselineCaptureInput).mutation(async ({ ctx, input }) => {
    const { project } = await requireProjectAccess(ctx, input.projectId);
    return withRequirementBaselineAccess(ctx.prisma, input.projectId, ctx.user.id, project.organizationId,
      (tx, access) => captureRequirementBaseline(tx, access, input), { expectedScope: input.expectedScope, verifiedClerkActorId: ctx.user.clerkUserId });
  }),
});
