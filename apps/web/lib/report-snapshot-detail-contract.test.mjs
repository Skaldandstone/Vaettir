// Authored source contracts only. Real QueryClient/clipboard/browser checks have
// deliberately NOT been executed in James's source-only evening session.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const source = readFileSync(
    new URL(
      "../app/projects/[projectId]/reports/snapshots/[snapshotId]/page.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  flat = source.replace(/\s+/g, " ");
test("route identity remounts snapshot-local sharing state", () => {
  assert.ok(source.includes("key={`${projectId}:${snapshotId}`}"));
  assert.ok(source.includes("copyGeneration.current++"));
  assert.ok(source.includes("alive.current = false"));
});
test("all project and membership cache failure states fail closed", () => {
  for (const guard of [
    "!project.error",
    "!project.isFetching",
    "!project.isPaused",
    "project.data?.id === projectId",
    "!organizations.error",
    "!organizations.isFetching",
    "!organizations.isPaused",
    "org.id === organizationId",
    "enabled: accessReady",
    "staleTime: 0",
  ])
    assert.ok(flat.includes(guard), guard);
  assert.ok(source.includes("missingMembership"));
});
test("approved cached state is insufficient without fresh matching snapshot identity", () => {
  for (const guard of [
    "!snapshot.error",
    "!snapshot.isFetching",
    "!snapshot.isPaused",
    "snapshot.data?.id === snapshotId",
    "snapshot.data.projectId === projectId",
    "snapshot.data.organizationId === organizationId",
  ])
    assert.ok(flat.includes(guard), guard);
  assert.ok(source.includes("{ready && ("));
  assert.ok(source.includes("report={ready.payload}"));
  assert.ok(
    source.includes('allowExport={ready.payload.state === "approved"}'),
  );
  assert.ok(!source.includes("report={snapshot.data.payload}"));
});
test("copy reauthorizes all access and original-org identity before writing the native link", () => {
  for (const guard of [
    "!ready",
    'ready.payload.state !== "approved"',
    "freshProject.error",
    "freshProject.isFetching",
    "freshProject.isPaused",
    "freshOrganizations.error",
    "freshOrganizations.isFetching",
    "freshOrganizations.isPaused",
    "freshSnapshot.error",
    "freshSnapshot.isFetching",
    "freshSnapshot.isPaused",
    "freshSnapshot.data?.id !== snapshotId",
    "freshSnapshot.data.projectId !== projectId",
    "freshSnapshot.data.organizationId !== originalOrganizationId",
    'freshSnapshot.data.payload.state !== "approved"',
    "scope.organizationId !== originalOrganizationId",
  ])
    assert.ok(flat.includes(guard), guard);
  assert.ok(
    source.indexOf("await Promise.all", source.indexOf("async function copy")) <
      source.indexOf("navigator.clipboard.writeText"),
  );
  assert.ok(
    source.includes("reports/snapshots/${encodeURIComponent(snapshotId)}"),
  );
  assert.ok(!source.includes("writeText(window.location.href)"));
});
test("same-route organization changes invalidate only access evidence, never captured content", () => {
  assert.ok(flat.includes("previousOrganization.current !== organizationId"));
  assert.ok(source.includes("void snapshot.refetch()"));
  assert.ok(source.includes('setMessage("")'));
  assert.ok(!source.includes("removeQueries"));
  assert.ok(!source.includes("useMutation"));
});
test("denial offline missing membership and wrong echoes offer honest states and retry", () => {
  for (const text of [
    "wrongIdentity",
    "missingMembership",
    "Cached preview, export and sharing controls are withheld",
    "Reconnect to verify current snapshot access",
    "No sharing link was copied",
    "Try again",
    "recipients still need their own access",
  ])
    assert.ok(flat.includes(text), text);
  assert.ok(source.includes("onClick={() => void refresh()}"));
});
test("private preview never gets sharing/export and original recipient authorization remains required", () => {
  assert.ok(source.includes('ready.payload.state === "approved"'));
  assert.ok(
    flat.includes(
      "Private preview. Approve it from the report builder before workspace sharing",
    ),
  );
  assert.ok(
    flat.includes("Recipients must already have access to this workspace"),
  );
  assert.ok(source.includes("disabled={copying}"));
});
