import { router, protectedProcedure, requireProjectAccess, type Context } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { refreshReleaseReadiness } from "../services/releaseReadiness.js";
import {
  planGovernanceScopeInput,
  editPlanHeaderInput,
  savePlanExecutionTemplateInput,
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
  saveGovernedExecutionTemplate,
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
// The optional custom path carries independently verified transport identity.
// Services recheck the exact action under the existing business locks.
async function planWriteAuthorization(ctx: Context & { user: NonNullable<Context["user"]> }, projectId: string) {
  const { membership } = await requireProjectAccess(ctx, projectId);
  if (["OWNER", "ADMIN", "EDITOR"].includes(membership.role)) return { clerkActorId: ctx.user.clerkUserId };
  if (!ctx.authenticatedClerkSubject || ctx.authenticatedClerkSubject !== ctx.user.clerkUserId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again before editing this plan." });
  return { clerkActorId: ctx.authenticatedClerkSubject, planAuthor: {
    userId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject, workspaceOrganizationId: ctx.workspaceOrganizationId,
  } };
}
export const testPlanGovernanceRouter = router({
  saveExecutionTemplate: protectedProcedure
    .input(savePlanExecutionTemplateInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.authenticatedClerkSubject || ctx.authenticatedClerkSubject !== ctx.user.clerkUserId)
        throw new TRPCError({ code: "FORBIDDEN", message: "Sign in again before saving this plan." });
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      return saveGovernedExecutionTemplate(ctx.prisma, ctx.user.id, input, authorized);
    }),
  setPlanStatus: protectedProcedure
    .input(setPlanStatusInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      return setGovernedPlanStatus(ctx.prisma, ctx.user.id, input, authorized);
    }),
  editPlanCustomFields: protectedProcedure
    .input(editPlanCustomFieldsInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      return editGovernedPlanCustomFields(ctx.prisma, ctx.user.id, input, authorized);
    }),
  editPlanHeader: protectedProcedure
    .input(editPlanHeaderInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      return editGovernedPlanHeader(ctx.prisma, ctx.user.id, input, authorized);
    }),
  addCriterion: protectedProcedure
    .input(addGovernedCriterionInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      const saved = await addGovernedCriterion(ctx.prisma, ctx.user.id, input, authorized);
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, saved.releaseId);
      return saved;
    }),
  deleteCriterion: protectedProcedure
    .input(deleteGovernedCriterionInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      const saved = await deleteGovernedCriterion(
        ctx.prisma,
        ctx.user.id,
        input,
        authorized,
      );
      if (!saved.replayed) refreshReleaseReadiness(ctx.prisma, saved.releaseId);
      return saved;
    }),
  setCriterionRequirement: protectedProcedure
    .input(setGovernedCriterionRequirementInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      const saved = await setGovernedCriterionRequirement(
        ctx.prisma,
        ctx.user.id,
        input,
        authorized,
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
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      const saved = await setGovernedCriterionVerdict(
        ctx.prisma,
        ctx.user.id,
        input,
        authorized,
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
        ...(ctx.authenticatedClerkSubject ? { planAuthor: {
          userId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject, workspaceOrganizationId: ctx.workspaceOrganizationId,
        } } : {}),
      });
    }),
  editCriterionDescription: protectedProcedure
    .input(editCriterionDescriptionInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      return editGovernedCriterionDescription(ctx.prisma, ctx.user.id, input, authorized);
    }),
  attachUnassignedPlan: protectedProcedure
    .input(attachUnassignedPlanInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      return attachGovernedUnassignedPlan(ctx.prisma, ctx.user.id, input, authorized);
    }),
  detachAttachedPlan: protectedProcedure
    .input(detachAttachedPlanInput)
    .output(planGovernanceAck)
    .mutation(async ({ ctx, input }) => {
      if (!ctx.authenticatedClerkSubject || ctx.authenticatedClerkSubject !== ctx.user.clerkUserId)
        throw new TRPCError({ code: "FORBIDDEN", message: "Current authenticated actor access is required for reviewed plan detachment." });
      const authorized = await planWriteAuthorization(ctx, input.projectId);
      const saved = await detachGovernedAttachedPlan(ctx.prisma, ctx.user.id, input, authorized);
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
