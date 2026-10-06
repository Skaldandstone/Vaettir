import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  freezeReviewedStartEnvelope,
  inspectReviewedStartWire,
  manualRunStartReviewedStartInput as start,
  manualRunStartReviewedRecoveryInput as recover,
  manualRunStartReviewedAckSchema as ack,
  REVIEWED_START_WIRE_BOUNDS,
} from "./manualRunStartReviewedWriteSchema.js";
import { manualRunStartLegacyInputSchema } from "./manualRunStartLegacySchema.js";
import {
  qualityProfileHash,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";
const uuid = "00000000-0000-4000-8000-000000000001";
const pins = {
  projectId: "project",
  originalOrganizationId: "org",
  expectedClerkActorId: "human",
  expectedNativeActorId: "native",
};
const inner = () => ({
  idempotencyKey: uuid,
  executionContext: {
    environment: " exact\n prose ",
    build: "",
    configuration: "0",
  },
  expectedClerkActorId: "human",
  originalOrganizationId: "org",
  testCaseIds: ["two", "one"],
  expectedProfileHash: "a".repeat(64),
  projectId: "project",
});
const envelope = () => ({ mode: "START" as const, request: inner(), ...pins });
function legacyHash(
  value: Parameters<typeof manualRunStartLegacyInputSchema.parse>[0],
) {
  const input = manualRunStartLegacyInputSchema.parse(value);
  return qualityProfileHash({
    testCaseIds: input.planReference
      ? input.testCaseIds
      : [...input.testCaseIds].sort(),
    expectedProfileHash: input.expectedProfileHash ?? null,
    configuration: runConfigurationSchema.parse(input.executionContext ?? {}),
    ...(input.planReference ? { planReference: input.planReference } : {}),
    ...(input.originalOrganizationId
      ? {
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        }
      : {}),
  });
}
describe("reviewed run-start raw wire envelope, no native permission or SQL proof", () => {
  it("START validation preserves entire raw wire/inner key order, literal prose and presence without applying old transforms", () => {
    const raw = envelope(),
      before = JSON.stringify(raw),
      value = start.parse(raw);
    expect(value).toBe(raw);
    expect(value.request).toBe(raw.request);
    expect(JSON.stringify(value)).toBe(before);
    expect(Object.keys(value)).toEqual(Object.keys(raw));
    expect(Object.keys(value.request)).toEqual(Object.keys(raw.request));
    expect(value.request.executionContext?.environment).toBe(" exact\n prose ");
    expect(value.request.executionContext?.build).toBe("");
    expect(value.request.executionContext?.configuration).toBe("0");
    expect(value.request.executionContext).not.toHaveProperty("platform");
    expect(
      manualRunStartLegacyInputSchema.parse(value.request).executionContext
        ?.environment,
    ).toBe("exact\n prose");
    expect(legacyHash(value.request)).toBe(legacyHash(raw.request));
  });
  it.each([
    {},
    { executionContext: {} },
    { executionContext: { build: "" } },
    { executionContext: { build: " retained\n " } },
  ])(
    "RECOVERY preserves old omissions/explicit empty/raw fields %j without injecting pins or defaults",
    (extra) => {
      const request = {
          testCaseIds: ["case"],
          idempotencyKey: uuid,
          projectId: "project",
          ...extra,
        },
        raw = { request, ...pins, mode: "LEGACY_RECOVERY" as const };
      const before = JSON.stringify(raw),
        value = recover.parse(raw),
        owned = freezeReviewedStartEnvelope(value);
      expect(value).toBe(raw);
      expect(JSON.stringify(owned)).toBe(before);
      expect(owned.request).not.toHaveProperty("originalOrganizationId");
      expect(owned.request).not.toHaveProperty("expectedClerkActorId");
      expect(legacyHash(owned.request)).toBe(legacyHash(request));
      expect(Object.keys(owned.request)).toEqual(Object.keys(request));
    },
  );
  it("owned asynchronous copy is deeply immutable without modifying caller buffers", () => {
    const raw = envelope(),
      captured = freezeReviewedStartEnvelope(start.parse(raw)),
      before = JSON.stringify(captured);
    expect(captured).not.toBe(raw);
    expect(Object.isFrozen(raw)).toBe(false);
    expect(Object.isFrozen(captured.request.testCaseIds)).toBe(true);
    expect(Object.isFrozen(captured.request.executionContext)).toBe(true);
    raw.request.testCaseIds.push("changed");
    raw.request.executionContext.environment = "changed";
    expect(JSON.stringify(captured)).toBe(before);
    expect(() => captured.request.testCaseIds.push("new")).toThrow();
  });
  it.each([
    "expectedProfileHash",
    "executionContext",
    "idempotencyKey",
    "originalOrganizationId",
    "expectedClerkActorId",
  ])(
    "new START requires its original inner %s rather than naked legacy creation",
    (key) => {
      const raw = envelope();
      Reflect.deleteProperty(raw.request, key);
      expect(start.safeParse(raw).success).toBe(false);
    },
  );
  it.each([
    "expectedNativeActorId",
    "originalOrganizationId",
    "expectedClerkActorId",
  ])(
    "missing outer %s cannot be inferred from inner/default/cached account",
    (key) => {
      const raw = envelope();
      Reflect.deleteProperty(raw, key);
      expect(start.safeParse(raw).success).toBe(false);
      expect(
        recover.safeParse({ ...raw, mode: "LEGACY_RECOVERY" }).success,
      ).toBe(false);
    },
  );
  it.each(["projectId", "originalOrganizationId", "expectedClerkActorId"])(
    "inner %s must agree with outer scope if present",
    (key) => {
      const raw = envelope();
      Object.assign(raw.request, { [key]: "foreign" });
      expect(start.safeParse(raw).success).toBe(false);
      expect(
        recover.safeParse({ ...raw, mode: "LEGACY_RECOVERY" }).success,
      ).toBe(false);
    },
  );
  it("retained plan reference/context/order remains exact and old parsed hash unchanged", () => {
    const request = {
      ...inner(),
      planReference: {
        configurationId: uuid,
        expectedTemplateHash: "b".repeat(64),
        testPlanId: "plan",
      },
    };
    const raw = { request, mode: "START" as const, ...pins },
      owned = freezeReviewedStartEnvelope(start.parse(raw));
    expect(JSON.stringify(owned)).toBe(JSON.stringify(raw));
    expect(Object.keys(owned.request.planReference!)).toEqual(
      Object.keys(request.planReference),
    );
    expect(owned.request.testCaseIds).toEqual(["two", "one"]);
    expect(legacyHash(owned.request)).toBe(legacyHash(request));
  });
  it.each(["outer", "inner", "configuration", "plan"])(
    "unknown %s fields are rejected, not stripped into a replacement request",
    (location) => {
      const raw = envelope() as ReturnType<typeof envelope> & {
        extra?: boolean;
      };
      if (location === "outer") raw.extra = true;
      else if (location === "inner")
        Object.assign(raw.request, { extra: "retained" });
      else if (location === "configuration")
        Object.assign(raw.request.executionContext, { extra: "retained" });
      else
        Object.assign(raw.request, {
          planReference: {
            testPlanId: "plan",
            expectedTemplateHash: "b".repeat(64),
            configurationId: uuid,
            extra: true,
          },
        });
      expect(start.safeParse(raw).success).toBe(false);
      expect(
        recover.safeParse({ ...raw, mode: "LEGACY_RECOVERY" }).success,
      ).toBe(false);
    },
  );
  it.each([
    "getter",
    "toJSON",
    "nonenumerable",
    "symbol",
    "hole",
    "prototype",
    "cycle",
    "undefined",
  ])(
    "unsupported %s representation is refused before any accessor/serialization hook runs",
    (kind) => {
      const raw = envelope(),
        calls = { value: 0 };
      if (kind === "getter")
        Object.defineProperty(raw, "request", {
          enumerable: true,
          get: () => {
            calls.value++;
            return inner();
          },
        });
      if (kind === "toJSON")
        Object.assign(raw, {
          toJSON: () => {
            calls.value++;
            return {};
          },
        });
      if (kind === "nonenumerable")
        Object.defineProperty(raw, "private", {
          value: "retained",
          enumerable: false,
        });
      if (kind === "symbol")
        Object.defineProperty(raw, Symbol("private"), { value: true });
      if (kind === "hole") delete raw.request.testCaseIds[0];
      if (kind === "prototype")
        Object.setPrototypeOf(raw.request, { extra: true });
      if (kind === "cycle") Object.assign(raw, { future: raw });
      if (kind === "undefined")
        Object.assign(raw.request, { expectedProfileHash: undefined });
      expect(start.safeParse(raw).success).toBe(false);
      expect(calls.value).toBe(0);
    },
  );
  it("bounded escaped byte/depth/array admissions reject whole request without clipping", () => {
    expect(() =>
      inspectReviewedStartWire("x".repeat(REVIEWED_START_WIRE_BOUNDS.bytes)),
    ).toThrow();
    expect(() => inspectReviewedStartWire(Array(1001).fill("case"))).toThrow();
    let deep: unknown = "retained";
    for (let i = 0; i < 18; i++) deep = [deep];
    expect(() => inspectReviewedStartWire(deep)).toThrow();
    const raw = envelope();
    raw.request.testCaseIds = Array.from(
      { length: 1000 },
      (_, i) => `case-${i}`,
    );
    expect(start.safeParse(raw).success).toBe(true);
    raw.request.testCaseIds.push("case-1001");
    expect(start.safeParse(raw).success).toBe(false);
  });
  it("new START refuses duplicate/unsupported identities but RECOVERY keeps original legacy accepted shape", () => {
    const raw = envelope();
    raw.request.testCaseIds = ["same", "same"];
    expect(start.safeParse(raw).success).toBe(false);
    raw.request.testCaseIds = ["x".repeat(201)];
    expect(start.safeParse(raw).success).toBe(false);
    expect(recover.safeParse({ ...raw, mode: "LEGACY_RECOVERY" }).success).toBe(
      true,
    );
  });
  it("ACK explicitly separates current scope and legacy-normalized confirmation from unrecorded historical outer provenance", () => {
    const value = {
      mode: "LEGACY_RECOVERY",
      currentScope: {
        projectId: "project",
        organizationId: "org",
        actorId: "native",
        actorClerkUserId: "human",
      },
      idempotencyKey: uuid,
      legacyAck: { testRunId: "manual_" + "a".repeat(64) },
      historicalOuterProvenance: "UNRECORDED",
      interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS",
    };
    expect(ack.parse(value)).toEqual(value);
    expect(ack.safeParse({ ...value, created: true }).success).toBe(false);
    expect(
      ack.safeParse({
        ...value,
        historicalOuterProvenance: "REVIEWED_AT_ORIGINAL_CREATION",
      }).success,
    ).toBe(false);
  });
  it("write wire runtime imports remain browser-pure; original parser is type-only and still owns native normalization/hash", () => {
    const source = readFileSync(
      new URL("./manualRunStartReviewedWriteSchema.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("import type { ManualRunStartLegacyRawInput }");
    expect(source).not.toMatch(
      /from ["'](?:node:|@vaettir\/db)|manualRunStartLegacyInputSchema|\.trim\(\)\.(?:max|min)|\.default\(|\.strip\(|\.coerce/,
    );
  });
});
