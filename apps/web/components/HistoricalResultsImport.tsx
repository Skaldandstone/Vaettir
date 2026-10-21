"use client";

import { useRef, useState } from "react";
import { trpcReact, type RouterOutputs } from "../lib/trpcReact";
import { GoogleSheetsImportSource } from "./GoogleSheetsImportSource";
import { splitCsvRows } from "../../api/src/services/csvFieldMapping";

type Review = RouterOutputs["testRuns"]["previewHistorical"];
type Result = RouterOutputs["testRuns"]["commitHistorical"];
type Sheet = { name: string; csvText: string | null; headers: string[]; warning?: string };
type Status = "PASS" | "FAIL" | "SKIP" | "BLOCKED" | "FLAKY" | "IGNORE";
const known: Record<string, Status> = { pass: "PASS", passed: "PASS", success: "PASS", fail: "FAIL", failed: "FAIL", failure: "FAIL", skip: "SKIP", skipped: "SKIP", blocked: "BLOCKED", flaky: "FLAKY", "not run": "IGNORE", "not executed": "IGNORE", untested: "IGNORE", pending: "IGNORE", "": "IGNORE" };
const alias = (values: string[], names: string[]) => values.find(value => names.includes(value.trim().toLowerCase().replace(/[_-]+/g, " ")) ) ?? "";

