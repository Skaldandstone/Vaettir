import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { assessPopulation } from "../services/populationAssessment.js";
export const populationAssessmentRouter = router({
  current: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const where = { projectId: input.projectId };
      const [
        documents,
        requirements,
        testCases,
        approvedPlans,
        latestRun,
        releases,
      ] = await ctx.prisma.$transaction(
        [
          ctx.prisma.projectPopulationDocument.count({ where }),
          ctx.prisma.requirement.count({ where }),
          ctx.prisma.testCase.count({ where }),
          ctx.prisma.testPlan.count({
            where: { ...where, status: "APPROVED" },
          }),
          ctx.prisma.testRun.findFirst({
            where,
            orderBy: [{ startedAt: "desc" }, { id: "desc" }],
            select: {
              id: true,
              status: true,
              startedAt: true,
              finishedAt: true,
            },
          }),
          ctx.prisma.release.findMany({
            where,
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            take: 10,
            select: { id: true, name: true, status: true },
          }),
        ],
        { isolationLevel: "RepeatableRead" },
      );
      const observedAt = new Date();
      return {
        ...assessPopulation(
          {
            documents,
            requirements,
            testCases,
            approvedPlans,
            latestRun,
            releases,
          },
          observedAt,
        ),
        observedAt,
        documents,
        latestRun,
      };
    }),
});
