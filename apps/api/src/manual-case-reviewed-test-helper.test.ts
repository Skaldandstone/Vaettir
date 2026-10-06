// Pure/mock/source contracts ONLY. This file never imports native DB runtime.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  admitManualCaseFixtureSource,
  manualCaseFixtureEnabled,
  assertManualCaseFixtureOwnership,
  reviewedManualCaseFixture,
  seedSyntheticUnversionedManualCase,
  seedSyntheticAcceptedLegacyManualCase,
  MANUAL_CASE_FIXTURE_OPT_IN,
  MANUAL_CASE_ERASURE_OPT_IN,
} from "./manual-case-reviewed-test-helper.js";
import {
  manualCaseResultWriteSchema,
  manualCaseResultWriteKey,
  manualCaseReviewedReadKey,
} from "./services/manualCaseResultSchema.js";
const database =
  "postgresql://synthetic:unused@127.0.0.1:5432/vaettir_day_test_1791327600000?schema=public&connection_limit=1";
const prefix =
  "manual-case-revision-1791327600000-11111111-1111-4111-8111-111111111111";
const owned = {
  prefix,
  organizationId: "synthetic-org",
  organizationSlug: `${prefix}-original`,
  projectId: "synthetic-project",
  actorId: "synthetic-native",
  clerkActorId: `${prefix}-owner`,
  testRunId: "synthetic-run",
  testCaseId: "synthetic-case",
};
const read = {
  projectId: owned.projectId,
  testRunId: owned.testRunId,
  testCaseId: owned.testCaseId,
  expectedScope: {
    projectId: owned.projectId,
    organizationId: owned.organizationId,
    clerkActorId: owned.clerkActorId,
  },
};
const source = (name: string) =>
  readFileSync(new URL(name, import.meta.url), "utf8");
