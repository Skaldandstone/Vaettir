import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { caseFieldReadOrigin, caseFieldReadPins, sameCaseFieldOrigin } from "./case-field-origin.ts";

const original = { projectId: "p", caseId: "c", organizationId: "org-a", clerkActorId: "clerk-a" };
const scope = { projectId: "p", organizationId: "org-a", actorId: "native-a", actorClerkUserId: "clerk-a" };
const body = { projectId: "p", caseId: "c", organizationId: "org-a", readScope: scope };

test("first metadata bootstrap requires the authenticated server's exact scope echo", () => {
  assert.deepEqual(caseFieldReadOrigin(body, "p", "c", "clerk-a"), original);
  for (const data of [null, undefined, { ...body, readScope: undefined }])
    assert.equal(caseFieldReadOrigin(data, "p", "c", "clerk-a"), null);
  assert.deepEqual(caseFieldReadPins(null), {});
  assert.deepEqual(caseFieldReadPins(original), { originalOrganizationId: "org-a", expectedClerkActorId: "clerk-a" });
});
test("an A cache response cannot become B's authorized origin merely because B is signed in", () => {
  assert.equal(caseFieldReadOrigin(body, "p", "c", "clerk-b"), null);
  assert.equal(caseFieldReadOrigin(body, "p", "c", null), null);
  assert.equal(caseFieldReadOrigin(body, "p", "c", undefined), null);
  const currentB = caseFieldReadOrigin({ ...body, readScope: { ...scope, actorId: "native-b", actorClerkUserId: "clerk-b" } }, "p", "c", "clerk-b");
  assert.equal(sameCaseFieldOrigin(original, currentB), false);
});
test("cross-project case and organization echoes fail closed before private body admission", () => {
  for (const patch of [{ projectId: "foreign" }, { caseId: "foreign" }, { organizationId: "foreign" }])
    assert.equal(caseFieldReadOrigin({ ...body, ...patch }, "p", "c", "clerk-a"), null);
  for (const patch of [{ projectId: "foreign" }, { organizationId: "" }, { actorId: "" }, { actorClerkUserId: "foreign" }])
    assert.equal(caseFieldReadOrigin({ ...body, readScope: { ...scope, ...patch } }, "p", "c", "clerk-a"), null);
  assert.equal(caseFieldReadOrigin(body, "", "c", "clerk-a"), null);
  assert.equal(caseFieldReadOrigin(body, "p", "", "clerk-a"), null);
});
test("history and project-only reads require their own complete server echo", () => {
  const history = { projectId: "p", caseId: "c", readScope: scope };
  assert.deepEqual(caseFieldReadOrigin(history, "p", "c", "clerk-a"), original);
  assert.equal(caseFieldReadOrigin({ ...history, readScope: undefined }, "p", "c", "clerk-a"), null);
  assert.deepEqual(caseFieldReadOrigin({ ...body, caseId: null }, "p", null, "clerk-a"), { ...original, caseId: null });
  assert.equal(caseFieldReadOrigin(body, "p", null, "clerk-a"), null);
});
test("a retained organization never rebases after an authorized dual-member project relocation", () => {
  const moved = caseFieldReadOrigin({ ...body, organizationId: "org-b", readScope: { ...scope, organizationId: "org-b" } }, "p", "c", "clerk-a");
  assert.equal(sameCaseFieldOrigin(original, moved), false);
  assert.deepEqual(caseFieldReadPins(original), { originalOrganizationId: "org-a", expectedClerkActorId: "clerk-a" });
  assert.equal(sameCaseFieldOrigin(original, caseFieldReadOrigin(body, "p", "c", "clerk-a")), true);
});
test("all three private read paths submit retained pins and require response origin independently", () => {
  const hook = readFileSync(new URL("./use-case-field-access.ts", import.meta.url), "utf8");
  const history = readFileSync(new URL("../components/CaseFieldHistory.tsx", import.meta.url), "utf8");
  assert.match(hook, /caseFieldReadPins\(origin\)/);
  assert.match(hook, /caseFieldReadOrigin\(query\.data, projectId, caseId \?\? null, userId\)/);
  assert.doesNotMatch(hook, /clerkActorId:\s*userId/);
  assert.match(history, /caseFieldReadPins\(access\.origin\)/);
  assert.match(history, /caseFieldReadPins\(origin\)/);
  assert.match(history, /caseFieldReadOrigin\(query\.data, projectId, caseId, access\.current\?\.clerkActorId\)/);
  assert.match(history, /caseFieldReadOrigin\(query\.data, projectId, caseId, origin\?\.clerkActorId\)/);
});
