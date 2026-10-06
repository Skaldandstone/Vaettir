import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { refreshReleaseReadiness } from "../services/releaseReadiness.js";
import {
  planGovernanceScopeInput,
  editCriterionDescriptionInput,
  setCriterionVerdictInput,
  attachUnassignedPlanInput,
  planGovernancePreviewOutput,
  planGovernanceAck,
  planGovernanceHistoryInput,
  planGovernanceHistoryOutput,
} from "../services/testPlanGovernanceSchema.js";
import {
  previewPlanGovernance,
  editGovernedCriterionDescription,
  setGovernedCriterionVerdict,
  attachGovernedUnassignedPlan,
  listPlanGovernanceHistory,
} from "../services/testPlanGovernance.js";
export const testPlanGovernanceRouter = router({
  setCriterionVerdict: protectedProcedure
    .input(setCriterionVerdictInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const saved = await setGovernedCriterionVerdict(
        ctx.prisma,
        ctx.user.id,
        input,
        {
          clerkActorId: ctx.user.clerkUserId,
        },
      );
      // Preserve the existing post-commit readiness refresh for a new manual
      // decision. Replaying a lost ACK does not schedule a second transition.
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, saved.releaseId);
      return saved;
    }),
  preview: protectedProcedure
    .input(planGovernanceScopeInput)
    .output(planGovernancePreviewOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return previewPlanGovernance(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  editCriterionDescription: protectedProcedure
    .input(editCriterionDescriptionInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return editGovernedCriterionDescription(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  attachUnassignedPlan: protectedProcedure
    .input(attachUnassignedPlanInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return attachGovernedUnassignedPlan(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  history: protectedProcedure
    .input(planGovernanceHistoryInput)
    .output(planGovernanceHistoryOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listPlanGovernanceHistory(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
});
