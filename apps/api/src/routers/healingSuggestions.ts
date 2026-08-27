import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { classifyAndSuggestHealing } from "../services/healingSuggestion.js";
import { InsufficientAiCreditsError } from "../services/aiCredits.js";

const suggestionOutput = z.object({
  id: z.string(),
  testResultId: z.string(),
  testCaseId: z.string(),
  classification: z.string(),
  classificationRationale: z.string(),
  suggestedDiff: z.string().nullable(),
  suggestionRationale: z.string().nullable(),
  status: z.string(),
  reviewedAt: z.date().nullable(),
  resolvedAt: z.date().nullable(),
  createdAt: z.date(),
});

// P6.5: suggest-only test self-healing. Every mutation here either reads,
// classifies, or records a human's review decision -- none of them touch
// the connected repo. See ROADMAP.md's Phase 6.5 intro for why that's a
// deliberate, permanent boundary, not a v1 limitation.
export const healingSuggestionsRouter = router({
  // P6.5-01/02: classify (and possibly propose a fix for) one failing
  // result, on demand from the Test Runs UI. Idempotent -- calling this
  // again on an already-classified result just returns the existing row
  // rather than spending more AI credits re-classifying it.
  classify: protectedProcedure
    .input(z.object({ testResultId: z.string() }))
    .output(z.union([z.object({ ok: z.literal(true), suggestion: suggestionOutput }), z.object({ ok: z.literal(false), reason: z.string() })]))
    .mutation(async ({ ctx, input }) => {
      const result = await ctx.prisma.testResult.findUniqueOrThrow({
        where: { id: input.testResultId },
        include: { testCase: { select: { projectId: true } } },
      });
      const projectId = result.testCase?.projectId;
      if (!projectId) {
        return { ok: false, reason: "This result isn't linked to a tracked test case yet" };
      }
      await requireProjectAccess(ctx, projectId, "EDITOR");

      try {
        return await classifyAndSuggestHealing(ctx.prisma, input.testResultId);
      } catch (e) {
        if (e instanceof InsufficientAiCreditsError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: e.message });
        }
        throw e;
      }
    }),

  byTestResult: protectedProcedure
    .input(z.object({ testResultId: z.string() }))
    .output(suggestionOutput.nullable())
    .query(async ({ ctx, input }) => {
      const suggestion = await ctx.prisma.healingSuggestion.findUnique({
        where: { testResultId: input.testResultId },
        include: { testCase: { select: { projectId: true } } },
      });
      if (!suggestion) return null;
      await requireProjectAccess(ctx, suggestion.testCase.projectId);
      return suggestion;
    }),

  // P6.5-03: approve/reject records the review decision. Approving does
  // NOT touch the repo -- the suggested diff is already visible in the UI
  // for the developer to copy/apply themselves; this just marks it
  // reviewed so it stops showing as needing attention.
  review: protectedProcedure
    .input(z.object({ id: z.string(), status: z.enum(["APPROVED", "REJECTED"]) }))
    .output(suggestionOutput)
    .mutation(async ({ ctx, input }) => {
      const suggestion = await ctx.prisma.healingSuggestion.findUniqueOrThrow({
        where: { id: input.id },
        include: { project: { select: { id: true } } },
      });
      await requireProjectAccess(ctx, suggestion.project.id, "EDITOR");
      return ctx.prisma.healingSuggestion.update({
        where: { id: input.id },
        data: { status: input.status, reviewedById: ctx.user.id, reviewedAt: new Date() },
      });
    }),

  // P6.5-05: aggregate brittle-vs-real signal, plus a per-test-case
  // breakdown -- a test that keeps generating BRITTLE suggestions is
  // itself the problem (e.g. a hardcoded selector that should be a
  // data-testid), not the app.
  aggregateSignal: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.object({
        totalCount: z.number(),
        brittleCount: z.number(),
        realRegressionCount: z.number(),
        uncertainCount: z.number(),
        resolvedCount: z.number(),
        repeatOffenders: z.array(
          z.object({ testCaseId: z.string(), testCaseTitle: z.string(), brittleCount: z.number() }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const all = await ctx.prisma.healingSuggestion.findMany({
        where: { projectId: input.projectId },
        include: { testCase: { select: { id: true, title: true } } },
      });

      const brittleByCase = new Map<string, { title: string; count: number }>();
      for (const s of all) {
        if (s.classification !== "BRITTLE") continue;
        const entry = brittleByCase.get(s.testCaseId) ?? { title: s.testCase.title, count: 0 };
        entry.count++;
        brittleByCase.set(s.testCaseId, entry);
      }

      return {
        totalCount: all.length,
        brittleCount: all.filter((s) => s.classification === "BRITTLE").length,
        realRegressionCount: all.filter((s) => s.classification === "REAL_REGRESSION").length,
        uncertainCount: all.filter((s) => s.classification === "UNCERTAIN").length,
        resolvedCount: all.filter((s) => s.resolvedAt !== null).length,
        repeatOffenders: [...brittleByCase.entries()]
          .filter(([, v]) => v.count >= 2)
          .sort((a, b) => b[1].count - a[1].count)
          .map(([testCaseId, v]) => ({ testCaseId, testCaseTitle: v.title, brittleCount: v.count })),
      };
    }),
});
