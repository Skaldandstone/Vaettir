import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = readFileSync(new URL("../components/QualityRiskRegister.tsx", import.meta.url), "utf8");

// Authored source contracts only. Real installed QueryClient rendering is a
// separate mandatory morning gate; these assertions are not its substitute.
test("risk review refuses cached error, paused, wrong-page and changed-version baselines", () => {
  assert.match(source, /!list\.error && !list\.isFetching && !list\.isPaused/);
  assert.match(source, /!detail\.error && !detail\.isFetching && !detail\.isPaused/);
  assert.match(source, /!lookup\.error && !lookup\.isFetching && !lookup\.isPaused/);
  assert.match(source, /detail\.data\.entry\.id === selected/);
  assert.match(source, /current\.entry\.version === baseline\.version/);
  assert.match(source, /<Register key=\{projectId\}/);
});
test("uncertain risk request remains mounted across close and exact typed refusal retries", () => {
  assert.match(source, /const request = pending \?\? \{ \.\.\.structuredClone\(input\), expectedScope:/);
  assert.match(source, /retainSavedQueryRequest\(recovery, error\)/);
  assert.match(source, /Retry exact risk change/);
  assert.match(source, /function close\(\) \{ setOpen\(false\); \}/);
  assert.match(source, /expectedVersion: baseline!\.version/);
});
test("risk register provides qualitative initial and residual context and short modal screens", () => {
  for (const text of ["Component", "Initial likelihood / consequence", "Latest human residual", "Failure description",
    "Initial assessment", "Intended mitigation", "Review risk definition", "Execution evidence", "Review decision"])
    assert.ok(source.includes(text), text);
  assert.match(source, /width: "100%", minWidth: 0, boxSizing: "border-box"/);
  assert.match(source, /Scroll sideways for all columns/);
});
test("links and captured status never claim qualified approval or automatic reverification", () => {
  assert.match(source, /later result, procedure or requirement changes/);
  assert.match(source, /not qualified regulatory acceptance, an e-signature or proven mitigation/);
  assert.match(source, /I reviewed removal of/);
  assert.match(source, /No execution-result references were recorded/);
  assert.match(source, /Historical: the entry baseline has changed/);
  assert.match(source, /No numerical score, standard-specific threshold or safety certification/);
});