export function HistoricalResultsImport({ projectId }: { projectId: string }) {
  const [method, setMethod] = useState<"file" | "google">("file");
  const [sheets, setSheets] = useState<Sheet[]>([]), [sheetName, setSheetName] = useState("");
  const [csv, setCsv] = useState(""), [sourceRef, setSourceRef] = useState(""), [headers, setHeaders] = useState<string[]>([]);
  const [caseColumn, setCaseColumn] = useState(""), [titleColumn, setTitleColumn] = useState(""), [resultColumn, setResultColumn] = useState(""), [dateColumn, setDateColumn] = useState(""), [noteColumn, setNoteColumn] = useState("");
  const [runDate, setRunDate] = useState(""), [dateFormat, setDateFormat] = useState<"iso" | "mdy" | "dmy" | "excel1900">("iso"), [runLabel, setRunLabel] = useState("");
  const [statusValues, setStatusValues] = useState<string[]>([]), [statusMap, setStatusMap] = useState<Record<string, Status>>({}), [caseSelections, setCaseSelections] = useState<Record<string, string>>({});
  const [review, setReview] = useState<Review | null>(null), [result, setResult] = useState<Result | null>(null), [dirty, setDirty] = useState(true), [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const previewMutation = trpcReact.testRuns.previewHistorical.useMutation(), commitMutation = trpcReact.testRuns.commitHistorical.useMutation(), workbookMutation = trpcReact.importJobs.historicalWorkbook.useMutation();
  const utils = trpcReact.useUtils();
  function changed() { setDirty(true); setApproved(false); setError(null); setResult(null); }
  function loadSource(text: string, reference: string) {
    if (new TextEncoder().encode(text).length > 1024 * 1024) throw new Error("Choose at most 1 MiB of worksheet content.");
    const rows = splitCsvRows(text, true), columns = (rows.shift() ?? []).map(x => x.trim());
    if (!columns.length || columns.some(x => !x) || new Set(columns).size !== columns.length) throw new Error("Use unique column names in the first row.");
    if (!rows.length || rows.length > 2500) throw new Error("Choose a worksheet with 1–2,500 result rows.");
    setCsv(text); setSourceRef(reference); setHeaders(columns);
    setCaseColumn(alias(columns, ["case id", "external id", "test id", "id", "test case id"]));
    setTitleColumn(alias(columns, ["title", "test name", "test case", "test case name", "test case title"]));
    const status = alias(columns, ["result", "status", "test result", "actual result", "execution status"]);
    chooseResult(status, rows, columns); setRunLabel(status || "Historical results");
    setDateColumn(alias(columns, ["run date", "execution date", "executed on", "date"])); setNoteColumn(alias(columns, ["note", "notes", "comment", "comments", "actual outcome"]));
    setCaseSelections({}); setReview(null); setRunDate(""); changed();
  }
  function chooseResult(column: string, rows = splitCsvRows(csv, true).slice(1), columns = headers) {
    setResultColumn(column);
    const values = column ? [...new Set(rows.map(row => (row[columns.indexOf(column)] ?? "").trim()))].slice(0, 101) : [];
    setStatusValues(values); setStatusMap(Object.fromEntries(values.flatMap(value => {
      const normalized = value.toLowerCase().replace(/\s+/g, " ");
      return Object.hasOwn(known, normalized) ? [[value, known[normalized]!]] : [];
    }))); changed();
  }
  async function upload(file?: File) {
    if (!file || busy) return;
    const ticket = ++generation.current; setBusy(true); setError(null); setCsv(""); setReview(null); setSheets([]); setResult(null); setApproved(false);
    try {
      if (/\.csv$/i.test(file.name)) { if (file.size > 1024 * 1024) throw new Error("CSV history is limited to 1 MiB. Split the worksheet first."); const text = await file.text(); if (generation.current === ticket) loadSource(text, `file:${file.name}`); }
      else if (/\.xlsx$/i.test(file.name)) {
        if (file.size > 32 * 1024 * 1024) throw new Error("Excel uploads are limited to 32 MiB.");
        const data = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1] ?? ""); reader.onerror = () => reject(new Error("Could not read the workbook.")); reader.readAsDataURL(file); });
        const response = await workbookMutation.mutateAsync({ projectId, fileBase64: data });
        if (generation.current !== ticket) return;
        setSheets(response.sheets); setSourceRef(`file:${file.name}`); setSheetName("");
      } else throw new Error("Choose a CSV or modern Excel (.xlsx) export. For a document table, paste it into a worksheet and export it first.");
    } catch (cause) { if (generation.current === ticket) setError(cause instanceof Error ? cause.message : "Could not read the results source."); }
    finally { if (generation.current === ticket) setBusy(false); }
  }
  const request = { projectId, sourceRef, runLabel, csvText: csv, mapping: { caseId: caseColumn || undefined, title: titleColumn || undefined, result: resultColumn, date: dateColumn || undefined, note: noteColumn || undefined }, dateFormat, runDate, statusMap, caseSelections };
  async function preview() {
    const ticket = ++generation.current; setBusy(true); setError(null); setApproved(false);
    try { const value = await previewMutation.mutateAsync(request); if (ticket === generation.current) { setReview(value); setDirty(false); setResult(null); } }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review the results."); }
    finally { if (ticket === generation.current) setBusy(false); }
  }
  async function commit() {
    if (!review || dirty || !approved || review.blockedCount || !review.matchedCount || busy) return;
    setBusy(true); setError(null);
    try { setResult(await commitMutation.mutateAsync({ ...request, expectedDigest: review.fingerprint, acknowledgeHistoricalObservation: true })); await utils.testRuns.list.invalidate({ projectId }); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Results were not recorded. You can retry the same reviewed import safely."); }
    finally { setBusy(false); }
  }
  const column = (label: string, value: string, onChange: (value: string) => void, none: string) => <label>{label}<select aria-label={label} value={value} disabled={busy} onChange={event => { onChange(event.target.value); changed(); }} style={{ display: "block", maxWidth: "100%" }}><option value="">{none}</option>{headers.map(header => <option key={header}>{header}</option>)}</select></label>;
  return <section className="panel" aria-label="Historical result import" style={{ marginBlock: 20, overflowWrap: "anywhere" }}>
    <h2>Backfill historical test run results</h2>
    <p>Start with the original test-plan worksheet or results export. Choose a result column and the dates it was recorded, then review which existing Vaettir cases match. Case definitions and procedures are kept intact.</p>
    <details><summary>Where can I get old results?</summary><ul><li><strong>Google Sheets:</strong> choose the original spreadsheet and the tab with result columns.</li><li><strong>Excel:</strong> upload the original .xlsx workbook, then choose its results tab. A CSV export also works.</li><li><strong>A column from an imported test plan:</strong> reopen its original file or sheet. Unmapped result columns are not recoverable from the imported case definitions.</li><li><strong>A Google Docs or Word table:</strong> copy the relevant table into a worksheet and export CSV/Excel. This connection reads Google Sheets, not Google Docs.</li></ul><p>Use stable case IDs where available. If each execution has its own result column, import one column and its date at a time. Blank or “Not run” cells do not become executions.</p></details>
    <fieldset disabled={busy} style={{ border: 0, padding: 0, minWidth: 0 }}><legend>1. Choose the source</legend>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, marginBlock: 12 }}>{([ ["file", "Excel or CSV"], ["google", "Google Sheets"] ] as const).map(([key, label]) => <label key={key}><input type="radio" name="historical-source" checked={method === key} onChange={() => { generation.current++; setMethod(key); setCsv(""); setSheets([]); setSheetName(""); setReview(null); changed(); }} /> {label}</label>)}</div>
      {method === "file" ? <label>Original workbook or results export<input aria-label="Historical results file" type="file" accept=".csv,.xlsx" onChange={event => { void upload(event.target.files?.[0]); event.target.value = ""; }} style={{ display: "block" }} /></label> : <GoogleSheetsImportSource projectId={projectId} disabled={busy} maxWorksheets={1} purpose="results" onSnapshots={async (snapshots, signal) => { if (signal.aborted) return; const snapshot = snapshots[0]; if (!snapshot || snapshots.length !== 1) throw new Error("Choose one historical results worksheet."); loadSource(snapshot.csvText, `google-sheets:${snapshot.source.spreadsheetId}:${snapshot.source.sheetId}`); }} />}
      {sheets.length > 0 && <label>Worksheet<select aria-label="Historical worksheet" value={sheetName} onChange={event => { setSheetName(event.target.value); const sheet = sheets.find(item => item.name === event.target.value); setCsv(""); setReview(null); changed(); try { if (!sheet?.csvText) throw new Error(sheet?.warning ?? "Choose a tab with a header row, or export that tab as CSV."); loadSource(sheet.csvText, sourceRef.split("#")[0] + "#" + sheet.name); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not read this worksheet."); } }}><option value="">Choose a results tab</option>{sheets.map(sheet => <option key={sheet.name}>{sheet.name}</option>)}</select></label>}
    </fieldset>
    {csv && <><fieldset disabled={busy} style={{ minWidth: 0, marginTop: 20 }}><legend>2. Choose columns and real dates</legend><p className="text-muted">Source: {sourceRef}</p><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 210px), 1fr))", gap: 14 }}>
      {column("Case ID column", caseColumn, setCaseColumn, "Use title matching instead")}
      {column("Case title column", titleColumn, setTitleColumn, "Not used")}
      {column("Result column", resultColumn, value => chooseResult(value), "Choose the column containing past results")}
      {column("Run date column", dateColumn, setDateColumn, "Enter one date for this result column")}
      {column("Result notes column", noteColumn, setNoteColumn, "No notes")}
      {dateColumn ? <label>Date format<select aria-label="Historical date format" value={dateFormat} onChange={event => { setDateFormat(event.target.value as typeof dateFormat); changed(); }}><option value="iso">YYYY-MM-DD</option><option value="mdy">Month/day/year</option><option value="dmy">Day/month/year</option><option value="excel1900">Excel 1900 date numbers</option></select></label> : <label>Original run date<input aria-label="Original historical run date" type="date" value={runDate} onChange={event => { setRunDate(event.target.value); changed(); }} style={{ display: "block" }} /></label>}
      <label>Run label<input aria-label="Historical run label" value={runLabel} onChange={event => { setRunLabel(event.target.value); changed(); }} style={{ display: "block" }} /></label>
    </div><p className="text-muted">Dates are required; today is never filled in for you. Only the day is known; this does not recreate original execution times or step evidence.</p>
    {statusValues.length > 0 && <details open={statusValues.some(value => !Object.hasOwn(statusMap, value))}><summary>Review result meanings</summary><div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>{statusValues.map(value => <label key={value}>{value || "(blank)"}<select aria-label={`Meaning of ${value || "blank"}`} value={statusMap[value] ?? ""} onChange={event => { setStatusMap(current => ({ ...current, [value]: event.target.value as Status })); changed(); }} style={{ display: "block" }}><option value="">Choose meaning</option>{(["PASS", "FAIL", "SKIP", "BLOCKED", "FLAKY", "IGNORE"] as const).map(status => <option key={status} value={status}>{status === "IGNORE" ? "No execution record / leave out" : status}</option>)}</select></label>)}</div></details>}
    </fieldset>{statusValues.length > 100 && <p role="alert">This column has more than 100 distinct values. Choose a result/status column or split the worksheet.</p>}<button type="button" className="btn-primary" disabled={busy || !resultColumn || (!caseColumn && !titleColumn) || !runLabel.trim() || (!dateColumn && !runDate) || statusValues.length > 100} onClick={() => void preview()} style={{ marginTop: 14 }}>{busy ? "Working…" : review ? "Refresh result review" : "Review historical results"}</button></>}
    {review && <section aria-label="Historical results review" style={{ marginTop: 20 }}><h3>3. Review matches before saving</h3><p>{review.matchedCount} ready · {review.ignoredCount} without execution · {review.blockedCount} need attention · {review.runCount} run date(s)</p>{dirty && <p role="status">Selections changed. Refresh the review before importing.</p>}<p className="text-muted">Review every row. On a small screen, scroll the table horizontally to see the case matches.</p><div role="region" aria-label="Historical results rows" tabIndex={0} style={{ overflowX: "auto" }}><table style={{ minWidth: 680, width: "100%" }}><thead><tr><th>Row</th><th>Source case</th><th>Recorded result</th><th>Date</th><th>Vaettir case / review</th></tr></thead><tbody>{review.rows.map(row => <tr key={row.rowNumber}><td>{row.rowNumber}</td><td>{row.key || row.title}</td><td>{row.rawStatus || "(blank)"} → {row.status === "IGNORE" ? "No execution record" : row.status ?? "Choose meaning"}</td><td>{row.date || "—"}</td><td>{row.caseTitle ?? "No unique match"}{row.issues.map(issue => <p key={issue} style={{ color: "var(--ember)" }}>{issue}</p>)}{row.status !== "IGNORE" && <details><summary>Choose a different case</summary><label>Vaettir case ID<input aria-label={`Vaettir case ID for row ${row.rowNumber}`} value={caseSelections[String(row.rowNumber)] ?? ""} onChange={event => { setCaseSelections(current => ({ ...current, [row.rowNumber]: event.target.value })); changed(); }} disabled={busy} /></label>{row.candidates.map(candidate => <button key={candidate.id} type="button" disabled={busy} onClick={() => { setCaseSelections(current => ({ ...current, [row.rowNumber]: candidate.id })); changed(); }}>{candidate.title} · {candidate.id}</button>)}</details>}</td></tr>)}</tbody></table></div>
      <label style={{ display: "block", marginBlock: 14 }}><input type="checkbox" checked={approved} onChange={event => setApproved(event.target.checked)} disabled={busy || dirty || review.blockedCount > 0 || !review.matchedCount || Boolean(result)} /> I confirm these dates, case matches and results are historical observations. They do not reverify the current procedure.</label><button type="button" className="btn-primary" disabled={busy || dirty || !approved || review.blockedCount > 0 || !review.matchedCount || Boolean(result)} onClick={() => void commit()}>{busy ? "Recording results…" : "Import reviewed historical results"}</button><p className="text-muted">All reviewed dates are committed together. An identical retry reuses the recorded runs; changed history is never silently overwritten.</p>
    </section>}
    {error && <p role="alert" style={{ color: "var(--ember)" }}>{error}</p>}
    {result && <section role="status"><h3>Historical results recorded</h3><p>{result.importedCount} new observations · {result.replayedCount} already recorded</p><ul>{result.runs.map(run => <li key={run.id}><a href={`/projects/${projectId}/test-runs#run-${run.id}`}>{run.date} · {run.results} results{run.replayed ? " · existing run" : ""}</a></li>)}</ul></section>}
  </section>;
}
