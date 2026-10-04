import { router, protectedProcedure } from "../trpc.js";
import { manualCaseResultReadSchema, manualCaseResultHistorySchema, manualCaseResultWriteSchema, manualCaseResultPreviewOutputSchema, manualCaseResultHistoryOutputSchema, manualCaseResultAckSchema } from "../services/manualCaseResultSchema.js";
import { previewManualCaseResult, historyManualCaseResult, recordManualCaseResult } from "../services/manualCaseResults.js";
export const manualCaseResultsRouter = router({
  preview: protectedProcedure.input(manualCaseResultReadSchema).output(manualCaseResultPreviewOutputSchema).query(({ ctx, input }) => previewManualCaseResult(ctx.prisma, ctx.user, input)),
  history: protectedProcedure.input(manualCaseResultHistorySchema).output(manualCaseResultHistoryOutputSchema).query(({ ctx, input }) => historyManualCaseResult(ctx.prisma, ctx.user, input)),
  record: protectedProcedure.input(manualCaseResultWriteSchema).output(manualCaseResultAckSchema).mutation(({ ctx, input }) => recordManualCaseResult(ctx.prisma, ctx.user, input)),
});
