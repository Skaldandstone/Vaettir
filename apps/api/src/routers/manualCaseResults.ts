import { router, protectedProcedure } from "../trpc.js";
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
export const manualCaseResultsRouter = router({
  accessReviewed: protectedProcedure
    .input(manualCaseReviewedAccessSchema)
    .output(manualCaseReviewedAccessOutputSchema)
    .query(({ ctx, input }) =>
      accessReviewedManualCaseResult(ctx.prisma, ctx.user, input),
    ),
  previewReviewed: protectedProcedure
    .input(manualCaseReviewedReadSchema)
    .output(manualCaseReviewedPreviewOutputSchema)
    .query(({ ctx, input }) =>
      previewReviewedManualCaseResult(ctx.prisma, ctx.user, input),
    ),
  historyReviewed: protectedProcedure
    .input(manualCaseReviewedHistorySchema)
    .output(manualCaseReviewedHistoryOutputSchema)
    .query(({ ctx, input }) =>
      historyReviewedManualCaseResult(ctx.prisma, ctx.user, input),
    ),
  recordReviewed: protectedProcedure
    .input(manualCaseReviewedWriteSchema)
    .output(manualCaseReviewedAckSchema)
    .mutation(({ ctx, input }) =>
      recordReviewedManualCaseResult(ctx.prisma, ctx.user, input),
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
