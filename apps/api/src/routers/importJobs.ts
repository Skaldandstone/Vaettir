import { z } from "zod";
import { createHash } from "node:crypto";
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
import { previewXlsxSheet } from "../services/xlsxImport.js";
import { parseXlsxWorkbookIsolated } from "../services/xlsxImportIsolation.js";
import { XLSX_MAX_BASE64_CHARACTERS } from "../services/xlsxImportLimits.js";
import { workbookReads, workbookPreview } from "../services/xlsxWorkbookReads.js";
import { importTypeCaseSchema, importTypeRecommendationSchema } from "@vaettir/ai-agent";
import { importTypeAnalysis } from "../services/importTypeAnalysis.js";
import { googleSheetsImportConfig, googleSheetSourceSchema, prepareGoogleSheetsImport } from "../services/googleSheetsImport.js";

const fieldMappingSchema = z
  .record(z.enum(TARGET_FIELDS), z.string())
  .refine((m) => Boolean(m.title), {
    message: 'The "title" field must be mapped to a CSV column',
  });
const xlsxContentSchema = z.string().min(1).max(XLSX_MAX_BASE64_CHARACTERS);
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
  suitePath: z.string().optional(),
  background: z.string().optional(),
  sourceRowKind: z.enum(["SECTION", "NOTE", "PLACEHOLDER"]).optional(),
  reviewReasons: z.array(z.string()).optional(),
  typeRecommendation: z.string().optional(),
  typeOrigin: z.enum(["SOURCE", "UNCLASSIFIED", "REVIEWER", "SEMANTIC"]).optional(),
});
const rowOverrideSchema = mappedRowSchema.partial().extend({
  rowNumber: z.number().int().min(2),
});
const rowMappingSuggestionSchema = z.object({ original: mappedRowSchema, proposed: mappedRowSchema });

const xlsxPreviewSchema = z.object({ sheets: z.array(z.object({
  name: z.string(), headerRow: z.number().nullable(), headers: z.array(z.string()),
  rowCount: z.number(), suggestedMapping: z.record(z.string(), z.string()),
  previewRows: z.array(mappedRowSchema), incompleteRows: z.array(mappedRowSchema),
  nonCaseRows: z.array(mappedRowSchema).optional(),
  rowMappingSuggestions: z.array(rowMappingSuggestionSchema).optional(),
  recommendations: z.array(mappedRowSchema).optional(),
  skippedCount: z.number(), warning: z.string().optional(),
})) });
const xlsxReadIdentity = z.object({ projectId: z.string(), requestId: z.string().uuid() });

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

const liveSourceManifestSchema = z.object({
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  caseCount: z.number().int().min(0),
});

function liveSourceManifest(scope: { projectId: string; provider: string; sourceProject: string }, scan: Awaited<ReturnType<typeof scanQTestProject>>) {
  // Hash the full parsed input, including ordered rows/steps and skipped dispositions,
  // not the twenty-row display sample. Never include provider credentials.
  return {
    digest: createHash("sha256").update(JSON.stringify({ scope, cases: scan.cases, skipped: scan.skipped })).digest("hex"),
    caseCount: scan.cases.length,
  };
}

function requireReviewedManifest(expected: z.infer<typeof liveSourceManifestSchema>, current: z.infer<typeof liveSourceManifestSchema>) {
  if (expected.digest !== current.digest || expected.caseCount !== current.caseCount) {
    throw new TRPCError({ code: "CONFLICT", message: "Source changed since preview. Nothing was imported. Refresh the preview and review the new scope before importing." });
  }
}

