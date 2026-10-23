import { test } from "node:test";
import assert from "node:assert/strict";
import { renderRecordedExecutionPortableHtml } from "./recorded-execution-trend-html.ts";
// SOURCE ONLY, authored NOT EXECUTED. Does not prove installed API/runtime, print or browser acceptance.
const counts = () => ({
  runs: 1,
  results: 2,
  mapped: 1,
  unmatched: 1,
  unavailableMapping: 0,
  inProgressRuns: 0,
  finishedRecordedRuns: 1,
  completionUnavailableRuns: 0,
  inProgressResults: 0,
  timedResults: 1,
  missingDurations: 1,
  invalidDurations: 0,
  sumDurationMs: 10,
  outcomes: { PASS: 1, FAIL: 1, FLAKY: 0, SKIP: 0, BLOCKED: 0 },
});
const sample = () => ({
  projectId: "private-project",
  organizationId: "private-org",
  clerkActorId: "private-actor",
  requestKey: "private-key",
  asOf: "2026-10-04T11:45:00.000Z",
  windowStart: "2026-10-01T00:00:00.000Z",
  windowEnd: "2026-10-01T23:59:59.999Z",
  scope: {
    start: "2026-10-01",
    end: "2026-10-01",
    platform: "<script>private-label()</script>",
  },
  totals: counts(),
  limitations: ["Synthetic recorded observations only"],
  days: [{ day: "2026-10-01", ...counts() }],
});
const period = () => ({
  ...counts(),
  key: "2026-10-01",
  start: "2026-10-01",
  end: "2026-10-01",
  partialWeek: false,
  days: [{ day: "2026-10-01", ...counts() }],
});
test("portable outcomes retain complete counts and scope without native identities or active markup", () => {
  const html = renderRecordedExecutionPortableHtml(
    sample(),
    [period()],
    "DAY",
    false,
  );
  for (const text of [
    "private-project",
    "private-org",
    "private-actor",
    "private-key",
  ])
    assert.ok(!html.includes(text));
  assert.ok(html.includes("&lt;script&gt;private-label()&lt;/script&gt;"));
  assert.ok(
    !/<script\b|<img\b|<iframe\b|<form\b|<[^>]*\b(?:href|src)\s*=/i.test(html),
  );
  assert.ok(html.includes("default-src 'none'"));
  assert.ok(html.includes("Numeric counts are authoritative"));
  assert.ok(html.includes("FLAKY (reported)"));
  assert.ok(html.includes("not an immutable approved stakeholder snapshot"));
  assert.ok(html.includes("grants no access"));
  assert.ok(
    !html.includes("<h2>Recorded duration and completion evidence</h2>"),
  );
});
test("optional recorded duration exposes exact unknown and completion evidence, not effort or capacity", () => {
  const html = renderRecordedExecutionPortableHtml(
    sample(),
    [period()],
    "DAY",
    true,
  );
  assert.ok(
    html.includes("<h2>Recorded duration and completion evidence</h2>"),
  );
  assert.ok(html.includes("Valid duration sum (ms)"));
  assert.ok(html.includes("Missing/invalid duration is not zero"));
  assert.ok(html.includes("Completion unavailable"));
  assert.ok(html.includes("human effort, billable cost"));
});
test("incomplete intervals, inconsistent totals, unsupported options and unsafe text refuse instead of partial report", () => {
  for (const change of [
    (p) => {
      p.results = 1;
    },
    (p) => {
      p.mapped = 0;
    },
    (p) => {
      p.sumDurationMs = -1;
    },
    (p) => {
      p.start = "2026-09-30";
    },
    (p) => {
      p.inProgressResults = 1;
    },
    (p) => {
      p.outcomes.FAIL = NaN;
    },
  ]) {
    const p = period();
    change(p);
    assert.throws(
      () => renderRecordedExecutionPortableHtml(sample(), [p], "DAY", false),
      /inconsistent/,
    );
  }
  assert.throws(
    () => renderRecordedExecutionPortableHtml(sample(), [], "DAY", false),
    /inconsistent/,
  );
  assert.throws(
    () =>
      renderRecordedExecutionPortableHtml(sample(), [period()], "MONTH", false),
    /inconsistent/,
  );
  assert.throws(
    () =>
      renderRecordedExecutionPortableHtml(sample(), [period()], "DAY", "yes"),
    /inconsistent/,
  );
  for (const text of ["bad\u0000label", "bad\uD800label", "x".repeat(4001)]) {
    const v = sample();
    v.scope.platform = text;
    assert.throws(
      () => renderRecordedExecutionPortableHtml(v, [period()], "DAY", false),
      /inconsistent/,
    );
  }
  const v = sample();
  v.totals.runs = 2;
  assert.throws(
    () => renderRecordedExecutionPortableHtml(v, [period()], "DAY", false),
    /inconsistent/,
  );
});
test("partial UTC week presentation retains actual included dates and a complete common-scale numeric denominator", () => {
  const p = period();
  p.key = "2026-09-28";
  p.partialWeek = true;
  const html = renderRecordedExecutionPortableHtml(
    sample(),
    [p],
    "WEEK",
    false,
  );
  assert.ok(html.includes("2026-10-01 · Partial UTC week"));
  assert.ok(html.includes("largest included period result total (2)"));
  assert.ok(html.includes("width:50%"));
  assert.ok(html.includes("Partial UTC weeks are not normalized"));
  assert.throws(
    () =>
      renderRecordedExecutionPortableHtml(
        sample(),
        [{ ...p, partialWeek: false }],
        "WEEK",
        false,
      ),
    /inconsistent/,
  );
  assert.throws(
    () =>
      renderRecordedExecutionPortableHtml(
        sample(),
        [{ ...p, key: "2026-09-29" }],
        "WEEK",
        false,
      ),
    /inconsistent/,
  );
});
test("empty successful scope remains literal zero without an invented chart denominator or passing verdict", () => {
  const p = period();
  for (const key of Object.keys(p)) if (typeof p[key] === "number") p[key] = 0;
  p.outcomes = { PASS: 0, FAIL: 0, FLAKY: 0, SKIP: 0, BLOCKED: 0 };
  const v = sample();
  v.totals = {
    ...counts(),
    ...Object.fromEntries(
      Object.entries(counts())
        .filter(([, value]) => typeof value === "number")
        .map(([key]) => [key, 0]),
    ),
    outcomes: { ...p.outcomes },
  };
  v.days = [{ day: p.start, ...v.totals }];
  const html = renderRecordedExecutionPortableHtml(v, [p], "DAY", false);
  assert.ok(html.includes("largest included period result total (0)"));
  assert.ok(html.includes("not a passing test or assurance finding"));
  assert.ok(!html.includes("NaN") && !html.includes("Infinity"));
});
