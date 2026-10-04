// SOURCE ONLY: authored NOT RUN. Not browser, authorization or file-save acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const component = readFileSync(
  new URL("../components/CaseHistoryPageExport.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const parent = readFileSync(
  new URL("../components/TestCaseExecutionHistory.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

test("only a fresh exact native page is mounted, never an eager whole-history export", () => {
  assert.ok(
    parent.includes(
      "<CaseHistoryPageExport page={page} input={input} pageNumber={anchors.length} />",
    ),
  );
  assert.ok(
    parent.includes(
      "!history.error && !history.isFetching && !history.isPaused",
    ),
  );
  assert.ok(!component.includes("useQuery"));
  assert.ok(!component.includes("useMutation"));
  assert.ok(component.includes("not the full case history"));
  assert.ok(component.includes("Older entries remain outside this file"));
});
test("unavailable/refreshed scopes and close/unmount invalidate the earlier review", () => {
  assert.ok(component.includes("previous.page !== page"));
  assert.ok(component.includes("review.epoch === epoch"));
  assert.ok(component.includes("current.request !== request"));
  assert.ok(component.includes("current.pageNumber !== pageNumber"));
  assert.match(
    component,
    /useLayoutEffect\(\(\) => \{ live.current = page \? \{ page, request, pageNumber, epoch \} : null; return \(\) => \{ live.current = null; \};/,
  );
  assert.ok(component.includes("!page || !current"));
  assert.ok(component.includes("current.epoch !== epoch"));
  assert.ok(component.includes("setInvalidation((value) => value + 1)"));
  assert.ok(
    component.includes("setOpen(false); setReview(null); setConfirmed(false)"),
  );
  assert.ok(
    component.includes(
      "message.page === page && message.request === request && message.epoch === epoch",
    ),
  );
  assert.match(component, /\[previous, setPrevious\] = useState/);
  assert.doesNotMatch(component, /previous\.current|epoch\.current/);
});
test("deliberate review and confirmation revalidate bytes before creating and cleaning a local download", () => {
  assert.ok(
    component.includes("reviewCaseHistoryPageCsv(page, input, pageNumber)"),
  );
  assert.ok(component.includes("!open || !confirmed || !reviewed"));
  const preparation =
    /prepareCaseHistoryPageCsv\(\s*page,\s*input,\s*pageNumber,\s*review\.binding,?\s*\)/.exec(
      component,
    );
  assert.ok(preparation, "exact reviewed bytes are revalidated");
  assert.ok(preparation.index < component.indexOf("URL.createObjectURL"));
  assert.ok(component.includes("live.current !== current"));
  assert.ok(component.includes("anchor?.remove()"));
  assert.ok(component.includes("URL.revokeObjectURL(preparedUrl)"));
  assert.ok(component.includes("Browser save completion is not verified"));
});
test("review discloses original labels, literal applied scope, private-data exclusions and no approval", () => {
  for (const value of [
    "page.testCase.displayId",
    "page.observedAt",
    "page.window",
    'whiteSpace: "pre-wrap"',
    "recorder names/times",
    "Stored labels or configuration text may themselves contain identifying information",
    "No procedure text, private observations, artifact URL fields, current account/email fields or actor IDs",
    "Corrections are not new retests",
    "not an approval or access grant",
  ])
    assert.ok(component.includes(value), value);
});
