import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
const source = readFileSync(new URL("../components/QualityRiskRegister.tsx", import.meta.url), "utf8");
const service = readFileSync(new URL("../../api/src/services/qualityRisks.ts", import.meta.url), "utf8");
// SOURCE ONLY; actual Clerk/QueryClient write-race rendering is not exercised.
test("first new risk UUID captures pinned scope without rebinding retained unknown payload", () => {
  assert.ok(source.includes("const request = pending ?? { ...structuredClone(input), expectedScope:"));
  assert.ok(source.includes("pending ?? { ...structuredClone(input), expectedScope: { organizationId: origin!.organizationId, clerkActorId: origin!.actorClerkUserId } }"));
  assert.ok(source.indexOf("expectedScope: { organizationId: origin!.organizationId", source.indexOf("const request = pending")) < source.indexOf("setPending(request)"));
  assert.ok(!source.includes("request.expectedScope ="), "No retained React state request is mutated or rebound");
  assert.ok(source.includes("retainSavedQueryRequest(recovery, error)"));
  assert.ok(source.includes("Receipt acknowledgement precedes all reads"));
});
test("risk expected scope is enforced against server actor before receipt replay or new write", () => {
  const start = service.indexOf("export async function writeQualityRisk"), scope = service.indexOf("if (input.expectedScope)", start),
    prior = service.indexOf("tx.qualityRiskWrite.findUnique", start);
  assert.ok(start >= 0 && scope > start && prior > scope);
  assert.ok(service.slice(scope, prior).includes("id: access.actorId"));
  assert.ok(service.slice(scope, prior).includes("input.expectedScope.organizationId !== access.organizationId"));
  assert.ok(service.slice(scope, prior).includes("input.expectedScope.clerkActorId !== actor.clerkUserId"));
  assert.ok(source.includes("actorClerkUserId: userId!"));
});
