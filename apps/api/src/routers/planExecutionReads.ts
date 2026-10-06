import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc.js";
import { readPlanExecutionAccess, readPlanExecutionPage } from "../services/planExecutionRead.js";
import { planExecutionAccessInput, planExecutionAccessOutput, planExecutionPageInput, planExecutionPageOutput, planExecutionReadSubject } from "../services/planExecutionReadSchema.js";

async function boundedRead<T>(subject: string | null | undefined, work: (subject: string) => Promise<T>) {
  if (!planExecutionReadSubject.safeParse(subject).success) throw new TRPCError({ code: "FORBIDDEN", message: "Current independently verified signed-in reader required." });
  try { return await work(subject!); }
  catch (cause) {
    if (cause instanceof TRPCError) throw cause;
    throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "The current plan execution read is unavailable. No private native error body was returned." });
  }
}
export const planExecutionReadsRouter = router({
  access: protectedProcedure.input(planExecutionAccessInput).output(planExecutionAccessOutput)
    .query(({ ctx, input }) => boundedRead(ctx.authenticatedClerkSubject, subject => readPlanExecutionAccess(ctx.prisma, ctx.user.id, input, { clerkActorId: subject }))),
  page: protectedProcedure.input(planExecutionPageInput).output(planExecutionPageOutput)
    .query(({ ctx, input }) => boundedRead(ctx.authenticatedClerkSubject, subject => readPlanExecutionPage(ctx.prisma, ctx.user.id, input, { clerkActorId: subject }))),
});
