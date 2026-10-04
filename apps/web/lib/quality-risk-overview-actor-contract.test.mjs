// SOURCE ONLY; real Clerk/installed QueryClient acceptance is still required.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const component = readFileSync(new URL("../components/QualityRiskOverview.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/services/qualityRiskOverview.ts", import.meta.url), "utf8");
const router = readFileSync(new URL("../../api/src/routers/qualityRiskOverview.ts", import.meta.url), "utf8");
test("original actor is pinned once and both cache identities require fresh server actor echoes", () => {
  for (const literal of ["useAuth()", "!originalOrganizationId && !originalClerkActorId", "setOriginalClerkActorId(userId!)", "originalClerkActorId === userId",
    "expectedClerkActorId: originalClerkActorId", "summary.data.actorClerkUserId === originalClerkActorId", "summary.data.actorClerkUserId === userId",
    "detail.data.actorClerkUserId === originalClerkActorId", "detail.data.actorClerkUserId === userId", "actorNow.current.userId !== originalClerkActorId"])
    assert.ok(component.includes(literal), literal);
  assert.ok(!component.includes("setOriginalClerkActorId(undefined)"));
  assert.ok(component.includes("Retained counts and native chips are hidden"));
  assert.ok(component.includes("Your filter draft remains retained"));
});
test("locked membership and DB actor bind read echoes before population callback without Viewer promotion", () => {
  assert.ok(service.includes("withQualityRiskAccess(db, input.projectId, actorId, organizationId"));
  assert.ok(service.includes("where: { id: access.actorId }"));
  assert.ok(service.includes("input.expectedClerkActorId !== actor.clerkUserId"));
  assert.ok(service.includes('["FULL", "READ_ONLY"].includes(member.seatType)'));
  assert.ok(service.indexOf("input.expectedClerkActorId !== actor.clerkUserId") < service.indexOf("return work(tx,"));
  assert.equal((router.match(/\.\.\.scope/g) ?? []).length, 2);
  assert.ok(!component.includes("useMutation"));
});
