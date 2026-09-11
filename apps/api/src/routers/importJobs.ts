import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { inspectCsv, mapCsvRows, TARGET_FIELDS, type TargetField } from "../services/csvFieldMapping.js";
import { commitImportedTestCases } from "../services/importCommit.js";
import { parseXrayExport } from "../services/xrayImport.js";
import { parseTestRailXml } from "../services/testrailImport.js";

const fieldMappingSchema = z.record(z.enum(TARGET_FIELDS), z.string()).refine((m) => Boolean(m.title), {
  message: 'The "title" field must be mapped to a CSV column',
});

// P11-01/P11-02: the generic ImportJob pipeline. `previewCsv` never writes
// anything - it's pure inspection/mapping-preview, so the user can adjust
// column mapping before anything real happens. `commit` is the only
// mutation that actually creates TestCases, and only after receiving back
// the exact mapping the user reviewed in preview.
const filePreviewRow = z.object({
  rowNumber: z.number(),
  key: z.string(),
  title: z.string(),
  testType: z.string(),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  tags: z.array(z.string()),
  suitePath: z.string().nullable(),
  given: z.array(z.string()),
  when: z.array(z.string()),
  then: z.array(z.string()),
  stepCount: z.number(),
});

function toFilePreviewRow(c: ReturnType<typeof parseXrayExport>["cases"][number]): z.infer<typeof filePreviewRow> {
  return {
    rowNumber: c.rowNumber,
    key: c.key,
    title: c.title,
    testType: c.testType,
    priority: c.priority,
    tags: c.tags,
    suitePath: c.suitePath,
    given: c.given,
    when: c.when,
    then: c.then,
    stepCount: c.steps.length,
  };
}

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
      // duplicating it - see commitImportedTestCases (shared with the Xray
      // importer since P11-05) for the create-vs-update split.
      return commitImportedTestCases(ctx.prisma, {
        projectId: input.projectId,
        organizationId: project.organizationId,
        actorId: ctx.user.id,
        rows: mapped.rows,
        skipped: mapped.skipped,
        source: "CSV",
        sourceLabel: input.sourceLabel,
        fieldMapping: input.mapping,
        keyPrefix: "csv",
        framework: "csv",
        testPlanId: input.testPlanId,
      });
    }),

  // P11-05: Xray (Jira) - a Jira CSV issue export of Test issues or Xray's
  // JSON test export, pasted/uploaded as a file. No column mapping step:
  // the columns are Xray's own, so the preview shows exactly what commit
  // will write and the user's only choices are "which plan" and "go".
  previewXray: protectedProcedure
    .input(z.object({ projectId: z.string(), content: z.string().min(1) }))
    .output(
      z.object({
        format: z.enum(["jira-csv", "xray-json"]),
        caseCount: z.number(),
        previewRows: z.array(filePreviewRow),
        skipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      let parsed;
      try {
        parsed = parseXrayExport(input.content);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
      return {
        format: parsed.format,
        caseCount: parsed.cases.length,
        previewRows: parsed.cases.slice(0, 20).map(toFilePreviewRow),
        skipped: parsed.skipped,
      };
    }),

  commitXray: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        content: z.string().min(1),
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
      let parsed;
      try {
        parsed = parseXrayExport(input.content);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
      return commitImportedTestCases(ctx.prisma, {
        projectId: input.projectId,
        organizationId: project.organizationId,
        actorId: ctx.user.id,
        rows: parsed.cases.map((c) => ({
          rowNumber: c.rowNumber,
          title: c.title,
          background: c.background,
          given: c.given,
          when: c.when,
          then: c.then,
          priority: c.priority,
          tags: c.tags,
          suitePath: c.suitePath,
          externalId: c.key,
          steps: c.steps,
        })),
        skipped: parsed.skipped,
        source: "XRAY",
        sourceLabel: input.sourceLabel,
        fieldMapping: { format: parsed.format },
        keyPrefix: "xray",
        framework: "xray",
        testPlanId: input.testPlanId,
      });
    }),

  // P11-03 (file-based slice): TestRail's "Export to XML" of a suite -
  // sections become the suite path, separated steps become structured
  // steps, text-template steps split per numbered line, exploratory
  // sessions map mission/goals. Same no-mapping preview → commit shape as
  // Xray. Runs/results are the REST-API half of the ticket, still open.
  previewTestRail: protectedProcedure
    .input(z.object({ projectId: z.string(), content: z.string().min(1) }))
    .output(
      z.object({
        format: z.literal("testrail-xml"),
        suiteName: z.string().nullable(),
        caseCount: z.number(),
        previewRows: z.array(filePreviewRow),
        skipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      let parsed;
      try {
        parsed = parseTestRailXml(input.content);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
      return {
        format: parsed.format,
        suiteName: parsed.suiteName,
        caseCount: parsed.cases.length,
        previewRows: parsed.cases.slice(0, 20).map(toFilePreviewRow),
        skipped: parsed.skipped,
      };
    }),

  commitTestRail: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        content: z.string().min(1),
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
      let parsed;
      try {
        parsed = parseTestRailXml(input.content);
      } catch (e) {
        throw new TRPCError({ code: "BAD_REQUEST", message: e instanceof Error ? e.message : String(e) });
      }
      return commitImportedTestCases(ctx.prisma, {
        projectId: input.projectId,
        organizationId: project.organizationId,
        actorId: ctx.user.id,
        rows: parsed.cases.map((c) => ({
          rowNumber: c.rowNumber,
          title: c.title,
          background: c.background,
          given: c.given,
          when: c.when,
          then: c.then,
          priority: c.priority,
          tags: c.tags,
          suitePath: c.suitePath,
          externalId: c.key,
          steps: c.steps,
        })),
        skipped: parsed.skipped,
        source: "TESTRAIL",
        sourceLabel: input.sourceLabel,
        fieldMapping: { format: parsed.format, suiteName: parsed.suiteName ?? "" },
        keyPrefix: "testrail",
        framework: "testrail",
        testPlanId: input.testPlanId,
      });
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
