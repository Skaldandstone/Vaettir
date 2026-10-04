// SOURCE ONLY: authored for deferred validation, not executed tonight.
import { describe, expect, it } from "vitest";
import { manualRetestExpectedScopeSchema, manualRetestReadRequestKey, manualRetestStartOutputSchema } from "./manualRetestScopeSchema.js";
import { manualRetestRequestHash, retestPreviewInputSchema, retestStartInputSchema } from "./manualRetest.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const base = { projectId: "project", sourceRunId: "source", testCaseId: "case" };
const scope = { projectId: "project", organizationId: "organization", clerkActorId: "clerk" };
const request = { ...base, expectedReviewHash: "a".repeat(64), idempotencyKey: "88c47b3b-d1f7-43b5-bd88-b49ddf14b8c0" };
describe("optional manual retest scope preserves historical omission", () => {
  it("keeps omitted preview/start shapes and the exact old four-field hash projection", () => {
    expect(retestPreviewInputSchema.parse(base)).toEqual(base);
    expect(Object.hasOwn(retestStartInputSchema.parse(request), "expectedScope")).toBe(false);
    expect(manualRetestRequestHash(request)).toBe(qualityProfileHash({ ...base, expectedReviewHash: request.expectedReviewHash }));
    expect(manualRetestStartOutputSchema.parse({ testRunId: "run", recovered: true })).toEqual({ testRunId: "run", recovered: true });
  });
  it("binds scoped hashes to the exact original organization and actor without changing UUID semantics", () => {
    const input = { ...request, expectedScope: scope };
    expect(manualRetestRequestHash(input)).not.toBe(manualRetestRequestHash(request));
    expect(manualRetestRequestHash({ ...input, idempotencyKey: "9b9c47bb-abeb-4338-85b1-3e96cff2f1ad" })).toBe(manualRetestRequestHash(input));
    for (const changed of [{ organizationId: "other" }, { clerkActorId: "other" }, { projectId: "other" }])
      expect(manualRetestRequestHash({ ...input, expectedScope: { ...scope, ...changed } })).not.toBe(manualRetestRequestHash(input));
  });
  it("rejects extra authorization fields, oversized identities and partial scopes instead of coercing permission", () => {
    for (const value of [{ ...scope, role: "OWNER" }, { projectId: "project" }, { ...scope, clerkActorId: "x".repeat(201) }])
      expect(manualRetestExpectedScopeSchema.safeParse(value).success).toBe(false);
    expect(retestPreviewInputSchema.safeParse({ ...base, expectedScope: scope, actorId: "native" }).success).toBe(false);
    expect(manualRetestStartOutputSchema.safeParse({ testRunId: "run", recovered: true, scope: { ...scope, actorId: "native" } }).success).toBe(false);
  });
  it("read identity binds original actor/org, source, case and pagination without adding omitted defaults", () => {
    expect(manualRetestReadRequestKey(base)).toBe(JSON.stringify(base));
    const key = manualRetestReadRequestKey({ ...base, expectedScope: scope });
    for (const input of [{ ...base, expectedScope: { ...scope, clerkActorId: "other" } }, { ...base, expectedScope: scope, before: "older" }, { ...base, expectedScope: scope, sourceRunId: "other" }])
      expect(manualRetestReadRequestKey(input)).not.toBe(key);
  });
});
