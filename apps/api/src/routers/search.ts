import { z } from "zod";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

// A first pass at P1-14: simple case-insensitive substring matching across
// the three things a QA person actually goes hunting for. Postgres
// full-text search (tsvector/ts_rank) is the obvious upgrade once result
// relevance matters more than "does it contain the string" -- not needed
// yet at this data scale.
const RESULT_LIMIT = 8;

export const searchRouter = router({
  search: protectedProcedure
    .input(z.object({ projectId: z.string(), query: z.string().min(1) }))
    .output(
      z.object({
        testCases: z.array(z.object({ id: z.string(), title: z.string(), testType: z.string() })),
        testPlans: z.array(z.object({ id: z.string(), name: z.string(), status: z.string() })),
        requirements: z.array(z.object({ id: z.string(), title: z.string(), description: z.string().nullable() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const q = input.query.trim();
      if (!q) return { testCases: [], testPlans: [], requirements: [] };

      const [testCases, testPlans, requirements] = await Promise.all([
        ctx.prisma.testCase.findMany({
          where: { projectId: input.projectId, title: { contains: q, mode: "insensitive" } },
          select: { id: true, title: true, testType: true },
          take: RESULT_LIMIT,
          orderBy: { updatedAt: "desc" },
        }),
        ctx.prisma.testPlan.findMany({
          where: { projectId: input.projectId, name: { contains: q, mode: "insensitive" } },
          select: { id: true, name: true, status: true },
          take: RESULT_LIMIT,
          orderBy: { updatedAt: "desc" },
        }),
        ctx.prisma.requirement.findMany({
          where: {
            projectId: input.projectId,
            OR: [{ title: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
          },
          select: { id: true, title: true, description: true },
          take: RESULT_LIMIT,
          orderBy: { createdAt: "desc" },
        }),
      ]);

      return { testCases, testPlans, requirements };
    }),
});
