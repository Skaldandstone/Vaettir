import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Context } from "../trpc.js";
import { previewReviewedStep, recordReviewedStep } from "../services/manualStepExecutionReview.js";
import { reviewedStepAckSchema, reviewedStepPreviewInputSchema, reviewedStepPreviewOutputSchema, reviewedStepWriteInputSchema } from "../services/manualStepExecutionReviewSchema.js";
/** Protected reviewed namespace; legacy step callers are cut over separately. */
function verifiedActor(ctx: Context & { user: NonNullable<Context["user"]> }) {
  if (!ctx.authenticatedClerkSubject) throw new TRPCError({ code: "FORBIDDEN", message: "An independently verified human session is required for reviewed step evidence." });
  return { id: ctx.user.id, clerkUserId: ctx.authenticatedClerkSubject };
}
export const manualStepExecutionReviewRouter = router({
  preview: protectedProcedure.input(reviewedStepPreviewInputSchema).output(reviewedStepPreviewOutputSchema).query(({ ctx, input }) => previewReviewedStep(ctx.prisma, verifiedActor(ctx), input)),
  record: protectedProcedure.input(reviewedStepWriteInputSchema).output(reviewedStepAckSchema).mutation(({ ctx, input }) => recordReviewedStep(ctx.prisma, verifiedActor(ctx), input)),
});
