import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  assertVersionRestoreAck,
  currentVersionRead,
  freezeVersionEnvelope,
  versionRestoreRequestHash,
} from "./case-version-draft";
const origin = {
  projectId: "project",
  caseId: "case",
  organizationId: "org",
  clerkActorId: "clerk",
  nativeActorId: "native",
};
const readScope = {
  projectId: "project",
  organizationId: "org",
  actorId: "native",
  actorClerkUserId: "clerk",
};
const request = {
  projectId: "project",
  testCaseId: "case",
  versionNumber: 1,
  expectedCaseRevision: "a".repeat(64),
  expectedVersionRevision: "b".repeat(64),
  fields: ["tags", "title"] as Array<"tags" | "title">,
  reason: "  Retained reason  ",
  confirmed: true as const,
  requestId: "bee715be-045f-48a0-9158-1c2e08c300ec",
};
describe("exact case-version protocol/read proof", () => {
  it("browser hash keeps the old sorted-field/parsed-reason contract, without envelope/nonces", async () => {
    // Canonical key order mirrors existing qualityProfileHash; values are the
    // old versionRestoreSchema parsed body, not a new operation-format hash.
    const parsed = {
      ...request,
      reason: "Retained reason",
      fields: ["tags", "title"],
    };
    const native = createHash("sha256")
      .update(
        JSON.stringify(
          Object.fromEntries(
            Object.keys(parsed)
              .sort()
              .map((key) => [key, parsed[key as keyof typeof parsed]]),
          ),
        ),
      )
      .digest("hex");
    expect(await versionRestoreRequestHash(request)).toBe(native);
    expect(
      await versionRestoreRequestHash({
        ...request,
        fields: ["title", "tags"],
      }),
    ).toBe(native);
    const envelope = freezeVersionEnvelope(request, origin);
    expect(envelope.request).not.toHaveProperty("originalOrganizationId");
    expect(envelope.request).not.toHaveProperty("readRequestId");
    expect(await versionRestoreRequestHash(envelope.request)).toBe(native);
    expect(Object.isFrozen(envelope.request.fields)).toBe(true);
    expect(envelope.request.fields).not.toBe(request.fields);
  });
  it("admits only completed exact native reader/nonce/case/projection and never cache-only, fetching or paused output", () => {
    const projection = { kind: "LIST" as const, take: 10, before: null },
      data = {
        items: [],
        readContext: {
          readRequestId: request.requestId,
          readScope,
          caseId: "case",
          canRecover: true,
          projection,
        },
      };
    const query = {
      data,
      error: null,
      isFetchedAfterMount: true,
      isFetching: false,
      isPaused: false,
    };
    expect(
      currentVersionRead(query, origin, true, request.requestId, projection),
    ).toBe(data);
    for (const patch of [
      { isFetchedAfterMount: false },
      { isFetching: true },
      { isPaused: true },
      { error: Error("Refused") },
    ])
      expect(
        currentVersionRead(
          { ...query, ...patch },
          origin,
          true,
          request.requestId,
          projection,
        ),
      ).toBeNull();
    for (const patch of [
      { caseId: "foreign" },
      { readRequestId: crypto.randomUUID() },
      { readScope: { ...readScope, actorId: "replacement" } },
      { readScope: { ...readScope, organizationId: "other" } },
      { projection: { kind: "CURRENT" as const, versionNumber: 1 } },
    ])
      expect(
        currentVersionRead(
          {
            ...query,
            data: { ...data, readContext: { ...data.readContext, ...patch } },
          },
          origin,
          true,
          request.requestId,
          projection,
        ),
      ).toBeNull();
    expect(
      currentVersionRead(query, origin, false, request.requestId, projection),
    ).toBeNull();
    expect(
      currentVersionRead(query, null, true, request.requestId, projection),
    ).toBeNull();
  });
  it("requires exact scoped UUID/hash/native ACK, not any successful legacy/malformed response", async () => {
    const pending = {
      input: freezeVersionEnvelope(request, origin),
      origin,
      requestHash: await versionRestoreRequestHash(request),
      uncertain: false,
      draftIdentity: "draft",
    };
    const result = {
      requestId: request.requestId,
      requestHash: pending.requestHash,
      readScope,
      caseId: "case",
      scopeProof: "CURRENT_LOCKED_AUTHORIZATION" as const,
      restoredVersionNumber: 1,
      createdVersionNumber: 3,
      displayId: "TC-1",
      replayed: true,
    };
    expect(() => assertVersionRestoreAck(result, pending)).not.toThrow();
    for (const patch of [
      { requestId: crypto.randomUUID() },
      { requestHash: "c".repeat(64) },
      { caseId: "foreign" },
      { readScope: { ...readScope, actorId: "replacement" } },
      { restoredVersionNumber: 2 },
      { createdVersionNumber: 1 },
      { scopeProof: undefined },
    ])
      expect(() =>
        assertVersionRestoreAck(
          { ...result, ...patch } as typeof result,
          pending,
        ),
      ).toThrow(/exact request/);
  });
});
