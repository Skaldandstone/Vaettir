import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  releaseCriteriaDraftProblem,
  saveReleaseCriterionDraft,
  releasePlanChoices,
  addReleaseGoal,
  releaseGoalDraftProblem,
  releaseGoalPresets,
  specializedReleaseGoalPresets,
} from "./release-planning-draft.ts";
test("release goals are optional presets or custom bounded labels, not mandatory domain milestones", () => {
  const original = ["Regular release"];
  assert.deepEqual(
    addReleaseGoal(original, "  Improve checkout reliability  "),
    [...original, "Improve checkout reliability"],
  );
  assert.deepEqual(original, ["Regular release"]);
  assert.deepEqual(addReleaseGoal(original, "Regular release"), original);
  assert.ok(releaseGoalPresets.includes("Regular release"));
  assert.ok(!releaseGoalPresets.includes("Regulatory submission"));
  assert.ok(specializedReleaseGoalPresets.includes("Regulatory submission"));
  assert.equal(releaseGoalDraftProblem(""), null);
  assert.match(releaseGoalDraftProblem(" \t"), /clear its draft/);
  for (const draft of ["", " \n ", "x".repeat(201), "nul\0text", "\ud800"])
    assert.throws(() => addReleaseGoal(original, draft));
  assert.deepEqual(addReleaseGoal([], "A 🚀 goal"), ["A 🚀 goal"]);
  const full = Array.from({ length: 20 }, (_, i) => `Goal ${i}`);
  assert.throws(() => addReleaseGoal(full, "Extra"), /20 goals/);
  assert.deepEqual(addReleaseGoal(full, "Goal 1"), full);
});
test("custom goal drafts cannot disappear into a release request and selected specialized goals stay removable", () => {
  const wizard = readFileSync(
    new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(wizard, /!releaseGoalDraftProblem\(goalDraft\)/);
  assert.match(wizard, /Selected release goals/);
  assert.match(wizard, /Clear goal draft/);
  assert.match(wizard, /goals: \[\.\.\.releaseGoals\]/);
  assert.match(wizard, /const request = createRequest \?\?/);
});
test("editing a wizard draft preserves all other criteria and never writes persisted plan data", () => {
  const original = ["First", "Second"];
  assert.deepEqual(saveReleaseCriterionDraft(original, " Edited second ", 1), [
    "First",
    " Edited second ",
  ]);
  assert.deepEqual(original, ["First", "Second"]);
  assert.deepEqual(saveReleaseCriterionDraft(original, "Third", null), [
    "First",
    "Second",
    "Third",
  ]);
  for (const value of ["", " \n ", "x".repeat(2001), "nul\0text", "\ud800"])
    assert.throws(() => saveReleaseCriterionDraft(original, value, null));
  assert.throws(() => saveReleaseCriterionDraft(original, "Changed", 2));
});
test("release criteria retain exact multiline whitespace, duplicate wording and explicit unfinished blank drafts", () => {
  const raw = " \t First line\n  Second line \n";
  assert.deepEqual(saveReleaseCriterionDraft([raw], raw, null), [raw, raw]);
  assert.deepEqual(
    saveReleaseCriterionDraft(["Other", raw], "\n Changed \t", 0),
    ["\n Changed \t", raw],
  );
  assert.match(
    releaseCriteriaDraftProblem({
      criteria: [raw],
      planName: "Plan",
      criterionDraft: " \t",
      editingIndex: null,
    }),
    /clear its draft/,
  );
  const wizard = readFileSync(
    new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(wizard, /wordingMode: "EXACT" as const/);
  assert.match(wizard, /const request = createRequest \?\?/);
  assert.match(
    wizard,
    /<span\s+style=\{\{\s*whiteSpace: "pre-wrap",\s*overflowWrap: "anywhere",?\s*\}\}\s*>\s*\{criterion\}\s*<\/span>/,
  );
});
test("50-criterion limit permits editing and explicit clearing unadded text releases the Continue gate", () => {
  const criteria = Array.from({ length: 50 }, (_, i) => `Criterion ${i}`);
  assert.throws(() => saveReleaseCriterionDraft(criteria, "Extra", null));
  assert.equal(saveReleaseCriterionDraft(criteria, "Edited", 49)[49], "Edited");
  assert.match(
    releaseCriteriaDraftProblem({
      criteria,
      planName: "Plan",
      criterionDraft: "Extra",
      editingIndex: null,
    }),
    /clear the extra draft/,
  );
  assert.equal(
    releaseCriteriaDraftProblem({
      criteria,
      planName: "Plan",
      criterionDraft: "",
      editingIndex: null,
    }),
    null,
  );
  assert.match(
    releaseCriteriaDraftProblem({
      criteria: [],
      planName: "Named plan",
      criterionDraft: "",
      editingIndex: null,
    }),
    /at least one criterion/,
  );
  assert.equal(
    releaseCriteriaDraftProblem({
      criteria: [],
      planName: "",
      criterionDraft: "",
      editingIndex: null,
    }),
    null,
  );
});
test("workspace attach choices exclude both current-release and assigned-elsewhere plans", () => {
  const plans = [
    { id: "unassigned", releaseId: null },
    { id: "current", releaseId: "this" },
    { id: "foreign", releaseId: "other" },
  ];
  const choice = releasePlanChoices(plans, "this");
  assert.deepEqual(
    choice.available.map((plan) => plan.id),
    ["unassigned"],
  );
  assert.deepEqual(
    choice.assignedElsewhere.map((plan) => plan.id),
    ["foreign"],
  );
  assert.equal(plans[2].releaseId, "other");
});
test("planning screens expose truthful draft edits, assigned-plan links and existing plan management", () => {
  const wizard = readFileSync(
    new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url),
    "utf8",
  );
  const workspace = readFileSync(
    new URL(
      "../app/projects/[projectId]/releases/[releaseId]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(wizard, /Save draft edit/);
  assert.match(wizard, /Clear draft/);
  assert.match(wizard, /Cancel edit/);
  assert.match(wizard, /releaseGoalPresets/);
  assert.doesNotMatch(wizard, /adjust status and dates later/);
  assert.match(
    workspace,
    /releasePlanChoices\(\s*allPlans,\s*releaseId,?\s*\)/,
  );
  assert.match(workspace, /Open its assigned release/);
  assert.match(workspace, /Open plan to add or manage criteria/);
  assert.match(workspace, /Create a test plan/);
  assert.doesNotMatch(
    workspace,
    /allPlans.filter\(\(p\) => p.releaseId !== releaseId\)/,
  );
  // Dedicated audited attachment replaces the old client-only picker guard.
  // Preserve the guarantee at all three layers: unassigned choices, fresh
  // reviewed preview, and native atomic null-assignment CAS.
  const attach = readFileSync(
    new URL("../components/AttachUnassignedPlan.tsx", import.meta.url),
    "utf8",
  );
  const governedWrite = readFileSync(
    new URL("../../api/src/services/testPlanGovernance.ts", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /<AttachUnassignedPlan/);
  assert.match(workspace, /plans=\{[\s\S]*?attachablePlans/);
  assert.match(attach, /fresh.snapshot.releaseId !== null/);
  assert.match(attach, /expectedReleaseId: null/);
  assert.match(governedWrite, /before.releaseId !== attach.expectedReleaseId/);
  assert.match(governedWrite, /where:\s*\{[\s\S]*?releaseId: null/);
  assert.match(governedWrite, /updated.count !== 1/);
});
