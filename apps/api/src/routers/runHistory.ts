import { router, protectedProcedure } from "../trpc.js";
import {
  runHistoryAccessInput,
  runHistoryAccessOutput,
  runHistoryPageInput,
  runHistoryPageOutput,
} from "../services/runHistoryReadSchema.js";
import {
  readRunHistoryAccess,
  readRunHistoryPage,
} from "../services/runHistoryRead.js";
/** Additive source reader only. Root owns later central/browser cutover. */
export const runHistoryRouter = router({
  access: protectedProcedure
    .input(runHistoryAccessInput)
    .output(runHistoryAccessOutput)
    .query(({ ctx, input }) =>
      readRunHistoryAccess(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      }),
    ),
  page: protectedProcedure
    .input(runHistoryPageInput)
    .output(runHistoryPageOutput)
    .query(({ ctx, input }) =>
      readRunHistoryPage(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      }),
    ),
});
