import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import {
  inspectCsv,
  mapCsvRows,
  TARGET_FIELDS,
  type TargetField,
} from "../services/csvFieldMapping.js";
import { commitImportedTestCases } from "../services/importCommit.js";
import { parseXrayExport } from "../services/xrayImport.js";
import { parseTestRailXml } from "../services/testrailImport.js";
import { scanQTestProject } from "../services/qtestImport.js";
import { scanZephyrProject } from "../services/zephyrImport.js";
import { parseXlsxWorkbook, previewXlsxSheet } from "../services/xlsxImport.js";

const fieldMappingSchema = z
  .record(z.enum(TARGET_FIELDS), z.string())
  .refine((m) => Boolean(m.title), {
    message: 'The "title" field must be mapped to a CSV column',
  });
const xlsxContentSchema = z.string().min(1).max(14_000_000);
const mappedRowSchema = z.object({
  rowNumber: z.number(),
  title: z.string(),
  given: z.array(z.string()),
  when: z.array(z.string()),
  then: z.array(z.string()),
  priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
  tags: z.array(z.string()),
  testType: z.enum([
    "UNIT",
    "FUNCTIONAL",
    "CONTRACT",
    "INSTRUMENTATION",
    "SMOKE",
    "SANITY",
    "REGRESSION",
    "E2E",
    "PERFORMANCE",
    "SECURITY",
    "ACCESSIBILITY",
    "EXPLORATORY",
    "COMPLIANCE",
    "OTHER",
  ]),
  automationStatus: z.enum([
    "MANUAL",
    "AUTOMATED",
    "PARTIALLY_AUTOMATED",
    "NEEDS_AUTOMATION",
  ]),
  externalId: z.string().optional(),
});
const rowOverrideSchema = mappedRowSchema.partial().extend({
  rowNumber: z.number().int().min(2),
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

function toFilePreviewRow(
  c: ReturnType<typeof parseXrayExport>["cases"][number],
): z.infer<typeof filePreviewRow> {
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
  previewXlsx: protectedProcedure
    .input(z.object({ projectId: z.string(), fileBase64: xlsxContentSchema }))
    .output(
      z.object({
        sheets: z.array(
          z.object({
            name: z.string(),
            headerRow: z.number().nullable(),
            headers: z.array(z.string()),
            rowCount: z.number(),
            suggestedMapping: z.record(z.string(), z.string()),
            previewRows: z.array(mappedRowSchema),
            incompleteRows: z.array(mappedRowSchema),
            skippedCount: z.number(),
            warning: z.string().optional(),
          }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      try {
        const sheets = parseXlsxWorkbook(
          Buffer.from(input.fileBase64, "base64"),
        );
        return {
          sheets: sheets.map((sheet) => {
            const preview = sheet.suggestedMapping.title
              ? previewXlsxSheet(sheet)
              : { rows: [], skipped: [], incompleteRows: [] };
            return {
              name: sheet.name,
              headerRow: sheet.headerRow,
              headers: sheet.headers,
              rowCount: sheet.rowCount,
              suggestedMapping: sheet.suggestedMapping,
              previewRows: preview.rows,
              incompleteRows: preview.incompleteRows,
              skippedCount: preview.skipped.length,
              warning: sheet.warning,
            };
          }),
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),

  previewXlsxSheet: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fileBase64: xlsxContentSchema,
        sheetName: z.string(),
        mapping: fieldMappingSchema,
        overrides: z.array(rowOverrideSchema).default([]),
      }),
    )
    .output(
      z.object({
        previewRows: z.array(mappedRowSchema),
        incompleteRows: z.array(mappedRowSchema),
        skippedCount: z.number(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      try {
        const sheet = parseXlsxWorkbook(
          Buffer.from(input.fileBase64, "base64"),
        ).find((candidate) => candidate.name === input.sheetName);
        if (!sheet)
          throw new Error("Worksheet was not found in the uploaded workbook");
        const preview = previewXlsxSheet(sheet, input.mapping, input.overrides);
        return {
          previewRows: preview.rows,
          incompleteRows: preview.incompleteRows,
          skippedCount: preview.skipped.length,
        };
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),

  commitXlsx: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        fileBase64: xlsxContentSchema,
        sourceLabel: z.string().optional(),
        sheets: z
          .array(
            z.object({
              name: z.string(),
              mapping: fieldMappingSchema,
              overrides: z.array(rowOverrideSchema).default([]),
            }),
          )
          .min(1),
      }),
    )
    .output(
      z.object({
        importJobId: z.string(),
        createdCount: z.number(),
        updatedCount: z.number(),
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      try {
        const workbook = parseXlsxWorkbook(
          Buffer.from(input.fileBase64, "base64"),
        );
        const selected = new Map(
          input.sheets.map((sheet) => [sheet.name, sheet]),
        );
        const rows: ReturnType<typeof mapCsvRows>["rows"] = [];
        const skipped: { rowNumber: number; reason: string }[] = [];
        let rowOffset = 0;
        for (const sheet of workbook) {
          const selection = selected.get(sheet.name);
          if (!selection || !sheet.csvText) continue;
          const mapped = mapCsvRows(
            sheet.csvText,
            selection.mapping,
            undefined,
            selection.overrides,
          );
          if (mapped.skipped.length > 0) {
            throw new Error(
              `${sheet.name}: complete the required title for row(s) ${mapped.skipped.map((row) => row.rowNumber).join(", ")} before importing`,
            );
          }
          rows.push(
            ...mapped.rows.map((row) => ({
              ...row,
              rowNumber: row.rowNumber + rowOffset,
              externalId: row.externalId
                ? `${sheet.name}:${row.externalId}`
                : undefined,
              suitePath: sheet.name.trim(),
            })),
          );
          rowOffset += sheet.rowCount + 1;
        }
        if (rows.length === 0)
          throw new Error(
            "No importable test cases were found in the selected worksheets",
          );
        return commitImportedTestCases(ctx.prisma, {
          projectId: input.projectId,
          organizationId: project.organizationId,
          actorId: ctx.user.id,
          rows,
          skipped,
          source: "CSV",
          sourceLabel: input.sourceLabel,
          fieldMapping: Object.fromEntries(
            input.sheets.map((sheet) => [
              sheet.name,
              JSON.stringify(sheet.mapping),
            ]),
          ),
          keyPrefix: "xlsx",
          framework: "xlsx",
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),

  previewCsv: protectedProcedure
    .input(z.object({ projectId: z.string(), csvText: z.string().min(1) }))
    .output(
      z.object({
        headers: z.array(z.string()),
        suggestedMapping: z.record(z.string(), z.string()),
        rowCount: z.number(),
        previewRows: z.array(mappedRowSchema),
        incompleteRows: z.array(mappedRowSchema),
        previewSkipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const { headers, suggestedMapping, rowCount } = inspectCsv(input.csvText);

      let previewRows: ReturnType<typeof mapCsvRows>["rows"] = [];
      let previewSkipped: ReturnType<typeof mapCsvRows>["skipped"] = [];
      let incompleteRows: ReturnType<typeof mapCsvRows>["incompleteRows"] = [];
      if (suggestedMapping.title) {
        const preview = mapCsvRows(input.csvText, suggestedMapping);
        previewRows = preview.rows.slice(0, 10);
        previewSkipped = preview.skipped;
        incompleteRows = preview.incompleteRows;
      }

      return {
        headers,
        suggestedMapping,
        rowCount,
        previewRows,
        previewSkipped,
        incompleteRows,
      };
    }),

  // Re-runs mapCsvRows with a user-adjusted mapping, still preview-only
  // (no ImportJob, no TestCases) - called every time the user changes a
  // dropdown in the mapping UI so they see the real effect before committing.
  previewWithMapping: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        csvText: z.string().min(1),
        mapping: fieldMappingSchema,
        overrides: z.array(rowOverrideSchema).default([]),
      }),
    )
    .output(
      z.object({
        previewRows: z.array(mappedRowSchema),
        incompleteRows: z.array(mappedRowSchema),
        previewSkipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      try {
        const { rows, skipped, incompleteRows } = mapCsvRows(
          input.csvText,
          input.mapping,
          undefined,
          input.overrides,
        );
        return {
          previewRows: rows.slice(0, 10),
          previewSkipped: skipped,
          incompleteRows,
        };
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
    }),

  commitCsv: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        csvText: z.string().min(1),
        mapping: fieldMappingSchema,
        overrides: z.array(rowOverrideSchema).default([]),
        testPlanId: z.string().optional(),
        sourceLabel: z.string().optional(),
      }),
    )
    .output(
      z.object({
        importJobId: z.string(),
        createdCount: z.number(),
        updatedCount: z.number(),
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );

      let mapped;
      try {
        mapped = mapCsvRows(
          input.csvText,
          input.mapping,
          undefined,
          input.overrides,
        );
        if (mapped.skipped.length > 0) {
          throw new Error(
            `Complete the required title for row(s) ${mapped.skipped.map((row) => row.rowNumber).join(", ")} before importing`,
          );
        }
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
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
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      let parsed;
      try {
        parsed = parseXrayExport(input.content);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
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
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      let parsed;
      try {
        parsed = parseXrayExport(input.content);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
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
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      let parsed;
      try {
        parsed = parseTestRailXml(input.content);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
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
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      let parsed;
      try {
        parsed = parseTestRailXml(input.content);
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
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
        fieldMapping: {
          format: parsed.format,
          suiteName: parsed.suiteName ?? "",
        },
        keyPrefix: "testrail",
        framework: "testrail",
        testPlanId: input.testPlanId,
      });
    }),

  // P11-06: qTest, unlike TestRail's/Xray's file-export halves, is a live
  // REST-API importer - the connection (baseUrl + apiToken) is a one-shot
  // mutation input, used only for this one fetch and never persisted
  // anywhere (no new stored-credential model, since this is a synchronous
  // import operation, not a recurring sync). Never logged: the token isn't
  // included in fieldMapping/ImportJob or anywhere else that's stored.
  previewQTest: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        baseUrl: z.string().min(1),
        apiToken: z.string().min(1),
        qtestProjectId: z.number(),
      }),
    )
    .output(
      z.object({
        format: z.literal("qtest-api"),
        caseCount: z.number(),
        previewRows: z.array(filePreviewRow),
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      let scan;
      try {
        scan = await scanQTestProject(
          { baseUrl: input.baseUrl, apiToken: input.apiToken },
          input.qtestProjectId,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return {
        format: "qtest-api" as const,
        caseCount: scan.cases.length,
        previewRows: scan.cases.slice(0, 20).map(toFilePreviewRow),
        skipped: scan.skipped,
      };
    }),

  commitQTest: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        baseUrl: z.string().min(1),
        apiToken: z.string().min(1),
        qtestProjectId: z.number(),
        testPlanId: z.string().optional(),
        sourceLabel: z.string().optional(),
      }),
    )
    .output(
      z.object({
        importJobId: z.string(),
        createdCount: z.number(),
        updatedCount: z.number(),
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      let scan;
      try {
        scan = await scanQTestProject(
          { baseUrl: input.baseUrl, apiToken: input.apiToken },
          input.qtestProjectId,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return commitImportedTestCases(ctx.prisma, {
        projectId: input.projectId,
        organizationId: project.organizationId,
        actorId: ctx.user.id,
        rows: scan.cases.map((c) => ({
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
        skipped: scan.skipped,
        source: "QTEST",
        sourceLabel: input.sourceLabel,
        fieldMapping: {
          format: "qtest-api",
          qtestProjectId: String(input.qtestProjectId),
        },
        keyPrefix: "qtest",
        framework: "qtest",
        testPlanId: input.testPlanId,
      });
    }),

  // P11-04: Zephyr Scale Cloud, same live-REST-API shape as qTest above -
  // a fixed API host, so the connection input is just a personal API
  // token + project key, no instance URL and no SSRF guard needed. Never
  // persisted, same one-shot-input reasoning as qTest's connection.
  previewZephyr: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        apiToken: z.string().min(1),
        zephyrProjectKey: z.string().min(1),
      }),
    )
    .output(
      z.object({
        format: z.literal("zephyr-api"),
        caseCount: z.number(),
        previewRows: z.array(filePreviewRow),
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      let scan;
      try {
        scan = await scanZephyrProject(
          { apiToken: input.apiToken },
          input.zephyrProjectKey,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return {
        format: "zephyr-api" as const,
        caseCount: scan.cases.length,
        previewRows: scan.cases.slice(0, 20).map(toFilePreviewRow),
        skipped: scan.skipped,
      };
    }),

  commitZephyr: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        apiToken: z.string().min(1),
        zephyrProjectKey: z.string().min(1),
        testPlanId: z.string().optional(),
        sourceLabel: z.string().optional(),
      }),
    )
    .output(
      z.object({
        importJobId: z.string(),
        createdCount: z.number(),
        updatedCount: z.number(),
        skipped: z.array(
          z.object({ rowNumber: z.number(), reason: z.string() }),
        ),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      let scan;
      try {
        scan = await scanZephyrProject(
          { apiToken: input.apiToken },
          input.zephyrProjectKey,
        );
      } catch (e) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: e instanceof Error ? e.message : String(e),
        });
      }
      return commitImportedTestCases(ctx.prisma, {
        projectId: input.projectId,
        organizationId: project.organizationId,
        actorId: ctx.user.id,
        rows: scan.cases.map((c) => ({
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
        skipped: scan.skipped,
        source: "ZEPHYR",
        sourceLabel: input.sourceLabel,
        fieldMapping: {
          format: "zephyr-api",
          zephyrProjectKey: input.zephyrProjectKey,
        },
        keyPrefix: "zephyr",
        framework: "zephyr",
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
