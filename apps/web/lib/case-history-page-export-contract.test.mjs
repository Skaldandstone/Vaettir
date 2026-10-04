// SOURCE ONLY: authored NOT RUN. Not browser, authorization or file-save acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const component = readFileSync(new URL("../components/CaseHistoryPageExport.tsx", import.meta.url), "utf8");
const parent = readFileSync(new URL("../components/TestCaseExecutionHistory.tsx", import.meta.url), "utf8");

test("only a fresh exact native page is mounted, never an eager whole-history export", () => {
  assert.ok(parent.includes("<CaseHistoryPageExport page={page} input={input} pageNumber={anchors.length} />"));
  assert.ok(parent.includes("!history.error && !history.isFetching && !history.isPaused"));
  assert.ok(!component.includes("useQuery"));
  assert.ok(!component.includes("useMutation"));
  assert.ok(component.includes("not the full case history"));
  assert.ok(component.includes("Older entries remain outside this file"));
});
test("unavailable/refreshed scopes and close/unmount invalidate the earlier review", () => {
  assert.ok(component.includes("if (!page)"));
  assert.ok(component.includes("review.epoch === live.current?.epoch"));
  assert.ok(component.includes("live.current.request !== request"));
  assert.ok(component.includes("live.current.pageNumber !== pageNumber"));
  assert.ok(component.includes("mounted.current = false; epoch.current += 1; live.current = null"));
  assert.ok(component.includes("if (!mounted.current || !page) return"));
  assert.ok(component.includes("setOpen(false); setReview(null); setConfirmed(false)"));
  assert.ok(component.includes("message.page === page && message.request === request && message.epoch === live.current?.epoch"));
});
test("deliberate review and confirmation revalidate bytes before creating and cleaning a local download", () => {
  assert.ok(component.includes("reviewCaseHistoryPageCsv(page, input, pageNumber)"));
  assert.ok(component.includes("!mounted.current || !open || !confirmed || !reviewed"));
  assert.ok(component.indexOf("prepareCaseHistoryPageCsv(page, input, pageNumber, review.binding)") < component.indexOf("URL.createObjectURL"));
  assert.ok(component.includes("live.current !== current"));
  assert.ok(component.includes("anchor?.remove()"));
  assert.ok(component.includes("URL.revokeObjectURL(preparedUrl)"));
  assert.ok(component.includes("Browser save completion is not verified"));
});
test("review discloses original labels, literal applied scope, private-data exclusions and no approval", () => {
  for (const value of ["page.testCase.displayId", "page.observedAt", "page.window", "whiteSpace: \"pre-wrap\"", "recorder names/times",
    "Stored labels or configuration text may themselves contain identifying information", "No procedure text, private observations, artifact URL fields, current account/email fields or actor IDs", "Corrections are not new retests", "not an approval or access grant"])
    assert.ok(component.includes(value), value);
});
