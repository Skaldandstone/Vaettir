"use client";

import { useEffect, useRef, useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { readWorkbookPreview } from "@/lib/read-workbook-preview";
import { reassignImportColumn, remainingNonCaseRows } from "@/lib/reassign-import-column";
import { importReviewRows, typeReviewCase, typeReviewLabel, type TypeReviewCase } from "@/lib/import-type-review";
import { GoogleSheetsImportSource } from "@/components/GoogleSheetsImportSource";
import type { GoogleSheetSnapshot } from "@/lib/google-sheets-import";

// P11-10: "Migration assistant" wizard. Every backend piece this orchestrates
// already existed and worked (P11-01/02's CSV mapping+preview, P11-03's
// TestRail XML importer, P11-05's Xray/Jira importer, P11-09's diff/summary
// shape) - what was actually missing, per the ticket's own wording, was "one
// guided flow rather than disconnected tools." Before this, the import page
// stacked three always-visible, independently-operated panels (Xray,
// TestRail, a separate CSV mapping section) that assumed the user already
// knew which importer applied to their export. This makes the same three
// backends into one step machine: pick a source -> upload -> (CSV only) map
// columns -> review the exact scope preview -> commit -> see the diff
// report, with a "start over" at every step. Spreadsheet previews also retain
// incomplete rows for inline repair instead of silently dropping source data.

type Source = "csv" | "testrail" | "xray" | "qtest" | "zephyr";
type Step = "source" | "upload" | "review" | "done";
type ImportMethod = "api" | "webhook" | "file" | "google-sheets";

const TARGET_FIELDS = [
  "title",
  "given",
  "when",
  "then",
  "priority",
  "tags",
  "testType",
  "automationStatus",
  "externalId",
] as const;
type TargetField = (typeof TARGET_FIELDS)[number];
const FIELD_LABELS: Record<TargetField, string> = {
  title: "Title",
  given: "Preconditions",
  when: "Actions / procedure",
  then: "Expected results",
  priority: "Priority",
  tags: "Tags",
  testType: "Test type",
  automationStatus: "Automation status",
  externalId: "External ID (for re-import)",
};

const SOURCE_INFO: Record<
  Source,
  { label: string; mark: string; blurb: string; accept: string }
> = {
  csv: {
    label: "Smart file import",
    mark: "CSV",
    blurb:
      "CSV or Excel (.xlsx) from Qase, Tricentis, TestRail, qTest, or another test system. Vaettir detects fields and automatically reviews mapped case definitions with its AI provider to recommend test types, included free. Nothing is imported until you confirm.",
    accept:
      ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  testrail: {
    label: "TestRail",
    mark: "TR",
    blurb: "TestRail → open the suite → Test Cases → Export → XML.",
    accept: ".xml,text/xml,application/xml",
  },
  xray: {
    label: "Xray (Jira)",
    mark: "XR",
    blurb:
      "A Jira Test-issue CSV export (JQL: issuetype = Test), or Xray's own JSON test export.",
    accept: ".csv,.json,text/csv,application/json",
  },
  qtest: {
    label: "qTest",
    mark: "qT",
    blurb:
      "Connect directly with your qTest instance URL and a personal API token - no file needed.",
    accept: "",
  },
  zephyr: {
    label: "Zephyr Scale",
    mark: "ZS",
    blurb:
      "Connect directly with a Zephyr Scale Cloud personal API token and your Jira project key - no file needed.",
    accept: "",
  },
};

function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsText(file);
  });
}

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result ?? "");
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

function importErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    return "Vaettir could not reach the import service. Nothing was written. Check your connection and retry; if it continues, send support the file name and time of the attempt.";
  }
  if (/413|payload too large|request entity too large/i.test(message)) {
    return "This export is larger than the current upload limit. Nothing was written. Split it into smaller workbooks or contact support for an assisted migration.";
  }
  return message;
}

type FilePreviewRow =
  RouterOutputs["importJobs"]["previewXray"]["previewRows"][number];
type FileCommitResult = RouterOutputs["importJobs"]["commitXray"];
type CsvPreview = RouterOutputs["importJobs"]["previewCsv"];
type CsvMappedPreviewRow =
  RouterOutputs["importJobs"]["previewWithMapping"]["previewRows"][number];
type EditableImportRow =
  RouterOutputs["importJobs"]["previewWithMapping"]["incompleteRows"][number];
type XlsxPreview = RouterOutputs["importJobs"]["previewXlsx"];

function rowRecord(rows: EditableImportRow[]) {
  return Object.fromEntries(
    rows.map((row) => [
      row.rowNumber,
      {
        ...row,
        // Tags and external IDs are not case names. Missing names require
        // explicit review rather than a silent cross-field substitution.
        title: row.title,
      },
    ]),
  );
}

function reconcileRowOverrides(
  current: Record<number, EditableImportRow>,
  incompleteRows: EditableImportRow[],
) {
  const next = rowRecord(incompleteRows);
  for (const row of Object.values(current)) {
    if (row.title.trim()) next[row.rowNumber] = row;
  }
  return next;
}

function splitEditedLines(value: string) {
  return value.trim() ? [value] : [];
}

function NonCaseRowsReview({ rows, overrides, onInclude }: {
  rows: EditableImportRow[] | undefined;
  overrides: Record<number, EditableImportRow>;
  onInclude: (row: EditableImportRow) => void;
}) {
  const excluded = remainingNonCaseRows(rows, overrides);
  if (!excluded.length) return null;
  return (
    <details className="import-repair-panel">
      <summary>{excluded.length} source context rows and placeholders · For review</summary>
      <p className="text-muted">Sections and notes are automatically mapped to the following cases, not discarded or made into empty cases. ID-only placeholders have no definition. These are suggestions; inspect the proposed context below or edit a case’s section. Nothing is written until you import.</p>
      <div className="table-scroll" style={{ maxHeight: 240 }}><table className="workspace-table">
        <thead><tr><th>Import row</th><th>Source label</th><th>Proposed role</th><th>Context</th><th>Review</th></tr></thead>
        <tbody>{excluded.map(row => <tr key={row.rowNumber}>
          <td>{row.rowNumber}</td><td>{row.externalId || row.tags.join(", ")}</td>
          <td>{row.sourceRowKind === "SECTION" ? "Section within suite" : row.sourceRowKind === "NOTE" ? "Source note" : "ID-only placeholder"}<small>For review</small></td>
          <td>{row.suitePath || row.reviewReasons?.join(" ") || "No case definition"}</td>
          <td><button className="btn-secondary" disabled={Boolean(overrides[row.rowNumber])} onClick={() => onInclude(row)}>
            {overrides[row.rowNumber] ? "Editing below" : "Also add as case"}
          </button></td>
        </tr>)}</tbody>
      </table></div>
    </details>
  );
}

function RowMappingReview({ suggestions, overrides, onChange }: {
  suggestions: { original: EditableImportRow; proposed: EditableImportRow }[] | undefined;
  overrides: Record<number, EditableImportRow>;
  onChange: (row: EditableImportRow) => void;
}) {
  if (!suggestions?.length) return null;
  return <details className="import-repair-panel" open>
    <summary>{suggestions.length} automatically applied row-layout suggestions · For review</summary>
    <p className="text-muted">These rows appear to use a different layout: module/scenario contains the case name, description contains the actions, and preconditions contains the expected result. Suggestions are already included in the preview and import scope. Edit a row or restore its original column mapping if incorrect. Suggested cases remain For review after import.</p>
    <div className="table-scroll" style={{ maxHeight: 320 }}><table className="workspace-table">
      <thead><tr><th>Row</th><th>Suggested case name</th><th>Actions / procedure</th><th>Expected result</th><th>Review</th></tr></thead>
      <tbody>{suggestions.map(({ original, proposed }) => {
        const row = overrides[proposed.rowNumber] ?? proposed;
        return <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.title}</td>
          <td style={{ whiteSpace: "pre-wrap" }}>{row.when.join("\n") || "—"}</td>
          <td style={{ whiteSpace: "pre-wrap" }}>{row.then.join("\n") || "—"}</td>
          <td><div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button className="btn-secondary" onClick={() => onChange(row)}>Edit row</button>
            <button className="btn-secondary" onClick={() => onChange(original)}>Keep column mapping</button>
          </div></td>
        </tr>;
      })}</tbody>
    </table></div>
  </details>;
}

