import { TRPCError } from "@trpc/server";
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
// Additive access/preview only. No start mutation or central mount in phase A.
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
});
