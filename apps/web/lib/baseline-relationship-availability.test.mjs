// Authored only. Source parsing/presentation checks are NOT RUN overnight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  baselineCaseRelationshipLabel,
  baselineDirectLinkComparison,
} from "./requirement-baseline-presentation.ts";
test("missing captured side never reports a new link or an unchanged comparison", () => {
  const item = { wasLinked: false, isLinked: true };
  assert.equal(
    baselineCaseRelationshipLabel(item, false, true),
    "Current direct link; no captured baseline",
  );
  assert.equal(
    baselineDirectLinkComparison(false, true, false),
    "No captured baseline: current direct links are recorded, but additions or removals cannot be compared.",
  );
  assert.equal(
    baselineDirectLinkComparison(false, true, true),
    baselineDirectLinkComparison(false, true, false),
  );
  assert.deepEqual(item, { wasLinked: false, isLinked: true });
});
test("unavailable current requirement never turns captured links into observed removals", () => {
  const item = { wasLinked: true, isLinked: false };
  assert.equal(
    baselineCaseRelationshipLabel(item, true, false),
    "Captured direct link; current requirement unavailable",
  );
  assert.equal(
    baselineDirectLinkComparison(true, false, false),
    "Current requirement unavailable: captured direct links are retained, but removals cannot be established.",
  );
  assert.deepEqual(item, { wasLinked: true, isLinked: false });
});
test("two available sides retain all exact native relationship classifications", () => {
  for (const [wasLinked, isLinked, label] of [
    [true, true, "Captured and current"],
    [true, false, "No longer directly linked"],
    [false, true, "New direct link"],
    [false, false, "Not linked in either displayed scope"],
  ])
    assert.equal(
      baselineCaseRelationshipLabel({ wasLinked, isLinked }, true, true),
      label,
    );
  assert.equal(
    baselineDirectLinkComparison(true, true, true),
    "Direct relationship or recorded label scope changed.",
  );
  assert.equal(
    baselineDirectLinkComparison(true, true, false),
    "No direct link change detected in the recorded scope.",
  );
});
test("neither comparison side available remains explicit unknown rather than zero or unchanged", () => {
  assert.equal(
    baselineCaseRelationshipLabel(
      { wasLinked: false, isLinked: false },
      false,
      false,
    ),
    "Captured/current relationship comparison unavailable",
  );
  assert.equal(
    baselineDirectLinkComparison(false, false, false),
    "Direct relationship comparison unavailable: neither side is recorded.",
  );
});
test("comparison UI gates direct-link summary and chips on actual recorded-side availability", () => {
  const ui = readFileSync(
    new URL("../components/RequirementBaselines.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    ui.includes(
      "baselineDirectLinkComparison(!!current.baseline, !!current.current, current.comparison.coverageChanged)",
    ),
  );
  assert.ok(
    ui.includes(
      "baselineCaseRelationshipLabel(c, !!current.baseline, !!current.current)",
    ),
  );
  assert.ok(
    !ui.includes(
      'c.wasLinked ? "No longer directly linked" : "New direct link"',
    ),
  );
  assert.ok(
    ui.includes("filterBaselineCasePage(current.affected.items, caseSearch)"),
  );
  assert.ok(ui.includes("sameScope(detail.data)"));
});
