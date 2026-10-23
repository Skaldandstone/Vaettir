import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import {
  manualRunCurrentReadInput,
  manualRunCurrentReadOutput,
} from "../services/manualRunCurrentReadSchema.js";
import { readManualRunCurrent } from "../services/manualRunCurrentRead.js";
export const manualRunReadsRouter = router({
  current: protectedProcedure
    .input(manualRunCurrentReadInput)
    .output(manualRunCurrentReadOutput)
    .query(({ ctx, input }) => {
      if (!ctx.authenticatedClerkSubject)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current independently verified signed-in reader required.",
        });
      return readManualRunCurrent(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.authenticatedClerkSubject,
      });
    }),
});
