import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const component = readFileSync(
  new URL("../components/SharedStepHistoryReview.tsx", import.meta.url),
  "utf8",
);
const page = readFileSync(
  new URL("../app/projects/[projectId]/shared-steps/page.tsx", import.meta.url),
  "utf8",
);
test("library procedure editor uses the available responsive review width", () => {
  for (const guard of [
    'width: "100%"',
    'boxSizing: "border-box"',
    "style={fieldStyle}",
    "style={labelStyle}",
    "Reason (required)",
  ]) {
    assert.ok(component.includes(guard), guard);
  }
});
test("library approvals require fresh verified current data, not failed/paused cached success", () => {
  for (const guard of [
    "fresh &&",
    "!query.isError",
    'query.fetchStatus === "idle"',
    "query.isFetchedAfterMount",
    "data?.canEdit",
    "baseline !== data.revisionHash",
  ])
    assert.ok(component.includes(guard), guard);
});
test("uncertain reviewed writes retain their exact UUID and procedure through close/reopen", () => {
  for (const text of [
    "pending ??",
    "requestId: crypto.randomUUID()",
    "mutation.mutate(pending)",
    "setFresh(false)",
    "Retry exact approved change",
    "onPendingChanged",
  ])
    assert.ok(component.includes(text), text);
  assert.ok(!component.includes("setPending(null);\n    onClose"));
  assert.ok(page.includes("open={historyOpen}"));
  assert.ok(!page.includes("onClose={() => setLibrary(null)}"));
  for (const source of [component, page]) {
    assert.ok(source.includes("retainedTraceabilityReceipt("));
    assert.ok(source.includes("pendingReceipt.current?.input ?? null"));
    assert.ok(source.includes("pendingReceipt.current = null"));
    assert.ok(source.includes("uncertain: false"));
  }
  assert.ok(component.includes("mutation.reset()"));
});
test("library history preserves actor uncertainty, procedures and reviewed current-case impact", () => {
  for (const text of [
    "Current content captured at migration",
    "Unknown / system capture",
    "Frozen run instructions",
    "mediaAttachmentIds",
    "Latest revisions",
    "Older revisions",
    "No AI credits",
    "I reviewed the procedure and impact",
    "!action &&",
  ])
    assert.ok(component.includes(text), text);
  assert.ok(page.includes("Show archived libraries"));
  assert.ok(!page.includes(".delete.useMutation"));
});
