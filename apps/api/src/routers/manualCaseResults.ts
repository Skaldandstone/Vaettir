import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Context } from "../trpc.js";
import {
  manualCaseResultReadSchema,
  manualCaseResultHistorySchema,
  manualCaseResultWriteSchema,
  manualCaseResultPreviewOutputSchema,
  manualCaseResultHistoryOutputSchema,
  manualCaseResultAckSchema,
} from "../services/manualCaseResultSchema.js";
import {
  previewManualCaseResult,
  historyManualCaseResult,
  recordManualCaseResult,
} from "../services/manualCaseResults.js";
import {
  accessReviewedManualCaseResult,
  previewReviewedManualCaseResult,
  historyReviewedManualCaseResult,
  recordReviewedManualCaseResult,
} from "../services/manualCaseResults.js";
import {
  manualCaseReviewedAccessSchema,
  manualCaseReviewedReadSchema,
  manualCaseReviewedHistorySchema,
  manualCaseReviewedWriteSchema,
  manualCaseReviewedAccessOutputSchema,
  manualCaseReviewedPreviewOutputSchema,
  manualCaseReviewedHistoryOutputSchema,
  manualCaseReviewedAckSchema,
} from "../services/manualCaseResultSchema.js";
/** Reviewed human evidence must use the verified transport subject, never a
 * mutable cached native mapping or an API-key backing user's Clerk field. */
function verifiedReviewedActor(ctx: Context & { user: NonNullable<Context["user"]> }) {
  if (!ctx.authenticatedClerkSubject)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An independently verified human session is required for reviewed case evidence.",
    });
  return { id: ctx.user.id, clerkUserId: ctx.authenticatedClerkSubject };
}
export const manualCaseResultsRouter = router({
  accessReviewed: protectedProcedure
    .input(manualCaseReviewedAccessSchema)
    .output(manualCaseReviewedAccessOutputSchema)
    .query(({ ctx, input }) =>
      accessReviewedManualCaseResult(ctx.prisma, verifiedReviewedActor(ctx), input),
    ),
  previewReviewed: protectedProcedure
    .input(manualCaseReviewedReadSchema)
    .output(manualCaseReviewedPreviewOutputSchema)
    .query(({ ctx, input }) =>
      previewReviewedManualCaseResult(ctx.prisma, verifiedReviewedActor(ctx), input),
    ),
  historyReviewed: protectedProcedure
    .input(manualCaseReviewedHistorySchema)
    .output(manualCaseReviewedHistoryOutputSchema)
    .query(({ ctx, input }) =>
      historyReviewedManualCaseResult(ctx.prisma, verifiedReviewedActor(ctx), input),
    ),
  recordReviewed: protectedProcedure
    .input(manualCaseReviewedWriteSchema)
    .output(manualCaseReviewedAckSchema)
    .mutation(({ ctx, input }) =>
      recordReviewedManualCaseResult(ctx.prisma, verifiedReviewedActor(ctx), input),
    ),
  preview: protectedProcedure
    .input(manualCaseResultReadSchema)
    .output(manualCaseResultPreviewOutputSchema)
    .query(({ ctx, input }) =>
      previewManualCaseResult(ctx.prisma, ctx.user, input),
    ),
  history: protectedProcedure
    .input(manualCaseResultHistorySchema)
    .output(manualCaseResultHistoryOutputSchema)
    .query(({ ctx, input }) =>
      historyManualCaseResult(ctx.prisma, ctx.user, input),
    ),
  record: protectedProcedure
    .input(manualCaseResultWriteSchema)
    .output(manualCaseResultAckSchema)
    .mutation(({ ctx, input }) =>
      recordManualCaseResult(ctx.prisma, ctx.user, input),
    ),
});
