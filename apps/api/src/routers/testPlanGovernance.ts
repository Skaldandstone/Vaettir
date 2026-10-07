import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { refreshReleaseReadiness } from "../services/releaseReadiness.js";
import {
  planGovernanceScopeInput,
  editPlanHeaderInput,
  setPlanStatusInput,
  editPlanCustomFieldsInput,
  editCriterionDescriptionInput,
  setCriterionVerdictInput,
  addGovernedCriterionInput,
  deleteGovernedCriterionInput,
  setGovernedCriterionRequirementInput,
  requirementChoiceInput,
  requirementChoiceOutput,
  attachUnassignedPlanInput,
  detachAttachedPlanInput,
  planGovernancePreviewOutput,
  planGovernanceAck,
  planGovernanceHistoryInput,
  planGovernanceHistoryOutput,
} from "../services/testPlanGovernanceSchema.js";
import {
  previewPlanGovernance,
  editGovernedPlanHeader,
  setGovernedPlanStatus,
  editGovernedPlanCustomFields,
  editGovernedCriterionDescription,
  setGovernedCriterionVerdict,
  addGovernedCriterion,
  deleteGovernedCriterion,
  setGovernedCriterionRequirement,
  listGovernanceRequirementChoices,
  attachGovernedUnassignedPlan,
  detachGovernedAttachedPlan,
  listPlanGovernanceHistory,
} from "../services/testPlanGovernance.js";
export const testPlanGovernanceRouter = router({
  setPlanStatus: protectedProcedure
    .input(setPlanStatusInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return setGovernedPlanStatus(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  editPlanCustomFields: protectedProcedure
    .input(editPlanCustomFieldsInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return editGovernedPlanCustomFields(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  editPlanHeader: protectedProcedure
    .input(editPlanHeaderInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return editGovernedPlanHeader(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  addCriterion: protectedProcedure
    .input(addGovernedCriterionInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const saved = await addGovernedCriterion(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, saved.releaseId);
      return saved;
    }),
  deleteCriterion: protectedProcedure
    .input(deleteGovernedCriterionInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const saved = await deleteGovernedCriterion(
        ctx.prisma,
        ctx.user.id,
        input,
        { clerkActorId: ctx.user.clerkUserId },
      );
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, saved.releaseId);
      return saved;
    }),
  setCriterionRequirement: protectedProcedure
    .input(setGovernedCriterionRequirementInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const saved = await setGovernedCriterionRequirement(
        ctx.prisma,
        ctx.user.id,
        input,
        { clerkActorId: ctx.user.clerkUserId },
      );
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, saved.releaseId);
      return saved;
    }),
  requirementChoices: protectedProcedure
    .input(requirementChoiceInput)
    .output(requirementChoiceOutput)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return listGovernanceRequirementChoices(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
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
  detachAttachedPlan: protectedProcedure
    .input(detachAttachedPlanInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.authenticatedClerkSubject || ctx.authenticatedClerkSubject !== ctx.user.clerkUserId)
        throw new TRPCError({ code: "FORBIDDEN", message: "Current authenticated actor access is required for reviewed plan detachment." });
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      const saved = await detachGovernedAttachedPlan(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.authenticatedClerkSubject,
      });
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, input.expectedReleaseId);
      return saved;
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
