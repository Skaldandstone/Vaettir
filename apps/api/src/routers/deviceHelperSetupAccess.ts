import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../trpc.js";
import { readDeviceHelperSetupAccess } from "../services/deviceHelperSetupAccess.js";
import { deviceHelperSetupAccessInput, deviceHelperSetupAccessOutput } from "../services/deviceHelperSetupAccessSchema.js";

// CURRENT setup-only identity read. No legacy actor discovery/read namespace is
// used as transport proof, and API-key/native Clerk row fallback is refused.
export const deviceHelperSetupAccessRouter = router({
  establishCurrent: protectedProcedure.input(deviceHelperSetupAccessInput).output(deviceHelperSetupAccessOutput).query(({ ctx, input }) => {
    if (!ctx.authenticatedClerkSubject) throw new TRPCError({ code: "FORBIDDEN", message: "An independently verified current Clerk session is required for setup identity reads." });
    return readDeviceHelperSetupAccess(ctx.prisma, ctx.user.id, input, { authenticatedClerkSubject: ctx.authenticatedClerkSubject });
  }),
});