function ImportRecommendations({ rows, overrides, onChange, analysis, manualOnly = false }: {
  manualOnly?: boolean;
  rows: EditableImportRow[] | undefined;
  overrides: Record<number, EditableImportRow>;
  onChange: (row: EditableImportRow) => void;
  analysis?: Record<number, RouterOutputs["importJobs"]["typeAnalysisStatus"]["results"][number]>;
}) {
  if (!rows?.length) return null;
  return <details className="import-repair-panel" open={manualOnly ? undefined : true}>
    <summary>{rows.length} cases with automatic suggestions · For review</summary>
    <p className="text-muted">{manualOnly ? "Review the mapped source fields and choose a test type where needed. Unspecified types stay Unclassified and For review. Sheets imports do not use AI analysis. Priority and automation default to Medium and Manual when absent." : "Already applied, no detection button needed. Free AI review reads each complete case definition and recommends its primary testing objective with supporting excerpts. Missing or uncertain classifications stay Unclassified and For review, not Functional by default. You can change any recommendation. Priority and automation use Medium and Manual defaults if unspecified; those defaults are not verified source facts. No missing steps are invented."}</p>
    <div className="table-scroll" style={{ maxHeight: 320 }}><table className="workspace-table">
      <thead><tr><th>Row</th><th>Case name</th><th>Section within suite</th><th>Test type</th><th>Why / status</th><th>Details</th></tr></thead>
      <tbody>{rows.map(proposed => {
        const row = overrides[proposed.rowNumber] ?? proposed;
        const recommendation = row.typeOrigin === "REVIEWER" || row.typeOrigin === "SOURCE" ? undefined : analysis?.[row.rowNumber];
        const selectedType = recommendation?.testType ?? row.testType;
        return <tr key={row.rowNumber}>
          <td>{row.rowNumber}</td><td>{row.title}</td>
          <td><input aria-label={`Section for row ${row.rowNumber}`} value={row.suitePath ?? ""} onChange={event => onChange({ ...row, suitePath: event.target.value })} /></td>
          <td><select aria-label={`Test type for row ${row.rowNumber}`} value={selectedType} onChange={event => onChange({ ...row, testType: event.target.value as EditableImportRow["testType"], typeOrigin: "REVIEWER" })}>
            {["UNIT", "FUNCTIONAL", "CONTRACT", "INSTRUMENTATION", "SMOKE", "SANITY", "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY", "EXPLORATORY", "COMPLIANCE", "OTHER"].map(type => <option key={type} value={type}>{type === "OTHER" && row.typeOrigin === "UNCLASSIFIED" && !recommendation?.testType ? "Unclassified · For review" : typeReviewLabel(type)}</option>)}
          </select></td>
          <td><span className="status-pill status-warning">For review{recommendation ? ` · ${recommendation.confidence.toLowerCase()} confidence` : ""}</span>
            {recommendation ? <><p><strong>{recommendation.objective}</strong></p><p>{recommendation.reason}</p>{recommendation.evidence.map((quote, i) => <blockquote key={i} style={{ margin: "4px 0", fontSize: 12 }}>{quote}</blockquote>)}</> : <p>{row.typeOrigin === "REVIEWER" ? "Reviewer-selected type." : manualOnly && row.typeOrigin === "UNCLASSIFIED" ? "Unclassified: choose a test type if needed. No AI analysis is used for Sheets imports." : proposed.typeRecommendation || proposed.reviewReasons?.join(" ")}</p>}</td>
          <td><button className="btn-secondary" onClick={() => onChange(row)}>Edit details</button></td>
        </tr>;
      })}</tbody>
    </table></div>
  </details>;
}

