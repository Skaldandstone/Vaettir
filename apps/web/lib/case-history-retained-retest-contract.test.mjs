// SOURCE ONLY. NOT RUN: mounted response-loss/role/actor/paused regressions are mandatory in the morning.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const history = readFileSync(new URL("../components/TestCaseExecutionHistory.tsx", import.meta.url), "utf8");
const retest = readFileSync(new URL("../components/ManualRetestWizard.tsx", import.meta.url), "utf8");
test("one selected retest stays mounted independently of conditional history rows", () => {
  const conditionalHistoryEnd = history.indexOf('{selectedRetest && <section');
  assert.ok(conditionalHistoryEnd > history.indexOf("History scope and evidence limits"));
  assert.ok(history.includes("sourceRunId={selectedRetest.runId} testCaseId={selectedRetest.caseId}"));
  assert.ok(history.includes("canRetest={selectedRetest.canRetest && memberCanWrite} active={!!page}"));
  assert.ok(history.includes("disabled={retainedRetest}"));
  assert.ok(history.includes("An unconfirmed request must first recover its receipt"));
});
test("inactive retest hides native/private bodies and guards review/start without clearing exact request", () => {
  for (const literal of ["active=true", "open={open&&active}", "if(legacyBlocked||!current())return", "const legacyHeld=attempt??retainedLegacyAttempt", "setAttempt(captureLegacyRequest(retainedLegacyAttempt))",
    "Private evidence, links and actions are hidden", "const metadataReadEnabled = actorReady", "{ enabled: metadataReadEnabled, staleTime: 0, retry: false, refetchOnMount: false }", "const ready = active && !denied && !paused", "readEnabled={open}", "active={active&&canRetest&&access.ready&&access.canWrite}"])
    assert.ok(retest.includes(literal), literal);
  assert.ok(retest.indexOf("!view.readable?<section>") < retest.indexOf("{view.known?<section>"));
  assert.ok(retest.includes("controller.view().readable&&open&&active"));
  assert.ok(!retest.includes("setAttempt(null)"));
  assert.ok(!retest.includes("if (!active) setAttempt(null)"));
  assert.ok(history.includes("reloading does not preserve local state"));
});