afterEach(() => vi.unstubAllEnvs());
describe("manual-case reviewed native fixture source admission (no DB)", () => {
  it("requires exact disposable route plus separate named native/destructive opt-ins", () => {
    const env = { DATABASE_URL: database, [MANUAL_CASE_FIXTURE_OPT_IN]: "1" };
    expect(admitManualCaseFixtureSource(env)).toEqual({
      route: "LOCAL_DISPOSABLE",
      database: "vaettir_day_test_1791327600000",
    });
    expect(() => admitManualCaseFixtureSource(env, true)).toThrow(
      "Explicit owned local",
    );
    expect(
      admitManualCaseFixtureSource(
        { ...env, [MANUAL_CASE_ERASURE_OPT_IN]: "1" },
        true,
      ).route,
    ).toBe("LOCAL_DISPOSABLE");
    expect(manualCaseFixtureEnabled({ DATABASE_URL: database })).toBe(false);
  });
  for (const route of [
    database.replace("127.0.0.1", "remote.invalid"),
    database.replace("vaettir_day_test_1791327600000", "customer_test"),
    database.replace("vaettir_day_test_1791327600000", "vaettir_test"),
    `${database}&host=127.0.0.1`,
    database.replace(":5432/", ":5433/"),
  ]) {
    it(`refuses unsupported route without disclosing credentials (${route.indexOf("remote") >= 0 ? "remote" : route.length})`, () => {
      expect(
        manualCaseFixtureEnabled({
          DATABASE_URL: route,
          [MANUAL_CASE_FIXTURE_OPT_IN]: "1",
        }),
      ).toBe(false);
      try {
        admitManualCaseFixtureSource({
          DATABASE_URL: route,
          [MANUAL_CASE_FIXTURE_OPT_IN]: "1",
        });
        throw Error("Unexpected admission");
      } catch (error) {
        expect(String(error)).not.toContain("synthetic:unused");
      }
    });
  }
  it("requires original synthetic namespace and exact native read tuple", () => {
    expect(assertManualCaseFixtureOwnership(owned, read)).toBeUndefined();
    for (const candidate of [
      { ...owned, prefix: "test" },
      { ...owned, organizationSlug: "customer" },
      { ...owned, clerkActorId: "real-actor" },
      { ...owned, actorId: "" },
      { ...owned, testRunId: "different" },
    ])
      expect(() => assertManualCaseFixtureOwnership(candidate, read)).toThrow(
        "Exact synthetic",
      );
    expect(() =>
      assertManualCaseFixtureOwnership(owned, {
        ...read,
        expectedScope: { ...read.expectedScope, organizationId: "foreign" },
      }),
    ).toThrow("Exact synthetic");
  });
  it("invalid admission refuses both synthetic seeds before DB methods or runtime imports", async () => {
    vi.stubEnv("DATABASE_URL", database);
    vi.stubEnv(MANUAL_CASE_FIXTURE_OPT_IN, "0");
    const db = { $transaction: vi.fn() } as unknown as Parameters<
      typeof seedSyntheticUnversionedManualCase
    >[0];
    await expect(
      seedSyntheticUnversionedManualCase(db, owned, {
        status: "FAIL",
        note: null,
        observations: {},
      }),
    ).rejects.toThrow("Explicit owned local");
    const input = manualCaseResultWriteSchema.parse({
      ...read,
      expectedRevisionId: null,
      expectedCurrentFingerprint: "a".repeat(64),
      status: "FAIL",
      note: null,
      observations: {},
      correctionReason: null,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    await expect(
      seedSyntheticAcceptedLegacyManualCase(db, owned, input),
    ).rejects.toThrow("Explicit owned local");
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("obtains independently echoed current access and preview nonces without guessed evidence", async () => {
    vi.stubEnv("DATABASE_URL", database);
    vi.stubEnv(MANUAL_CASE_FIXTURE_OPT_IN, "1");
    const scope = { ...read.expectedScope, actorId: owned.actorId };
    const context = (
      input: Parameters<typeof manualCaseReviewedReadKey>[0],
      projection: "ACCESS" | "PREVIEW",
    ) => ({
      requestId: input.readRequestId,
      requested: manualCaseReviewedReadKey(input),
      projection,
      scope,
      canRecover: true,
    });
    const api = {
      accessReviewed: vi.fn(async (input) => ({
        readContext: context(input, "ACCESS"),
      })),
      previewReviewed: vi.fn(async (input) => ({
        readContext: context(input, "PREVIEW"),
        frozenEvidenceHash: "b".repeat(64),
      })),
    };
    const result = await reviewedManualCaseFixture(
      api as unknown as Parameters<typeof reviewedManualCaseFixture>[0],
      read,
      owned.actorId,
    );
    expect(api.accessReviewed).toHaveBeenCalledOnce();
    expect(api.previewReviewed).toHaveBeenCalledOnce();
    expect(api.accessReviewed.mock.calls[0]![0].readRequestId).not.toBe(
      api.previewReviewed.mock.calls[0]![0].readRequestId,
    );
    expect(result.reviewedRead.expectedNativeActorId).toBe(owned.actorId);
    expect(result.preview.frozenEvidenceHash).toBe("b".repeat(64));
  });
  for (const mismatch of [
    "nonce",
    "native",
    "organization",
    "projection",
  ] as const)
    it(`refuses actual-reader ${mismatch} mismatch before private preview`, async () => {
      vi.stubEnv("DATABASE_URL", database);
      vi.stubEnv(MANUAL_CASE_FIXTURE_OPT_IN, "1");
      const api = {
        accessReviewed: vi.fn(async (input) => ({
          readContext: {
            requestId: mismatch === "nonce" ? "wrong" : input.readRequestId,
            requested: manualCaseReviewedReadKey(input),
            projection: mismatch === "projection" ? "HISTORY" : "ACCESS",
            scope: {
              ...read.expectedScope,
              organizationId:
                mismatch === "organization" ? "foreign" : owned.organizationId,
              actorId: mismatch === "native" ? "foreign" : owned.actorId,
            },
          },
        })),
        previewReviewed: vi.fn(),
      };
      await expect(
        reviewedManualCaseFixture(
          api as unknown as Parameters<typeof reviewedManualCaseFixture>[0],
          read,
          owned.actorId,
        ),
      ).rejects.toThrow("Exact synthetic");
      expect(api.previewReviewed).not.toHaveBeenCalled();
    });
  it("accepted old parsed wire retains old hash and defaults, not EXACT provenance", () => {
    const parsed = manualCaseResultWriteSchema.parse({
      ...read,
      expectedRevisionId: null,
      expectedCurrentFingerprint: "a".repeat(64),
      status: "FAIL",
      note: " raw\nnote ",
      observations: { environment: " old environment " },
      correctionReason: null,
      idempotencyKey: "11111111-1111-4111-8111-111111111111",
    });
    const reparsed = manualCaseResultWriteSchema.parse(parsed);
    expect(
      createHash("sha256")
        .update(manualCaseResultWriteKey(parsed))
        .digest("hex"),
    ).toBe(
      createHash("sha256")
        .update(manualCaseResultWriteKey(reparsed))
        .digest("hex"),
    );
    expect(parsed).not.toHaveProperty("mode");
    expect(parsed.note).toBe(" raw\nnote ");
    expect(parsed.observations.measurements).toEqual([]);
  });
  it("helper contains native route/current owner locks/empty cohort and original old receipt wire; no erasure/bypass", () => {
    const helper = source("./manual-case-reviewed-test-helper.ts");
    const compact = helper.replace(/\s/g, "");
    expect(
      compact.indexOf(
        "admitManualCaseFixtureSource();assertManualCaseFixtureOwnership",
      ),
    ).toBeLessThan(compact.indexOf('awaitimport("@vaettir/db")'));
    for (const token of [
      "current_database()",
      "inet_server_addr()",
      "lockManualRetestAccess",
      "org.slug!==owned.organizationSlug",
      "run.planned!==true",
      "occupied.some",
      "manualCaseResultWriteSchema.parse(raw)",
      "manualCaseResultWriteKey(request)",
      "manualCaseResultRevision.create",
      "manualCaseResultHead.create",
    ])
      expect(compact).toContain(token);
    expect(helper).not.toMatch(
      /deleteMany|hardDeleteOrganization|DISABLE TRIGGER|session_replication_role/,
    );
  });
  it("fixture retains evidence, has separate destructive admission and only actual reviewed new-write calls", () => {
    const fixture = source("./manual-case-result-history.integration.test.ts");
    const ast = ts.createSourceFile(
      "fixture.ts",
      fixture,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const calls: string[] = [];
    const visit = (node: ts.Node) => {
      if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast));
      ts.forEachChild(node, visit);
    };
    visit(ast);
    expect(calls).not.toContain("api.record");
    expect(calls).not.toContain("fresh.record");
    expect(calls).toContain("seedSyntheticAcceptedLegacyManualCase");
    expect(calls).toContain("api.recordReviewed");
    const teardown = fixture.slice(
      fixture.indexOf("afterAll(async"),
      fixture.indexOf("function ownership"),
    );
    expect(teardown).toContain("prisma.$disconnect()");
    expect(teardown).not.toMatch(/deleteMany|hardDeleteOrganization/);
    expect(fixture.replace(/\s/g, "")).toContain(
      "it.skipIf(!manualCaseFixtureEnabled(process.env,true))",
    );
    expect(fixture.replace(/\s/g, "")).toContain(
      "admitManualCaseFixtureSource(process.env,true)",
    );
    expect(fixture).toContain("Promise.allSettled");
    expect(fixture).toContain('code: "CONFLICT"');
    // Native registrations must not nest another it() inside a test callback.
    const registration = (node: ts.CallExpression) =>
      (node.expression.getText(ast) === "it" ||
        /^it(?:\.|\()/.test(node.expression.getText(ast))) &&
      node.arguments.some(
        (argument) =>
          ts.isArrowFunction(argument) || ts.isFunctionExpression(argument),
      );
    const check = (node: ts.Node, inTest = false) => {
      const isTest = ts.isCallExpression(node) && registration(node);
      if (isTest) expect(inTest).toBe(false);
      ts.forEachChild(node, (child) => check(child, inTest || isTest));
    };
    check(ast);
  });
});
