import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const component = readFileSync(
  new URL("../components/RequirementCoverageExport.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
const matrix = readFileSync(
  new URL("../components/RequirementCoverageMatrix.tsx", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");
// SOURCE ONLY, NOT RUN. Text assertions are not QueryClient/Clerk/browser/keyboard acceptance.
test("full export queries once per exact applied criteria, not concatenated browse pages", () => {
  assert.ok(component.includes("exportMatrix.useQuery"));
  assert.ok(
    component.includes("enabled: open && ready") ||
      component.includes("enabled:open && ready"),
  );
  assert.ok(
    component.includes("requirementCoverageExportOutput.parse(current)"),
  );
  assert.ok(component.includes("requirementCoverageExportPlan(current)"));
  assert.ok(
    component.includes("current.actorClerkUserId") ||
      component.includes("query.data.actorClerkUserId === clerkActorId"),
  );
  assert.ok(component.includes("query.data.requested === requestKey"));
  assert.ok(component.includes("not the visible twenty-row browse page"));
});
test("review is response/format/revision/epoch bound and unmount/closure/consumption invalidate it", () => {
  for (const text of [
    "query.dataUpdatedAt",
    "previous.format !== format",
    "reviewed === active",
    "reviewedEpoch === epoch",
    "live.current.epoch !== reviewedEpoch",
    "live.current.open = false",
    "URL.revokeObjectURL",
    "anchor.remove()",
  ])
    assert.ok(component.includes(text));
  assert.match(component, /\[previous, setPrevious\] = useState/);
  assert.doesNotMatch(component, /previous\.current|epoch\.current/);
  assert.match(
    component,
    /useLayoutEffect\(\(\) => \{ live.current = \{ active, requestKey, format, open, epoch \}; return \(\) => \{/,
  );
  assert.match(
    component,
    /active:\s*null,\s*requestKey:\s*"",\s*format:\s*"CSV",\s*open:\s*false,\s*epoch:\s*-1/,
  );
  assert.ok(component.includes('value="CSV"'));
  assert.ok(component.includes('value="HTML"'));
  const downloadAt = component.indexOf("function download()");
  const consumeAt = component.indexOf("live.current.open = false;", downloadAt);
  const effectAt = component.indexOf('document.createElement("a")', downloadAt);
  assert.ok(downloadAt >= 0 && consumeAt > downloadAt && effectAt > consumeAt);
});
test("current matrix and report mount retain same actor/original organization and failed/paused cache guards", () => {
  for (const text of [
    "useAuth()",
    "project.byId.useQuery",
    "organization.mine.useQuery",
    "originalClerkActorId",
    "expectedClerkActorId",
    "actorNow.current.userId !== originalClerkActorId",
    "RequirementCoverageExport",
    "revision={list.dataUpdatedAt}",
  ])
    assert.ok(matrix.includes(text));
  assert.ok(matrix.includes("list.data.actorClerkUserId === userId"));
  assert.ok(matrix.includes("cases.data.actorClerkUserId === userId"));
  assert.ok(matrix.includes("evidence.data.actorClerkUserId === userId"));
  assert.ok(matrix.includes("freshProject.error"));
  assert.ok(matrix.includes("freshOrganizations.isPaused"));
});
