import { protectedProcedure, router } from "../trpc.js";
import {
  recordedExecutionTrendInput,
  recordedExecutionTrendOutput,
  recordedExecutionTrendRunsInput,
  recordedExecutionTrendRunsOutput,
} from "../services/recordedExecutionTrendSchema.js";
import {
  withRecordedExecutionTrendAccess,
  readRecordedExecutionTrend,
  readRecordedExecutionTrendRuns,
} from "../services/recordedExecutionTrend.js";
export const recordedExecutionTrendsRouter = router({
  summary: protectedProcedure
    .input(recordedExecutionTrendInput)
    .output(recordedExecutionTrendOutput)
    .query(({ ctx, input }) =>
      withRecordedExecutionTrendAccess(
        ctx.prisma,
        ctx.user.id,
        ctx.user.clerkUserId,
        input,
        (tx) => readRecordedExecutionTrend(tx, input, ctx.user.clerkUserId),
      ),
    ),
  runs: protectedProcedure
    .input(recordedExecutionTrendRunsInput)
    .output(recordedExecutionTrendRunsOutput)
    .query(({ ctx, input }) =>
      withRecordedExecutionTrendAccess(
        ctx.prisma,
        ctx.user.id,
        ctx.user.clerkUserId,
        input,
        (tx) => readRecordedExecutionTrendRuns(tx, input, ctx.user.clerkUserId),
      ),
    ),
});
