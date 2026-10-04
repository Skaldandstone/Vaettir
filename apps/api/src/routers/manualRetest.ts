import { router, protectedProcedure } from "../trpc.js";
import { z } from "zod";
import {
  listManualRetestLinks,
  prepareManualRetest,
  retestPreviewInputSchema,
  retestStartInputSchema,
  startManualRetest,
} from "../services/manualRetest.js";
import { manualRetestStartOutputSchema } from "../services/manualRetestScopeSchema.js";

export const manualRetestRouter = router({
  preview: protectedProcedure
    .input(retestPreviewInputSchema)
    .query(({ ctx, input }) =>
      ctx.prisma.$transaction(
        async (tx) => {
          const prepared = await prepareManualRetest(tx, ctx.user.id, input, false, ctx.user.clerkUserId);
          const {
            frozen: _frozen,
            ordered: _ordered,
            prerequisites: _prerequisites,
            ...preview
          } = prepared;
          return preview;
        },
        { timeout: 20000, isolationLevel: "RepeatableRead" },
      ),
    ),
  start: protectedProcedure
    .input(retestStartInputSchema)
    .output(manualRetestStartOutputSchema)
    .mutation(({ ctx, input }) =>
      startManualRetest(ctx.prisma, ctx.user.id, input, ctx.user.clerkUserId),
    ),
  links: protectedProcedure
    .input(
      retestPreviewInputSchema.extend({
        before: z.string().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listManualRetestLinks(ctx.prisma, ctx.user.id, input, ctx.user.clerkUserId),
    ),
});
