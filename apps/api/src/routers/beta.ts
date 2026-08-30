import { z } from "zod";
import { router, protectedProcedure, staffProcedure, isStaffEmail } from "../trpc.js";
import { BETA_TEAM_LIMIT, enrollBetaOwner, normalizeBetaEmail, revokeBetaEnrollment } from "../services/privateBeta.js";

export const betaRouter = router({
  capabilities: protectedProcedure.query(({ ctx }) => ({ canManageSharedCatalog: isStaffEmail(ctx.user.email) })),
  eligibility: protectedProcedure.query(async ({ ctx }) => {
    const enrollment = await ctx.prisma.betaEnrollment.findUnique({ where: { email: normalizeBetaEmail(ctx.user.email) } });
    return { eligible: Boolean(enrollment && !enrollment.revokedAt && !enrollment.claimedAt) };
  }),
  list: staffProcedure.query(async ({ ctx }) => ({
    limit: BETA_TEAM_LIMIT,
    enrollments: await ctx.prisma.betaEnrollment.findMany({ orderBy: { createdAt: "desc" } }),
  })),
  enroll: staffProcedure.input(z.object({ email: z.string().email(), reason: z.string().trim().min(1).max(500) }))
    .mutation(({ ctx, input }) => enrollBetaOwner(ctx.prisma, input.email, ctx.user.id, input.reason)),
  revoke: staffProcedure.input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => revokeBetaEnrollment(ctx.prisma, input.id)),
});
