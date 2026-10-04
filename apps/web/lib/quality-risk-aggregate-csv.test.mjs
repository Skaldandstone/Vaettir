import { test } from "node:test";
import assert from "node:assert/strict";
import { qualityRiskAggregateCsvPlan } from "./quality-risk-aggregate-csv.ts";

// SOURCE ONLY: authored 2026-10-04, NOT EXECUTED.
const population = () => ({
  entries: 2,
  likelihood: { UNKNOWN: 2, RARE: 0, POSSIBLE: 0, FREQUENT: 0 },
  consequence: { UNKNOWN: 2, MINOR: 0, SIGNIFICANT: 0, SEVERE: 0 },
  review: { NO_REVIEW: 1, VERSION_MATCHING_REVIEW: 1, BASELINE_CHANGED: 0 },
  disposition: {
    NOT_RECORDED: 1,
    FURTHER_ACTION: 1,
    REVIEW_RECORDED: 0,
    HUMAN_ACCEPTANCE_RECORDED: 0,
  },
  evidence: {
    NO_REVIEW: 1,
    NONE_RECORDED: 0,
    ALL_REFERENCES_AVAILABLE: 1,
    SOME_REFERENCES_UNAVAILABLE: 0,
    ALL_REFERENCES_UNAVAILABLE: 0,
  },
  mitigation: {
    NO_LINKS: 2,
    ALL_REFERENCES_AVAILABLE: 0,
    SOME_REFERENCES_UNAVAILABLE: 0,
    ALL_REFERENCES_UNAVAILABLE: 0,
  },
  evidenceReferences: { total: 1, available: 1, unavailable: 0 },
});
const filters = () => ({
  search: "",
  review: "ANY",
  disposition: "ANY",
  evidence: "ANY",
  mitigation: "ANY",
});
const sample = () => ({
  observedAt: "2026-10-04T11:15:00.000Z",
  population: population(),
  filtered: population(),
  limits: ["Synthetic complete current population"],
  projectId: "private-project",
  organizationId: "private-org",
  clerkActorId: "private-actor",
  items: [{ title: "private-title", component: "private-component" }],
});

test("aggregate plan exports two complete populations with literal zero categories, not page identities", () => {
  const plan = qualityRiskAggregateCsvPlan(sample(), filters());
  assert.equal(plan.headers.length, 4);
  assert.ok(plan.rows.every((row) => row.length === 4));
  assert.ok(
    plan.rows.some(
      (row) =>
        row[0] === "Full project population" &&
        row[2] === "UNKNOWN" &&
        row[3] === 2,
    ),
  );
  assert.ok(
    plan.rows.some(
      (row) =>
        row[0] === "Filtered cohort" && row[2] === "SEVERE" && row[3] === 0,
    ),
  );
  const serialized = JSON.stringify(plan);
  for (const privateText of [
    "private-project",
    "private-org",
    "private-actor",
    "private-title",
    "private-component",
  ])
    assert.ok(!serialized.includes(privateText), privateText);
  assert.ok(serialized.includes("not an approved frozen report"));
});
test("literal search is omitted while its presence and reconstruction limitation remain explicit", () => {
  const plan = qualityRiskAggregateCsvPlan(sample(), {
    ...filters(),
    search: "=private-query()",
  });
  assert.ok(!JSON.stringify(plan).includes("=private-query()"));
  assert.ok(JSON.stringify(plan).includes("Applied search; text not exported"));
  assert.ok(
    JSON.stringify(plan).includes("prevents full filter reconstruction"),
  );
});
test("missing, negative, inconsistent or unsupported aggregate counts refuse instead of becoming zero", () => {
  for (const mutate of [
    (value) => {
      delete value.population.review.NO_REVIEW;
    },
    (value) => {
      value.filtered.entries = -1;
    },
    (value) => {
      value.population.likelihood.UNKNOWN = 1;
    },
    (value) => {
      value.population.evidenceReferences.total = 0;
      value.population.evidenceReferences.available = 0;
    },
    (value) => {
      value.filtered.evidenceReferences.available = 2;
      value.filtered.evidenceReferences.total = 2;
    },
    (value) => {
      value.population.review.EXTRA = 0;
    },
    (value) => {
      value.observedAt = "not-a-date";
    },
  ]) {
    const value = sample();
    mutate(value);
    assert.throws(
      () => qualityRiskAggregateCsvPlan(value, filters()),
      /inconsistent/,
    );
  }
  assert.throws(
    () =>
      qualityRiskAggregateCsvPlan(sample(), {
        ...filters(),
        review: "invented",
      }),
    /inconsistent/,
  );
});
test("unfiltered populations must match completely and empty human registers remain distinct from no risk", () => {
  const changed = sample();
  changed.filtered.review.NO_REVIEW = 0;
  changed.filtered.review.VERSION_MATCHING_REVIEW = 2;
  changed.filtered.disposition.NOT_RECORDED = 0;
  changed.filtered.disposition.FURTHER_ACTION = 2;
  changed.filtered.evidence.NO_REVIEW = 0;
  changed.filtered.evidence.ALL_REFERENCES_AVAILABLE = 2;
  assert.throws(
    () => qualityRiskAggregateCsvPlan(changed, filters()),
    /inconsistent/,
  );
  const empty = population();
  empty.entries = 0;
  for (const [key, value] of Object.entries(empty))
    if (key !== "entries")
      for (const category of Object.keys(value)) value[category] = 0;
  const plan = qualityRiskAggregateCsvPlan(
    { ...sample(), population: empty, filtered: structuredClone(empty) },
    filters(),
  );
  assert.ok(plan.rows.some((row) => row[1] === "Population" && row[3] === 0));
  assert.ok(JSON.stringify(plan).includes("No calibrated score"));
});
