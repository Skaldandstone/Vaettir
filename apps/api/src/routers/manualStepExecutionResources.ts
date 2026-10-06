import { router, protectedProcedure } from "../trpc.js";
import { readStepResourceHistory, readStepResourceEvidence } from "../services/manualStepExecutionResources.js";
import { stepResourceHistoryInput, stepResourceHistoryOutput, stepResourceEvidenceInput, stepResourceEvidenceOutput } from "../services/manualStepExecutionResourcesSchema.js";

/** Read-only metadata. No file opening, signing, upload or provider operation. */
export const manualStepExecutionResourcesRouter = router({
  history: protectedProcedure.input(stepResourceHistoryInput).output(stepResourceHistoryOutput).query(({ ctx, input }) => readStepResourceHistory(ctx.prisma, ctx.user, input)),
  evidence: protectedProcedure.input(stepResourceEvidenceInput).output(stepResourceEvidenceOutput).query(({ ctx, input }) => readStepResourceEvidence(ctx.prisma, ctx.user, input)),
});
