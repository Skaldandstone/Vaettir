import { TRPCError } from "@trpc/server";
import { createHash } from "node:crypto";
import { router, protectedProcedure, type Context } from "../trpc.js";
import {
  manualRunStartReviewedAccessInput,
  manualRunStartReviewedAccessOutput,
  manualRunStartReviewedPreviewInput,
  manualRunStartReviewedPreviewOutput,
  manualRunStartReviewedAuthenticatedSubject,
} from "../services/manualRunStartReviewedWireSchema.js";
import {
  readManualRunStartReviewedAccess,
  readManualRunStartReviewedPreview,
} from "../services/manualRunStartReviewedRead.js";
import { startManualRun } from "../services/manualRunStart.js";
import {
  manualRunStartReviewedStartInput,
  manualRunStartReviewedRecoveryInput,
  manualRunStartReviewedAckSchema,
  freezeReviewedStartEnvelope,
  inspectReviewedStartWire,
  type ManualRunStartReviewedWriteInput,
} from "../services/manualRunStartReviewedWriteSchema.js";
function subject(ctx: Context) {
  const authenticated = manualRunStartReviewedAuthenticatedSubject.safeParse(
    ctx.authenticatedClerkSubject,
  );
  if (!authenticated.success)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "An independently authenticated human session is required for reviewed run-start metadata.",
    });
  return { clerkActorId: authenticated.data };
}
async function write(
  ctx: Context & { user: NonNullable<Context["user"]> },
  input: ManualRunStartReviewedWriteInput,
) {
  const authorized = subject(ctx);
  if (
    ctx.user.id !== input.expectedNativeActorId ||
    authorized.clerkActorId !== input.expectedClerkActorId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "The original independently signed-in native author is required. This retained request was not rebound.",
    });
  const frozen = freezeReviewedStartEnvelope(input);
  // Pin context scalars without impersonating the native user's cached Clerk
  // mapping. The writer checks the independent subject/native/org in EVERY
  // held-lock transaction, including prior receipt and P2002 recovery.
  const nativeUser = Object.freeze({ ...ctx.user });
  const nativeContext = { ...ctx, user: nativeUser };
  let result: Awaited<ReturnType<typeof startManualRun>>;
  try {
    result = await startManualRun(nativeContext, frozen.request, {
      mode: frozen.mode === "START" ? "REVIEWED_START" : "LEGACY_RECOVERY",
      projectId: frozen.projectId,
      originalOrganizationId: frozen.originalOrganizationId,
      expectedClerkActorId: frozen.expectedClerkActorId,
      expectedNativeActorId: frozen.expectedNativeActorId,
      authenticatedClerkSubject: authorized.clerkActorId,
    });
  } catch (cause) {
    if (
      cause instanceof TRPCError &&
      [
        "BAD_REQUEST",
        "CONFLICT",
        "FORBIDDEN",
        "UNAUTHORIZED",
        "NOT_FOUND",
        "PRECONDITION_FAILED",
      ].includes(cause.code)
    )
      throw new TRPCError({
        code: cause.code,
        message:
          "The retained run-start request could not be admitted under current native access or metadata. Keep its exact body/key; any earlier unknown response remains unknown.",
      });
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The run-start response could not be confirmed. Retain the exact original body/key; acceptance remains unknown.",
    });
  }
  let supportedAck = false;
  try {
    const bounded = inspectReviewedStartWire(result);
    supportedAck = bounded.bytes <= 8192 && bounded.nodes <= 128;
  } catch {
    /* Never invoke a private ACK getter or publish its cause. */
  }
  const parsed = supportedAck
    ? manualRunStartReviewedAckSchema.shape.legacyAck.safeParse(result)
    : { success: false as const };
  const expectedId = `manual_${createHash("sha256")
    .update(
      JSON.stringify([
        frozen.projectId,
        frozen.expectedNativeActorId,
        frozen.request.idempotencyKey,
      ]),
    )
    .digest("hex")}`;
  if (
    !parsed.success ||
    parsed.data.testRunId !== expectedId ||
    (frozen.request.originalOrganizationId !== undefined &&
      (parsed.data.originalOrganizationId !==
        frozen.request.originalOrganizationId ||
        parsed.data.expectedClerkActorId !==
          frozen.request.expectedClerkActorId ||
        parsed.data.idempotencyKey !== frozen.request.idempotencyKey)) ||
    (frozen.request.originalOrganizationId === undefined &&
      (Object.hasOwn(parsed.data, "originalOrganizationId") ||
        Object.hasOwn(parsed.data, "expectedClerkActorId") ||
        Object.hasOwn(parsed.data, "idempotencyKey")))
  )
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message:
        "The run-start acknowledgement could not confirm this exact original request. Retain the identical request/key; acceptance remains unknown.",
    });
  return {
    mode: frozen.mode,
    currentScope: {
      projectId: frozen.projectId,
      organizationId: frozen.originalOrganizationId,
      actorId: frozen.expectedNativeActorId,
      actorClerkUserId: authorized.clerkActorId,
    },
    idempotencyKey: frozen.request.idempotencyKey!,
    legacyAck: result,
    historicalOuterProvenance: "UNRECORDED" as const,
    interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS" as const,
  };
}
// Additive reviewed endpoints; existing read contracts and old routes unchanged.
export const manualRunStartReviewedRouter = router({
  access: protectedProcedure
    .input(manualRunStartReviewedAccessInput)
    .output(manualRunStartReviewedAccessOutput)
    .query(({ ctx, input }) =>
      readManualRunStartReviewedAccess(
        ctx.prisma,
        ctx.user.id,
        input,
        subject(ctx),
      ),
    ),
  preview: protectedProcedure
    .input(manualRunStartReviewedPreviewInput)
    .output(manualRunStartReviewedPreviewOutput)
    .query(({ ctx, input }) =>
      readManualRunStartReviewedPreview(
        ctx.prisma,
        ctx.user.id,
        input,
        subject(ctx),
      ),
    ),
  start: protectedProcedure
    .input(manualRunStartReviewedStartInput)
    .output(manualRunStartReviewedAckSchema)
    .mutation(({ ctx, input }) => write(ctx, input)),
  recoverLegacy: protectedProcedure
    .input(manualRunStartReviewedRecoveryInput)
    .output(manualRunStartReviewedAckSchema)
    .mutation(({ ctx, input }) => write(ctx, input)),
});