async function requireFreshXlsxAccess(
  ctx: Parameters<typeof requireProjectAccess>[0],
  projectId: string,
  minRole: "VIEWER" | "EDITOR" = "VIEWER",
) {
  // The worker creates an async boundary. Request-start memberships are not
  // proof that access still exists when parsing finishes.
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.user.id },
    include: { memberships: true },
  });
  if (!user) throw new TRPCError({ code: "UNAUTHORIZED", message: "Project access changed. Sign in again." });
  return requireProjectAccess({ ...ctx, user }, projectId, minRole);
}

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
  historicalWorkbook: protectedProcedure.input(z.object({ projectId: z.string(), fileBase64: xlsxContentSchema }).strict())
    .mutation(async ({ ctx, input, signal }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      let sheets: Awaited<ReturnType<typeof parseXlsxWorkbookIsolated>>;
      try { sheets = await parseXlsxWorkbookIsolated(Buffer.from(input.fileBase64, "base64"), signal,
        JSON.stringify([ctx.authenticatedClerkSubject, ctx.user.id, project.organizationId, project.id]), undefined, "results"); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Could not read the workbook. Export its results tab as CSV." }); }
      await requireFreshXlsxAccess(ctx, input.projectId, "EDITOR");
      if (sheets.length > 20 || sheets.reduce((n, sheet) => n + Buffer.byteLength(sheet.csvText ?? "", "utf8"), 0) > 1024 * 1024)
        throw new TRPCError({ code: "BAD_REQUEST", message: "Choose a workbook with at most 20 tabs and 1 MiB of converted content, or export the results tab as CSV." });
      return { sheets: sheets.map(sheet => ({ name: sheet.name, csvText: sheet.csvText, headers: sheet.headers, rowCount: sheet.rowCount, warning: sheet.warning, originalRowNumbers: sheet.originalRowNumbers })) };
    }),

  googleSheetsConfig: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .output(z.object({ clientId: z.string(), apiKey: z.string(), appId: z.string() }).nullable())
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      // Browser-public OAuth client/Picker configuration only, never a secret.
      return googleSheetsImportConfig();
    }),
  startTypeAnalysis: protectedProcedure
    .input(xlsxReadIdentity.extend({ cases: z.array(importTypeCaseSchema).min(1).max(15_000) }))
    .output(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireFreshXlsxAccess(ctx, input.projectId, "EDITOR");
      try {
        return importTypeAnalysis.start({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.requestId, input.cases,
          async () => {
            const fresh = await requireFreshXlsxAccess(ctx, input.projectId, "EDITOR");
            if (fresh.project.organizationId !== project.organizationId) throw new Error("Project access changed.");
          });
      } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Type review could not start." }); }
    }),
  typeAnalysisStatus: protectedProcedure.input(xlsxReadIdentity)
    .output(z.object({ status: z.enum(["READING", "READY", "CANCELLED"]), total: z.number(), completed: z.number(), failed: z.number(), results: z.array(importTypeRecommendationSchema.extend({ fingerprint: z.string(), modelAnalyzed: z.boolean() })) }))
    .query(async ({ ctx, input }) => {
      const { project } = await requireFreshXlsxAccess(ctx, input.projectId);
      try { return importTypeAnalysis.status({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.requestId); }
      catch { throw new TRPCError({ code: "NOT_FOUND", message: "Type review expired. Retry analysis; no cases were imported." }); }
    }),
  cancelTypeAnalysis: protectedProcedure.input(xlsxReadIdentity).mutation(async ({ ctx, input }) => {
    const { project } = await requireFreshXlsxAccess(ctx, input.projectId);
    try { return importTypeAnalysis.cancel({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.requestId); }
    catch { throw new TRPCError({ code: "NOT_FOUND", message: "Type review expired." }); }
  }),
  startXlsxRead: protectedProcedure
    .input(xlsxReadIdentity.extend({ fileBase64: xlsxContentSchema }))
    .output(z.object({ requestId: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireFreshXlsxAccess(ctx, input.projectId);
      try {
        return workbookReads.start({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.requestId, Buffer.from(input.fileBase64, "base64"));
      } catch (error) {
        throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Excel preview could not start." });
      }
    }),
  xlsxReadStatus: protectedProcedure
    .input(xlsxReadIdentity)
    .output(z.object({ status: z.enum(["READING", "READY", "FAILED", "CANCELLED"]), checkpoints: z.number().int().min(0).max(103), preview: xlsxPreviewSchema.optional(), error: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const { project } = await requireFreshXlsxAccess(ctx, input.projectId);
      try {
        return workbookReads.status({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.requestId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "This workbook preview expired. Upload the same workbook again." });
      }
    }),
  cancelXlsxRead: protectedProcedure
    .input(xlsxReadIdentity)
    .output(z.object({ cancelled: z.boolean() }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireFreshXlsxAccess(ctx, input.projectId);
      try {
        return workbookReads.cancel({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.requestId);
      } catch {
        throw new TRPCError({ code: "NOT_FOUND", message: "This workbook preview expired. Upload the same workbook again." });
      }
    }),
  previewXlsx: protectedProcedure
    .input(z.object({ projectId: z.string(), fileBase64: xlsxContentSchema }))
    .output(xlsxPreviewSchema)
    .mutation(async ({ ctx, input, signal }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      try {
        const sheets = await parseXlsxWorkbookIsolated(
          Buffer.from(input.fileBase64, "base64"),
          signal,
          JSON.stringify([ctx.authenticatedClerkSubject, ctx.user.id, project.organizationId, project.id]),
        );
        await requireFreshXlsxAccess(ctx, input.projectId);
        return workbookPreview(sheets);
      } catch (error) {
        if (error instanceof TRPCError) throw error;
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
        nonCaseRows: z.array(mappedRowSchema).optional(),
        rowMappingSuggestions: z.array(rowMappingSuggestionSchema).optional(),
        recommendations: z.array(mappedRowSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input, signal }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId);
      try {
        const workbook = await parseXlsxWorkbookIsolated(
          Buffer.from(input.fileBase64, "base64"),
          signal,
          JSON.stringify([ctx.authenticatedClerkSubject, ctx.user.id, project.organizationId, project.id]),
        );
        await requireFreshXlsxAccess(ctx, input.projectId);
        const sheet = workbook.find((candidate) => candidate.name === input.sheetName);
        if (!sheet)
          throw new Error("Worksheet was not found in the uploaded workbook");
        const preview = previewXlsxSheet(sheet, input.mapping, input.overrides);
        return {
          previewRows: preview.rows,
          incompleteRows: preview.incompleteRows,
          skippedCount: preview.skipped.length,
          nonCaseRows: preview.nonCaseRows ?? [],
          rowMappingSuggestions: preview.rowMappingSuggestions ?? [],
          recommendations: preview.recommendations ?? [],
        };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
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
        typeAnalysisRequestId: z.string().uuid().optional(),
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
    .mutation(async ({ ctx, input, signal }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "EDITOR",
      );
      try {
        const workbook = await parseXlsxWorkbookIsolated(
          Buffer.from(input.fileBase64, "base64"),
          signal,
          JSON.stringify([ctx.authenticatedClerkSubject, ctx.user.id, project.organizationId, project.id]),
        );
        const refreshed = await requireFreshXlsxAccess(ctx, input.projectId, "EDITOR");
        if (refreshed.project.organizationId !== project.organizationId)
          throw new Error("Project access changed. Refresh before importing.");
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
          if (mapped.incompleteRows.length > 0) {
            throw new Error(
              `${sheet.name}: complete the required title for row(s) ${mapped.incompleteRows.map((row) => row.rowNumber).join(", ")} before importing`,
            );
          }
          rows.push(
            ...importTypeAnalysis.apply({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.typeAnalysisRequestId, sheet.name, mapped.rows).map((row) => ({
              ...row,
              rowNumber: row.rowNumber + rowOffset,
              externalId: row.externalId
                ? `${sheet.name}:${row.externalId}`
                : undefined,
              suitePath: [sheet.name.trim(), row.suitePath].filter(Boolean).join(" / "),
              reviewRequired: Boolean(row.reviewReasons?.length),
            })),
          );
          skipped.push(...mapped.skipped.map(row => ({ rowNumber: row.rowNumber + rowOffset, reason: `${sheet.name}: ${row.reason}` })));
          rowOffset += sheet.rowCount + 1;
        }
        if (rows.length === 0)
          throw new Error(
            "No importable test cases were found in the selected worksheets",
          );
        if (signal?.aborted) throw new Error("Excel processing was cancelled.");
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
        if (error instanceof TRPCError) throw error;
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
        nonCaseRows: z.array(mappedRowSchema).optional(),
        rowMappingSuggestions: z.array(rowMappingSuggestionSchema).optional(),
        recommendations: z.array(mappedRowSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const { headers, suggestedMapping, rowCount } = inspectCsv(input.csvText);

      let previewRows: ReturnType<typeof mapCsvRows>["rows"] = [];
      let previewSkipped: ReturnType<typeof mapCsvRows>["skipped"] = [];
      let incompleteRows: ReturnType<typeof mapCsvRows>["incompleteRows"] = [];
      let nonCaseRows: ReturnType<typeof mapCsvRows>["rows"] = [];
      let rowMappingSuggestions: NonNullable<ReturnType<typeof mapCsvRows>["rowMappingSuggestions"]> = [];
      let recommendations: NonNullable<ReturnType<typeof mapCsvRows>["recommendations"]> = [];
      if (suggestedMapping.title) {
        const preview = mapCsvRows(input.csvText, suggestedMapping);
        previewRows = preview.rows.slice(0, 10);
        previewSkipped = preview.skipped;
        incompleteRows = preview.incompleteRows;
        nonCaseRows = preview.nonCaseRows ?? [];
        rowMappingSuggestions = preview.rowMappingSuggestions ?? [];
        recommendations = preview.recommendations ?? [];
      }

      return {
        headers,
        suggestedMapping,
        rowCount,
        previewRows,
        previewSkipped,
        incompleteRows,
        nonCaseRows,
        rowMappingSuggestions,
        recommendations,
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
        nonCaseRows: z.array(mappedRowSchema).optional(),
        rowMappingSuggestions: z.array(rowMappingSuggestionSchema).optional(),
        recommendations: z.array(mappedRowSchema).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      try {
        const { rows, skipped, incompleteRows, nonCaseRows, rowMappingSuggestions, recommendations } = mapCsvRows(
          input.csvText,
          input.mapping,
          undefined,
          input.overrides,
        );
        return {
          previewRows: rows.slice(0, 10),
          previewSkipped: skipped,
          incompleteRows,
          nonCaseRows: nonCaseRows ?? [],
          rowMappingSuggestions: rowMappingSuggestions ?? [],
          recommendations: recommendations ?? [],
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
        typeAnalysisRequestId: z.string().uuid().optional(),
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
        if (mapped.incompleteRows.length > 0) {
          throw new Error(
            `Complete the required title for row(s) ${mapped.incompleteRows.map((row) => row.rowNumber).join(", ")} before importing`,
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
        rows: importTypeAnalysis.apply({ actorId: ctx.user.id, clerkSubject: ctx.authenticatedClerkSubject ?? null, organizationId: project.organizationId, projectId: project.id }, input.typeAnalysisRequestId, "", mapped.rows).map(row => ({ ...row, reviewRequired: Boolean(row.reviewReasons?.length) })),
        skipped: mapped.skipped,
        source: "CSV",
        sourceLabel: input.sourceLabel,
        fieldMapping: input.mapping,
        keyPrefix: "csv",
        framework: "csv",
        testPlanId: input.testPlanId,
      });
    }),

  commitGoogleSheets: protectedProcedure
    .input(z.object({
      projectId: z.string(), sourceLabel: z.string().max(2000),
      sheets: z.array(z.object({
        source: googleSheetSourceSchema, name: z.string().min(1).max(1000),
        csvText: z.string().min(1).max(1024 * 1024),
        mapping: fieldMappingSchema, overrides: z.array(rowOverrideSchema).max(2500).default([]),
      }).strict()).min(1).max(20),
    }).strict())
    .output(z.object({ importJobId: z.string(), createdCount: z.number(), updatedCount: z.number(), skipped: z.array(z.object({ rowNumber: z.number(), reason: z.string() })) }))
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(ctx, input.projectId, "EDITOR");
      let prepared;
      try { prepared = prepareGoogleSheetsImport(input.sheets); }
      catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error ? error.message : "Review the selected worksheets before importing." }); }
      // One existing atomic transaction for all selected tabs. This route has no
      // provider token or AI analysis input; only the customer's reviewed snapshot.
      return commitImportedTestCases(ctx.prisma, {
        ...prepared, rows: prepared.rows.map(row => ({ ...row, reviewRequired: Boolean(row.reviewReasons?.length) })),
        projectId: project.id, organizationId: project.organizationId, actorId: ctx.user.id,
        source: "CSV", sourceLabel: input.sourceLabel,
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
        sourceManifest: liveSourceManifestSchema,
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
        sourceManifest: liveSourceManifest({projectId:input.projectId,provider:"qtest",sourceProject:JSON.stringify([input.baseUrl,input.qtestProjectId])},scan),
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
        expectedManifest: liveSourceManifestSchema,
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
      const manifest=liveSourceManifest({projectId:input.projectId,provider:"qtest",sourceProject:JSON.stringify([input.baseUrl,input.qtestProjectId])},scan);
      requireReviewedManifest(input.expectedManifest,manifest);
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
          reviewedManifestDigest: manifest.digest,
          reviewedManifestCaseCount: String(manifest.caseCount),
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
        sourceManifest: liveSourceManifestSchema,
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
        sourceManifest: liveSourceManifest({projectId:input.projectId,provider:"zephyr",sourceProject:input.zephyrProjectKey},scan),
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
        expectedManifest: liveSourceManifestSchema,
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
      const manifest=liveSourceManifest({projectId:input.projectId,provider:"zephyr",sourceProject:input.zephyrProjectKey},scan);
      requireReviewedManifest(input.expectedManifest,manifest);
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
          reviewedManifestDigest: manifest.digest,
          reviewedManifestCaseCount: String(manifest.caseCount),
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
