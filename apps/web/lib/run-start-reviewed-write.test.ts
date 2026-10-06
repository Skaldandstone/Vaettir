import { createHash, webcrypto } from "node:crypto";
import { expect, it } from "vitest";
import {
  admitRunStartRead,
  runStartReviewedReadKey,
  type RunStartReadSnapshot,
} from "./manual-run-start-reviewed-reader";
import { freezeRunConfiguration } from "./run-configuration-request";
import {
  freezeReviewedRunStart,
  reviewedRunStartAccessMatches,
  verifyReviewedRunStartAck,
  expectedReviewedRunId,
} from "./run-start-reviewed-write";
const id = "00000000-0000-4000-8000-000000000001";
const request = () =>
  freezeRunConfiguration(
    {
      projectId: "project",
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
      testCaseIds: ["one", "two"],
      expectedProfileHash: "a".repeat(64),
      executionContext: {
        configuration: " Raw\n config ",
        platform: "",
        build: "",
        hardwareRevision: "",
        firmwareVersion: "",
        rig: "",
        batchOrLot: "",
        environment: "",
        calibrationReference: "",
        protocolReference: "",
      },
    },
    id,
  );
function snapshot(
  projection: "ACCESS" | "PREVIEW" = "PREVIEW",
  supported = true,
): RunStartReadSnapshot {
  const input = {
    projectId: "project",
    originalOrganizationId: "org",
    expectedClerkActorId: "clerk",
    expectedNativeActorId: "native",
    requestId: id,
  };
  const readContext = {
    projection,
    requestId: id,
    requestedKey: runStartReviewedReadKey(input, projection),
    scope: {
      projectId: "project",
      organizationId: "org",
      actorId: "native",
      actorClerkUserId: "clerk",
    },
  };
  const raw =
    projection === "ACCESS"
      ? { readContext, canConfigure: true, canRecover: true }
      : {
          readContext,
          canConfigure: true,
          canRecover: true,
          canStart: supported,
          profile: supported
            ? {
                kind: "SUPPORTED",
                experience: null,
                profileHash: "a".repeat(64),
              }
            : { kind: "UNSUPPORTED", reason: "PROFILE_UNAVAILABLE" },
          limitations: [],
        };
  const admitted = admitRunStartRead(raw, input, projection, "clerk")!;
  return Object.freeze({
    origin: admitted.origin,
    observedSessionId: "session-A",
    projection,
    epoch: 0,
    revision: 1,
    receivedAt: "2026-10-06T00:00:00.000Z",
    data: admitted.data,
  });
}
function ack() {
  return {
    mode: "START",
    currentScope: {
      projectId: "project",
      organizationId: "org",
      actorId: "native",
      actorClerkUserId: "clerk",
    },
    idempotencyKey: id,
    legacyAck: {
      testRunId: `manual_${createHash("sha256")
        .update(JSON.stringify(["project", "native", id]))
        .digest("hex")}`,
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
      idempotencyKey: id,
    },
    historicalOuterProvenance: "UNRECORDED",
    interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS",
  };
}
it("prospective envelope owns exact immutable inner body without injecting native pin into legacy request", () => {
  const r = request(),
    before = JSON.stringify(r),
    o = freezeReviewedRunStart(r, snapshot());
  expect(JSON.stringify(o.envelope.request)).toBe(before);
  expect(o.envelope.expectedNativeActorId).toBe("native");
  expect("expectedNativeActorId" in o.envelope.request).toBe(false);
  expect(o.envelope.request).toBe(o.request);
  expect(Object.isFrozen(o.request.executionContext)).toBe(true);
  expect(r.executionContext.configuration).toBe("Raw\n config");
});
it("real WebCrypto deterministic target equals existing native actor+UUID SHA256 recipe", async () => {
  expect(globalThis.crypto.subtle).toBeDefined();
  expect(
    await expectedReviewedRunId(freezeReviewedRunStart(request(), snapshot())),
  ).toBe(ack().legacyAck.testRunId);
  expect(webcrypto.subtle).toBeDefined();
});
it("complete exact ACK is copied before async hashing and not misrepresented as recorded outer/native raw provenance", async () => {
  const o = freezeReviewedRunStart(request(), snapshot()),
    raw = ack(),
    pending = verifyReviewedRunStartAck(o, raw);
  raw.currentScope.actorId = "changed";
  const confirmed = await pending;
  expect(confirmed.currentScope.actorId).toBe("native");
  expect(confirmed.historicalOuterProvenance).toBe("UNRECORDED");
  expect(confirmed.interpretation).toBe("LEGACY_NORMALIZED_NOT_RAW_LOSSLESS");
});
it.each(["actorId", "actorClerkUserId", "projectId", "organizationId"])(
  "changed outer %s does not consume ownership",
  async (key) => {
    const raw = ack();
    (raw.currentScope as Record<string, string>)[key] = "foreign";
    await expect(
      verifyReviewedRunStartAck(
        freezeReviewedRunStart(request(), snapshot()),
        raw,
      ),
    ).rejects.toThrow("unknown");
  },
);
it.each([
  "mode",
  "idempotencyKey",
  "historicalOuterProvenance",
  "interpretation",
])("changed ACK %s stays unknown", async (key) => {
  const raw = ack();
  (raw as Record<string, unknown>)[key] = "unsupported";
  await expect(
    verifyReviewedRunStartAck(
      freezeReviewedRunStart(request(), snapshot()),
      raw,
    ),
  ).rejects.toThrow();
});
it.each([
  "testRunId",
  "originalOrganizationId",
  "expectedClerkActorId",
  "idempotencyKey",
])("changed inner ACK %s stays unknown", async (key) => {
  const raw = ack();
  (raw.legacyAck as Record<string, string>)[key] =
    key === "testRunId" ? `manual_${"f".repeat(64)}` : "wrong";
  await expect(
    verifyReviewedRunStartAck(
      freezeReviewedRunStart(request(), snapshot()),
      raw,
    ),
  ).rejects.toThrow();
});
it("partial/extra/oversized/getter ACK is refused before any private getter or trimming", async () => {
  let calls = 0;
  const raw = Object.defineProperty({}, "currentScope", {
    enumerable: true,
    get() {
      calls++;
      throw Error("PRIVATE");
    },
  });
  const o = freezeReviewedRunStart(request(), snapshot());
  for (const value of [
    null,
    { legacyAck: ack().legacyAck },
    { ...ack(), extra: "x" },
    { ...ack(), extra: "x".repeat(8192) },
    raw,
  ])
    await expect(verifyReviewedRunStartAck(o, value)).rejects.toThrow(
      "unknown",
    );
  expect(calls).toBe(0);
});
it("recovery admits current original ACCESS or unsupported PREVIEW without guessing receipt/profile/cohort", () => {
  const o = freezeReviewedRunStart(request(), snapshot());
  expect(reviewedRunStartAccessMatches(o, snapshot("ACCESS"))).toBe(true);
  expect(reviewedRunStartAccessMatches(o, snapshot("PREVIEW", false))).toBe(
    true,
  );
  expect(() => freezeReviewedRunStart(request(), snapshot("ACCESS"))).toThrow();
  expect(() =>
    freezeReviewedRunStart(request(), snapshot("PREVIEW", false)),
  ).toThrow();
});
it.each(["nativeActorId", "clerkActorId", "organizationId", "projectId"])(
  "recovery never rebinds original %s",
  (key) => {
    const current = snapshot("ACCESS");
    const changed = Object.freeze({
      ...current,
      origin: Object.freeze({ ...current.origin, [key]: "other" }),
    });
    expect(
      reviewedRunStartAccessMatches(
        freezeReviewedRunStart(request(), snapshot()),
        changed,
      ),
    ).toBe(false);
  },
);
it("new session/profile/body mismatches require explicit original intent, no default or native adoption", () => {
  const o = freezeReviewedRunStart(request(), snapshot());
  expect(
    reviewedRunStartAccessMatches(
      o,
      Object.freeze({ ...snapshot("ACCESS"), observedSessionId: "session-B" }),
    ),
  ).toBe(false);
  for (const r of [
    { ...request(), expectedProfileHash: "b".repeat(64) },
    { ...request(), testCaseIds: ["one", "one"] },
    { ...request(), idempotencyKey: "uuid" },
    { ...request(), expectedClerkActorId: "other" },
  ])
    expect(() => freezeReviewedRunStart(r, snapshot())).toThrow();
});
it.each(["epoch", "revision", "receivedAt", "projection"])(
  "whole snapshot %s corruption is not superficial capability authority",
  (key) => {
    const changed = Object.freeze({ ...snapshot(), [key]: "unsupported" });
    expect(() =>
      freezeReviewedRunStart(request(), changed as RunStartReadSnapshot),
    ).toThrow();
  },
);
it("mutable/missing-key/read-key/getter snapshots cannot grant an envelope", () => {
  const s = snapshot();
  if (!("profile" in s.data)) throw Error("Fixture requires actual PREVIEW");
  expect(() => freezeReviewedRunStart(request(), { ...s })).toThrow();
  let calls = 0;
  const getter = Object.freeze(
    Object.defineProperty({}, "origin", {
      enumerable: true,
      get() {
        calls++;
        throw Error();
      },
    }),
  );
  expect(() =>
    freezeReviewedRunStart(request(), getter as RunStartReadSnapshot),
  ).toThrow();
  expect(calls).toBe(0);
  const bad = Object.freeze({
    ...s,
    data: Object.freeze({
      ...s.data,
      readContext: Object.freeze({
        ...s.data.readContext,
        requestedKey: "stale",
      }),
    }),
  });
  expect(() => freezeReviewedRunStart(request(), bad)).toThrow();
});
