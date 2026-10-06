import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../trpc.js";
import { readDeviceCaptureAccess } from "../services/deviceCaptureAccess.js";
import { deviceCaptureAccessInput, deviceCaptureAccessOutput } from "../services/deviceCaptureAccessSchema.js";

// Standalone, intentionally UNMOUNTED until original-scope consent and actual
// caller are reviewed. API-key/native row Clerk metadata is not JWT provenance.
export const deviceCaptureAccessRouter = router({
  read: protectedProcedure.input(deviceCaptureAccessInput).output(deviceCaptureAccessOutput).query(({ ctx, input }) => {
    if (!ctx.authenticatedClerkSubject) throw new TRPCError({ code: "FORBIDDEN", message: "An independently verified original Clerk session is required for capture access reads." });
    return readDeviceCaptureAccess(ctx.prisma, ctx.user.id, input, { authenticatedClerkSubject: ctx.authenticatedClerkSubject });
  }),
});
