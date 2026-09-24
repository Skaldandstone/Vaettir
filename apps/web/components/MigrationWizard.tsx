"use client";

import { useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";

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

const TARGET_FIELDS = [
  "title",
  "given",
  "when",
  "then",
  "priority",
  "tags",
  "externalId",
] as const;
type TargetField = (typeof TARGET_FIELDS)[number];
const FIELD_LABELS: Record<TargetField, string> = {
  title: "Title",
  given: "Given (preconditions)",
  when: "When (steps)",
  then: "Then (expected result)",
  priority: "Priority",
  tags: "Tags",
  externalId: "External ID (for re-import)",
};

const SOURCE_INFO: Record<
  Source,
  { label: string; blurb: string; accept: string }
> = {
  csv: {
    label: "Spreadsheet or vendor export",
    blurb:
      "CSV or Excel (.xlsx) from Qase, Tricentis, TestRail, qTest, or another test system. Vaettir detects sheets, headers, and likely fields before anything is written.",
    accept:
      ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  },
  testrail: {
    label: "TestRail",
    blurb: "TestRail → open the suite → Test Cases → Export → XML.",
    accept: ".xml,text/xml,application/xml",
  },
  xray: {
    label: "Xray (Jira)",
    blurb:
      "A Jira Test-issue CSV export (JQL: issuetype = Test), or Xray's own JSON test export.",
    accept: ".csv,.json,text/csv,application/json",
  },
  qtest: {
    label: "qTest",
    blurb:
      "Connect directly with your qTest instance URL and a personal API token - no file needed.",
    accept: "",
  },
  zephyr: {
    label: "Zephyr Scale",
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
        title:
          row.title.trim() ||
          row.externalId?.trim() ||
          row.tags[0]?.trim() ||
          "",
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
  return value
    .split(/\r?\n/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function RowRepairEditor({
  row,
  onChange,
}: {
  row: EditableImportRow;
  onChange: (next: EditableImportRow) => void;
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
        Preconditions
        <textarea
          rows={3}
          value={row.given.join("\n")}
          onChange={(event) => updateLines("given", event.target.value)}
          placeholder="One item per line"
        />
      </label>
      <label>
        Steps
        <textarea
          rows={3}
          value={row.when.join("\n")}
          onChange={(event) => updateLines("when", event.target.value)}
          placeholder="One step per line"
        />
      </label>
      <label>
        Expected results
        <textarea
          rows={3}
          value={row.then.join("\n")}
          onChange={(event) => updateLines("then", event.target.value)}
          placeholder="One result per line"
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
  const [source, setSource] = useState<Source | null>(null);
  const [fileName, setFileName] = useState("");
  const [rawContent, setRawContent] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
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

  // TestRail/Xray preview state
  const [filePreview, setFilePreview] = useState<{
    format: string;
    formatLabel: string;
    caseCount: number;
    previewRows: FilePreviewRow[];
    skipped: { rowNumber: number; reason: string }[];
  } | null>(null);

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
  const commitXlsxMutation = trpcReact.importJobs.commitXlsx.useMutation();
  const commitXrayMutation = trpcReact.importJobs.commitXray.useMutation();
  const commitTestRailMutation =
    trpcReact.importJobs.commitTestRail.useMutation();
  const commitQTestMutation = trpcReact.importJobs.commitQTest.useMutation();
  const commitZephyrMutation = trpcReact.importJobs.commitZephyr.useMutation();
  const previewXlsxMutation = trpcReact.importJobs.previewXlsx.useMutation();
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
    setStep("source");
    setSource(null);
    setFileName("");
    setRawContent("");
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

  async function loadFile(file: File) {
    if (!source) return;
    setError(null);
    setFileName(file.name);
    setCsvPreview(null);
    setXlsxPreview(null);
    setXlsxBase64("");
    setLoading(true);
    try {
      if (source === "csv") {
        if (file.name.toLowerCase().endsWith(".xlsx")) {
          const fileBase64 = await readFileAsBase64(file);
          const res = await previewXlsxMutation.mutateAsync({
            projectId,
            fileBase64,
          });
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
      setError(importErrorMessage(e));
    } finally {
      setLoading(false);
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
        previewRows: res.previewRows,
        skipped: res.skipped,
      });
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
        previewRows: res.previewRows,
        skipped: res.skipped,
      });
      setStep("review");
    } catch (e) {
      setError(importErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  async function updateMapping(field: TargetField, column: string) {
    const next = { ...mapping, [field]: column || undefined };
    setMapping(next);
    if (!next.title) {
      setCsvPreviewRows([]);
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
    const nextMapping = {
      ...xlsxMappings[sheetName],
      [field]: column || undefined,
    };
    setXlsxMappings((current) => ({ ...current, [sheetName]: nextMapping }));
    if (!nextMapping.title) return;
    setLoading(true);
    setError(null);
    try {
      const res = await previewXlsxSheetMutation.mutateAsync({
        projectId,
        fileBase64: xlsxBase64,
        sheetName,
        mapping: nextMapping as Record<TargetField, string>,
        overrides: Object.values(xlsxRowOverrides[sheetName] ?? {}),
      });
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
          res = await commitXlsxMutation.mutateAsync({
            projectId,
            fileBase64: xlsxBase64,
            sourceLabel: fileName,
            sheets,
          });
        } else {
          if (!mapping.title) return;
          res = await commitCsvMutation.mutateAsync({
            projectId,
            csvText: rawContent,
            mapping: mapping as Record<TargetField, string>,
            overrides: Object.values(csvRowOverrides),
            sourceLabel: fileName || undefined,
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
        if (!Number.isFinite(parsedProjectId)) return;
        res = await commitQTestMutation.mutateAsync({
          projectId,
          baseUrl: qtestBaseUrl.trim(),
          apiToken: qtestApiToken.trim(),
          qtestProjectId: parsedProjectId,
          sourceLabel: `qTest project ${qtestProjectId}`,
        });
      } else {
        res = await commitZephyrMutation.mutateAsync({
          projectId,
          apiToken: zephyrApiToken.trim(),
          zephyrProjectKey: zephyrProjectKey.trim(),
          sourceLabel: `Zephyr project ${zephyrProjectKey}`,
        });
      }
      setResult(res);
      setStep("done");
      onCommitted();
    } catch (e) {
      setError(importErrorMessage(e));
    }
  }

  const committing =
    commitCsvMutation.isPending ||
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

  return (
    <div className="panel" style={{ marginBottom: 20 }}>
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
            Where is your test case data coming from?
          </p>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              maxWidth: 720,
            }}
          >
            {(Object.keys(SOURCE_INFO) as Source[]).map((s) => (
              <button
                key={s}
                onClick={() => chooseSource(s)}
                style={{
                  textAlign: "left",
                  border: "1px solid var(--line)",
                  borderRadius: 8,
                  padding: 12,
                  background: "transparent",
                  cursor: "pointer",
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  {SOURCE_INFO[s].label}
                </div>
                <div className="text-muted" style={{ fontSize: 12 }}>
                  {SOURCE_INFO[s].blurb}
                </div>
              </button>
            ))}
          </div>
        </>
      )}

      {step === "upload" &&
        source &&
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
            {loading && <p className="text-muted">Reading export…</p>}
          </>
        )}

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

      {step === "upload" && source === "csv" && xlsxPreview && (
        <div className="xlsx-mapping-workspace">
          <div className="xlsx-workbook-heading">
            <div>
              <h3>Review workbook — {fileName}</h3>
              <p className="text-muted">
                {xlsxPreview.sheets.length} worksheet(s) detected. Choose the
                sheets to import and verify each suggested mapping.
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
              const unresolvedRepairCount = repairRows.filter(
                (row) => !row.title.trim(),
              ).length;
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
                  {sheet.headers.length > 0 && (
                    <>
                      <div className="xlsx-field-grid">
                        {TARGET_FIELDS.map((field) => (
                          <label key={field}>
                            {FIELD_LABELS[field]}
                            {field === "title" && (
                              <span className="text-error"> *</span>
                            )}
                            <select
                              value={sheetMapping[field] ?? ""}
                              onChange={(event) =>
                                void updateXlsxMapping(
                                  sheet.name,
                                  field,
                                  event.target.value,
                                )
                              }
                            >
                              <option value="">— not mapped —</option>
                              {sheet.headers.map((header) => (
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
                                <th>Steps</th>
                                <th>Expected</th>
                                <th>Priority</th>
                              </tr>
                            </thead>
                            <tbody>
                              {sheet.previewRows.slice(0, 5).map((row) => (
                                <tr key={row.rowNumber}>
                                  <td>{row.rowNumber}</td>
                                  <td>{row.title}</td>
                                  <td>{row.when.join(" · ") || "—"}</td>
                                  <td>{row.then.join(" · ") || "—"}</td>
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
                          open={unresolvedRepairCount > 0}
                        >
                          <summary>
                            Review {repairRows.length} incomplete source row(s)
                          </summary>
                          <p className="text-muted">
                            Vaettir retained these rows and suggested titles
                            from stable IDs or section tags when possible.
                            Review or edit any field before continuing.
                          </p>
                          {repairRows.map((row) => (
                            <RowRepairEditor
                              key={row.rowNumber}
                              row={row}
                              onChange={(next) =>
                                updateXlsxRepair(sheet.name, next)
                              }
                            />
                          ))}
                        </details>
                      )}
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
              selectedSheets.size === 0 ||
              unresolvedXlsxRows.length > 0
            }
          >
            Review import scope
          </button>
          {unresolvedXlsxRows.length > 0 && (
            <p className="xlsx-sheet-note" role="status">
              Complete {unresolvedXlsxRows.length} required title field(s) to
              continue. No rows will be dropped.
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
            {csvPreview.rowCount} data row(s) found. &quot;Title&quot; is
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
                  value={mapping[field] ?? ""}
                  onChange={(e) => void updateMapping(field, e.target.value)}
                  style={{ width: "100%" }}
                >
                  <option value="">— not mapped —</option>
                  {csvPreview.headers.map((h) => (
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
                    <th style={{ textAlign: "left" }}>Given</th>
                    <th style={{ textAlign: "left" }}>When</th>
                    <th style={{ textAlign: "left" }}>Then</th>
                    <th style={{ textAlign: "left" }}>Priority</th>
                    <th style={{ textAlign: "left" }}>Tags</th>
                  </tr>
                </thead>
                <tbody>
                  {csvPreviewRows.map((r) => (
                    <tr
                      key={r.rowNumber}
                      style={{ borderTop: "1px solid var(--line)" }}
                    >
                      <td className="text-muted">{r.rowNumber}</td>
                      <td>{r.title}</td>
                      <td>{r.given.join(" | ")}</td>
                      <td>{r.when.join(" | ")}</td>
                      <td>{r.then.join(" | ")}</td>
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
              open={unresolvedCsvRows.length > 0}
            >
              <summary>
                Review {Object.values(csvRowOverrides).length} incomplete source
                row(s)
              </summary>
              <p className="text-muted">
                Vaettir retained these rows and suggested titles from stable IDs
                or section tags when possible. Review or edit any field before
                continuing.
              </p>
              {Object.values(csvRowOverrides).map((row) => (
                <RowRepairEditor
                  key={row.rowNumber}
                  row={row}
                  onChange={updateCsvRepair}
                />
              ))}
            </details>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button
              onClick={() => setStep("review")}
              disabled={!mapping.title || unresolvedCsvRows.length > 0}
            >
              Review scope
            </button>
          </div>
          {unresolvedCsvRows.length > 0 && (
            <p className="xlsx-sheet-note" role="status">
              Complete {unresolvedCsvRows.length} required title field(s) to
              continue. No rows will be dropped.
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
              .reduce((sum, sheet) => sum + sheet.rowCount, 0)}{" "}
            source row(s). Each worksheet becomes a suite. Stable source IDs are
            preserved for safe re-imports. Nothing is written until you confirm.
          </p>
          <div className="xlsx-review-list">
            {xlsxPreview.sheets
              .filter((sheet) => selectedSheets.has(sheet.name))
              .map((sheet) => (
                <span key={sheet.name}>
                  <strong>{sheet.name}</strong>
                  {sheet.rowCount} rows · {sheet.previewRows.length} previewed
                </span>
              ))}
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => setStep("upload")}>
              Back to mapping
            </button>
            <button
              onClick={commit}
              disabled={committing || selectedSheets.size === 0}
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
            {csvPreviewRows.length} row(s) shown of {csvPreview?.rowCount ?? 0}{" "}
            total will be created. Any incomplete source rows were repaired
            before this step. Nothing is written until you confirm.
          </p>
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn-secondary" onClick={() => setStep("upload")}>
              Back to mapping
            </button>
            <button onClick={commit} disabled={committing}>
              {committing
                ? "Importing…"
                : `Import ${csvPreview?.rowCount ?? 0} row(s)`}
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
              {filePreview.caseCount}.
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
            <button className="btn-secondary" onClick={() => setStep("upload")}>
              {source === "qtest" || source === "zephyr"
                ? "Change connection"
                : "Choose a different file"}
            </button>
            <button
              onClick={commit}
              disabled={committing || filePreview.caseCount === 0}
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

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
    </div>
  );
}
