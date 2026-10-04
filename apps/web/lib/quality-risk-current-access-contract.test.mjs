import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const source = readFileSync(new URL("../components/QualityRiskRegister.tsx", import.meta.url), "utf8");
// SOURCE ONLY. No actual QueryClient, Clerk or rendered acceptance is claimed.
test("fresh actor project membership and original organization gate every retained risk read", () => {
  assert.ok(source.includes("const { isLoaded, isSignedIn, userId } = useAuth()"));
  for (const query of ["project", "organizations", "list", "detail", "lookup"]) {
    assert.ok(source.includes(`!${query}.error`)); assert.ok(source.includes(`!${query}.isFetching`)); assert.ok(source.includes(`!${query}.isPaused`));
  }
  for (const query of ["list", "detail", "lookup"]) {
    assert.ok(source.includes(`${query}.data.organizationId === project.data?.organizationId`));
    assert.match(source, new RegExp(`${query}\\.data(?:\\?)?\\.organizationId\\s*===\\s*originalOrganizationId`));
    assert.ok(source.includes(`${query}.data.actorClerkUserId === userId`));
  }
  assert.ok(source.includes("origin.actorClerkUserId !== userId")); assert.ok(source.includes("origin.organizationId !== project.data?.organizationId"));
  assert.ok(source.includes("enabled: ready && open && !!selected")); assert.ok(source.includes("enabled: ready && open && mode !== \"VIEW\""));
});
test("unknown risk UUID baseline and human draft remain retained through current access changes", () => {
  assert.ok(source.includes("const request = pending ?? { ...structuredClone(input), expectedScope:")); assert.ok(source.includes("retainSavedQueryRequest(recovery, error)"));
  assert.ok(source.includes("if (mutation.isPending || !writeReady) return"));
  assert.ok(source.includes("formVisible && mode !== \"VIEW\" && <fieldset"));
  assert.ok(source.includes("Your fields and any exact unconfirmed request are retained without rebasing"));
  assert.ok(source.includes("Recheck current baseline without replacing draft"));
  const originEffect = source.slice(source.indexOf("useEffect(() =>"), source.indexOf("const identityChanged"));
  for (const setter of ["setPending", "setDefinition", "setReview", "setBaseline"]) assert.ok(!originEffect.includes(setter));
  assert.ok(source.includes("!origin && actorReady && projectReady && membership"));
});
test("acknowledged risk mutation is outside failure catch before independent dashboard reads", () => {
  const begin = source.indexOf("async function send"), end = source.indexOf("async function refresh", begin), send = source.slice(begin, end);
  const catchAt = send.indexOf("} catch (error)"), ackAt = send.indexOf("// Receipt acknowledgement"), refreshAt = send.indexOf("utils.qualityRiskOverview.summary.invalidate");
  assert.ok(catchAt > 0 && ackAt > catchAt && refreshAt > ackAt);
  assert.ok(send.slice(catchAt, ackAt).includes("return;"));
  assert.ok(send.slice(ackAt).includes("setPending(null)")); assert.ok(send.slice(ackAt).includes(".catch(() => undefined)"));
  assert.ok(!send.slice(ackAt).includes("mutateAsync"));
});
test("existing dashboard mount native current pages and human qualification boundaries remain", () => {
  assert.ok(source.includes("<QualityRiskOverview projectId={projectId} />"));
  assert.ok(source.includes("Retained definitions, native links and drafts are hidden, not discarded"));
  assert.ok(source.includes("detail.data.entry.id === selected")); assert.ok(source.includes("detail.data.historyOffset === historyOffset"));
  assert.ok(source.includes("current.entry.version === baseline.version"));
  assert.ok(source.includes("not qualified regulatory acceptance, an e-signature or proven mitigation"));
});
