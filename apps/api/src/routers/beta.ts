import { z } from "zod";
import { router, protectedProcedure, staffProcedure, staffTokenProcedure, isStaffEmail } from "../trpc.js";
import { TRPCError } from "@trpc/server";
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
  enrollFromStudio: staffTokenProcedure.input(z.object({
    email: z.string().email(),
    requestId: z.string().uuid(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const enrollment = await enrollBetaOwner(
      ctx.prisma,
      input.email,
      `studio:${ctx.staff.actor}`,
      `Studio access request ${input.requestId}`,
    );
    return {
      id: enrollment.id,
      email: enrollment.email,
      createdAt: enrollment.createdAt,
      claimedAt: enrollment.claimedAt,
    };
  }),
  revokeFromStudio: staffTokenProcedure.input(z.object({
    enrollmentId: z.string().min(1).max(100),
    requestId: z.string().uuid(),
  }).strict()).mutation(async ({ ctx, input }) => {
    const enrollment = await ctx.prisma.betaEnrollment.findUnique({ where: { id: input.enrollmentId } });
    if (!enrollment
      || !enrollment.createdBy.startsWith("studio:")
      || enrollment.reason !== `Studio access request ${input.requestId}`) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Studio enrollment not found" });
    }
    const revoked = await revokeBetaEnrollment(ctx.prisma, input.enrollmentId);
    return { id: revoked.id, revokedAt: revoked.revokedAt };
  }),
  revoke: staffProcedure.input(z.object({ id: z.string() }))
    .mutation(({ ctx, input }) => revokeBetaEnrollment(ctx.prisma, input.id)),
});
