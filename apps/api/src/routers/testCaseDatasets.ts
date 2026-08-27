import { z } from "zod";
import { substituteDatasetPlaceholders } from "@vaettir/core";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";

const rowSchema = z.object({ name: z.string().min(1), values: z.record(z.string()) });

// 2026-08-27 competitor parity audit: one dataset per case (see the
// schema comment on TestCaseDataset) - fetching/saving is always "the
// whole set," matching how the web form edits it.
export const testCaseDatasetsRouter = router({
  get: protectedProcedure
    .input(z.object({ testCaseId: z.string() }))
    .output(
      z
        .object({
          parameterNames: z.array(z.string()),
          rows: z.array(rowSchema),
        })
        .nullable(),
    )
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, tc.projectId);
      const dataset = await ctx.prisma.testCaseDataset.findUnique({ where: { testCaseId: input.testCaseId } });
      if (!dataset) return null;
      return { parameterNames: dataset.parameterNames, rows: dataset.rows as never };
    }),

  // Upsert-the-whole-set, same shape as sharedStepGroups' create/update -
  // the form always submits the complete parameter list + every row.
  save: protectedProcedure
    .input(z.object({ testCaseId: z.string(), parameterNames: z.array(z.string().min(1)).min(1), rows: z.array(rowSchema).min(1) }))
    .mutation(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, tc.projectId, "EDITOR");
      await ctx.prisma.testCaseDataset.upsert({
        where: { testCaseId: input.testCaseId },
        create: { testCaseId: input.testCaseId, parameterNames: input.parameterNames, rows: input.rows as never },
        update: { parameterNames: input.parameterNames, rows: input.rows as never },
      });
      return { saved: true };
    }),

  delete: protectedProcedure.input(z.object({ testCaseId: z.string() })).mutation(async ({ ctx, input }) => {
    const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
    await requireProjectAccess(ctx, tc.projectId, "EDITOR");
    await ctx.prisma.testCaseDataset.deleteMany({ where: { testCaseId: input.testCaseId } });
    return { deleted: true };
  }),

  // Pre-rendered preview: each row's actual concrete steps, with every
  // <placeholder> substituted - what a tester would follow if executing
  // that specific row. Real substitution logic, not a display-only
  // approximation, since this reuses the same helper a future manual-
  // execution-per-row flow would need.
  expandedPreview: protectedProcedure
    .input(z.object({ testCaseId: z.string() }))
    .output(
      z.array(
        z.object({
          rowName: z.string(),
          given: z.array(z.string()),
          when: z.array(z.string()),
          then: z.array(z.string()),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.testCaseId },
        select: { projectId: true, given: true, when: true, then: true },
      });
      await requireProjectAccess(ctx, tc.projectId);
      const dataset = await ctx.prisma.testCaseDataset.findUnique({ where: { testCaseId: input.testCaseId } });
      if (!dataset) return [];
      const rows = dataset.rows as Array<{ name: string; values: Record<string, string> }>;
      return rows.map((row) => ({
        rowName: row.name,
        given: tc.given.map((s) => substituteDatasetPlaceholders(s, row.values)),
        when: tc.when.map((s) => substituteDatasetPlaceholders(s, row.values)),
        then: tc.then.map((s) => substituteDatasetPlaceholders(s, row.values)),
      }));
    }),
});
