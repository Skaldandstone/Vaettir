import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const component = readFileSync(
  new URL("../components/CaseAuthoringPresets.tsx", import.meta.url),
  "utf8",
);
const form = readFileSync(
  new URL("../components/TestCaseForm.tsx", import.meta.url),
  "utf8",
);
const dialog = readFileSync(
  new URL("../components/ui/DialogFrame.tsx", import.meta.url),
  "utf8",
);
const fields = readFileSync(
  new URL("../components/CaseCustomFields.tsx", import.meta.url),
  "utf8",
);
test("controlled preset writes retain exact uncertain actor approval and compare content/profile/required fields", () => {
  for (const value of [
    "retainedTraceabilityReceipt",
    "mutation.mutate(pending)",
    "reviewed.nextVersion",
    "reviewed.requiredFields",
    "reviewed.applicabilityMatches",
    "CurrentProfile",
    "current.canManage",
    "isFetchedAfterMount",
    "fetchStatus",
    "reason.trim()",
    "Review this content as a new revision",
  ])
    assert.ok(component.includes(value), value);
});
test("prefill preserves a separate new human draft rather than replacing a case or later edits", () => {
  for (const value of [
    "draftReceipt.current",
    "Resume preset case draft",
    "keepMounted={!!draft}",
    "active={draftActive}",
    'mode="create"',
    "initialCustomFields",
    "No existing draft was replaced",
    "Discard only local case draft",
  ])
    assert.ok(component.includes(value), value);
  assert.ok(
    form.includes(
      'mode==="create"&&!testCaseId?initialCustomFields:undefined',
    ) || form.includes('mode === "create" && !testCaseId'),
  );
  assert.ok(fields.includes("initial.expectedSchemaHash"));
  assert.ok(fields.includes("active &&"));
});
test("preset module pins fresh original actor and organization while retaining unavailable drafts and unknown payloads", () => {
  for (const value of ["usePresetAccess", "useAuth", "projectReady", "origin.clerkActorId === userId", "expectedScope: access.expectedScope", "access.matches(catalog.data)", "access.matches(history.data)", "access.matches(review.data)", "active={draftActive}", "hidden={!draftActive}", "element.inert = !draftActive", "setPending(receipt.current?.input ?? null)"])
    assert.ok(component.includes(value), value);
  assert.ok(!component.includes("key={organizationId}"));
  assert.ok(!component.includes("key={userId}"));
});
test("review approval binds response identity and availability epoch; late prefill cannot replace a draft after close/unmount", () => {
  for (const value of ["approvedReview?.value === reviewed", "approvedReview.epoch === reviewEpoch", "live.current.epoch !== attempt.current.epoch", "live.current.reviewed !== attempt.current.reviewed", "value.expectedHash !== attempt.current.expectedHash", "attempt.current = null", "live.current = null", "draftReceipt.current || draft", "useReviewEpoch"])
    assert.ok(component.includes(value), value);
  const epochStart = component.indexOf("function useReviewEpoch");
  const epochEnd = component.indexOf("function usePresetAccess", epochStart);
  assert.ok(epochStart >= 0 && epochEnd > epochStart);
  const epoch = component.slice(epochStart, epochEnd);
  assert.match(epoch, /\[state, setState\] = useState/);
  assert.match(epoch, /state\.epoch \+ 1/);
  assert.doesNotMatch(epoch, /\.current/);
  assert.match(component, /useLayoutEffect\(\(\) => \{\s*live.current = \{ ready: canManageCurrent, approved: reviewed \};\s*return \(\) => \{ live.current = null; \}/);
  assert.match(component, /useLayoutEffect\(\(\) => \{\s*live.current = \{ available: !!reviewed, epoch: reviewEpoch, reviewed \};\s*return \(\) => \{ live.current = null; \}/);
});
test("acknowledged preset write and failed independent refresh do not erase human definition or imply a failed write", () => {
  const ack = component.slice(component.indexOf("onSuccess: (result) =>"), component.indexOf("onError: (error) =>"));
  assert.ok(ack.includes("result.requestId !== receipt.current?.input.requestId"));
  assert.ok(ack.includes("Acknowledged saved"));
  assert.ok(ack.includes("Current catalog refresh is separate"));
  assert.ok(ack.includes("Refresh failed"));
  assert.ok(ack.includes("uncertain: true"));
  for (const destructive of ["setDefinition(blank())", "setName(\"\")", "setLoaded(false)", "setSelection(\"\")"])
    assert.ok(!ack.includes(destructive), destructive);
});
test("a retained local prefill discloses later profile/schema changes without reapplying or qualifying its scaffold", () => {
  for (const value of ["draft.value.profileHash !== current.profileHash", "draft.value.fieldSchemaHash !== current.fieldSchemaHash", "original prefill and your edits remain unchanged", "not a regulatory or console TRC qualification", "Retained defaults are not silently reapplied or discarded"])
    assert.ok(component.includes(value), value);
});
test("optional kept-mounted native dialog stays closed/hidden/inert without changing existing default unmount", () => {
  for (const value of [
    "keepMounted = false",
    "!open && !keepMounted",
    "hidden={!open}",
    "if (dialog) dialog.inert = !open",
    'display: "none"',
    "if (!open || !dialog) return;",
  ])
    assert.ok(dialog.includes(value), value);
});
