// Authored fixtures only, NOT RUN. Links do not prove authorization or navigation.
import test from "node:test";
import assert from "node:assert/strict";
import { caseObservationHistoryEntry, manualCaseHistoryAnchor } from "./case-observation-history-entry.ts";
const item = { runId: "run-1", source: "MANUAL", outcomeMode: "CASE_RESULT", definition: { source: "FROZEN_MANUAL_SUMMARY", originalCaseId: "case-1", titleAtRun: "Saved title", stepCount: 3 } };
const input = { projectId: "project-1", testCaseId: "case-1", displayId: "SYN-01", item };

test("exact frozen native case/run route carries current stable case label without guessing display-ID route", () => {
  const entry = caseObservationHistoryEntry(input);
  assert.equal(entry.kind, "SUPPORTED");
  assert.equal(entry.href, "/projects/project-1/test-runs/manual/run-1?caseId=case-1#manual-case-case-1");
  assert.equal(entry.anchor, manualCaseHistoryAnchor(input.testCaseId));
  assert.equal(entry.mode, "WHOLE_CASE");
  assert.ok(!entry.href.includes("SYN-01"));
  assert.deepEqual(item.definition, input.item.definition);
});

test("CI/foreign selected-case/legacy and unsupported frozen summaries never create a manual history route", () => {
  for (const changed of [{ source: "CI_IMPORT" }, { definition: { ...item.definition, originalCaseId: "other-case" } },
    { definition: { ...item.definition, source: "NOT_RECORDED" } }, { definition: { ...item.definition, source: "UNSUPPORTED_METADATA" } }]) {
    const entry = caseObservationHistoryEntry({ ...input, item: { ...item, ...changed } });
    assert.equal(entry.kind, "UNAVAILABLE"); assert.ok(!("href" in entry));
  }
});

test("step/partial observations stay separate from whole-case corrections and incomplete case completion", () => {
  for (const outcomeMode of ["STEP_RESULTS", "PARTIAL_STEPS"]) {
    const entry = caseObservationHistoryEntry({ ...input, item: { ...item, outcomeMode } });
    assert.equal(entry.mode, "STEP"); assert.match(entry.label, /step history/);
    assert.ok(entry.limitations.some(note => note.includes("not whole-case revisions")));
    assert.ok(entry.limitations.some(note => note.includes("do not confirm a completed case")));
  }
});

test("planned/missing/multiple results are inspect-only without selected revision or completed observation claim", () => {
  for (const outcomeMode of ["MULTIPLE_REPORTED_RESULTS", "PLANNED_ONLY", "NO_CASE_RESULT"]) {
    const entry = caseObservationHistoryEntry({ ...input, item: { ...item, outcomeMode } });
    assert.equal(entry.mode, "INSPECT_RUN");
    assert.equal(entry.label, "Open saved run and check observations");
    assert.ok(entry.limitations.some(note => note.includes("not converted into a chosen result")));
  }
});

test("no count or legacy recorder/time is inferred from latest whole-case summary", () => {
  const before = structuredClone(input), entry = caseObservationHistoryEntry(input);
  assert.ok(entry.limitations.some(note => note.includes("availability is not queried")));
  assert.ok(entry.limitations.some(note => note.includes("unknown original recorder and time")));
  assert.ok(entry.limitations.some(note => note.includes("not another execution")));
  assert.ok(!("revisionCount" in entry)); assert.deepEqual(input, before);
});

test("native query/fragment encoding resolves the exact DOM anchor, rejecting oversized/control/unpaired identities", () => {
  const testCaseId = "case/native %", entry = caseObservationHistoryEntry({ ...input, projectId: "project/native", testCaseId,
    item: { ...item, runId: "run/native", definition: { ...item.definition, originalCaseId: testCaseId } } });
  const route = new URL(entry.href, "https://synthetic.example");
  assert.equal(route.pathname, "/projects/project%2Fnative/test-runs/manual/run%2Fnative");
  assert.equal(route.searchParams.get("caseId"), testCaseId);
  assert.equal(decodeURIComponent(route.hash.slice(1)), manualCaseHistoryAnchor(testCaseId));
  for (const native of ["", "x".repeat(201), "bad\u0000native", "\ud800"]) {
    assert.equal(manualCaseHistoryAnchor(native), null);
    assert.equal(caseObservationHistoryEntry({ ...input, testCaseId: native }).kind, "UNAVAILABLE");
  }
});
