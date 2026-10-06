import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const source = path => readFileSync(new URL(path, import.meta.url), "utf8");

test("legacy plan owner retains opaque state without legacy reads, save or start dispatch", () => {
  const modal = source("../components/PlanExecutionModal.tsx");
  assert.match(modal, /\[draft, setDraft\] = useState<Template>\(emptyTemplate\)/);
  assert.match(modal, /\[runAttempt, setRunAttempt\] = useState<RunRequest \| null>\(null\)/);
  assert.match(modal, /\[startedRunId, setStartedRunId\] = useState<string \| null>\(null\)/);
  assert.match(modal, /legacyBlocked = !!runAttempt \|\| !!startedRunId \|\| busy/);
  assert.equal(modal.match(/enabled: false/g)?.length, 2);
  assert.match(modal, /<PlanExecutionReviewed projectId=\{projectId\} testPlanId=\{id\}/);
  assert.match(modal, /legacyBlocked=\{legacyBlocked\} legacyHasDraft=\{legacyHasDraft\}/);
  assert.doesNotMatch(modal, /mutateAsync\(|\.refetch\(|query\.data|profileQuery\.data|setRunAttempt\(|setStartedRunId\(/);
});

test("native plan browsing preserves complete identities and refuses unavailable template SAVE", () => {
  const modal = source("../components/PlanExecutionReviewed.tsx");
  assert.match(modal, /originalNativeActorId: plan\.origin\?\.nativeActorId \?\? null/);
  assert.match(modal, /currentPlan === plan\.snapshot/);
  assert.match(modal, /currentProfile === profile\.snapshot/);
  assert.match(modal, /page\.selected\.map/);
  assert.match(modal, /item\.metadata\?\.displayId \|\| item\.testCaseId/);
  assert.match(modal, /Missing, archived or unapproved selected cases/);
  assert.match(modal, /Browsing candidates never changes this selection/);
  assert.match(modal, /previousCursors/);
  assert.match(modal, /maxLength=\{200\}/);
  assert.match(modal, /page\.rawTemplate\.sqlNull \? "SQL NULL" : page\.rawTemplate\.jsonText/);
  assert.match(modal, /disabled>Save reusable template \(reviewed native-save protocol unavailable\)/);
  assert.doesNotMatch(modal, /saveExecutionTemplate|manualExecution\.start/);
});

test("plan starts retain original native-pinned body and privately settle exact ACK before visible callbacks", () => {
  const modal = source("../components/PlanExecutionReviewed.tsx");
  const controller = source("./plan-execution-reviewed-controller.ts");
  assert.match(modal, /manualRunStartReviewed\.start\.useMutation/);
  assert.match(modal, /controller\.submit\(input => start\.mutateAsync\(input\), onSaved\)/);
  assert.match(modal, /Retry exact held request/);
  assert.match(modal, /controller\.view\(\)\.confirmedRunId !== view\.confirmedRunId/);
  assert.match(controller, /interpretation === "EXACT_SUPPORTED"/);
  assert.match(controller, /testCaseIds: \[\.\.\.page\.template!\.testCaseIds\]/);
  assert.match(controller, /executionContext: \{ \.\.\.preset\.context \}/);
  assert.match(controller, /idempotencyKey: this\.uuid\(\)/);
  assert.match(controller, /freezeReviewedPlanStart/);
  assert.match(controller, /transport\(held\.owned\.envelope\)/);
  assert.match(controller, /verifyReviewedPlanStartAck\(held\.owned, raw\)/);
  assert.match(controller, /this\.pending = null; this\.known = Object\.freeze\(\{ held, ack \}\)/);
  assert.ok(controller.indexOf("this.known = Object.freeze({ held, ack })") < controller.indexOf("onConfirmed?.()"));
  assert.match(controller, /this\.epoch === startedEpoch && this\.fullProfile\(held\)/);
  assert.match(controller, /retained\.everAmbiguous \|\| !definitive/);
  assert.doesNotMatch(controller, /window.location|router.push|setTimeout/);
});

test("plan detail keeps configuration modal mounted on the current page", () => {
  const detail = source("../components/TestPlanDetailContent.tsx");
  assert.match(detail, /const executionControls = controlProjectId \? <PlanExecutionModal key=\{id\}/);
  assert.match(detail, /open=\{executionOpen && !!plan && auth\.isLoaded && !!auth\.isSignedIn && !readOnly && !loadError\}/);
  assert.match(detail, /projectId=\{controlProjectId\}/);
  assert.match(detail, /organizationId=\{organizationId \|\| undefined\}/);
  assert.match(detail, /if \(!plan\) return <div>\{executionControls\}\{reviewedControls\}/);
  assert.equal(detail.match(/<PlanExecutionModal\b/g)?.length, 1);
  assert.equal(detail.match(/\{executionControls\}/g)?.length, 2);
  assert.match(detail, /Configure cases \/ repeat execution/);
  const list = source("../app/projects/[projectId]/test-plans/page.tsx");
  assert.match(list, /save named configurations, then review each repeat execution/);
});
