import { router, protectedProcedure } from "../trpc.js";
import { previewReviewedStep, recordReviewedStep } from "../services/manualStepExecutionReview.js";
import { reviewedStepAckSchema, reviewedStepPreviewInputSchema, reviewedStepPreviewOutputSchema, reviewedStepWriteInputSchema } from "../services/manualStepExecutionReviewSchema.js";
/** Standalone until Root mounts the coherent reviewed browser caller. */
export const manualStepExecutionReviewRouter = router({
  preview: protectedProcedure.input(reviewedStepPreviewInputSchema).output(reviewedStepPreviewOutputSchema).query(({ ctx, input }) => previewReviewedStep(ctx.prisma, ctx.user, input)),
  record: protectedProcedure.input(reviewedStepWriteInputSchema).output(reviewedStepAckSchema).mutation(({ ctx, input }) => recordReviewedStep(ctx.prisma, ctx.user, input)),
});
