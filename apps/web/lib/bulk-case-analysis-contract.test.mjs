import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const component = readFileSync(
  new URL("../components/DurableCaseAnalysis.tsx", import.meta.url),
  "utf8",
);

test("durable bulk analysis reviews the whole bounded scope and retains exact uncertain requests", () => {
  assert.match(component, /ids: \[\.\.\.selectedIds\]/);
  assert.match(component, /reviewRequest \?\?/);
  assert.match(component, /approvalRequest \?\?/);
  assert.match(component, /allowCaseProcessing: true/);
  assert.match(component, /saved\.balance >= saved\.maximumCredits &&\s+consent/);
  assert.match(
    component,
    /!state\.error &&\s+!state\.isFetching &&\s+!state\.isPaused/,
  );
  assert.match(component, /Maximum approved spend/);
  assert.match(component, /No cached scope can\s+authorize spending/);
  assert.match(component, /Make a request/);
  assert.match(component, /Cancel remaining work/);
  assert.match(component, /Saved analysis queues/);
  assert.doesNotMatch(
    component,
    /assessRisk\.useMutation|reviewTestDesign|selectedIds\.slice/,
  );
});
