import { z } from "zod";
import { router, protectedProcedure } from "../trpc.js";
import {
  listManualRetestLinks,
  prepareManualRetest,
  retestPreviewInputSchema,
  retestStartInputSchema,
  startManualRetest,
} from "../services/manualRetest.js";

export const manualRetestRouter = router({
  preview: protectedProcedure
    .input(retestPreviewInputSchema)
    .query(({ ctx, input }) =>
      ctx.prisma.$transaction(
        async (tx) => {
          const prepared = await prepareManualRetest(tx, ctx.user.id, input);
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
    .output(z.object({ testRunId: z.string(), recovered: z.boolean() }))
    .mutation(({ ctx, input }) =>
      startManualRetest(ctx.prisma, ctx.user.id, input),
    ),
  links: protectedProcedure
    .input(
      retestPreviewInputSchema.extend({
        before: z.string().min(1).max(200).optional(),
      }),
    )
    .query(({ ctx, input }) =>
      listManualRetestLinks(ctx.prisma, ctx.user.id, input),
    ),
});
