import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, type Context } from "../trpc.js";
import { readStepResourceHistory, readStepResourceEvidence } from "../services/manualStepExecutionResources.js";
import { stepResourceHistoryInput, stepResourceHistoryOutput, stepResourceEvidenceInput, stepResourceEvidenceOutput } from "../services/manualStepExecutionResourcesSchema.js";

/** Read-only metadata. No file opening, signing, upload or provider operation. */
function verifiedActor(ctx: Context & { user: NonNullable<Context["user"]> }) {
  if (!ctx.authenticatedClerkSubject) throw new TRPCError({ code: "FORBIDDEN", message: "An independently verified human session is required for private step resources." });
  return { id: ctx.user.id, clerkUserId: ctx.authenticatedClerkSubject };
}
export const manualStepExecutionResourcesRouter = router({
  history: protectedProcedure.input(stepResourceHistoryInput).output(stepResourceHistoryOutput).query(({ ctx, input }) => readStepResourceHistory(ctx.prisma, verifiedActor(ctx), input)),
  evidence: protectedProcedure.input(stepResourceEvidenceInput).output(stepResourceEvidenceOutput).query(({ ctx, input }) => readStepResourceEvidence(ctx.prisma, verifiedActor(ctx), input)),
});
