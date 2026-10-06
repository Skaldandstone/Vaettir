import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { renderCurrentManualRunPortableHtml } from "./manual-run-portable-report.ts";
const record = { projectId: "synthetic-project", runId: "synthetic-run", status: "RUNNING", executionContext: { version: 1 }, stepFieldLabels: { action: "Tester action", expectedActionOrData: "Technical behavior" }, cases: [{ testCaseId: "case-1", displayId: "TC-1", title: "<script>alert(1)</script>", validationDomain: "SOFTWARE", given: ["", " retained\ncontext "], when: ["Click"], then: ["Observe"], prerequisiteIds: ["case-2"], steps: [{ action: "Click\nbutton", expectedActionOrData: "GET /synthetic", expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["https://synthetic.invalid/image"] }], currentResult: { status: "FAIL", note: '<img src="https://synthetic.invalid/x">' }, stepResults: [{ status: "FAIL", note: "raw step head" }] }] };
test("portable current report preserves paired fields, NULL/empty, phases, prerequisites and observations", () => {
  const before = structuredClone(record);
  const html = renderCurrentManualRunPortableHtml(record);
  for (const content of ["0 left to test", "100% recorded", "FAIL: 1", "GET /synthetic", "Explicit empty text", "Not supplied (NULL)", "retained\ncontext", "raw step head", "Prerequisite cases (not procedure steps)", "not complete revision history", "not a complete revision history"]) assert.ok(html.includes(content), content);
  assert.deepEqual(record, before);
  assert.match(html, /@media print/);
  assert.match(html, /default-src 'none'/);
  assert.match(html, /form-action 'none'/);
  assert.doesNotMatch(html, /<script|<img|<iframe|<link|onerror=|href=/i);
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&lt;img src="));
});
test("run export includes all 851 current cases including untested and unknown verdicts", () => {
  const cases = Array.from({ length: 851 }, (_, i) => ({ ...record.cases[0], testCaseId: `case-${i}`, displayId: `TC-${i}`, currentResult: i === 0 ? { status: "CUSTOM_STATUS" } : null }));
  const html = renderCurrentManualRunPortableHtml({ ...record, cases });
  assert.ok(html.includes("850 left to test"));
  assert.ok(html.includes("OTHER RECORDED: 1"));
  assert.equal((html.match(/<article>/g) ?? []).length, 851);
  assert.ok(html.includes("TC-850"));
});
test("legacy and zero-case reports never invent frozen evidence or acceptance", () => {
  const html = renderCurrentManualRunPortableHtml({ ...record, executionContext: null, cases: [] });
  assert.ok(html.includes("may reflect later case edits"));
  assert.ok(html.includes("0% recorded"));
  assert.ok(html.includes("Not a signed audit report"));
  assert.ok(html.includes('max="1" value="0"'));
});
test("custom labels survive and unsupported text refuses instead of substitution", () => {
  const html = renderCurrentManualRunPortableHtml({ ...record, stepFieldLabels: { expectedActionOrData: "Custom <interface> behavior" }, cases: [{ ...record.cases[0], title: "λ 🎮\r\nReview" }] });
  assert.ok(html.includes("Custom &lt;interface&gt; behavior"));
  assert.ok(html.includes("λ 🎮&#13;\nReview"));
  assert.ok(renderCurrentManualRunPortableHtml({ ...record, stepFieldLabels: { expectedActionOrData: "Expected Action / Data" } }).includes("Technical behavior / data"));
  for (const title of ["nul\u0000", "unpaired\ud800", "unpaired\udc00"]) assert.throws(() => renderCurrentManualRunPortableHtml({ ...record, cases: [{ ...record.cases[0], title }] }), /unsupported control or Unicode/);
});
test("identity ambiguity, over-scope and escaped-output oversize refuse without partial export", () => {
  assert.throws(() => renderCurrentManualRunPortableHtml({ ...record, cases: [record.cases[0], record.cases[0]] }), /ambiguous/);
  assert.throws(() => renderCurrentManualRunPortableHtml({ ...record, cases: Array.from({ length: 1001 }, (_, i) => ({ ...record.cases[0], testCaseId: `case-${i}` })) }), /unsupported/);
  assert.throws(() => renderCurrentManualRunPortableHtml({ ...record, cases: [{ ...record.cases[0], title: "<".repeat(2 * 1024 * 1024) }] }), /8 MiB/);
});
test("all mounted download formats recheck current original access after preparation", () => {
  const source = readFileSync(new URL("../components/RunExecutionSummary.tsx", import.meta.url), "utf8");
  assert.equal((source.match(/Original run access changed\. Nothing was exported\./g) ?? []).length, 3);
  assert.match(source, /Export printable report · HTML/);
  assert.match(source, /same complete current run/);
  assert.match(source, /label: "Flaky", value: count\("FLAKY"\), tone: "info"/);
  assert.match(source, /\["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"\]\.reduce/);
});
