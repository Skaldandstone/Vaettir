import { renderCurrentManualRunRecordJson } from "./manual-run-record-export.ts";
import { technicalBehaviorLabel } from "./case-authoring-fields.ts";
import { hasTextControl } from "./control-characters.ts";

type ReportCase = {
  testCaseId: string;
  displayId: string | null;
  title: string;
  validationDomain: string;
  given: readonly string[];
  when: readonly string[];
  then: readonly string[];
  steps: readonly {
    action: string;
    expectedActionOrData: string | null;
    expectedResult: string | null;
    expectedResponse: string | null;
    mediaAttachmentIds: readonly string[];
  }[];
  prerequisiteIds: readonly string[];
  currentResult: { status: string } | null;
  stepResults: readonly unknown[];
};
type Report = {
  projectId: string; runId: string; status: string;
  executionContext: unknown; stepFieldLabels: Record<string, string>;
  cases: readonly ReportCase[];
};
const escape = (value: string | number) => {
  const source = String(value);
  if (hasTextControl(source) || /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(source)) throw new Error("Portable text contains unsupported control or Unicode characters. No content was substituted or exported.");
  return source.replace(/[&<>"'\r]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;", "\r": "&#13;" })[character]!);
};
const text = (value: string | null) => value === null
  ? '<em>Not supplied (NULL)</em>' : value === ""
    ? '<em>Explicit empty text</em>' : `<pre>${escape(value)}</pre>`;
const json = (value: unknown) => `<pre>${escape(JSON.stringify(value, null, 2))}</pre>`;

/** Offline text-only HTML from the complete already-authorized response. Never
 * fetches media, substitutes current definitions, or emits active user HTML. */
export function renderCurrentManualRunPortableHtml(record: Report): string {
  const source = JSON.parse(renderCurrentManualRunRecordJson(record));
  const recorded = record.cases.filter(testCase => testCase.currentResult !== null).length;
  const total = record.cases.length;
  const outcomes = ["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"];
  const counts = outcomes.map(outcome => record.cases.filter(testCase => testCase.currentResult?.status === outcome).length);
  const known = counts.reduce((sum, value) => sum + value, 0);
  const summary = [...outcomes.map((outcome, index) => ({ outcome, count: counts[index], tone: outcome.toLowerCase() })), { outcome: "OTHER RECORDED", count: recorded - known, tone: "other" }, { outcome: "UNTESTED", count: total - recorded, tone: "untested" }];
  const ids = new Map(record.cases.map(testCase => [testCase.testCaseId, testCase.displayId ?? testCase.testCaseId]));
  const label = (key: string, fallback: string) => escape(key === "expectedActionOrData" ? technicalBehaviorLabel(record.stepFieldLabels[key]) : record.stepFieldLabels[key] ?? fallback);
  const content = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Vaettir current run ${escape(record.runId)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;color:#172c32;background:#fff;max-width:1100px;margin:24px auto;padding:20px}h1,h2,h3{line-height:1.2}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere;margin:0}section,article{border:1px solid #c8d3d5;border-radius:10px;padding:16px;margin:16px 0}dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px}dd{margin:0;overflow-wrap:anywhere}.outcomes{display:flex;gap:8px;flex-wrap:wrap}.outcome{padding:8px 12px;border-radius:6px;border:1px solid #bdc9cc;background:#eef2f3}.pass{background:#dcecdf}.fail{background:#ffe0dc}.blocked,.flaky{background:#fff0cc}.step{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;border-top:1px solid #cad4d7;padding:12px 0}.field{min-width:0}.field strong{display:block}progress{width:100%;height:20px}li{overflow-wrap:anywhere}details{margin:12px 0}@media(max-width:600px){body{padding:12px;margin:0}.step{grid-template-columns:1fr}dl{grid-template-columns:1fr}}@media print{body{max-width:none;margin:0;padding:0}article{break-inside:avoid}.step{break-inside:avoid}details> *{display:block!important}summary{font-weight:bold}}
</style></head><body><h1>Current manual run report</h1><dl><dt>Run</dt><dd>${escape(record.runId)}</dd><dt>Project</dt><dd>${escape(record.projectId)}</dd><dt>Status</dt><dd>${escape(record.status)}</dd></dl><section aria-label="Current progress"><h2>${total ? Math.round(recorded * 100 / total) : 0}% recorded · ${total - recorded} left to test</h2><progress max="${total || 1}" value="${recorded}">${recorded}/${total}</progress><div class="outcomes">${summary.map(row => `<span class="outcome ${row.tone}">${row.outcome}: ${row.count}</span>`).join("")}</div><p>Recorded progress is not pass rate or release acceptance.</p></section><section><h2>Evidence boundary</h2><ul>${Object.values(source.evidenceBoundary).map(value => `<li>${escape(String(value))}</li>`).join("")}</ul><p>Offline text-only report. Use your browser Print command to print or save as PDF. No attachment files are embedded.</p></section>${record.cases.map(testCase => `<article><h2>${escape(testCase.displayId ?? testCase.testCaseId)} · ${escape(testCase.title)}</h2><p>${escape(testCase.validationDomain)} · ${escape(testCase.currentResult?.status ?? "UNTESTED")}</p><h3>Prerequisite cases (not procedure steps)</h3>${testCase.prerequisiteIds.length ? `<ul>${testCase.prerequisiteIds.map(id => `<li>${escape(ids.get(id) ?? id)}</li>`).join("")}</ul>` : '<p>None in this response</p>'}${(["given", "when", "then"] as const).map(phase => testCase[phase].length ? `<h3>${phase.charAt(0).toUpperCase() + phase.slice(1)}</h3><ol>${testCase[phase].map(value => `<li>${text(value)}</li>`).join("")}</ol>` : "").join("")}<h3>Procedure</h3>${testCase.steps.length ? testCase.steps.map((step, index) => `<section><h3>Step ${index + 1}</h3><div class="step"><div class="field"><strong>${label("action", "Tester action")}</strong>${text(step.action)}</div><div class="field"><strong>${label("expectedActionOrData", "Technical behavior / data")}</strong>${text(step.expectedActionOrData)}</div><div class="field"><strong>${label("expectedResult", "Expected result")}</strong>${text(step.expectedResult)}</div><div class="field"><strong>${label("expectedResponse", "Expected response")}</strong>${text(step.expectedResponse)}</div></div><p>Attachment identifiers only</p>${json(step.mediaAttachmentIds)}</section>`).join("") : '<p>No classic steps in this response; any Given/When/Then procedure is above.</p>'}<h3>Current case observation</h3>${json(testCase.currentResult)}<h3>Present step heads (not complete revision history)</h3>${json(testCase.stepResults)}</article>`).join("")}<section><details><summary>Present execution configuration and saved context</summary>${json(record.executionContext)}</details></section></body></html>`;
  if (new TextEncoder().encode(content).byteLength > 8 * 1024 * 1024) throw new Error("Portable report exceeds the 8 MiB limit. No cases or procedures were silently truncated.");
  return content;
}
