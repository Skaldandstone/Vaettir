import { router, protectedProcedure } from "../trpc.js";
import { manualRunCatalogInputSchema, manualRunCatalogOutputSchema, manualRunComparisonInputSchema, manualRunComparisonOutputSchema } from "../services/manualRunComparisonSchema.js";
import { listManualComparisonRuns, compareManualRuns } from "../services/manualRunComparison.js";
export const manualRunComparisonRouter = router({
  runs: protectedProcedure.input(manualRunCatalogInputSchema).output(manualRunCatalogOutputSchema).query(({ ctx, input }) => listManualComparisonRuns(ctx.prisma, ctx.user.id, ctx.user.clerkUserId, input)),
  compare: protectedProcedure.input(manualRunComparisonInputSchema).output(manualRunComparisonOutputSchema).query(({ ctx, input }) => compareManualRuns(ctx.prisma, ctx.user.id, ctx.user.clerkUserId, input)),
});
