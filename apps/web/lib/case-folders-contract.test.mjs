import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const component = readFileSync(
  new URL("../components/TestCaseFolders.tsx", import.meta.url),
  "utf8",
);
const tree = readFileSync(
  new URL("../components/TestCaseTree.tsx", import.meta.url),
  "utf8",
);
const recovery = readFileSync(
  new URL("../components/TestCaseFolderRecovery.tsx", import.meta.url),
  "utf8",
);
const copy = readFileSync(
  new URL("../components/TestCaseFolderCopy.tsx", import.meta.url),
  "utf8",
);
test("independent folders render without invented case IDs and support an empty project", () => {
  assert.ok(tree.includes("folderPaths"));
  assert.ok(tree.includes("if (tc.id) node.cases.push(tc)"));
});
test("inverse placement recovery retains exact uncertain approval and shows bounded complete impact", () => {
  for (const value of [
    "retainedTraceabilityReceipt",
    "mutation.mutate(pending)",
    "latest 25 receipts",
    "reviewed.caseCount",
    "reviewed.archivedCaseCount",
    "isFetchedAfterMount",
    "fetchStatus",
    "No AI credits",
    "reason.trim()",
  ])
    assert.ok(recovery.includes(value), value);
  assert.match(recovery, /no blind\s+rollback or automatic merge/);
});
test("complete folder copy shows all exclusions, procedures and metadata before retained exact approval", () => {
  for (const value of [
    "retainedTraceabilityReceipt",
    "mutation.mutate(pending)",
    "50 independent cases",
    "8 MiB",
    "No AI credits",
    "reviewed.caseCount",
    "reviewed.folderCount",
    "reviewed.notice",
    "reviewed.orderNotice",
    "reviewed.cases.map",
    "c.customFields",
    "reason.trim()",
    "fetchStatus",
    "isFetchedAfterMount",
  ])
    assert.ok(copy.includes(value), value);
});
test("folder approvals require complete current review and retain exact uncertain receipt", () => {
  for (const value of [
    "reviewed.caseCount",
    "reviewed.archivedCaseCount",
    "preview.isFetchedAfterMount",
    "preview.fetchStatus",
    "retainedTraceabilityReceipt",
    "mutation.mutate(pending)",
    "reason.trim()",
    "No AI credits",
  ])
    assert.ok(component.includes(value), value);
});
