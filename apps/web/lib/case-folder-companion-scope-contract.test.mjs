// Source-only assertions, not mocked or real browser acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const scope = readFileSync(
  new URL("./use-folder-action-scope.ts", import.meta.url),
  "utf8",
);
const copy = readFileSync(
  new URL("../components/TestCaseFolderCopy.tsx", import.meta.url),
  "utf8",
);
const recovery = readFileSync(
  new URL("../components/TestCaseFolderRecovery.tsx", import.meta.url),
  "utf8",
);
function successBody(source) {
  // Copy now verifies dependency/dataset receipts asynchronously. Require the
  // actual callback boundary rather than silently slicing from missing index -1.
  const start = /onSuccess:\s*(?:async\s+)?\(result\)\s*=>\s*\{/.exec(source);
  assert.ok(start, "success callback exists");
  const end = source.indexOf("onError: (error)", start.index);
  assert.ok(end > start.index, "failure callback follows success callback");
  return source.slice(start.index, end);
}
test("companion scopes require fresh parent/member/Clerk identity without rebinding old drafts", () => {
  for (const text of [
    "useAuth()",
    "!project.error",
    "!project.isFetching",
    "!project.isPaused",
    "!organizations.error",
    "!organizations.isFetching",
    "!organizations.isPaused",
    "origin.clerkActorId === userId",
    "value.organizationId === origin?.organizationId",
    "epoch.generation + 1",
    "if (!origin && accessReady && organizationId)",
  ])
    assert.ok(scope.includes(text), text);
});
test("folder generation is tracked state and event-only live scope is published after commit", () => {
  assert.match(scope, /\[epoch,\s*setEpoch\]\s*=\s*useState/);
  assert.match(
    scope,
    /if\s*\(epoch\.key\s*!==\s*key\)\s*setEpoch\(\{\s*key,\s*generation\s*\}\)/,
  );
  assert.doesNotMatch(scope, /epoch\.current/);
  const publication = scope.indexOf("useLayoutEffect(() => {");
  const end = scope.indexOf("}, [ready, origin, generation]);", publication);
  assert.ok(publication >= 0 && end > publication);
  const committed = scope.slice(publication, end);
  assert.ok(committed.includes("live.current = { ready, origin, generation }"));
  assert.ok(committed.includes("ready: false, origin, generation: -1"));
  assert.equal(scope.match(/live\.current/g)?.length, 2);
  const keyStart = scope.indexOf("const key = JSON.stringify([");
  const keyEnd = scope.indexOf("]);", keyStart);
  assert.ok(keyStart >= 0 && keyEnd > keyStart);
  const key = scope.slice(keyStart, keyEnd);
  for (const predicate of [
    "enabled",
    "project.error",
    "project.isFetching",
    "project.isPaused",
    "organizations.error",
    "organizations.isFetching",
    "organizations.isPaused",
    "accessReady",
  ])
    assert.ok(key.includes(predicate), predicate);
});
test("failed/paused/cancelled/old-generation reads cannot authorize complete impact", () => {
  for (const source of [copy, recovery]) {
    assert.ok(source.includes("reviewGeneration === scope.generation"));
    assert.ok(source.includes("scope.matches(review.data)"));
    assert.ok(source.includes('review.fetchStatus === "idle"'));
    assert.ok(source.includes("dataUpdatedAt > before"));
    assert.ok(source.includes("approvedHash !== reviewed.expectedHash"));
    assert.ok(
      source.includes("scope.live.current.generation === scope.generation"),
    );
  }
  assert.ok(copy.includes("review.data?.fromPath === prepared.fromPath"));
  assert.ok(copy.includes("review.data.toPath === prepared.toPath"));
  assert.ok(recovery.includes("review.data?.originalReceiptId === reviewId"));
});
test("unknown inputs and mounted human drafts survive close, legacy ACK uses original scope", () => {
  for (const source of [copy, recovery]) {
    assert.ok(source.includes("if (!pending && !draftStarted)"));
    assert.ok(source.includes("mutation.mutate(pending)"));
    assert.ok(source.includes("input?.expectedScope ?? scope.origin"));
    assert.ok(source.includes("result.requestId !== input.requestId"));
    assert.ok(
      source.includes(
        "result.organizationId !== acknowledgedScope.organizationId",
      ),
    );
    assert.ok(
      source.includes("result.clerkActorId !== acknowledgedScope.clerkActorId"),
    );
    assert.ok(source.includes("organizationId: scope.origin!.organizationId"));
    assert.ok(source.includes("clerkActorId: scope.origin!.clerkActorId"));
    const success = successBody(source);
    assert.doesNotMatch(success, /input\.(?:expectedScope|requestId)\s*=/);
  }
});
test("accepted ACK remains separate from failed refresh and late changed-account callbacks", () => {
  for (const source of [copy, recovery]) {
    const success = successBody(source);
    assert.ok(success.indexOf("result.requestId !== input.requestId") >= 0);
    assert.ok(success.indexOf("receipt.current = null") >= 0);
    assert.ok(
      success.indexOf("result.requestId !== input.requestId") <
        success.indexOf("receipt.current = null"),
    );
    assert.ok(success.includes("throwOnError: true"));
    assert.ok(success.includes("was not retried"));
    assert.ok(
      success.includes("live.origin.clerkActorId === result.clerkActorId"),
    );
    assert.doesNotMatch(success, /mutation\.mutate/);
  }
  const copied = successBody(copy);
  for (const validation of [
    "await verifiedFolderPrerequisiteAck(input, result)",
    "await verifiedFolderDatasetAck(input, result)",
    "!graphVerified",
    "!datasetsVerified",
    "receipt.current?.input !== input",
  ]) {
    assert.ok(copied.includes(validation), validation);
    assert.ok(
      copied.indexOf(validation) < copied.indexOf("receipt.current = null"),
    );
  }
});
test("copy results and recovery choices have scope guards and native readable hierarchy", () => {
  assert.ok(
    copy.includes("completed && currentAccess && scope.matches(completed)"),
  );
  assert.ok(copy.includes('p.split("/").join(" › ")'));
  assert.ok(recovery.includes("caseFolders.recoveryCatalog.useQuery"));
  assert.ok(recovery.includes("currentOptions.items.map"));
  assert.ok(recovery.includes('row.fromPath.split("/").join(" › ")'));
  assert.ok(
    recovery.includes(
      "Selected operation (verify its current recovery impact)",
    ),
  );
});