function RowRepairEditor({
  row,
  onChange,
  recommendation,
}: {
  row: EditableImportRow;
  onChange: (next: EditableImportRow) => void;
  recommendation?: RouterOutputs["importJobs"]["typeAnalysisStatus"]["results"][number];
}) {
  const updateLines = (field: "given" | "when" | "then", value: string) =>
    onChange({ ...row, [field]: splitEditedLines(value) });

  return (
    <fieldset className="import-row-repair">
      <legend>Source row {row.rowNumber}</legend>
      <label className="import-row-repair-title">
        Title <span className="text-error">*</span>
        <input
          value={row.title}
          onChange={(event) => onChange({ ...row, title: event.target.value })}
          placeholder="Add the missing test-case title"
        />
      </label>
      <label>
        Section within suite
        <input value={row.suitePath ?? ""} onChange={event => onChange({ ...row, suitePath: event.target.value })} />
      </label>
      <label>
        Source notes / context
        <textarea rows={3} value={row.background ?? ""} onChange={event => onChange({ ...row, background: event.target.value })} />
      </label>
      <label>
        Preconditions
        <textarea
          rows={3}
          value={row.given.join("\n")}
          onChange={(event) => updateLines("given", event.target.value)}
          placeholder="Keep the source preconditions and formatting"
        />
      </label>
      <label>
        Steps
        <textarea
          rows={3}
          value={row.when.join("\n")}
          onChange={(event) => updateLines("when", event.target.value)}
          placeholder="Actions or procedure, in your preferred format"
        />
      </label>
      <label>
        Expected results
        <textarea
          rows={3}
          value={row.then.join("\n")}
          onChange={(event) => updateLines("then", event.target.value)}
          placeholder="Expected results, preserving source formatting"
        />
      </label>
      <label>
        Priority
        <select
          value={row.priority}
          onChange={(event) =>
            onChange({
              ...row,
              priority: event.target.value as EditableImportRow["priority"],
            })
          }
        >
          <option value="CRITICAL">Critical</option>
          <option value="HIGH">High</option>
          <option value="MEDIUM">Medium</option>
          <option value="LOW">Low</option>
        </select>
      </label>
      <label>
        Test type
        <select
          value={row.typeOrigin === "UNCLASSIFIED" ? recommendation?.testType ?? row.testType : row.testType}
          onChange={(event) =>
            onChange({
              ...row,
              testType: event.target.value as EditableImportRow["testType"],
              typeOrigin: "REVIEWER",
            })
          }
        >
          {[
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
          ].map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </select>
      </label>
      <label>
        Automation
        <select
          value={row.automationStatus}
          onChange={(event) =>
            onChange({
              ...row,
              automationStatus: event.target
                .value as EditableImportRow["automationStatus"],
            })
          }
        >
          <option value="MANUAL">Manual</option>
          <option value="AUTOMATED">Automated</option>
          <option value="PARTIALLY_AUTOMATED">Partially automated</option>
          <option value="NEEDS_AUTOMATION">Needs automation</option>
        </select>
      </label>
      <label>
        Tags
        <input
          value={row.tags.join(", ")}
          onChange={(event) =>
            onChange({
              ...row,
              tags: event.target.value
                .split(",")
                .map((tag) => tag.trim())
                .filter(Boolean),
            })
          }
          placeholder="Comma-separated"
        />
      </label>
    </fieldset>
  );
}

export function MigrationWizard({
  projectId,
  onCommitted,
}: {
  projectId: string;
  onCommitted: () => void;
}) {
  const [step, setStep] = useState<Step>("source");
  const [importMethod, setImportMethod] = useState<ImportMethod | null>(null);
  const [source, setSource] = useState<Source | null>(null);
  const [fileName, setFileName] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [googleSnapshots, setGoogleSnapshots] = useState<GoogleSheetSnapshot[]>([]);
  const [expandedGoogleSheet, setExpandedGoogleSheet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [workbookCheckpoints, setWorkbookCheckpoints] = useState<number | null>(null);
  const activeFileRead = useRef<AbortController | null>(null);
  const utils = trpcReact.useUtils();
  useEffect(() => () => { activeFileRead.current?.abort(); activeFileRead.current = null; }, []);
  const [result, setResult] = useState<FileCommitResult | null>(null);

  // CSV-only mapping state
  const [csvPreview, setCsvPreview] = useState<CsvPreview | null>(null);
  const [mapping, setMapping] = useState<Partial<Record<TargetField, string>>>(
    {},
  );
  const [csvPreviewRows, setCsvPreviewRows] = useState<CsvMappedPreviewRow[]>(
    [],
  );
  const [csvRowOverrides, setCsvRowOverrides] = useState<
    Record<number, EditableImportRow>
  >({});
  const [xlsxBase64, setXlsxBase64] = useState("");
  const [xlsxPreview, setXlsxPreview] = useState<XlsxPreview | null>(null);
  const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
  const [xlsxMappings, setXlsxMappings] = useState<
    Record<string, Partial<Record<TargetField, string>>>
  >({});
  const [xlsxRowOverrides, setXlsxRowOverrides] = useState<
    Record<string, Record<number, EditableImportRow>>
  >({});
  type TypeAnalysis = RouterOutputs["importJobs"]["typeAnalysisStatus"];
  const [typeReview, setTypeReview] = useState<{ input: string; requestId?: string; state?: TypeAnalysis; error?: string } | null>(null);
  const [typeRetry, setTypeRetry] = useState(0);
  const typeJob = useRef<string | null>(null);
  const typeCases: TypeReviewCase[] = source !== "csv" || importMethod === "google-sheets" || step === "done" ? [] : xlsxPreview ? xlsxPreview.sheets
    .filter(sheet => selectedSheets.has(sheet.name) && xlsxMappings[sheet.name]?.title)
    .flatMap(sheet => importReviewRows(sheet.recommendations, xlsxRowOverrides[sheet.name] ?? {})
      .filter(row => row.title && row.typeOrigin !== "SOURCE" && row.typeOrigin !== "REVIEWER")
      .map(row => typeReviewCase(sheet.name, row))) : importReviewRows(csvPreview?.recommendations, csvRowOverrides)
        .filter(row => row.title && row.typeOrigin !== "SOURCE" && row.typeOrigin !== "REVIEWER")
        .map(row => typeReviewCase("", row));
  const typeInput = JSON.stringify(typeCases);
  useEffect(() => {
    const cases = JSON.parse(typeInput) as TypeReviewCase[];
    if (!cases.length) return;
    const controller = new AbortController();
    let ownedRequest: string | undefined;
    const timer = setTimeout(() => {
      setTypeReview({ input: typeInput });
      void (async () => {
        const previous = typeJob.current;
        if (previous) await utils.client.importJobs.cancelTypeAnalysis.mutate({ projectId, requestId: previous }).catch(() => undefined);
        if (controller.signal.aborted) return;
        const started = await utils.client.importJobs.startTypeAnalysis.mutate({ projectId, requestId: crypto.randomUUID(), cases });
        ownedRequest = started.requestId;
        if (controller.signal.aborted) { void utils.client.importJobs.cancelTypeAnalysis.mutate({ projectId, requestId: ownedRequest }).catch(() => undefined); return; }
        typeJob.current = ownedRequest;
        let failures = 0;
        while (!controller.signal.aborted) {
          let state: TypeAnalysis;
          try { state = await utils.client.importJobs.typeAnalysisStatus.query({ projectId, requestId: ownedRequest }); failures = 0; }
          catch (error) { if (++failures >= 3) throw error; await new Promise(resolve => setTimeout(resolve, 1500)); continue; }
          if (controller.signal.aborted) return;
          setTypeReview({ input: typeInput, requestId: ownedRequest, state });
          if (state.status !== "READING") return;
          await new Promise(resolve => setTimeout(resolve, 1500));
        }
      })().catch(error => { if (!controller.signal.aborted) setTypeReview({ input: typeInput, error: importErrorMessage(error) }); });
    }, 600);
    return () => { clearTimeout(timer); controller.abort(); if (ownedRequest) void utils.client.importJobs.cancelTypeAnalysis.mutate({ projectId, requestId: ownedRequest }).catch(() => undefined); };
  }, [typeInput, projectId, typeRetry, utils.client]);
  const currentTypeReview = typeReview?.input === typeInput ? typeReview : null;
  const typeReviewPending = typeCases.length > 0 && !currentTypeReview?.error && currentTypeReview?.state?.status !== "READY";
  const typeReviewBlocked = typeCases.length > 0 && currentTypeReview?.state?.status !== "READY";
  function sheetTypeResults(sheet: string) {
    return Object.fromEntries((currentTypeReview?.state?.results ?? []).flatMap(r => {
      const [name, row] = JSON.parse(r.id) as [string, number]; return name === sheet ? [[row, r]] : [];
    }));
  }
  function displayedType(sheet: string, row: EditableImportRow) {
    const result = row.typeOrigin === "SOURCE" || row.typeOrigin === "REVIEWER" ? undefined : sheetTypeResults(sheet)[row.rowNumber];
    return result ? result.testType ? typeReviewLabel(result.testType) : "Unclassified · For review" : typeReviewLabel(row.testType, row.typeOrigin);
  }

  // TestRail/Xray preview state
  const [filePreview, setFilePreview] = useState<{
    format: string;
    formatLabel: string;
    caseCount: number;
    sourceManifest?: RouterOutputs["importJobs"]["previewQTest"]["sourceManifest"];
    previewRows: FilePreviewRow[];
    skipped: { rowNumber: number; reason: string }[];
  } | null>(null);
  const [manifestNeedsRefresh, setManifestNeedsRefresh] = useState(false);

  // qTest-only connection state - a live API, not a file, so there's no
  // rawContent to hold; the connection details are re-sent to commitQTest
  // directly rather than persisted anywhere (see importJobs.ts's own note
  // on why this stays a one-shot input, not a stored credential).
  const [qtestBaseUrl, setQtestBaseUrl] = useState("");
  const [qtestApiToken, setQtestApiToken] = useState("");
  const [qtestProjectId, setQtestProjectId] = useState("");

  // Zephyr Scale-only connection state - same one-shot-input reasoning as
  // qTest's, but no instance URL (Zephyr Scale Cloud's API host is fixed).
  const [zephyrApiToken, setZephyrApiToken] = useState("");
  const [zephyrProjectKey, setZephyrProjectKey] = useState("");

  const commitCsvMutation = trpcReact.importJobs.commitCsv.useMutation();
  const commitGoogleSheetsMutation = trpcReact.importJobs.commitGoogleSheets.useMutation();
  const commitXlsxMutation = trpcReact.importJobs.commitXlsx.useMutation();
  const commitXrayMutation = trpcReact.importJobs.commitXray.useMutation();
  const commitTestRailMutation =
    trpcReact.importJobs.commitTestRail.useMutation();
  const commitQTestMutation = trpcReact.importJobs.commitQTest.useMutation();
  const commitZephyrMutation = trpcReact.importJobs.commitZephyr.useMutation();
  const previewXlsxSheetMutation =
    trpcReact.importJobs.previewXlsxSheet.useMutation();
  const previewCsvMutation = trpcReact.importJobs.previewCsv.useMutation();
  const previewWithMappingMutation =
    trpcReact.importJobs.previewWithMapping.useMutation();
  const previewXrayMutation = trpcReact.importJobs.previewXray.useMutation();
  const previewTestRailMutation =
    trpcReact.importJobs.previewTestRail.useMutation();
  const previewQTestMutation = trpcReact.importJobs.previewQTest.useMutation();
  const previewZephyrMutation =
    trpcReact.importJobs.previewZephyr.useMutation();

  function reset() {
    activeFileRead.current?.abort();
    activeFileRead.current = null;
    setLoading(false);
    setWorkbookCheckpoints(null);
    setStep("source");
    setImportMethod(null);
    setSource(null);
    setFileName("");
    setRawContent("");
    setGoogleSnapshots([]);
    setError(null);
    setCsvPreview(null);
    setMapping({});
    setCsvPreviewRows([]);
    setCsvRowOverrides({});
    setXlsxBase64("");
    setXlsxPreview(null);
    setSelectedSheets(new Set());
    setXlsxMappings({});
    setXlsxRowOverrides({});
    setFilePreview(null);
    setManifestNeedsRefresh(false);
    setResult(null);
    setQtestBaseUrl("");
    setQtestApiToken("");
    setQtestProjectId("");
    setZephyrApiToken("");
    setZephyrProjectKey("");
  }

  function chooseSource(s: Source) {
    setSource(s);
    setStep("upload");
    setError(null);
  }

  async function loadGoogleSheets(snapshots: GoogleSheetSnapshot[]) {
    activeFileRead.current?.abort();
    const controller = new AbortController();
    activeFileRead.current = controller;
    setError(null); setLoading(true); setCsvPreview(null); setXlsxPreview(null);
    setRawContent(""); setGoogleSnapshots([]); setMapping({});
    setCsvPreviewRows([]); setCsvRowOverrides({}); setTypeReview(null);
    try {
      const sheets = [];
      for (const snapshot of snapshots) {
        const res = await previewCsvMutation.mutateAsync({ projectId, csvText: snapshot.csvText });
        if (controller.signal.aborted || activeFileRead.current !== controller) return;
        sheets.push({ name: snapshot.label, headerRow: 1, ...res, skippedCount: res.previewSkipped.length });
      }
      setFileName("Google Sheets selection"); setGoogleSnapshots(snapshots); setExpandedGoogleSheet(sheets[0]?.name ?? null);
      setXlsxPreview({ sheets }); setXlsxBase64("");
      setSelectedSheets(new Set(sheets.map(sheet => sheet.name)));
      setXlsxMappings(Object.fromEntries(sheets.map(sheet => [sheet.name, sheet.suggestedMapping])));
      setXlsxRowOverrides(Object.fromEntries(sheets.map(sheet => [sheet.name, rowRecord(sheet.incompleteRows)])));
    } catch (error) { if (!controller.signal.aborted) setError(importErrorMessage(error)); }
    finally { if (activeFileRead.current === controller) setLoading(false); }
  }

  async function loadFile(file: File) {
    if (!source) return;
    activeFileRead.current?.abort();
    const controller = new AbortController();
    activeFileRead.current = controller;
    setWorkbookCheckpoints(null);
    setError(null);
    setFileName(file.name);
    setCsvPreview(null);
    setXlsxPreview(null);
    setXlsxBase64("");
    setLoading(true);
    try {
      if (source === "csv") {
        if (file.name.toLowerCase().endsWith(".xlsx")) {
          setWorkbookCheckpoints(0);
          const fileBase64 = await readFileAsBase64(file);
          const res = await readWorkbookPreview<XlsxPreview>({
            start: requestId => utils.client.importJobs.startXlsxRead.mutate({ projectId, requestId, fileBase64 }),
            status: requestId => utils.client.importJobs.xlsxReadStatus.query({ projectId, requestId }),
            cancel: requestId => utils.client.importJobs.cancelXlsxRead.mutate({ projectId, requestId }),
          }, controller.signal, setWorkbookCheckpoints);
          if (activeFileRead.current !== controller || controller.signal.aborted) return;
          const usableSheets = res.sheets.filter(
            (sheet) => sheet.suggestedMapping.title,
          );
          setXlsxBase64(fileBase64);
          setXlsxPreview(res);
          setSelectedSheets(new Set(usableSheets.map((sheet) => sheet.name)));
          setXlsxMappings(
            Object.fromEntries(
              res.sheets.map((sheet) => [sheet.name, sheet.suggestedMapping]),
            ),
          );
          setXlsxRowOverrides(
            Object.fromEntries(
              res.sheets.map((sheet) => [
                sheet.name,
                rowRecord(sheet.incompleteRows),
              ]),
            ),
          );
          return;
        }
        const text = await readFileAsText(file);
        setRawContent(text);
        const res = await previewCsvMutation.mutateAsync({
          projectId,
          csvText: text,
        });
        setCsvPreview(res);
        const suggested = res.suggestedMapping as Partial<
          Record<TargetField, string>
        >;
        setMapping(suggested);
        setCsvPreviewRows(res.previewRows);
        setCsvRowOverrides(rowRecord(res.incompleteRows));
      } else if (source === "xray") {
        const text = await readFileAsText(file);
        setRawContent(text);
        const res = await previewXrayMutation.mutateAsync({
          projectId,
          content: text,
        });
        setFilePreview({
          format: res.format,
          formatLabel:
            res.format === "jira-csv" ? "Jira CSV export" : "Xray JSON export",
          caseCount: res.caseCount,
          previewRows: res.previewRows,
          skipped: res.skipped,
        });
        setStep("review");
      } else {
        const text = await readFileAsText(file);
        setRawContent(text);
        const res = await previewTestRailMutation.mutateAsync({
          projectId,
          content: text,
        });
        setFilePreview({
          format: res.format,
          formatLabel: "TestRail XML export",
          caseCount: res.caseCount,
          previewRows: res.previewRows,
          skipped: res.skipped,
        });
        setStep("review");
      }
    } catch (e) {
      if (activeFileRead.current === controller) setError(importErrorMessage(e));
    } finally {
      if (activeFileRead.current === controller) {
        activeFileRead.current = null;
        setLoading(false);
        setWorkbookCheckpoints(null);
      }
    }
  }

  async function connectQTest() {
    const parsedProjectId = Number(qtestProjectId);
    if (
      !qtestBaseUrl.trim() ||
      !qtestApiToken.trim() ||
      !Number.isFinite(parsedProjectId)
    )
      return;
    setError(null);
    setLoading(true);
    setManifestNeedsRefresh(true);
    try {
      const res = await previewQTestMutation.mutateAsync({
        projectId,
        baseUrl: qtestBaseUrl.trim(),
        apiToken: qtestApiToken.trim(),
        qtestProjectId: parsedProjectId,
      });
      setFilePreview({
        format: res.format,
        formatLabel: "qTest project",
        caseCount: res.caseCount,
        sourceManifest: res.sourceManifest,
        previewRows: res.previewRows,
        skipped: res.skipped,
      });
      setManifestNeedsRefresh(false);
      setStep("review");
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function connectZephyr() {
    if (!zephyrApiToken.trim() || !zephyrProjectKey.trim()) return;
    setError(null);
    setLoading(true);
    setManifestNeedsRefresh(true);
    try {
      const res = await previewZephyrMutation.mutateAsync({
        projectId,
        apiToken: zephyrApiToken.trim(),
        zephyrProjectKey: zephyrProjectKey.trim(),
      });
      setFilePreview({
        format: res.format,
        formatLabel: "Zephyr Scale project",
        caseCount: res.caseCount,
        sourceManifest: res.sourceManifest,
        previewRows: res.previewRows,
        skipped: res.skipped,
      });
      setManifestNeedsRefresh(false);
      setStep("review");
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function updateMapping(field: TargetField, column: string) {
    const next = reassignImportColumn(mapping, field, column);
    setMapping(next);
    setCsvPreviewRows([]);
    setError(null);
    if (!next.title) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await previewWithMappingMutation.mutateAsync({
        projectId,
        csvText: rawContent,
        mapping: next as Record<TargetField, string>,
        overrides: Object.values(csvRowOverrides),
      });
      setCsvPreviewRows(res.previewRows);
      setCsvPreview(current => current ? { ...current, nonCaseRows: res.nonCaseRows, previewSkipped: res.previewSkipped, rowMappingSuggestions: res.rowMappingSuggestions, recommendations: res.recommendations } : current);
      setCsvRowOverrides((current) =>
        reconcileRowOverrides(current, res.incompleteRows),
      );
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function updateXlsxMapping(
    sheetName: string,
    field: TargetField,
    column: string,
  ) {
    const previousMapping = xlsxMappings[sheetName] ?? {};
    const nextMapping = reassignImportColumn(previousMapping, field, column);
    setXlsxMappings((current) => ({ ...current, [sheetName]: nextMapping }));
    setXlsxPreview(current => current ? { sheets: current.sheets.map(sheet => sheet.name === sheetName ? { ...sheet, previewRows: [] } : sheet) } : current);
    setError(null);
    if (!nextMapping.title) setSelectedSheets(current => { const next = new Set(current); next.delete(sheetName); return next; });
    else if (!previousMapping.title) setSelectedSheets(current => new Set(current).add(sheetName));
    if (!nextMapping.title) return;
    setLoading(true);
    setError(null);
    try {
      const googleSnapshot = googleSnapshots.find(snapshot => snapshot.label === sheetName);
      const res = importMethod === "google-sheets" && googleSnapshot
        ? await previewWithMappingMutation.mutateAsync({ projectId, csvText: googleSnapshot.csvText, mapping: nextMapping as Record<TargetField, string>, overrides: Object.values(xlsxRowOverrides[sheetName] ?? {}) }).then(result => ({ ...result, skippedCount: result.previewSkipped.length }))
        : await previewXlsxSheetMutation.mutateAsync({ projectId, fileBase64: xlsxBase64, sheetName, mapping: nextMapping as Record<TargetField, string>, overrides: Object.values(xlsxRowOverrides[sheetName] ?? {}) });
      setXlsxPreview((current) =>
        current
          ? {
              sheets: current.sheets.map((sheet) =>
                sheet.name === sheetName
                  ? {
                      ...sheet,
                      suggestedMapping: nextMapping,
                      previewRows: res.previewRows,
                      incompleteRows: res.incompleteRows,
                      skippedCount: res.skippedCount,
                      nonCaseRows: res.nonCaseRows ?? [],
                      rowMappingSuggestions: res.rowMappingSuggestions ?? [],
                      recommendations: res.recommendations ?? [],
                    }
                  : sheet,
              ),
            }
          : current,
      );
      setXlsxRowOverrides((current) => ({
        ...current,
        [sheetName]: reconcileRowOverrides(
          current[sheetName] ?? {},
          res.incompleteRows,
        ),
      }));
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  function updateCsvRepair(row: EditableImportRow) {
    setCsvRowOverrides((current) => ({
      ...current,
      [row.rowNumber]: row,
    }));
  }

  function updateXlsxRepair(sheetName: string, row: EditableImportRow) {
    setXlsxRowOverrides((current) => ({
      ...current,
      [sheetName]: {
        ...(current[sheetName] ?? {}),
        [row.rowNumber]: row,
      },
    }));
  }

  async function commit() {
    if (typeReviewBlocked) return;
    setError(null);
    try {
      let res: FileCommitResult;
      if (source === "csv") {
        if (xlsxPreview) {
          const sheets = [...selectedSheets]
            .map((name) => ({
              name,
              mapping: xlsxMappings[name],
              overrides: Object.values(xlsxRowOverrides[name] ?? {}),
            }))
            .filter(
              (
                sheet,
              ): sheet is {
                name: string;
                mapping: Record<TargetField, string>;
                overrides: EditableImportRow[];
              } => Boolean(sheet.mapping?.title),
            );
          if (sheets.length === 0) return;
          if (importMethod === "google-sheets") {
            res = await commitGoogleSheetsMutation.mutateAsync({ projectId, sourceLabel: fileName, sheets: sheets.map(sheet => {
              const snapshot = googleSnapshots.find(snapshot => snapshot.label === sheet.name);
              if (!snapshot || !sheet.mapping.externalId) throw new Error(`${sheet.name}: map a stable case ID column so re-imports update the same cases safely.`);
              return { source: snapshot.source, name: sheet.name, csvText: snapshot.csvText, mapping: sheet.mapping, overrides: sheet.overrides };
            }) });
          } else {
            res = await commitXlsxMutation.mutateAsync({ projectId, fileBase64: xlsxBase64, sourceLabel: fileName, typeAnalysisRequestId: currentTypeReview?.requestId, sheets });
          }
        } else {
          if (!mapping.title) return;
          res = await commitCsvMutation.mutateAsync({
            projectId,
            csvText: rawContent,
            mapping: mapping as Record<TargetField, string>,
            overrides: Object.values(csvRowOverrides),
            sourceLabel: fileName || undefined,
            typeAnalysisRequestId: importMethod === "google-sheets" ? undefined : currentTypeReview?.requestId,
          });
        }
      } else if (source === "xray") {
        res = await commitXrayMutation.mutateAsync({
          projectId,
          content: rawContent,
          sourceLabel: fileName || undefined,
        });
      } else if (source === "testrail") {
        res = await commitTestRailMutation.mutateAsync({
          projectId,
          content: rawContent,
          sourceLabel: fileName || undefined,
        });
      } else if (source === "qtest") {
        const parsedProjectId = Number(qtestProjectId);
        if (!Number.isFinite(parsedProjectId) || !filePreview?.sourceManifest || manifestNeedsRefresh || loading) return;
        res = await commitQTestMutation.mutateAsync({
          projectId,
          baseUrl: qtestBaseUrl.trim(),
          apiToken: qtestApiToken.trim(),
          qtestProjectId: parsedProjectId,
          expectedManifest: filePreview.sourceManifest,
          sourceLabel: `qTest project ${qtestProjectId}`,
        });
      } else {
        if (!filePreview?.sourceManifest || manifestNeedsRefresh || loading) return;
        res = await commitZephyrMutation.mutateAsync({
          projectId,
          apiToken: zephyrApiToken.trim(),
          zephyrProjectKey: zephyrProjectKey.trim(),
          expectedManifest: filePreview.sourceManifest,
          sourceLabel: `Zephyr project ${zephyrProjectKey}`,
        });
      }
      setResult(res);
      setStep("done");
      onCommitted();
    } catch (e) {
      if ((source === "qtest" || source === "zephyr") && typeof e === "object" && e !== null && "data" in e && (e.data as {code?: string} | undefined)?.code === "CONFLICT") setManifestNeedsRefresh(true);
      setError(importErrorMessage(e));
    }
  }

  const committing =
    commitCsvMutation.isPending || commitGoogleSheetsMutation.isPending ||
    commitXlsxMutation.isPending ||
    commitXrayMutation.isPending ||
    commitTestRailMutation.isPending ||
    commitQTestMutation.isPending ||
    commitZephyrMutation.isPending;
  const stepNumber = { source: 1, upload: 2, review: 3, done: 4 }[step];
  const totalSteps = 4;
  const unresolvedCsvRows = Object.values(csvRowOverrides).filter(
    (row) => !row.title.trim(),
  );
  const unresolvedXlsxRows = [...selectedSheets].flatMap((sheetName) =>
    Object.values(xlsxRowOverrides[sheetName] ?? {}).filter(
      (row) => !row.title.trim(),
    ),
  );
  const missingGoogleIds = importMethod === "google-sheets" && [...selectedSheets].some(name => !xlsxMappings[name]?.externalId);

  return (
    <div className={`panel${importMethod === "google-sheets" ? " google-sheets-migration" : ""}`} style={{ marginBottom: 20 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h2 style={{ marginTop: 0 }}>Migration assistant</h2>
        {step !== "source" && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12 }}
            onClick={reset}
          >
            Start over
          </button>
        )}
      </div>
      <p className="text-muted" style={{ fontSize: 12, marginTop: -4 }}>
        Step {stepNumber} of {totalSteps}
      </p>

      {step === "source" && (
        <>
          <p className="text-muted" style={{ fontSize: 13 }}>
            How should Vaettir receive the test cases?
          </p>
          <div className="import-method-grid">
            {(
              [
                [
                  "google-sheets",
                  "Google Sheets",
                  "Choose a spreadsheet with Google authorization, then map and review a worksheet.",
                ],
                [
                  "api",
                  "Connect an API",
                  "Pull cases directly from the source system and preview them before import.",
                ],
                [
                  "webhook",
                  "Webhook intake",
                  "Check availability for continuous test-case imports.",
                ],
                [
                  "file",
                  "Upload an export",
                  "Drop in CSV, Excel, XML, or JSON. Vaettir detects the vendor and fields.",
                ],
              ] as const
            ).map(([value, label, detail]) => (
              <button
                key={value}
                type="button"
                className={`import-method-card${importMethod === value ? " selected" : ""}`}
                onClick={() => {
                  setImportMethod(value);
                  setSource(value === "google-sheets" ? "csv" : null);
                  if (value === "google-sheets") setStep("upload");
                }}
              >
                <span className="import-method-icon" aria-hidden="true">
                  {value === "api" ? "↔" : value === "webhook" ? "⌁" : "⇧"}
                </span>
                <span>
                  <strong>{label}</strong>
                  <small>{detail}</small>
                </span>
              </button>
            ))}
          </div>
          {importMethod === "webhook" && (
            <div className="panel" style={{ padding: 14 }}>
              <strong>
                Continuous test-case imports are not available yet
              </strong>
              <p
                className="text-muted"
                style={{ margin: "4px 0 10px", fontSize: 13 }}
              >
                Existing notification and incident webhooks do not import test
                cases. Use a supported API or upload an export to map and review
                cases now.
              </p>
              <button
                className="btn-primary"
                onClick={() => setImportMethod("file")}
              >
                Import a file
              </button>
            </div>
          )}
          {(importMethod === "api" || importMethod === "file") && (
            <div className="source-chip-list">
              {(Object.keys(SOURCE_INFO) as Source[])
                .filter((s) =>
                  importMethod === "api"
                    ? s === "qtest" || s === "zephyr"
                    : s === "csv" || s === "testrail" || s === "xray",
                )
                .map((s) => (
                  <button
                    key={s}
                    onClick={() => chooseSource(s)}
                    className="source-connection-chip"
                  >
                    <span
                      className={`provider-mark provider-${s}`}
                      aria-hidden="true"
                    >
                      {SOURCE_INFO[s].mark}
                    </span>
                    <span>
                      <strong>{SOURCE_INFO[s].label}</strong>
                      <small>{importMethod === "api" ? "Connect API" : s === "csv" ? "CSV / Excel" : s === "testrail" ? "XML export" : "CSV / JSON export"}</small>
                    </span>
                  </button>
                ))}
            </div>
          )}
        </>
      )}

      {step === "upload" &&
        source &&
        importMethod !== "google-sheets" &&
        source !== "qtest" &&
        source !== "zephyr" && (
          <>
            <p className="text-muted" style={{ fontSize: 13 }}>
              {SOURCE_INFO[source].blurb}
            </p>
            <input
              type="file"
              accept={SOURCE_INFO[source].accept}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void loadFile(file);
                e.target.value = "";
              }}
            />
            {loading && <div role="status" aria-live="polite" style={{ marginTop: 12 }}>
              <progress aria-label="Reading export" style={{ width: "100%", maxWidth: 420 }} />
              <p className="text-muted">{workbookCheckpoints === null ? "Reading export…" : workbookCheckpoints < 3 ? "Opening Excel workbook…" : "Reading worksheets and preparing your preview…"}</p>
              {workbookCheckpoints !== null && <button className="btn-secondary" type="button" onClick={() => activeFileRead.current?.abort()}>Cancel reading</button>}
            </div>}
          </>
        )}

      {step === "upload" && importMethod === "google-sheets" && <>
        <GoogleSheetsImportSource key={projectId} projectId={projectId} disabled={loading} onSnapshots={loadGoogleSheets} />
        {googleSnapshots.length > 0 && <p role="status">Loaded {googleSnapshots.length} worksheets. Review the mappings below. No cases have been saved.</p>}
        {loading && <p role="status">Preparing your selected worksheet for review…</p>}
      </>}

      {step === "upload" && source === "qtest" && (
        <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {SOURCE_INFO.qtest.blurb} Nothing is stored beyond this one import -
            the token isn&apos;t saved.
          </p>
          <label style={{ fontSize: 13 }}>
            qTest instance URL
            <input
              value={qtestBaseUrl}
              onChange={(e) => setQtestBaseUrl(e.target.value)}
              placeholder="https://yourcompany.qtestnet.com"
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            API token
            <input
              type="password"
              value={qtestApiToken}
              onChange={(e) => setQtestApiToken(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            qTest project ID
            <input
              value={qtestProjectId}
              onChange={(e) => setQtestProjectId(e.target.value)}
              placeholder="12345"
              style={{ width: "100%" }}
            />
          </label>
          <button
            onClick={connectQTest}
            disabled={
              loading ||
              !qtestBaseUrl.trim() ||
              !qtestApiToken.trim() ||
              !qtestProjectId.trim()
            }
            style={{ marginTop: 4 }}
          >
            {loading ? "Connecting…" : "Connect and scan"}
          </button>
        </div>
      )}

      {step === "upload" && source === "zephyr" && (
        <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {SOURCE_INFO.zephyr.blurb} Nothing is stored beyond this one import
            - the token isn&apos;t saved.
          </p>
          <label style={{ fontSize: 13 }}>
            API token
            <input
              type="password"
              value={zephyrApiToken}
              onChange={(e) => setZephyrApiToken(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label style={{ fontSize: 13 }}>
            Jira project key
            <input
              value={zephyrProjectKey}
              onChange={(e) => setZephyrProjectKey(e.target.value)}
              placeholder="PROJ"
              style={{ width: "100%" }}
            />
          </label>
          <button
            onClick={connectZephyr}
            disabled={
              loading || !zephyrApiToken.trim() || !zephyrProjectKey.trim()
            }
            style={{ marginTop: 4 }}
          >
            {loading ? "Connecting…" : "Connect and scan"}
          </button>
        </div>
      )}

      {source === "csv" && typeCases.length > 0 && (step === "upload" || step === "review") && <section className="panel" aria-label="Automatic test type review" style={{ marginTop: 16 }}>
        <strong>{typeReviewPending ? "Reading each case’s testing objective…" : currentTypeReview?.error ? "Type review needs attention" : "Test-type review complete"}</strong>
        <p className="text-muted">Included free with import. No AI credits are deducted and no cases are imported. Recommendations read the complete mapped title, preconditions, actions, results and context. Uncertain cases stay For review.</p>
        <progress aria-label="Cases reviewed for test type" max={typeCases.length} value={currentTypeReview?.state?.completed ?? 0} style={{ width: "100%" }} />
        <p role="status">{currentTypeReview?.state?.completed ?? 0} of {typeCases.length} cases reviewed{currentTypeReview?.state?.failed ? ` · ${currentTypeReview.state.failed} could not be verified` : ""}</p>
        {currentTypeReview?.error && <p role="alert">{currentTypeReview.error}</p>}
        {(currentTypeReview?.error || currentTypeReview?.state?.failed) && <button className="btn-secondary" type="button" onClick={() => setTypeRetry(value => value + 1)}>Retry type review</button>}
      </section>}

      {step === "upload" && source === "csv" && xlsxPreview && (
        <div className="xlsx-mapping-workspace">
          <div className="xlsx-workbook-heading">
            <div>
              <h3>Review workbook — {fileName}</h3>
              <p className="text-muted">
                {xlsxPreview.sheets.length} worksheets detected. Columns are matched automatically.
                Change any mapping below to update the preview before importing.
              </p>
            </div>
            <span className="status-pill status-info">
              {selectedSheets.size} selected
            </span>
          </div>
          <div className="xlsx-sheet-list">
            {xlsxPreview.sheets.map((sheet) => {
              const selected = selectedSheets.has(sheet.name);
              const sheetMapping = xlsxMappings[sheet.name] ?? {};
              const repairRows = Object.values(
                xlsxRowOverrides[sheet.name] ?? {},
              );
              return (
                <section
                  key={sheet.name}
                  className={`xlsx-sheet-card${selected ? " is-selected" : ""}`}
                >
                  <div className="xlsx-sheet-heading">
                    <label>
                      <input
                        type="checkbox"
                        checked={selected}
                        disabled={!sheetMapping.title}
                        onChange={(event) =>
                          setSelectedSheets((current) => {
                            const next = new Set(current);
                            if (event.target.checked) next.add(sheet.name);
                            else next.delete(sheet.name);
                            return next;
                          })
                        }
                      />
                      <span>
                        <strong>{sheet.name}</strong>
                        <small>
                          {sheet.rowCount} data row(s)
                          {sheet.headerRow
                            ? ` · header on row ${sheet.headerRow}`
                            : ""}
                        </small>
                      </span>
                    </label>
                    {sheet.warning && (
                      <span className="status-pill status-warning">
                        {sheet.warning}
                      </span>
                    )}
                  </div>
                  {importMethod === "google-sheets" && <button type="button" className="btn-secondary" aria-expanded={expandedGoogleSheet === sheet.name} onClick={() => setExpandedGoogleSheet(current => current === sheet.name ? null : sheet.name)}>{expandedGoogleSheet === sheet.name ? "Collapse fields" : "Review fields"}<span className="sr-only"> for {sheet.name}</span></button>}
                  {sheet.headers.length > 0 && (importMethod !== "google-sheets" || expandedGoogleSheet === sheet.name) && (
                    <>
                      <div className="xlsx-field-grid">
                        {TARGET_FIELDS.map((field) => (
                          <label key={field}>
                            {FIELD_LABELS[field]}
                            {(field === "title" || (field === "externalId" && importMethod === "google-sheets")) && (
                              <span className="text-error"> *</span>
                            )}
                            <select
                              disabled={loading}
                              value={sheetMapping[field] ?? ""}
                              onChange={(event) =>
                                void updateXlsxMapping(
                                  sheet.name,
                                  field,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">{field === "title" ? "Choose a title column" : field === "testType" ? (importMethod === "google-sheets" ? "Unclassified · For review" : "Recommend from case text") : field === "priority" ? "Default: Medium" : field === "automationStatus" ? "Default: Manual" : "Not imported"}</option>
                              {[...new Set(sheet.headers.filter(header => header.trim()))].map((header) => (
                                <option key={header} value={header}>
                                  {header}
                                </option>
                              ))}
                            </select>
                          </label>
                        ))}
                      </div>
                      {sheet.previewRows.length > 0 && (
                        <div className="table-scroll xlsx-preview-table">
                          <table className="workspace-table">
                            <thead>
                              <tr>
                                <th>Row</th>
                                <th>Title</th>
                                <th>Preconditions</th>
                                <th>Actions / procedure</th>
                                <th>Expected</th>
                                <th>Tags</th>
                                <th>Type</th>
                                <th>Automation</th>
                                <th>Priority</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sheet.previewRows.slice(0, 5).map(row => xlsxRowOverrides[sheet.name]?.[row.rowNumber] ?? row).map((row) => (
                                <tr key={row.rowNumber}>
                                  <td>{row.rowNumber}</td>
                                  <td>{row.title}</td>
                                  <td style={{ whiteSpace: "pre-wrap" }}>{row.given.join("\n") || "—"}</td>
                                  <td style={{ whiteSpace: "pre-wrap" }}>{row.when.join("\n") || "—"}</td>
                                  <td style={{ whiteSpace: "pre-wrap" }}>{row.then.join("\n") || "—"}</td>
                                  <td>{row.tags.join(", ") || "—"}</td>
                                  <td>{displayedType(sheet.name, row)}</td>
                                  <td>{row.automationStatus}</td>
                                  <td>{row.priority}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {repairRows.length > 0 && (
                        <details
                          className="import-repair-panel"
                          open
                        >
                          <summary>
                            Review {repairRows.length} row edits
                          </summary>
                          <p className="text-muted">
                            Review or edit any field before continuing. Empty case
                            names must be completed; tags and external IDs remain separate.
                          </p>
                          {repairRows.map((row) => (
                            <RowRepairEditor
                              key={row.rowNumber}
                              row={row}
                              recommendation={sheetTypeResults(sheet.name)[row.rowNumber]}
                              onChange={(next) =>
                                updateXlsxRepair(sheet.name, next)
                              }
                            />
                          ))}
                        </details>
                      )}
                      <RowMappingReview suggestions={sheet.rowMappingSuggestions} overrides={xlsxRowOverrides[sheet.name] ?? {}} onChange={row => updateXlsxRepair(sheet.name, row)} />
                      <ImportRecommendations manualOnly={importMethod === "google-sheets"} rows={importReviewRows(sheet.recommendations, xlsxRowOverrides[sheet.name] ?? {})} overrides={xlsxRowOverrides[sheet.name] ?? {}} analysis={sheetTypeResults(sheet.name)} onChange={row => updateXlsxRepair(sheet.name, row)} />
                      <NonCaseRowsReview
                        rows={sheet.nonCaseRows}
                        overrides={xlsxRowOverrides[sheet.name] ?? {}}
                        onInclude={row => updateXlsxRepair(sheet.name, row)}
                      />
                    </>
                  )}
                </section>
              );
            })}
          </div>
          <button
            onClick={() => setStep("review")}
            disabled={
              loading ||
              Boolean(error) ||
              selectedSheets.size === 0 ||
              unresolvedXlsxRows.length > 0
              || missingGoogleIds
            }
          >
            Review import scope
          </button>
          {missingGoogleIds && <p role="status" className="xlsx-sheet-note">Map a Case ID or External ID column for each selected tab. Every case needs a unique, stable ID so repeating an import updates the same case safely.</p>}
          {unresolvedXlsxRows.length > 0 && (
            <p className="xlsx-sheet-note" role="status">
              Complete {unresolvedXlsxRows.length} required title field(s) to
              continue. Rows with test content are retained for repair.
            </p>
          )}
        </div>
      )}

      {step === "upload" && source === "csv" && csvPreview && !xlsxPreview && (
        <div style={{ marginTop: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <h3 style={{ margin: 0 }}>Map columns — {fileName}</h3>
          </div>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {csvPreview.rowCount} data row(s) found. Columns are matched automatically;
            change any mapping below to correct it. &quot;Title&quot; is
            required; leave any other field unmapped to skip it. Map
            &quot;External ID&quot; to a column with a stable per-row id to make
            this import re-runnable.
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 12,
              maxWidth: 500,
            }}
          >
            {TARGET_FIELDS.map((field) => (
              <label key={field} style={{ fontSize: 13 }}>
                {FIELD_LABELS[field]}
                {field === "title" && (
                  <span style={{ color: "var(--ember)" }}> *</span>
                )}
                <select
                  disabled={loading}
                  value={mapping[field] ?? ""}
                  onChange={(e) => void updateMapping(field, e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">{field === "title" ? "Choose a title column" : field === "testType" ? (importMethod === "google-sheets" ? "Unclassified · For review" : "Recommend from case text") : field === "priority" ? "Default: Medium" : field === "automationStatus" ? "Default: Manual" : "Not imported"}</option>
                  {[...new Set(csvPreview.headers.filter(header => header.trim()))].map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>

          <h4 style={{ marginTop: 16 }}>
            Preview (first {csvPreviewRows.length} row(s))
          </h4>
          {!mapping.title && (
            <p style={{ color: "var(--ember)" }}>
              Map a column to Title to see a preview.
            </p>
          )}
          {csvPreviewRows.length > 0 && (
            <div style={{ overflowX: "auto" }}>
              <table
                style={{
                  width: "100%",
                  fontSize: 12,
                  borderCollapse: "collapse",
                }}
              >
                <thead>
                  <tr>
                    <th style={{ textAlign: "left" }}>Row</th>
                    <th style={{ textAlign: "left" }}>Title</th>
                    <th style={{ textAlign: "left" }}>Preconditions</th>
                    <th style={{ textAlign: "left" }}>Actions / procedure</th>
                    <th style={{ textAlign: "left" }}>Expected results</th>
                    <th style={{ textAlign: "left" }}>Type</th>
                    <th style={{ textAlign: "left" }}>Automation</th>
                    <th style={{ textAlign: "left" }}>Priority</th>
                    <th style={{ textAlign: "left" }}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreviewRows.map(row => csvRowOverrides[row.rowNumber] ?? row).map((r) => (
                    <tr
                      key={r.rowNumber}
                      style={{ borderTop: "1px solid var(--line)" }}
                    >
                      <td className="text-muted">{r.rowNumber}</td>
                      <td>{r.title}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{r.given.join("\n")}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{r.when.join("\n")}</td>
                      <td style={{ whiteSpace: "pre-wrap" }}>{r.then.join("\n")}</td>
                      <td>{displayedType("", r)}</td>
                      <td>{r.automationStatus}</td>
                      <td>{r.priority}</td>
                      <td>{r.tags.join(", ")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {Object.values(csvRowOverrides).length > 0 && (
            <details
              className="import-repair-panel"
              open
            >
              <summary>
                Review {Object.values(csvRowOverrides).length} row edits
              </summary>
              <p className="text-muted">
                Review or edit any field before continuing. Empty case names must
                be completed; tags and external IDs remain separate.
              </p>
              {Object.values(csvRowOverrides).map((row) => (
                <RowRepairEditor
                  key={row.rowNumber}
                  row={row}
                  recommendation={sheetTypeResults("")[row.rowNumber]}
                  onChange={updateCsvRepair}
                />
              ))}
            </details>
          )}
          <RowMappingReview suggestions={csvPreview.rowMappingSuggestions} overrides={csvRowOverrides} onChange={updateCsvRepair} />
          <ImportRecommendations rows={importReviewRows(csvPreview.recommendations, csvRowOverrides)} overrides={csvRowOverrides} analysis={sheetTypeResults("")} onChange={updateCsvRepair} />
          <NonCaseRowsReview rows={csvPreview.nonCaseRows} overrides={csvRowOverrides} onInclude={updateCsvRepair} />

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setStep("review")}
              disabled={loading || Boolean(error) || !mapping.title || unresolvedCsvRows.length > 0}
            >
              Review scope
            </button>
          </div>
          {unresolvedCsvRows.length > 0 && (
            <p className="xlsx-sheet-note" role="status">
              Complete {unresolvedCsvRows.length} required title field(s) to
              continue. Rows with test content are retained for repair.
            </p>
          )}
        </div>
      )}

      {step === "review" && source === "csv" && xlsxPreview && (
        <div>
          <h3 style={{ marginTop: 0 }}>Ready to import — {fileName}</h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {selectedSheets.size} worksheet(s),{" "}
            {xlsxPreview.sheets
              .filter((sheet) => selectedSheets.has(sheet.name))
              .reduce((sum, sheet) => sum + sheet.rowCount - remainingNonCaseRows(sheet.nonCaseRows, xlsxRowOverrides[sheet.name] ?? {}).length, 0)}{" "}
            test cases. {xlsxPreview.sheets.filter(sheet => selectedSheets.has(sheet.name)).reduce((sum, sheet) => sum + remainingNonCaseRows(sheet.nonCaseRows, xlsxRowOverrides[sheet.name] ?? {}).length, 0)} context rows or placeholders are not standalone cases.
            {importMethod === "google-sheets" && <>Re-imports match the same spreadsheet, tab and case ID. Human edits are preserved; conflicts are skipped and listed in the result. No source rows are deleted. </>}
            Each worksheet becomes a suite; proposed sections and notes are preserved on its cases. Suggestions remain For review after import. Stable source IDs are
            preserved for safe re-imports. Nothing is written until you confirm.
          </p>
          <div className="xlsx-review-list">
            {xlsxPreview.sheets
              .filter((sheet) => selectedSheets.has(sheet.name))
              .map((sheet) => (
                <span key={sheet.name}>
                  <strong>{sheet.name}</strong>
                  {sheet.rowCount - remainingNonCaseRows(sheet.nonCaseRows, xlsxRowOverrides[sheet.name] ?? {}).length} cases · {remainingNonCaseRows(sheet.nonCaseRows, xlsxRowOverrides[sheet.name] ?? {}).length} context / placeholder rows
                </span>
              ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => setStep("upload")}>
              Back to mapping
            </button>
            <button
              onClick={commit}
              disabled={committing || typeReviewBlocked || selectedSheets.size === 0 || missingGoogleIds}
            >
              {committing ? "Importing…" : "Import selected worksheets"}
            </button>
          </div>
        </div>
      )}

      {step === "review" && source === "csv" && !xlsxPreview && (
        <div>
          <h3 style={{ marginTop: 0 }}>Ready to import — {fileName}</h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            {(csvPreview?.rowCount ?? 0) - remainingNonCaseRows(csvPreview?.nonCaseRows, csvRowOverrides).length} test cases. {remainingNonCaseRows(csvPreview?.nonCaseRows, csvRowOverrides).length} context rows or placeholders are not standalone cases. Sections and notes are preserved on cases; suggestions remain For review after import. Any incomplete source rows were repaired
            before this step. Nothing is written until you confirm.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => setStep("upload")}>
              Back to mapping
            </button>
            <button onClick={commit} disabled={committing || typeReviewBlocked}>
              {committing
                ? "Importing…"
                : `Import ${(csvPreview?.rowCount ?? 0) - remainingNonCaseRows(csvPreview?.nonCaseRows, csvRowOverrides).length} cases`}
            </button>
          </div>
        </div>
      )}

      {step === "review" && filePreview && source !== "csv" && (
        <div>
          <h3 style={{ marginTop: 0 }}>
            Ready to import —{" "}
            {source === "qtest"
              ? `qTest project ${qtestProjectId}`
              : source === "zephyr"
                ? `Zephyr project ${zephyrProjectKey}`
                : fileName}
          </h3>
          <p className="text-muted" style={{ fontSize: 13 }}>
            Detected {filePreview.formatLabel} · {filePreview.caseCount} test
            case(s) will be imported
            {filePreview.skipped.length > 0 &&
              `, ${filePreview.skipped.length} row(s) skipped`}
            . Nothing is written until you confirm.
          </p>
          {(source === "qtest" || source === "zephyr") && <p className="text-muted" style={{fontSize:13}}>The full {filePreview.caseCount}-case source manifest is frozen for this review; the table below is a display sample only. Import rechecks the entire source and stops without writes if cases, steps, order or skipped rows changed. Refreshing preview requires a new review.</p>}
          {source === "qtest" && <p role="note" className="text-muted" style={{fontSize:13}}>qTest scope: cases inside modules only. Root-level or unfiled test cases are not fetched or included in this count. Import those separately with a supported export.</p>}
          <div style={{ overflowX: "auto", overflowY: "auto", maxHeight: 320 }}>
            <table
              style={{
                width: "100%",
                fontSize: 12,
                borderCollapse: "collapse",
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Key</th>
                  <th style={{ textAlign: "left" }}>Title</th>
                  <th style={{ textAlign: "left" }}>Type</th>
                  <th style={{ textAlign: "left" }}>Priority</th>
                  <th style={{ textAlign: "left" }}>Suite</th>
                  <th style={{ textAlign: "left" }}>Tags</th>
                </tr>
              </thead>
              <tbody>
                {filePreview.previewRows.map((r, i) => (
                  <tr
                    key={`${r.key}-${i}`}
                    style={{ borderTop: "1px solid var(--line)" }}
                  >
                    <td className="text-muted">{r.key}</td>
                    <td>{r.title}</td>
                    <td>{r.testType}</td>
                    <td>{r.priority}</td>
                    <td>{r.suitePath ?? ""}</td>
                    <td>{r.tags.join(", ")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {filePreview.caseCount > filePreview.previewRows.length && (
            <p className="text-muted" style={{ fontSize: 12 }}>
              Showing the first {filePreview.previewRows.length} of{" "}
              {filePreview.caseCount}. This sample is not a full case-by-case preview.
            </p>
          )}
          {filePreview.skipped.length > 0 && (
            <p className="text-muted" style={{ fontSize: 12 }}>
              Skipped:{" "}
              {filePreview.skipped
                .slice(0, 5)
                .map((s) => `row ${s.rowNumber} (${s.reason})`)
                .join("; ")}
              {filePreview.skipped.length > 5 &&
                ` and ${filePreview.skipped.length - 5} more`}
            </p>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            {(source === "qtest" || source === "zephyr") && <button type="button" className="btn-secondary" disabled={committing || loading} onClick={()=>void (source === "qtest" ? connectQTest() : connectZephyr())}>{loading ? "Refreshing preview…" : "Refresh preview"}</button>}
            <button className="btn-secondary" onClick={() => setStep("upload")}>
              {source === "qtest" || source === "zephyr"
                ? "Change connection"
                : "Choose a different file"}
            </button>
            <button
              onClick={commit}
              disabled={committing || loading || filePreview.caseCount === 0 || ((source === "qtest" || source === "zephyr") && (manifestNeedsRefresh || !filePreview.sourceManifest))}
            >
              {committing
                ? "Importing…"
                : `Import ${filePreview.caseCount} test case(s)`}
            </button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div>
          <h3 style={{ marginTop: 0, color: "var(--frost)" }}>
            Import complete
          </h3>
          <p>
            Imported {result.createdCount} test case(s)
            {result.updatedCount > 0 &&
              `, updated ${result.updatedCount} existing case(s)`}
            {result.skipped.length > 0 &&
              `, skipped ${result.skipped.length} row(s)`}
            .
          </p>
          <button onClick={reset}>Import another</button>
        </div>
      )}

      {error && <p role="alert" style={{ color: "var(--ember)" }}>{error}</p>}
    </div>
  );
}
