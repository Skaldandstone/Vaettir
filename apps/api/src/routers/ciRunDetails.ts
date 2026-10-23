import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import {
  ciRunDetailAccessInput,
  ciRunDetailAccessOutput,
  ciRunDetailPageInput,
  ciRunDetailPageOutput,
} from "../services/ciRunDetailReadSchema.js";
import {
  readCiRunDetailAccess,
  readCiRunDetailPage,
} from "../services/ciRunDetailRead.js";
export const ciRunDetailsRouter = router({
  access: protectedProcedure
    .input(ciRunDetailAccessInput)
    .output(ciRunDetailAccessOutput)
    .query(({ ctx, input }) => {
      if (!ctx.authenticatedClerkSubject)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current independently verified signed-in reader required.",
        });
      return readCiRunDetailAccess(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.authenticatedClerkSubject,
      });
    }),
  page: protectedProcedure
    .input(ciRunDetailPageInput)
    .output(ciRunDetailPageOutput)
    .query(({ ctx, input }) => {
      if (!ctx.authenticatedClerkSubject)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current independently verified signed-in reader required.",
        });
      return readCiRunDetailPage(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.authenticatedClerkSubject,
      });
    }),
});
