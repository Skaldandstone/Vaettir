import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { casePriorityInput, setCasePriority, casePriorityLegacyOutput, casePriorityReviewedInput, casePriorityAck, casePriorityPreviewInput, casePriorityPreviewOutput, previewCasePriority } from "../services/casePriority.js";
export const casePriorityRouter = router({
  preview: protectedProcedure.input(casePriorityPreviewInput).output(casePriorityPreviewOutput).query(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId);
    return previewCasePriority(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
  set: protectedProcedure.input(casePriorityInput).output(casePriorityLegacyOutput).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.projectId, "EDITOR");
    return setCasePriority(ctx.prisma, ctx.user.id, input, { clerkActorId: ctx.user.clerkUserId });
  }),
  setReviewed: protectedProcedure.input(casePriorityReviewedInput).output(casePriorityAck).mutation(async ({ ctx, input }) => {
    await requireProjectAccess(ctx, input.input.projectId, "EDITOR");
    return setCasePriority(ctx.prisma, ctx.user.id, input.input, { clerkActorId: ctx.user.clerkUserId }, input.expectedNativeActorId);
  }),
});
