import { describe, expect, it, vi, beforeEach } from "vitest";
import { TRPCError } from "@trpc/server";
const guards = vi.hoisted(() => ({
  project: vi.fn(),
  authoring: vi.fn(),
  actor: vi.fn(),
  read: vi.fn(),
  plan: vi.fn(),
}));
vi.mock("./caseFields.js", () => ({
  lockCaseFieldProject: guards.project,
  assertCaseFieldAuthoring: guards.authoring,
}));
vi.mock("./testPlanExecution.js", () => ({
  requireCurrentPlanAccess: guards.plan,
}));
vi.mock("./caseFieldReadScope.js", async (original) => ({
  ...(await original<typeof import("./caseFieldReadScope.js")>()),
  lockCurrentCaseFieldActor: guards.actor,
  lockCaseFieldReadScope: guards.read,
}));
import {
  caseVersionReadContext,
  readCaseVersionAccess,
  restoreCaseVersion,
  versionRestoreSchema,
  versionPreviewSchema,
  versionPreviewReadSchema,
  versionListReadSchema,
  historicalComparisonReadSchema,
  versionRestoreReviewedSchema,
  assertReviewedVersionProfileRoundTrip,
} from "./caseVersionReview.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const scope = {
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
function fixture() {
  const parsed = versionRestoreSchema.parse(request),
    hash = qualityProfileHash({ ...parsed, fields: [...parsed.fields].sort() });
  const state = {
    role: "EDITOR",
    seat: "FULL",
    organizationId: "org",
    receipt: {
      organizationId: "org",
      metadata: {
        requestHash: hash,
        restoredVersionNumber: 1,
        createdVersionNumber: 3,
        displayId: "TC-1",
      },
    } as null | { organizationId: string; metadata: unknown },
  };
  const tx = {
    $queryRaw: vi.fn(async (_query: unknown, ..._values: unknown[]) => []),
    project: {
      findUniqueOrThrow: vi.fn(async () => ({
        organizationId: state.organizationId,
      })),
    },
    auditLog: { findFirst: vi.fn(async () => state.receipt) },
    membership: {
      findFirst: vi.fn(async () => ({
        role: state.role,
        seatType: state.seat,
      })),
    },
  };
  const db = {
    $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work(tx)),
  };
  return { state, tx, db, parsed, hash };
}
beforeEach(() => {
  Object.values(guards).forEach((guard) => guard.mockReset());
  guards.actor.mockResolvedValue("clerk");
  guards.read.mockResolvedValue(scope);
});
describe("additive case-version read/restore proof, mocked transactions NOT native acceptance", () => {
  it("separate read nonce/pin wrappers preserve original restore parsed shape/hash/strictness", () => {
    const baseline = {
      projectId: "project",
      testCaseId: "case",
      versionNumber: 1,
    };
    expect(versionPreviewReadSchema.parse(baseline)).toEqual(
      versionPreviewSchema.parse(baseline),
    );
    const extended = {
      ...baseline,
      readRequestId: request.requestId,
      originalOrganizationId: "org",
      expectedClerkActorId: "clerk",
    };
    expect(versionPreviewReadSchema.parse(extended)).toEqual(extended);
    expect(
      versionRestoreSchema.safeParse({
        ...request,
        readRequestId: request.requestId,
      }).success,
    ).toBe(false);
    expect(
      versionRestoreSchema.safeParse({
        ...request,
        originalOrganizationId: "org",
      }).success,
    ).toBe(false);
    expect(
      versionPreviewReadSchema.safeParse({
        ...baseline,
        expectedClerkActorId: "clerk",
      }).success,
    ).toBe(false);
    expect(
      versionListReadSchema.safeParse({
        projectId: "project",
        testCaseId: "case",
        unknown: true,
      }).success,
    ).toBe(false);
    expect(
      historicalComparisonReadSchema.safeParse({
        projectId: "project",
        testCaseId: "case",
        fromVersionNumber: 1,
        toVersionNumber: 2,
        readRequestId: "bad",
      }).success,
    ).toBe(false);
    const f = fixture(),
      envelope = versionRestoreReviewedSchema.parse({
        request,
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
        expectedNativeActorId: "native",
      });
    expect(envelope.request).toEqual(f.parsed);
    expect(
      qualityProfileHash({
        ...envelope.request,
        fields: [...envelope.request.fields].sort(),
      }),
    ).toBe(f.hash);
    expect(envelope.request).not.toHaveProperty("readRequestId");
    expect(envelope.request).not.toHaveProperty("expectedNativeActorId");
  });
  it("old read callers get no injected context/default/member query; new nonce echoes exact native projection", async () => {
    const f = fixture();
    expect(
      await caseVersionReadContext(
        f.tx as never,
        "native",
        { projectId: "project", testCaseId: "case", versionNumber: 1 },
        scope,
        { kind: "CURRENT", versionNumber: 1 },
      ),
    ).toEqual({});
    expect(f.tx.membership.findFirst).not.toHaveBeenCalled();
    const ctx = await caseVersionReadContext(
      f.tx as never,
      "native",
      {
        projectId: "project",
        testCaseId: "case",
        take: 10,
        before: 11,
        readRequestId: request.requestId,
      },
      scope,
      { kind: "LIST", take: 10, before: 11 },
    );
    expect(ctx).toEqual({
      readContext: {
        readRequestId: request.requestId,
        readScope: scope,
        caseId: "case",
        canRecover: true,
        projection: { kind: "LIST", take: 10, before: 11 },
      },
    });
    expect(f.tx.membership.findFirst).toHaveBeenCalledWith({
      where: { userId: "native", organizationId: "org" },
      select: { role: true, seatType: true },
    });
  });
  it.each([
    { role: "VIEWER", seat: "READ_ONLY" },
    { role: "EDITOR", seat: "READ_ONLY" },
    { role: "COMPLIANCE_AUDITOR", seat: "FULL" },
  ])(
    "schema-independent current native access can read but cannot recover as $role/$seat",
    async (member) => {
      const f = fixture();
      Object.assign(f.state, member);
      guards.authoring.mockRejectedValue(
        new Error("Malformed unrelated current case schema"),
      );
      const input = {
        projectId: "project",
        testCaseId: "case",
        readRequestId: request.requestId,
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
      };
      expect(
        await readCaseVersionAccess(f.db as never, "native", input, {
          clerkActorId: "clerk",
        }),
      ).toMatchObject({
        readRequestId: request.requestId,
        readScope: scope,
        canRecover: false,
        projection: { kind: "ACCESS" },
      });
      expect(guards.read).toHaveBeenCalledWith(
        f.tx,
        "native",
        {
          projectId: "project",
          caseId: "case",
          originalOrganizationId: "org",
          expectedClerkActorId: "clerk",
        },
        { clerkActorId: "clerk" },
      );
      expect(guards.authoring).not.toHaveBeenCalled();
      expect(f.tx.auditLog.findFirst).not.toHaveBeenCalled();
      expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), {
        isolationLevel: "RepeatableRead",
        timeout: 10000,
      });
    },
  );
  it("new scoped ACK is captured in the SAME transaction from an exact old accepted UUID before current required-field validation", async () => {
    const f = fixture();
    guards.authoring.mockRejectedValue(
      new TRPCError({ code: "PRECONDITION_FAILED" }),
    );
    const result = await restoreCaseVersion(
      f.db as never,
      "native",
      f.parsed,
      { clerkActorId: "clerk" },
      {
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
        expectedNativeActorId: "native",
      },
    );
    expect(result).toEqual({
      restoredVersionNumber: 1,
      createdVersionNumber: 3,
      displayId: "TC-1",
      replayed: true,
      requestId: request.requestId,
      requestHash: f.hash,
      caseId: "case",
      readScope: scope,
      scopeProof: "CURRENT_LOCKED_AUTHORIZATION",
    });
    expect(f.db.$transaction).toHaveBeenCalledTimes(1);
    expect(guards.actor).toHaveBeenCalledWith(f.tx, "native", {
      clerkActorId: "clerk",
    });
    expect(guards.authoring).not.toHaveBeenCalled();
    expect(f.tx.auditLog.findFirst.mock.invocationCallOrder[0]).toBeGreaterThan(
      guards.actor.mock.invocationCallOrder[0]!,
    );
    const retained = structuredClone(f.state.receipt);
    await restoreCaseVersion(
      f.db as never,
      "native",
      f.parsed,
      { clerkActorId: "clerk" },
      {
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
        expectedNativeActorId: "native",
      },
    );
    expect(f.state.receipt).toEqual(retained);
  });
  it.each([
    { originalOrganizationId: "foreign" },
    { expectedClerkActorId: "other-clerk" },
    { expectedNativeActorId: "other-native" },
  ])(
    "refuses original native envelope mismatch BEFORE receipt/private lookup: %j",
    async (patch) => {
      const f = fixture();
      await expect(
        restoreCaseVersion(
          f.db as never,
          "native",
          f.parsed,
          { clerkActorId: "clerk" },
          {
            originalOrganizationId: "org",
            expectedClerkActorId: "clerk",
            expectedNativeActorId: "native",
            ...patch,
          },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.tx.auditLog.findFirst).not.toHaveBeenCalled();
      expect(f.tx.$queryRaw).not.toHaveBeenCalled();
      expect(guards.authoring).not.toHaveBeenCalled();
    },
  );
  it("preserves EXACT legacy result while new writes still require original current full authoring validation", async () => {
    const f = fixture();
    expect(
      await restoreCaseVersion(f.db as never, "native", f.parsed, {
        clerkActorId: "clerk",
      }),
    ).toEqual({
      restoredVersionNumber: 1,
      createdVersionNumber: 3,
      displayId: "TC-1",
      replayed: true,
    });
    f.state.receipt = null;
    guards.authoring.mockRejectedValue(
      new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "Required current fields",
      }),
    );
    await expect(
      restoreCaseVersion(
        f.db as never,
        "native",
        f.parsed,
        { clerkActorId: "clerk" },
        {
          originalOrganizationId: "org",
          expectedClerkActorId: "clerk",
          expectedNativeActorId: "native",
        },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(guards.authoring).toHaveBeenCalledWith(
      f.tx,
      "native",
      "project",
      { caseId: "case" },
      { clerkActorId: "clerk" },
    );
    expect(guards.authoring.mock.invocationCallOrder[0]).toBeGreaterThan(
      f.tx.auditLog.findFirst.mock.invocationCallOrder.at(-1)!,
    );
  });
  it("admits exact complete profile JSON and selected saved profile with scoped native comparisons, not fallback construction", async () => {
    const tx = {
        $queryRaw: vi.fn(async (_query: unknown, ..._values: unknown[]) => [
          { exact: true, nativeKind: "VALUE" },
        ]),
      },
      current = { future: { raw: [false, 0, "\n exact ", null] } },
      saved = { retained: ["same", "same", ""] };
    await assertReviewedVersionProfileRoundTrip(tx as never, request, current, {
      value: saved,
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(tx.$queryRaw.mock.calls[0]![1]).toBe(JSON.stringify(current));
    expect(tx.$queryRaw.mock.calls[1]![1]).toBe(JSON.stringify(saved));
    const queries = tx.$queryRaw.mock.calls.map((call) =>
      (call[0] as unknown as string[]).join("?"),
    );
    expect(queries[0]).toContain("IS NOT DISTINCT FROM ?::jsonb");
    expect(queries[0]).toContain("'SQL_NULL'");
    expect(queries[0]).toContain("'JSON_NULL'");
    expect(queries[1]).toContain('JOIN "TestCase" c');
    expect(queries[1]).toContain('v."versionNumber"=?');
  });
  it.each([
    { exact: false, nativeKind: "VALUE" },
    { exact: true, nativeKind: "SQL_NULL" },
    { exact: true, nativeKind: "JSON_NULL" },
  ])(
    "refuses native precision/SQL-null/JSON-null snapshot boundary without converting content: %j",
    async (native) => {
      const tx = { $queryRaw: vi.fn(async () => [native]) };
      await expect(
        assertReviewedVersionProfileRoundTrip(
          tx as never,
          request,
          native.nativeKind === "VALUE" ? { large: 9007199254740992 } : null,
        ),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    },
  );
  it("only selected historical profile is round-trip checked and exact prior UUID replay precedes all new codec admissions", async () => {
    const tx = {
      $queryRaw: vi
        .fn()
        .mockResolvedValueOnce([{ exact: true, nativeKind: "VALUE" }])
        .mockResolvedValueOnce([{ exact: false, nativeKind: "VALUE" }]),
    };
    await expect(
      assertReviewedVersionProfileRoundTrip(
        tx as never,
        request,
        {},
        { value: { large: 9007199254740992 } },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    const f = fixture();
    const ack = await restoreCaseVersion(
      f.db as never,
      "native",
      f.parsed,
      { clerkActorId: "clerk" },
      {
        originalOrganizationId: "org",
        expectedClerkActorId: "clerk",
        expectedNativeActorId: "native",
      },
    );
    expect(ack.replayed).toBe(true);
    expect(
      f.tx.$queryRaw.mock.calls.every(
        (call) =>
          !(call[0] as unknown as string[])
            .join("?")
            .includes("verificationProfile"),
      ),
    ).toBe(true);
  });
});
