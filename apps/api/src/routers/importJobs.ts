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
            externalId: z.string().optional(),
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
            externalId: z.string().optional(),
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
        updatedCount: z.number(),
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

      // P11-11: when the mapping includes an external-id column, re-running
      // this same import (e.g. a re-exported spreadsheet during a phased
      // migration) updates the matching TestCase in place instead of
      // duplicating it - the same update-vs-create split
      // reverseEngineerPersist.ts already uses for a re-scanned source
      // file, just keyed by a CSV row id instead of a file/function name.
      // Keys are namespaced per-project (TestCaseSource.externalTestId is
      // globally unique, but a spreadsheet's own row ids like "TC-001" are
      // only ever meant to be unique within one project's own source file).
      const keyFor = (raw: string) => `csv:${input.projectId}:${raw}`;
      const rowsWithExternalId = mapped.rows.filter((r): r is typeof r & { externalId: string } => Boolean(r.externalId));
      const existingSources =
        rowsWithExternalId.length > 0
          ? await ctx.prisma.testCaseSource.findMany({
              where: { externalTestId: { in: rowsWithExternalId.map((r) => keyFor(r.externalId)) } },
            })
          : [];
      const sourceByKey = new Map(existingSources.map((s) => [s.externalTestId!, s]));

      const updateRowNumbers = new Set(
        rowsWithExternalId.filter((r) => sourceByKey.has(keyFor(r.externalId))).map((r) => r.rowNumber),
      );
      const toUpdate = mapped.rows.filter((r) => updateRowNumbers.has(r.rowNumber));
      const toCreate = mapped.rows.filter((r) => !updateRowNumbers.has(r.rowNumber));

      const updated = await ctx.prisma.$transaction(
        toUpdate.map((r) => {
          const source = sourceByKey.get(keyFor(r.externalId!))!;
          return ctx.prisma.testCase.update({
            where: { id: source.testCaseId },
            data: {
              title: r.title,
              given: r.given,
              when: r.when,
              then: r.then,
              tags: r.tags,
              priority: r.priority,
              updatedById: ctx.user.id,
              source: { update: { lastSyncedAt: new Date() } },
            },
          });
        }),
      );

      const created = await ctx.prisma.$transaction(
        toCreate.map((r) =>
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
              ...(r.externalId
                ? {
                    source: {
                      create: {
                        filePath: input.sourceLabel ?? "csv-import",
                        framework: "csv",
                        frameworkFamily: "CUSTOM",
                        externalTestId: keyFor(r.externalId),
                        lastSyncedAt: new Date(),
                      },
                    },
                  }
                : {}),
            },
          }),
        ),
      );

      await Promise.all(
        [...created, ...updated].map((c) =>
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
          status: mapped.skipped.length > 0 && created.length === 0 && updated.length === 0 ? "FAILED" : "SUCCEEDED",
          createdCount: created.length,
          updatedCount: updated.length,
          skippedCount: mapped.skipped.length,
          errors: mapped.skipped,
          createdById: ctx.user.id,
          completedAt: new Date(),
        },
      });

      if (created.length + updated.length > 0) {
        const first = created[0] ?? updated[0]!;
        await recordAudit(ctx.prisma, {
          organizationId: project.organizationId,
          projectId: input.projectId,
          actorId: ctx.user.id,
          entityType: "TestCase",
          entityId: first.id,
          action: created.length > 0 ? "CREATE" : "UPDATE",
          summary: `Imported ${created.length} new and updated ${updated.length} existing test case(s) from ${input.sourceLabel ?? "CSV"} (job ${importJob.id})`,
        });
      }

      return { importJobId: importJob.id, createdCount: created.length, updatedCount: updated.length, skipped: mapped.skipped };
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
          updatedCount: z.number(),
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
        updatedCount: j.updatedCount,
        skippedCount: j.skippedCount,
        createdAt: j.createdAt,
        createdByName: j.createdBy?.name ?? j.createdBy?.email ?? null,
      }));
    }),
});

export type { TargetField };
