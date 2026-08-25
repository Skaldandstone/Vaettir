import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

// Deliberately minimal -- just enough to give a RiskFlag somewhere to
// attach to (see riskAnalysis.recommendForChange). Full release management
// (readiness scoring, gating, dashboard) is its own larger scope, tracked
// separately.
export const releasesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(z.array(z.object({ id: z.string(), name: z.string(), status: z.string(), targetDate: z.date().nullable() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.release.findMany({
        where: { projectId: input.projectId },
        orderBy: { createdAt: "desc" },
      });
    }),

  create: protectedProcedure
    .input(z.object({ projectId: z.string(), name: z.string().min(1), targetDate: z.date().optional() }))
    .output(z.object({ id: z.string(), name: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.release.create({
        data: { projectId: input.projectId, name: input.name, targetDate: input.targetDate },
        select: { id: true, name: true },
      });
    }),

  listRiskFlags: protectedProcedure
    .input(z.object({ releaseId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          severity: z.string(),
          source: z.string(),
          description: z.string(),
          relatedFilePath: z.string().nullable(),
          relatedPrUrl: z.string().nullable(),
          createdAt: z.date(),
          resolvedAt: z.date().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const release = await ctx.prisma.release.findUniqueOrThrow({ where: { id: input.releaseId } });
      await requireProjectAccess(ctx, release.projectId);
      return ctx.prisma.riskFlag.findMany({
        where: { releaseId: input.releaseId },
        orderBy: [{ resolvedAt: "asc" }, { createdAt: "desc" }],
      });
    }),
});
