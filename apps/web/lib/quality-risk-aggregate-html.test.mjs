import { test } from "node:test";
import assert from "node:assert/strict";
import { renderQualityRiskAggregateHtml } from "./quality-risk-aggregate-html.ts";
import { qualityRiskAggregateCsvPlan } from "./quality-risk-aggregate-csv.ts";
const render = (value, filters) =>
  renderQualityRiskAggregateHtml(qualityRiskAggregateCsvPlan(value, filters));
// Source only. Authored NOT EXECUTED; no browser, print or PDF acceptance.
const counts = () => ({
  entries: 1,
  likelihood: { UNKNOWN: 0, RARE: 0, POSSIBLE: 1, FREQUENT: 0 },
  consequence: { UNKNOWN: 0, MINOR: 0, SIGNIFICANT: 1, SEVERE: 0 },
  review: { NO_REVIEW: 0, VERSION_MATCHING_REVIEW: 1, BASELINE_CHANGED: 0 },
  disposition: {
    NOT_RECORDED: 0,
    FURTHER_ACTION: 1,
    REVIEW_RECORDED: 0,
    HUMAN_ACCEPTANCE_RECORDED: 0,
  },
  evidence: {
    NO_REVIEW: 0,
    NONE_RECORDED: 0,
    ALL_REFERENCES_AVAILABLE: 0,
    SOME_REFERENCES_UNAVAILABLE: 1,
    ALL_REFERENCES_UNAVAILABLE: 0,
  },
  mitigation: {
    NO_LINKS: 1,
    ALL_REFERENCES_AVAILABLE: 0,
    SOME_REFERENCES_UNAVAILABLE: 0,
    ALL_REFERENCES_UNAVAILABLE: 0,
  },
  evidenceReferences: { total: 2, available: 1, unavailable: 1 },
});
const filters = () => ({
  search: "",
  review: "ANY",
  disposition: "ANY",
  evidence: "ANY",
  mitigation: "ANY",
});
const value = () => ({
  observedAt: "2026-10-04T11:30:00.000Z",
  population: counts(),
  filtered: counts(),
  limits: ["Synthetic current-read limits"],
  projectId: "private-project",
  items: [{ title: "private-title" }],
});
test("portable report keeps both complete cohorts, literal zeros and observation bounds without per-entry identities", () => {
  const html = render(value(), {
    ...filters(),
    search: "private-search",
  });
  assert.ok(
    html.includes("Full project population") &&
      html.includes("Filtered cohort"),
  );
  assert.ok(html.includes("2026-10-04T11:30:00.000Z"));
  assert.ok(html.includes("Vaettir portable HTML v1"));
  assert.ok(!html.includes("Vaettir CSV v1"));
  assert.ok(html.includes("<td>0</td>"));
  for (const privateText of [
    "private-search",
    "private-project",
    "private-title",
  ])
    assert.ok(!html.includes(privateText));
  assert.ok(html.includes("not an approved frozen report"));
  assert.ok(html.includes("It grants no access to Vaettir"));
  assert.ok(html.includes("no PDF or delivery has been generated"));
});
test("portable report escapes retained source limits and contains no executable or external assets", () => {
  const sample = value();
  sample.limits = [
    `<script>alert('x')</script> & "quotes"`,
    `<img src=https://invalid.example>`,
    "https://invalid.example/raw",
  ];
  const html = render(sample, filters());
  assert.ok(html.includes("&lt;script&gt;"));
  assert.ok(html.includes("&#39;x&#39;"));
  assert.ok(html.includes("&quot;quotes&quot;"));
  assert.ok(html.includes("Content-Security-Policy"));
  assert.ok(html.includes("default-src 'none'"));
  // Escaped literal source strings may mention src=; only actual markup may fetch.
  assert.ok(
    !/<script\b|<img\b|<iframe\b|<form\b|<[^>]*\b(?:href|src)\s*=/i.test(html),
  );
});
test("malformed counts, category-scope mismatch and unsafe text refuse complete report instead of partial output", () => {
  const malformed = value();
  malformed.filtered.likelihood.POSSIBLE = 0;
  assert.throws(() => render(malformed, filters()), /inconsistent/);
  assert.throws(
    () =>
      render(value(), {
        ...filters(),
        likelihood: "RARE",
      }),
    /inconsistent/,
  );
  for (const text of ["bad\u0000text", "bad\uD800text", "bad\uDC00text"]) {
    const sample = value();
    sample.limits = [text];
    assert.throws(() => render(sample, filters()), /Unsupported/);
  }
});
