import { z } from "zod";
import { router, publicProcedure } from "../trpc.js";

export const testCasesRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ ctx, input }) =>
      ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId },
        include: { source: true, testPlan: true },
        orderBy: { updatedAt: "desc" },
      }),
    ),

  // .output() bounds the inferred type to this schema instead of Prisma's
  // deeply-nested `include` payload type, which otherwise blows past tsc's
  // structural inference limit (TS2589) for consumers of the AppRouter type.
  byId: publicProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        title: z.string(),
        background: z.string().nullable(),
        given: z.array(z.string()),
        when: z.array(z.string()),
        then: z.array(z.string()),
        tags: z.array(z.string()),
        testType: z.string(),
        priority: z.string(),
        origin: z.string(),
        confidence: z.number().nullable(),
        source: z
          .object({
            filePath: z.string(),
            functionName: z.string().nullable(),
            framework: z.string(),
          })
          .nullable(),
      }),
    )
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.id },
        include: { source: true },
      });
      return {
        id: tc.id,
        title: tc.title,
        background: tc.background,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        tags: tc.tags,
        testType: tc.testType,
        priority: tc.priority,
        origin: tc.origin,
        confidence: tc.confidence,
        source: tc.source
          ? { filePath: tc.source.filePath, functionName: tc.source.functionName, framework: tc.source.framework }
          : null,
      };
    }),

  create: publicProcedure
    .input(
      z.object({
        projectId: z.string(),
        testPlanId: z.string().optional(),
        title: z.string(),
        background: z.string().optional(),
        given: z.array(z.string()).min(1),
        when: z.array(z.string()).min(1),
        then: z.array(z.string()).min(1),
        tags: z.array(z.string()).default([]),
        testType: z.string(),
        priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
      }),
    )
    .mutation(({ ctx, input }) =>
      ctx.prisma.testCase.create({
        data: {
          projectId: input.projectId,
          testPlanId: input.testPlanId,
          title: input.title,
          background: input.background,
          given: input.given,
          when: input.when,
          then: input.then,
          tags: input.tags,
          testType: input.testType as never,
          priority: input.priority,
        },
      }),
    ),
});
