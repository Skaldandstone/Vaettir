import { router, protectedProcedure, type Context } from "../trpc.js";
import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { z } from "zod";
import {
  listManualRetestLinks,
  prepareManualRetest,
  retestPreviewInputSchema,
  retestStartInputSchema,
  startManualRetest,
} from "../services/manualRetest.js";
import { manualRetestStartOutputSchema } from "../services/manualRetestScopeSchema.js";
import { manualRetestReadRequestKey, type ManualRetestObservedScope } from "../services/manualRetestScopeSchema.js";
import { lockManualRetestAccess } from "../services/manualRetestScope.js";
import { boundedRetestReviewedOutput, retestAccessReviewedInput, retestAccessReviewedOutput, retestPreviewReviewedInput, retestPreviewReviewedOutput, retestLinksReviewedInput, retestLinksReviewedOutput, retestStartReviewedInput, retestStartReviewedOutput, retestReviewedReadKey, type RetestReviewedReadInput } from "../services/manualRetestReviewedSchema.js";

function verifiedRetestActor(ctx: Context & { user: NonNullable<Context["user"]> }, input: { expectedNativeActorId?: string; request: { expectedScope?: { clerkActorId: string } } }) {
  const subject = ctx.authenticatedClerkSubject;
  if (typeof subject !== "string" || !subject.trim() || subject.length > 200 || subject.includes("\0") ||
    typeof ctx.user.id !== "string" || !ctx.user.id.trim() || ctx.user.id.length > 200 || ctx.user.id.includes("\0") ||
    input.expectedNativeActorId !== undefined && input.expectedNativeActorId !== ctx.user.id ||
    input.request.expectedScope !== undefined && input.request.expectedScope.clerkActorId !== subject)
    throw new TRPCError({ code: "FORBIDDEN", message: "A current independently verified session and the original native retest owner are required. Retained requests were not rebound." });
  return { id: ctx.user.id, subject };
}
function reviewedContext(input: RetestReviewedReadInput, scope: ManualRetestObservedScope, actor: { id: string; subject: string }, projection: "ACCESS" | "PREVIEW" | "LINKS") {
  if (scope.actorId !== actor.id || scope.clerkActorId !== actor.subject || scope.projectId !== input.request.projectId ||
    input.request.expectedScope && scope.organizationId !== input.request.expectedScope.organizationId)
    throw new TRPCError({ code: "FORBIDDEN", message: "The current original native retest reader could not be verified." });
  return { requestId: input.readRequestId, requested: retestReviewedReadKey(input), projection, scope };
}
async function reviewedCall<T>(run: () => Promise<T>): Promise<T> {
  try { return await run(); }
  catch (cause) {
    throw new TRPCError({ code: cause instanceof TRPCError ? cause.code : "INTERNAL_SERVER_ERROR", message: "The original retest evidence or request could not be verified. Keep any submitted exact UUID and recheck original access; no private error detail was published." });
  }
}

export const manualRetestRouter = router({
  // Additive reviewed transport. Legacy routes below deliberately keep their
  // old parser/hash/wire behavior; these routes are not a caller cutover.
  accessReviewed: protectedProcedure.input(retestAccessReviewedInput).output(retestAccessReviewedOutput).query(({ ctx, input }) => {
    const actor = verifiedRetestActor(ctx, input);
    return reviewedCall(() => ctx.prisma.$transaction(async tx => {
      const scope = await lockManualRetestAccess(tx, actor.id, input.request, false, actor.subject);
      return boundedRetestReviewedOutput(retestAccessReviewedOutput, { readContext: reviewedContext(input, scope, actor, "ACCESS"), basis: "CURRENT_PROJECT_MEMBER_ONLY", sourceRelationshipVerified: false }, 8192);
    }, { timeout: 20000, isolationLevel: "RepeatableRead" }));
  }),
  previewReviewed: protectedProcedure.input(retestPreviewReviewedInput).output(retestPreviewReviewedOutput).query(({ ctx, input }) => {
    const actor = verifiedRetestActor(ctx, input);
    return reviewedCall(() => ctx.prisma.$transaction(async tx => {
      const prepared = await prepareManualRetest(tx, actor.id, input.request, false, actor.subject);
      const { frozen: _frozen, ordered: _ordered, prerequisites: _prerequisites, ...preview } = prepared;
      if (!preview.scope || preview.requested !== manualRetestReadRequestKey(input.request) || preview.projectId !== input.request.projectId || preview.sourceRunId !== input.request.sourceRunId || preview.testCaseId !== input.request.testCaseId) throw Error("Unsupported retest echo");
      return boundedRetestReviewedOutput(retestPreviewReviewedOutput, { readContext: reviewedContext(input, preview.scope, actor, "PREVIEW"), basis: "LEGACY_BOUNDED_PREPARATION_V1", preview });
    }, { timeout: 20000, isolationLevel: "RepeatableRead" }));
  }),
  linksReviewed: protectedProcedure.input(retestLinksReviewedInput).output(retestLinksReviewedOutput).query(({ ctx, input }) => {
    const actor = verifiedRetestActor(ctx, input);
    return reviewedCall(async () => {
      const links = await listManualRetestLinks(ctx.prisma, actor.id, input.request, actor.subject);
      if (!links.scope || links.requested !== manualRetestReadRequestKey(input.request)) throw Error("Unsupported retest echo");
      return boundedRetestReviewedOutput(retestLinksReviewedOutput, { readContext: reviewedContext(input, links.scope, actor, "LINKS"), links }, 16384);
    });
  }),
  startReviewed: protectedProcedure.input(retestStartReviewedInput).output(retestStartReviewedOutput).mutation(({ ctx, input }) => {
    const actor = verifiedRetestActor(ctx, input);
    return reviewedCall(async () => {
      const ack = await startManualRetest(ctx.prisma, actor.id, input.request, actor.subject);
      const parsed = boundedRetestReviewedOutput(retestStartReviewedOutput, ack, 8192);
      const expectedRunId = `retest_${createHash("sha256").update(JSON.stringify([input.request.projectId, actor.id, input.request.idempotencyKey])).digest("hex")}`;
      if (parsed.scope.actorId !== actor.id || parsed.scope.clerkActorId !== actor.subject || parsed.scope.projectId !== input.request.projectId ||
        parsed.scope.organizationId !== input.request.expectedScope!.organizationId || parsed.scope.sourceRunId !== input.request.sourceRunId || parsed.scope.testCaseId !== input.request.testCaseId ||
        parsed.scope.idempotencyKey !== input.request.idempotencyKey || parsed.scope.reviewHash !== input.request.expectedReviewHash || parsed.testRunId !== expectedRunId) throw Error("Unsupported retest receipt");
      return parsed;
    });
  }),
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
