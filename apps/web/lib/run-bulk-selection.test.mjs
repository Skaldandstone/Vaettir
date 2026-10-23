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
  const modal = source("../components/RunConfigurationModal.tsx").replace(/\s+/g, " ");
  const completion = source("./run-config-completion.ts").replace(/\s+/g, " ");
  assert.match(modal, /!bulkScopesReady \|\| !access\.canWrite \|\| busy \|\| refreshingNow\.current \|\| !controller\.canEdit\(liveSession\(\), completion\.activationEpoch\)/);
  assert.match(modal, /onSelectionChange\(result\.ids\)/);
  assert.match(modal, /setReviewedCount\(null\); setReviewedIds\(null\)/);
  assert.match(modal, /onChange=\{\(event\) =>\s*setBulkScopeKey\(event\.target\.value\)\s*\}/);
  assert.match(modal, /bulkScopeKey \? \(bulkScopes\?\.find\(\(scope\) => scope\.key === bulkScopeKey\) \?\? null\) : \(bulkScopes\?\.\[0\] \?\? null\)/);
  assert.match(modal, /Selected scope unavailable/);
  assert.match(modal, /confirmedStart\?\.request \?\? pendingRequest/);
  assert.match(modal, /freezeRunConfiguration/);
  assert.match(completion, /runConfigurationScopeMatches\(request, this\.origin\)/);
  assert.match(completion, /canEdit: authorized && !this.busy && !this.pending && !this.confirmed/);
  assert.match(modal, /Selection changes are locked while confirming the original/);
});

test("both callers use only loaded approved scopes; missing suite and navigation cannot infer selection", () => {
  const runs = source("../app/projects/[projectId]/test-runs/page.tsx").replace(/\s+/g, " "), library = source("../app/projects/[projectId]/test-cases/page.tsx");
  assert.match(runs, /\[manualSuite, setManualSuite\] = useState\(RUN_SUITE_ALL_VALUE\)/);
  assert.match(runs, /resolveRunSuiteScope\(\s*manualSuite,\s*suiteCatalog\.options,?\s*\)/);
  assert.match(runs, /\["matching", "all", "suite"\]\.includes\(manualBulkScope\) && \(manualBulkScope === "all" \|\| \(manualSuiteSelection\.available && \(manualBulkScope !== "suite" \|\| manualSuiteSelection\.specific\)\)\)/);
  assert.match(runs, /manualBulkScope !== "suite" \|\| manualSuiteSelection\.specific/);
  assert.match(runs, /manualBulkScope === "suite" && manualSuiteSelection\.specific \? manualSuiteCases/);
  assert.match(runs, /manualSuiteSelection\.available \? eligibleCases\.filter\(\(testCase\) => runSuiteScopeMatches\(manualSuiteSelection\.scope, testCase\.suitePath\),?\s*\) : \[\]/);
  assert.match(runs, /bulkScopesReady=\{ configurationOpen && manualBulkReady && manualSuiteSelection\.available && !selectionWriteStarted \}/);
  assert.match(runs, /no All-suites fallback or selection change was applied/);
  assert.doesNotMatch(runs, /Boolean\(manualSuite\)|suitePath === manualSuite|filter\(Boolean\)/);
  assert.match(runs, /manualSourceReady \? \(casesQuery\.data \?\? \[\]\) : \[\]/);
  assert.match(runs, /!testCase\.archived && testCase\.reviewStatus === "APPROVED"/);
  assert.match(runs, /if \(!manualSelectionWritable\(\) \|\| !manualBulkScopeValid\) return/);
  assert.match(runs, /if \(!manualSelectionWritable\(\)\) return; publishSelection\(new Set\(\)\)/);
  assert.match(runs, /current\.userId === manualAccess\.origin\?\.clerkActorId/);
  assert.match(runs, /configurationSelection === null && retainedSelection\.current === null && selectionRevision === selectionEvents\.current\.revision && !startManualMutation\.isPending/);
  assert.match(runs, /if \(!manualSelectionWritable\(\) \|\| manualSelection\.size === 0\) return/);
  assert.match(runs, /ids\.some\(\(id\) => !eligibleCases\.some\(\(testCase\) => testCase\.id === id\)\)/);
  assert.match(runs, /Object\.freeze\(ids\); retainedSelection\.current = \{ projectId, ids \}; setConfigurationSelection\(ids\)/);
  assert.match(runs, /<RunConfigurationModal key=\{`\$\{projectId\}:run-configuration`\} open=\{configurationOpen\}/);
  assert.match(runs, /testCaseIds=\{configurationSelection \?\? \[\]\}/);
  assert.match(runs, /return startManualMutation\.mutateAsync\(envelope\)/);
  assert.match(runs, /const configuration = envelope\.request/);
  assert.match(runs, /envelope\.projectId !== projectId/);
  assert.match(runs, /manualRunStartReviewed\.start\.useMutation/);
  assert.doesNotMatch(runs, /manualExecution\.start\.useMutation/);
  assert.doesNotMatch(runs, /manualStartRequest|crypto\.randomUUID|assertManualStartAcknowledgement/);
  assert.match(runs, /onChange=\{\(e\) => setManualSuite\(e\.target\.value\)\}/);
  assert.match(library, /label: "All loaded approved cases"/);
  assert.match(library, /bulkScopesReady=\{!readOnly && casesQuery\.isFetchedAfterMount/);
  assert.match(library, /onSelectionChange=\{ids => \{ if \(readOnly/);
  assert.doesNotMatch(runs + library, /testCaseIds\.slice\(0,\s*1000\)/);
});

test("851-case all/filter/suite operations retain stable selection and never change frozen review IDs", () => {
  const all = Array.from({ length: 851 }, (_, index) => `case-${index}`);
  const selected = applyRunBulkSelection([], all, "SET");
  assert.equal(selected.after, 851);
  const frozen = Object.freeze([...selected.ids]);
  assert.deepEqual(applyRunBulkSelection(selected.ids, all.slice(10, 20), "REMOVE").ids, [...all.slice(0, 10), ...all.slice(20)]);
  assert.deepEqual(applyRunBulkSelection(all.slice(0, 400), all.slice(200), "ADD").ids, all);
  assert.deepEqual(applyRunBulkSelection(all, all.slice(700), "SET").ids, all.slice(700));
  assert.deepEqual(frozen, all);
});
