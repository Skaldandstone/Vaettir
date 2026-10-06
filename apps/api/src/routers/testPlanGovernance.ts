import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import {
  planGovernanceScopeInput,
  editCriterionDescriptionInput,
  attachUnassignedPlanInput,
  planGovernancePreviewOutput,
  planGovernanceAck,
  planGovernanceHistoryInput,
  planGovernanceHistoryOutput,
} from "../services/testPlanGovernanceSchema.js";
import {
  previewPlanGovernance,
  editGovernedCriterionDescription,
  attachGovernedUnassignedPlan,
  listPlanGovernanceHistory,
} from "../services/testPlanGovernance.js";
export const testPlanGovernanceRouter = router({
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
