import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { snapshotTestCaseVersion } from "../services/testCaseVersion.js";
import { inspectCsv, mapCsvRows, TARGET_FIELDS, type TargetField } from "../services/csvFieldMapping.js";

const fieldMappingSchema = z.record(z.enum(TARGET_FIELDS), z.string()).refine((m) => Boolean(m.title), {
  message: 'The "title" field must be mapped to a CSV column',
});

// P11-01/P11-02: the generic ImportJob pipeline. `previewCsv` never writes
// anything - it's pure inspection/mapping-preview, so the user can adjust
// column mapping before anything real happens. `commit` is the only
// mutation that actually creates TestCases, and only after receiving back
// the exact mapping the user reviewed in preview.
export const importJobsRouter = router({
  previewCsv: protectedProcedure
    .input(z.object({ projectId: z.string(), csvText: z.string().min(1) }))
    .output(
      z.object({
        headers: z.array(z.string()),
        suggestedMapping: z.record(z.string(), z.string()),
        rowCount: z.number(),
        previewRows: z.array(
          z.object({
            rowNumber: z.number(),
            title: z.string(),
            given: z.array(z.string()),
            when: z.array(z.string()),
            then: z.array(z.string()),
            priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
            tags: z.array(z.string()),
          }),
        ),
        previewSkipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const { headers, suggestedMapping, rowCount } = inspectCsv(input.csvText);

      let previewRows: ReturnType<typeof mapCsvRows>["rows"] = [];
      let previewSkipped: ReturnType<typeof mapCsvRows>["skipped"] = [];
      if (suggestedMapping.title) {
        const preview = mapCsvRows(input.csvText, suggestedMapping, 10);
        previewRows = preview.rows;
        previewSkipped = preview.skipped;
      }

      return { headers, suggestedMapping, rowCount, previewRows, previewSkipped };
    }),

  // Re-runs mapCsvRows with a user-adjusted mapping, still preview-only
  // (no ImportJob, no TestCases) - called every time the user changes a
  // dropdown in the mapping UI so they see the real effect before committing.
  previewWithMapping: protectedProcedure
    .input(z.object({ projectId: z.string(), csvText: z.string().min(1), mapping: fieldMappingSchema }))
    .output(
      z.object({
        previewRows: z.array(
          z.object({
            rowNumber: z.number(),
            title: z.string(),
            given: z.array(z.string()),
            when: z.array(z.string()),
            then: z.array(z.string()),
            priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
            tags: z.array(z.string()),
          }),
        ),
        previewSkipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      try {
        const { rows, skipped } = mapCsvRows(input.csvText, input.mapping, 10);
        return { previewRows: rows, previewSkipped: skipped };
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
    }),

  commitCsv: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        csvText: z.string().min(1),
        mapping: fieldMappingSchema,
        testPlanId: z.string().optional(),
        sourceLabel: z.string().optional(),
      }),
    )
    .output(
      z.object({
        importJobId: z.string(),
        createdCount: z.number(),
        skipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");

      let mapped;
      try {
        mapped = mapCsvRows(input.csvText, input.mapping);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }

      const created = await ctx.prisma.$transaction(
        mapped.rows.map((r) =>
          ctx.prisma.testCase.create({
            data: {
              projectId: input.projectId,
              testPlanId: input.testPlanId,
              title: r.title,
              given: r.given,
              when: r.when,
              then: r.then,
              tags: r.tags,
              testType: "FUNCTIONAL",
              priority: r.priority,
              origin: "IMPORTED",
              createdById: ctx.user.id,
              updatedById: ctx.user.id,
            },
          }),
        ),
      );

      await Promise.all(
        created.map((c) =>
          snapshotTestCaseVersion(ctx.prisma, {
            testCaseId: c.id,
            title: c.title,
            background: null,
            given: c.given,
            when: c.when,
            then: c.then,
            steps: [],
            tags: c.tags,
            priority: c.priority,
            testType: c.testType,
            actorId: ctx.user.id,
          }),
        ),
      );

      const importJob = await ctx.prisma.importJob.create({
        data: {
          projectId: input.projectId,
          source: "CSV",
          sourceLabel: input.sourceLabel,
          fieldMapping: input.mapping,
          testPlanId: input.testPlanId,
          status: mapped.skipped.length > 0 && created.length === 0 ? "FAILED" : "SUCCEEDED",
          createdCount: created.length,
          skippedCount: mapped.skipped.length,
          errors: mapped.skipped,
          createdById: ctx.user.id,
          completedAt: new Date(),
        },
      });

      if (created.length > 0) {
        await recordAudit(ctx.prisma, {
          organizationId: project.organizationId,
          projectId: input.projectId,
          actorId: ctx.user.id,
          entityType: "TestCase",
          entityId: created[0]!.id,
          action: "CREATE",
          summary: `Imported ${created.length} test case(s) from ${input.sourceLabel ?? "CSV"} (job ${importJob.id})`,
        });
      }

      return { importJobId: importJob.id, createdCount: created.length, skipped: mapped.skipped };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          source: z.string(),
          sourceLabel: z.string().nullable(),
          status: z.string(),
          createdCount: z.number(),
          skippedCount: z.number(),
          createdAt: z.date(),
          createdByName: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const jobs = await ctx.prisma.importJob.findMany({
        where: { projectId: input.projectId },
        include: { createdBy: { select: { name: true, email: true } } },
        orderBy: { createdAt: "desc" },
      });
      return jobs.map((j) => ({
        id: j.id,
        source: j.source,
        sourceLabel: j.sourceLabel,
        status: j.status,
        createdCount: j.createdCount,
        skippedCount: j.skippedCount,
        createdAt: j.createdAt,
        createdByName: j.createdBy?.name ?? j.createdBy?.email ?? null,
      }));
    }),
});

export type { TargetField };
