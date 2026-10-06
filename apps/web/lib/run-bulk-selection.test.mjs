import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { applyRunBulkSelection } from "./run-bulk-selection.ts";
import { freezeRunConfiguration } from "./run-configuration-request.ts";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("Set replaces, Add forms stable union and Remove subtracts exact case identities", () => {
  const current = Object.freeze(["one", "two", "three"]), candidates = Object.freeze(["two", "four"]);
  assert.deepEqual(applyRunBulkSelection(current, candidates, "SET"), { ok: true, ids: ["two", "four"], before: 3, matched: 2, added: 1, removed: 2, after: 2 });
  assert.deepEqual(applyRunBulkSelection(current, candidates, "ADD"), { ok: true, ids: ["one", "two", "three", "four"], before: 3, matched: 2, added: 1, removed: 0, after: 4 });
  assert.deepEqual(applyRunBulkSelection(current, candidates, "REMOVE"), { ok: true, ids: ["one", "three"], before: 3, matched: 2, added: 0, removed: 1, after: 2 });
  assert.deepEqual(current, ["one", "two", "three"]); assert.deepEqual(candidates, ["two", "four"]);
});

test("empty scopes are explicit: Set clears, Add and Remove preserve selection", () => {
  assert.equal(applyRunBulkSelection(["one"], [], "SET").after, 0);
  for (const mode of ["ADD", "REMOVE"]) assert.deepEqual(applyRunBulkSelection(["one"], [], mode).ids, ["one"]);
  assert.deepEqual(applyRunBulkSelection([], ["one", "one"], "SET").ids, ["one"]);
});

test("1000 is accepted, 1001 result refuses atomically without returning partial IDs", () => {
  const thousand = Array.from({ length: 1000 }, (_, index) => `case-${index}`);
  assert.equal(applyRunBulkSelection([], thousand, "SET").after, 1000);
  for (const [current, candidates, mode] of [[[], [...thousand, "overflow"], "SET"], [thousand, ["overflow"], "ADD"]]) {
    const refused = applyRunBulkSelection(current, candidates, mode);
    assert.equal(refused.ok, false); assert.equal("ids" in refused, false);
    assert.match(refused.error, /1,001.*nothing was partially selected/);
  }
  assert.equal(applyRunBulkSelection(thousand, [...thousand, "not-selected"], "REMOVE").after, 0);
});

test("unsupported identities/operations and duplicate existing state do not silently coerce a scope", () => {
  for (const [current, candidates, mode] of [[[], [null], "ADD"], [[], [""], "SET"], [[], ["x".repeat(201)], "SET"], [["same", "same"], [], "REMOVE"], [[], ["one"], "INVALID"]]) {
    const refused = applyRunBulkSelection(current, candidates, mode);
    assert.equal(refused.ok, false); assert.equal("ids" in refused, false);
  }
});

test("a frozen unknown-ACK run request cannot be edited through selection preview or operations", () => {
  const request = freezeRunConfiguration({ projectId: "project", testCaseIds: ["one", "two"], expectedProfileHash: "a".repeat(64), executionContext: { configuration: "", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: "", calibrationReference: "", protocolReference: "" }, originalOrganizationId: "org", expectedClerkActorId: "clerk" }, "uuid");
  const original = JSON.stringify(request);
  assert.deepEqual(applyRunBulkSelection(request.testCaseIds, ["three"], "SET").ids, ["three"]);
  assert.equal(JSON.stringify(request), original);
  assert.equal(Object.isFrozen(request.testCaseIds), true);
});

test("modal applies only explicit operations using writable verified scopes and locks retained requests", () => {
  const modal = source("../components/RunConfigurationModal.tsx");
  assert.match(modal, /!bulkScopesReady \|\| !access\.canWrite \|\| busy \|\| refreshing \|\| pendingRequest \|\| inFlight\.current/);
  assert.match(modal, /onSelectionChange\(result\.ids\)/);
  assert.match(modal, /setReviewedCount\(null\); setReviewedIds\(null\)/);
  assert.match(modal, /onChange=\{event => setBulkScopeKey\(event\.target\.value\)\}/);
  assert.match(modal, /bulkScopeKey \? bulkScopes\?\.find\(scope => scope\.key === bulkScopeKey\) \?\? null : bulkScopes\?\.\[0\] \?\? null/);
  assert.match(modal, /Selected scope unavailable/);
  assert.match(modal, /pendingRequest \?\?/);
  assert.match(modal, /freezeRunConfiguration/);
  assert.match(modal, /runConfigurationScopeMatches/);
  assert.match(modal, /Selection changes are locked while confirming the original/);
});

test("both callers use only loaded approved scopes; missing suite and navigation cannot infer selection", () => {
  const runs = source("../app/projects/[projectId]/test-runs/page.tsx"), library = source("../app/projects/[projectId]/test-cases/page.tsx");
  assert.match(runs, /manualBulkScope !== "suite" \|\| Boolean\(manualSuite\)/);
  assert.match(runs, /manualBulkScope === "suite" && manualSuite/);
  assert.match(runs, /manualSourceReady \? casesQuery\.data/);
  assert.match(runs, /!testCase\.archived && testCase\.reviewStatus === "APPROVED"/);
  assert.match(runs, /if \(!manualSelectionWritable\(\) \|\| !manualBulkScopeValid\) return/);
  assert.match(runs, /if \(!manualSelectionWritable\(\)\) return; setManualSelection/);
  assert.match(runs, /current\.userId === manualAccess\.origin\?\.clerkActorId/);
  assert.match(runs, /!manualStartRequest && !manualInFlight\.current && !startManualMutation\.isPending/);
  assert.match(runs, /onChange=\{e => setManualSuite\(e\.target\.value\)\}/);
  assert.match(library, /label: "All loaded approved cases"/);
  assert.match(library, /bulkScopesReady=\{!readOnly && casesQuery\.isFetchedAfterMount/);
  assert.match(library, /onSelectionChange=\{ids => \{ if \(readOnly/);
  assert.doesNotMatch(runs + library, /testCaseIds\.slice\(0,\s*1000\)/);
});
