import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
const source = readFileSync(new URL("../components/QualityRiskOverview.tsx", import.meta.url), "utf8");
const mounted = readFileSync(new URL("../components/QualityRiskRegister.tsx", import.meta.url), "utf8");
// Authored source contracts, not actual rendering/QueryClient acceptance.
test("fresh project membership original-org and request-bound query caches gate read-only counts", () => {
  for (const query of ["project", "organizations", "summary", "detail"]) assert.ok(source.includes(`!${query}.isFetching`));
  for (const query of ["project", "organizations", "summary", "detail"]) { assert.ok(source.includes(`!${query}.error`)); assert.ok(source.includes(`!${query}.isPaused`)); }
  assert.ok(source.includes("enabled: ready")); assert.ok(source.includes("enabled: ready && !!selectedId"));
  assert.ok(source.includes("summary.data.organizationId === originalOrganizationId"));
  assert.ok(source.includes("detail.data.organizationId === project.data?.organizationId"));
  assert.ok(source.includes("qualityRiskOverviewRequestKey(input)")); assert.ok(source.includes("qualityRiskOverviewRequestKey(detailInput)"));
  assert.ok(source.includes("setOriginalOrganizationId(project.data!.organizationId)")); assert.ok(!source.includes("setOriginalOrganizationId(current.organizationId)"));
  assert.ok(source.includes("originalOrganizationId !== project.data?.organizationId"));
  assert.ok(source.includes("const ready = projectReady && memberReady"));
  assert.ok(source.includes("freshProject.isFetching")); assert.ok(source.includes("freshOrganizations.isFetching"));
});
test("human reviews and captured evidence never become safety or verification metrics", () => {
  for (const text of ["Entry version matches ordinary review", "No ordinary review recorded", "Reviewed with no evidence", "No category cross-product, normative ranking or risk-reduction score",
    "not automatically reverified", "NOT_RECORDED means no decision", "No entries match these filters", "Unavailable original tuple; native IDs withheld", "Result reference, no standalone result route"]) assert.ok(source.includes(text));
  assert.ok(source.includes("/test-cases?caseId=")); assert.ok(source.includes("/requirements#requirement-")); assert.ok(source.includes("/test-runs#run-"));
  assert.ok(!source.includes("useMutation"));
});
test("bounded native controls and progressive read-only evidence remain declared", () => {
  assert.ok(source.includes("boxSizing: \"border-box\"")); assert.ok(source.includes("size=\"wide\""));
  assert.ok(source.includes("aria-label=\"Filtered human risk entries\" tabIndex={0}")); assert.ok(source.includes("Scroll sideways for all recorded fields"));
  assert.ok(source.includes("<select style={control}")); assert.ok(source.includes("<summary>Captured evidence references"));
  assert.ok(!source.includes("<h1")); assert.ok(mounted.includes("<QualityRiskOverview projectId={projectId} />"));
  assert.ok(mounted.includes("utils.qualityRiskOverview.summary.invalidate({ projectId })"));
  assert.ok(mounted.includes("utils.qualityRiskOverview.byId.invalidate({ projectId })"));
});
