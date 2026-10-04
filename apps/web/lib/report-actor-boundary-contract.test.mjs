// Authored source contracts only. Actual QueryClient/Clerk/browser acceptance
// belongs to the coordinator, not these static assertions.
import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const read = path => readFileSync(new URL(path, import.meta.url), "utf8").replace(/\s+/g, " ");
const builder = read("../components/ReportBuilder.tsx"), manager = read("../components/ReportDefinitionManager.tsx"), catalog = read("../components/ReportSnapshotCatalog.tsx"), detail = read("../app/projects/[projectId]/reports/snapshots/[snapshotId]/page.tsx"), live = read("../app/projects/[projectId]/reports/page.tsx");
test("every report surface pins actual Clerk identity in tracked state without actor-key remount", () => {
  for (const source of [builder, manager, catalog, detail, live]) {
    assert.match(source, /from "@clerk\/nextjs"/);
    assert.match(source, /isLoaded, isSignedIn, userId.*useAuth\(\)/);
    assert.match(source, /\[originalActor, setOriginalActor\] = useState<string \| null>\(null\)/);
    assert.match(source, /actorMatches = actorReady && originalActor === userId/);
    assert.doesNotMatch(source, /key=\{userId\}|key=\{actor/);
    assert.doesNotMatch(source, /originalActor.current/);
  }
});
test("private capture fields and exact unknown UUID remain mounted but invisible outside original scope", () => {
  assert.match(builder, /workflowOrigin, setWorkflowOrigin/);
  assert.match(builder, /workflowOrigin.actor === userId && workflowOrigin.organizationId === project.data\?\.organizationId/);
  assert.match(builder, /hidden=\{!actorMatches \|\| !workflowMatches\}/);
  assert.match(builder, /open=\{open && !readOnly\}/);
  assert.match(builder, /const input = request \?\?/);
  assert.match(builder, /const input = saveRequest \?\?/);
  assert.match(builder, /if \(readOnly \|\| !userId \|\| !project.data\) return/);
  assert.match(builder, /review && review.reviewOrgId.*review.reviewActorId === userId/);
  assert.match(builder, /useLayoutEffect\(\(\) => \{ liveScope.current/);
  assert.match(builder, /liveScope.current.actor !== originalActorId/);
  assert.match(builder, /liveScope.current.organizationId !== originalOrganizationId/);
  for (const retained of ["request", "saveRequest"]) {
    const freshRequest = builder.match(new RegExp(`const input = ${retained} \\?\\? \\{(.*?)\\};`))?.[1];
    assert.ok(freshRequest, `${retained} retains a separate fresh payload`);
    assert.match(freshRequest, /requestId: crypto\.randomUUID\(\)/);
    assert.doesNotMatch(freshRequest, /userId|originalActor/);
  }
});
test("definition history preserves mounted authored state and separates current write/admin rights", () => {
  assert.match(manager, /hidden=\{!accessReady\}/);
  assert.match(manager, /open=\{open && accessReady\}/);
  assert.match(manager, /enabled: open && accessReady/);
  assert.match(manager, /canManage = writeReady && !!data\?\.canManage && \(data.current.visibility === "private" \|\| adminReady\)/);
  assert.match(manager, /canShare = adminReady && !!data\?\.canShare/);
  assert.match(manager, /if \( !accessReady \|\| !data \|\| !canManage/);
  assert.match(manager, /const request = pending \?\?/);
  assert.match(manager, /if \(!liveAccess.current\).*Exact request retained/);
  assert.ok(manager.indexOf("if (!liveAccess.current)") < manager.indexOf("setPending(null)", manager.indexOf("// Acknowledgement")));
  assert.match(manager, /The change was acknowledged as saved/);
});
test("catalog comparison mount is actor-gated without fresh-query mount loops", () => {
  assert.match(catalog, /const projectReady = actorMatches &&/);
  assert.match(catalog, /if \(!actorMatches\) return/);
  assert.match(catalog, /compareOpen && actorMatches && selectionOrganization === organizationId/);
  assert.doesNotMatch(catalog, /compareOpen && accessReady/);
});
test("live report and inventory-query exports require fresh exact actor and original tenant echoes", () => {
  for (const prefix of ["report", "preview"]) {
    for (const guard of [`!${prefix}.error`, `!${prefix}.isFetching`, `!${prefix}.isPaused`, `${prefix}.data?.projectId === projectId`, `${prefix}.data.organizationId === originalOrganization`, `${prefix}.data.clerkActorId === userId`]) assert.ok(live.includes(guard), guard);
  }
  assert.match(live, /if \(!accessReady \|\| !actorMatches \|\| !data \|\| !project.data\) return/);
  assert.match(live, /availableViews\?\.map/);
  assert.doesNotMatch(live, /views.data\?\.map/);
  assert.match(live, /open=\{queryOpen && accessReady\}/);
  assert.match(live, /hidden=\{!originalScopeMatches\}/);
  assert.match(live, /if \(!writeReady \|\| !actorMatches \|\| !previewData/);
});
test("snapshot sharing checks the original Clerk actor around fresh reauthorization and clipboard", () => {
  assert.match(detail, /const projectReady = actorMatches &&/);
  assert.match(detail, /scope.actor !== originalActorId/);
  assert.match(detail, /scope.organizationId !== originalOrganizationId/);
  assert.match(detail, /currentScope.current.actor !== originalActorId/);
  assert.match(detail, /useLayoutEffect\(\(\) => \{ currentScope.current/);
  assert.match(detail, /if \(!actorMatches\) return/);
  assert.match(detail, /Cached snapshot and sharing controls are hidden/);
});
