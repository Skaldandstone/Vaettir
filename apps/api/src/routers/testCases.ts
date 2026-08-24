import { z } from "zod";
import { TestCaseStepInputSchema, resolveStepFieldLabels, type StepFieldKey } from "@tci/core";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

const stepOutputSchema = z.object({
  order: z.number(),
  action: z.string(),
  expectedActionOrData: z.string().nullable(),
  expectedResult: z.string().nullable(),
  expectedResponse: z.string().nullable(),
});

export const testCasesRouter = router({
  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.testCase.findMany({
        where: { projectId: input.projectId },
        include: { source: true, testPlan: true },
        orderBy: { updatedAt: "desc" },
      });
    }),

  // .output() bounds the inferred type to this schema instead of Prisma's
  // deeply-nested `include` payload type, which otherwise blows past tsc's
  // structural inference limit (TS2589) for consumers of the AppRouter type.
  byId: protectedProcedure
    .input(z.object({ id: z.string() }))
    .output(
      z.object({
        id: z.string(),
        title: z.string(),
        background: z.string().nullable(),
        given: z.array(z.string()),
        when: z.array(z.string()),
        then: z.array(z.string()),
        steps: z.array(stepOutputSchema),
        stepFieldLabels: z.record(z.string()),
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
        include: {
          source: true,
          steps: { orderBy: { order: "asc" } },
          project: { include: { organization: { select: { stepFieldLabels: true } } } },
        },
      });
      await requireProjectAccess(ctx, tc.projectId);
      return {
        id: tc.id,
        title: tc.title,
        background: tc.background,
        given: tc.given,
        when: tc.when,
        then: tc.then,
        steps: tc.steps.map((s) => ({
          order: s.order,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData,
          expectedResult: s.expectedResult,
          expectedResponse: s.expectedResponse,
        })),
        stepFieldLabels: resolveStepFieldLabels(
          tc.project.organization.stepFieldLabels as Partial<Record<StepFieldKey, string>> | null,
        ),
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

  // Test cases can be authored two ways -- BDD (given/when/then) and/or the
  // structured step table (steps) -- and a case may carry either, both, or
  // (per the AI reverse-engineering path) just BDD. At least one is
  // required; an empty test case isn't a valid one.
  create: protectedProcedure
    .input(
      z
        .object({
          projectId: z.string(),
          testPlanId: z.string().optional(),
          title: z.string(),
          background: z.string().optional(),
          given: z.array(z.string()).default([]),
          when: z.array(z.string()).default([]),
          then: z.array(z.string()).default([]),
          steps: z.array(TestCaseStepInputSchema).default([]),
          tags: z.array(z.string()).default([]),
          testType: z.string(),
          priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]).default("MEDIUM"),
        })
        .refine((v) => (v.given.length > 0 && v.when.length > 0 && v.then.length > 0) || v.steps.length > 0, {
          message: "Provide either given/when/then or at least one structured step",
        }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return ctx.prisma.testCase.create({
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
          steps: {
            create: input.steps.map((s, i) => ({
              order: i,
              action: s.action,
              expectedActionOrData: s.expectedActionOrData ?? undefined,
              expectedResult: s.expectedResult ?? undefined,
              expectedResponse: s.expectedResponse ?? undefined,
            })),
          },
        },
      });
    }),
});
