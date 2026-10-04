import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const component = readFileSync(
  new URL("../components/RequirementCoverageMatrix.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
// SOURCE-ONLY contract authoring, not rendered or actual QueryClient acceptance.
test("coverage panels withhold failed fetching paused and wrong-scope caches", () => {
  for (const name of ["list", "cases", "evidence"]) {
    assert.ok(component.includes(`!${name}.error`));
    assert.ok(component.includes(`!${name}.isFetching`));
    assert.ok(component.includes(`!${name}.isPaused`));
  }
  assert.ok(component.includes("requirementCoverageRequestKey(listInput)"));
  assert.ok(component.includes("requirementCoverageRequestKey(caseInput)"));
  assert.ok(component.includes("requirementCoverageRequestKey(evidenceInput)"));
  assert.ok(component.includes("key={projectId}"));
  assert.ok(component.includes("originalOrganizationId: organizationId"));
});
test("native links, status distinctions and current-vs-recorded boundaries remain visible", () => {
  for (const text of [
    "Planned, not run",
    "Currently archived",
    "No explicit direct case links",
    "Current inventory and outcome records",
    "not a frozen historical snapshot",
    "Result reference, no standalone result route",
    "Run-start time, not result-recorded time",
    "no native link",
    "No tracker closure is interpreted as runtime resolution",
  ])
    assert.ok(component.includes(text));
  assert.ok(
    component.includes(
      'const outcomeKeys = ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"]',
    ),
  );
  assert.ok(component.includes("/test-cases?caseId="));
  assert.ok(component.includes("/test-runs/manual/"));
  assert.ok(component.includes("/test-runs#run-"));
});
test("scope modal controls wrap and table regions remain keyboard accessible", () => {
  assert.ok(component.includes('boxSizing: "border-box"'));
  assert.ok(component.includes('size="wide"'));
  assert.ok(
    component.includes(
      'aria-label="Current requirement direct coverage matrix" tabIndex={0}',
    ),
  );
  assert.ok(
    component.includes("Scroll sideways for all recorded outcome columns"),
  );
  assert.ok(
    component.includes("at most 100 current plans and 100 recent runs"),
  );
  assert.ok(component.includes("no zero-coverage substitute"));
});
test("native plan and run dropdowns preserve unlisted references without guessing context", () => {
  assert.ok(component.includes("All recorded plans"));
  assert.ok(component.includes("All recorded runs"));
  assert.ok(
    component.includes(
      "!scopeOptions?.plans.some((plan) => plan.id === draft.planId)",
    ),
  );
  assert.ok(
    component.includes(
      "!scopeOptions?.runs.some((run) => run.id === draft.runId)",
    ),
  );
  assert.ok(component.includes("Use an older exact plan or run reference"));
  assert.ok(component.includes("maxLength={200}"));
  assert.ok(
    component.includes("no configuration metadata is filled automatically"),
  );
  assert.ok(!component.includes('list="coverage-plans"'));
  assert.ok(!component.includes('list="coverage-runs"'));
});
test("suggestions and apply require current tenant access rather than retained options", () => {
  assert.ok(component.includes("options.data?.projectId === projectId"));
  assert.ok(
    component.includes("options.data.organizationId === organizationId"),
  );
  assert.ok(component.includes("disabled={!ready || denied || !scopeOptions}"));
  assert.ok(component.includes("function apply() { if (!ready || denied) {"));
  assert.ok(
    component.includes(
      "Recheck current project access before applying this scope.",
    ),
  );
  assert.ok(component.includes("disabled={!ready || denied} onClick={apply}"));
});
