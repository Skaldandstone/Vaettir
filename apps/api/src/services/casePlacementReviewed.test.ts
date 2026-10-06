import { beforeEach, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const locks = vi.hoisted(() => ({
  read: vi.fn(),
  write: vi.fn(),
  actor: vi.fn(),
}));
vi.mock("./caseFolders.js", () => ({
  lockAccess: locks.write,
  folderActorScope: locks.actor,
}));
vi.mock("./caseFieldReadScope.js", async (original) => ({
  ...(await original<typeof import("./caseFieldReadScope.js")>()),
  lockCaseFieldReadScope: locks.read,
}));
import {
  accessReviewedCasePlacement,
  previewReviewedCasePlacement,
  moveReviewedCasePlacement,
} from "./casePlacementReviewed.js";
import {
  placementCohortHash,
  placementMoveRequestHash,
  reviewedPlacementOrders,
  placementStoredReceipt,
  type placementMetadata,
} from "./casePlacementReviewedSchema.js";
import type { z } from "zod";
const scope = {
    projectId: "project",
    organizationId: "org",
    actorId: "native",
    actorClerkUserId: "clerk",
  },
  auth = { clerkActorId: scope.actorClerkUserId };
const intent = {
  projectId: "project",
  caseId: "main",
  originalOrganizationId: "org",
  expectedClerkActorId: "clerk",
  expectedNativeActorId: "native",
  expectedSuitePath: null,
  expectedSortPosition: 0,
  targetSuitePath: "auth",
  beforeCaseId: null,
};
const baseRows: z.infer<typeof placementMetadata>[] = [
  {
    id: "hidden",
    displayId: "SYN-1",
    suitePath: null,
    sortPosition: 0,
    createdAtText: "2026-10-06 00:00:00.000001+00",
    reviewStatus: "PENDING_REVIEW",
  },
  {
    id: "main",
    displayId: "SYN-2",
    suitePath: null,
    sortPosition: 0,
    createdAtText: "2026-10-06 00:00:00.000002+00",
    reviewStatus: "APPROVED",
  },
  {
    id: "target",
    displayId: "SYN-3",
    suitePath: "auth",
    sortPosition: 0,
    createdAtText: "2026-10-06 00:00:00.000003+00",
    reviewStatus: "REJECTED",
  },
];
const request = () => ({
  ...intent,
  requestId: randomUUID(),
  confirmed: true as const,
  expectedCohortHash: placementCohortHash(scope, intent, baseRows),
});
function fixture() {
  const state = {
    rows: baseRows.map((row) => ({ ...row })),
    sourceCount: 2n,
    targetCount: 1n,
    count: 3n,
    bytes: 1000n,
    unsupported: false,
    selectedCount: 1n,
    selectedBytes: 100n,
    selectedUnsupported: false,
    encodedBytes: 1000n,
    prior: [] as Record<string, unknown>[],
    stored: null as unknown,
    role: "EDITOR",
    seatType: "FULL",
    updateCount: 1,
    cohortCalls: 0,
    afterLockRows: null as null | typeof baseRows,
    lockRows: null as null | Array<{ id: string }>,
  };
  const events: string[] = [];
  const sql = (args: unknown[]) =>
    Array.isArray(args[0])
      ? args[0].join("")
      : String((args[0] as { sql?: string })?.sql ?? "");
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (...args: unknown[]) => {
      const text = sql(args);
      if (text.includes('FROM "CaseFolderWrite"')) {
        events.push("receipt-metadata");
        return state.prior;
      }
      if (text.includes("jsonb_build_array")) {
        events.push("cohort-admission");
        return [
          {
            count: state.count,
            sourceCount: state.sourceCount,
            targetCount: state.targetCount,
            bytes: state.bytes,
            unsupported: state.unsupported,
          },
        ];
      }
      if (text.includes('AS "createdAtText"')) {
        events.push("cohort-rows");
        state.cohortCalls++;
        return state.cohortCalls === 2 && state.afterLockRows
          ? state.afterLockRows
          : state.rows;
      }
      if (text.includes('SELECT id FROM "TestCase"')) {
        events.push("sorted-row-locks");
        return state.lockRows ?? state.rows.map(({ id }) => ({ id }));
      }
      if (text.includes('FROM "TestCase"')) {
        events.push("selected-admission");
        return [
          {
            count: state.selectedCount,
            bytes: state.selectedBytes,
            unsupported: state.selectedUnsupported,
          },
        ];
      }
      if (text.includes("SELECT octet_length")) {
        events.push("receipt-encoding-admission");
        return [{ bytes: state.encodedBytes }];
      }
      throw Error(`Unexpected MOCK SQL boundary: ${text.slice(0, 70)}`);
    }),
    membership: {
      findUniqueOrThrow: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
    },
    testCase: {
      updateMany: vi.fn(async (_input: { data: Record<string, unknown> }) => {
        events.push("placement-write");
        return { count: state.updateCount };
      }),
    },
    caseFolderWrite: {
      findUniqueOrThrow: vi.fn(async () => ({
        id: "receipt",
        receipt: state.stored,
      })),
      create: vi.fn(async (_input: { data: Record<string, unknown> }) => {
        events.push("unique-receipt-write");
        return { id: "receipt" };
      }),
    },
    auditLog: {
      create: vi.fn(async () => {
        events.push("audit-write");
        return {};
      }),
    },
  };
  const transaction = tx;
  const db = {
    $transaction: vi.fn(
      async (work: (current: typeof transaction) => unknown) =>
        work(transaction),
    ),
  };
  return { state, events, tx, db };
}
beforeEach(() => {
  locks.read.mockReset().mockResolvedValue(scope);
  locks.write.mockReset().mockResolvedValue(scope.organizationId);
  locks.actor.mockReset().mockResolvedValue({
    projectId: scope.projectId,
    organizationId: scope.organizationId,
    clerkActorId: scope.actorClerkUserId,
  });
});
describe("reviewed placement source service (mocked, native NOT RUN)", () => {
  it("access emits exact nonce/native reader with no case or receipt body, readonly never upgraded", async () => {
    const f = fixture();
    f.state.seatType = "READ_ONLY";
    const nonce = randomUUID();
    const value = await accessReviewedCasePlacement(
      f.db as never,
      scope.actorId,
      { projectId: "project", caseId: "main", readRequestId: nonce },
      auth,
    );
    expect(value).toMatchObject({
      readRequestId: nonce,
      readScope: scope,
      canWrite: false,
      canRecover: false,
    });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("native reader mismatch refuses before placement materialization", async () => {
    const f = fixture();
    await expect(
      previewReviewedCasePlacement(
        f.db as never,
        scope.actorId,
        {
          ...intent,
          expectedNativeActorId: "other",
          readRequestId: randomUUID(),
        },
        auth,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("preview admits exact complete hidden lanes before metadata and preserves native timestamp text", async () => {
    const f = fixture();
    const input = { ...intent, readRequestId: randomUUID() },
      value = await previewReviewedCasePlacement(
        f.db as never,
        scope.actorId,
        input,
        auth,
      );
    expect(value.rows).toEqual(baseRows);
    expect(value.intent).toEqual({
      caseId: intent.caseId,
      expectedSuitePath: null,
      expectedSortPosition: 0,
      targetSuitePath: "auth",
      beforeCaseId: null,
    });
    expect(value.sourceCount).toBe(2);
    expect(value.targetCount).toBe(1);
    expect(value.expectedCohortHash).toBe(
      placementCohortHash(scope, intent, baseRows),
    );
    expect(f.events).toEqual([
      "selected-admission",
      "cohort-admission",
      "cohort-rows",
    ]);
    expect(f.tx.testCase.updateMany).not.toHaveBeenCalled();
  });
  for (const change of [
    { count: 4001n },
    { sourceCount: 2001n },
    { targetCount: 2000n },
    { bytes: 1048577n },
    { bytes: -1n },
    { unsupported: true },
  ])
    it(`refuses complete native count/byte admission before metadata ${JSON.stringify(change, (_, v) => (typeof v === "bigint" ? v.toString() : v))}`, async () => {
      const f = fixture();
      Object.assign(f.state, change);
      await expect(
        previewReviewedCasePlacement(
          f.db as never,
          scope.actorId,
          { ...intent, readRequestId: randomUUID() },
          auth,
        ),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(f.events).not.toContain("cohort-rows");
    });
  it("decoded Unicode-width/private scalar mismatch is generic, not clipped/native Zod body", async () => {
    const f = fixture();
    f.state.rows[0]!.displayId = "🧭".repeat(101);
    await expect(
      previewReviewedCasePlacement(
        f.db as never,
        scope.actorId,
        { ...intent, readRequestId: randomUUID() },
        auth,
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.tx.testCase.updateMany).not.toHaveBeenCalled();
  });
  it("writes placement ONLY after current locks, repeated admission/CAS and bounded receipt, preserving pending/rejected siblings", async () => {
    const f = fixture(),
      input = request(),
      value = await moveReviewedCasePlacement(
        f.db as never,
        scope.actorId,
        input,
        auth,
      );
    expect(value).toMatchObject({
      readScope: scope,
      requestHash: placementMoveRequestHash(input),
      suitePath: "auth",
      sortPosition: 1,
      recovered: false,
    });
    expect(locks.write).toHaveBeenCalledBefore(locks.actor);
    expect(f.events.indexOf("receipt-metadata")).toBeLessThan(
      f.events.indexOf("selected-admission"),
    );
    expect(f.events.indexOf("sorted-row-locks")).toBeLessThan(
      f.events.lastIndexOf("cohort-admission"),
    );
    expect(f.events.indexOf("receipt-encoding-admission")).toBeLessThan(
      f.events.indexOf("placement-write"),
    );
    expect(f.tx.testCase.updateMany.mock.calls[0]![0].data).toEqual({
      suitePath: "auth",
      sortPosition: 1,
      updatedById: scope.actorId,
    });
    const receipt = placementStoredReceipt.parse(
      f.tx.caseFolderWrite.create.mock.calls[0]![0].data.receipt,
    );
    expect(receipt.before).toEqual(baseRows);
    expect(receipt.after[0]!.reviewStatus).toBe("PENDING_REVIEW");
    expect(receipt.after[2]!.reviewStatus).toBe("REJECTED");
    expect(f.events.slice(-2)).toEqual(["unique-receipt-write", "audit-write"]);
  });
  it("original native/org/Clerk/current FULL refusal precedes private receipt", async () => {
    for (const change of [
      { expectedNativeActorId: "other" },
      { originalOrganizationId: "other" },
      { expectedClerkActorId: "other" },
    ]) {
      const f = fixture();
      await expect(
        moveReviewedCasePlacement(
          f.db as never,
          scope.actorId,
          { ...request(), ...change },
          auth,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.events).toEqual([]);
    }
    const f = fixture();
    locks.write.mockRejectedValueOnce({ code: "FORBIDDEN" });
    await expect(
      moveReviewedCasePlacement(f.db as never, scope.actorId, request(), auth),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).toEqual([]);
  });
  it("exact native unique receipt recovers before later missing/oversized cohorts and does not mutate", async () => {
    const f = fixture(),
      input = request();
    f.state.prior = [
      {
        id: "receipt",
        kind: "CasePlacementReviewedMove",
        version: "1",
        organizationId: scope.organizationId,
        inputHash: placementMoveRequestHash(input),
        bytes: 1000n,
      },
    ];
    f.state.stored = {
      kind: "CasePlacementReviewedMove",
      version: 1,
      organizationId: scope.organizationId,
      scope,
      caseId: input.caseId,
      requestId: input.requestId,
      requestHash: placementMoveRequestHash(input),
      before: baseRows,
      after: reviewedPlacementOrders(baseRows, input).after,
      beforeCohortHash: input.expectedCohortHash,
      suitePath: "auth",
      sortPosition: 1,
    };
    f.state.selectedCount = 0n;
    f.state.count = 9999n;
    expect(
      (
        await moveReviewedCasePlacement(
          f.db as never,
          scope.actorId,
          input,
          auth,
        )
      ).recovered,
    ).toBe(true);
    expect(f.events).toEqual(["receipt-metadata"]);
    expect(f.tx.testCase.updateMany).not.toHaveBeenCalled();
    expect(f.tx.caseFolderWrite.create).not.toHaveBeenCalled();
  });
  for (const prior of [
    {
      kind: null,
      version: null,
      organizationId: null,
      inputHash: "a".repeat(64),
    },
    {
      kind: "CasePlacementReviewedMove",
      version: "2",
      organizationId: "org",
      inputHash: "a".repeat(64),
    },
    {
      kind: "CasePlacementReviewedMove",
      version: "1",
      organizationId: "org",
      inputHash: "a".repeat(64),
    },
  ])
    it("folder UUID/domain/hash collisions refuse before receipt body or new cohort", async () => {
      const f = fixture();
      f.state.prior = [{ id: "receipt", bytes: 1000n, ...prior }];
      await expect(
        moveReviewedCasePlacement(
          f.db as never,
          scope.actorId,
          request(),
          auth,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.events).toEqual(["receipt-metadata"]);
      expect(f.tx.caseFolderWrite.findUniqueOrThrow).not.toHaveBeenCalled();
    });
  it("full cohort/anchor/post-lock race or native changed-row count refuses atomic source write", async () => {
    for (const mode of ["hash", "race", "count", "receipt-size"]) {
      const f = fixture(),
        input = request();
      if (mode === "hash") input.expectedCohortHash = "a".repeat(64);
      if (mode === "race")
        f.state.afterLockRows = baseRows.map((row) =>
          row.id === "hidden" ? { ...row, sortPosition: 9 } : row,
        );
      if (mode === "count") f.state.updateCount = 0;
      if (mode === "receipt-size") f.state.encodedBytes = 2097153n;
      await expect(
        moveReviewedCasePlacement(f.db as never, scope.actorId, input, auth),
      ).rejects.toMatchObject({
        code: mode === "receipt-size" ? "PRECONDITION_FAILED" : "CONFLICT",
      });
      expect(f.tx.caseFolderWrite.create).not.toHaveBeenCalled();
    }
  });
  it("native serialization/unique rollback maps CONFLICT without automatic retry or inventing rejection of earlier ACK", async () => {
    for (const code of ["P2034", "P2002", "40001"]) {
      const f = fixture();
      f.db.$transaction.mockRejectedValueOnce({ code });
      await expect(
        moveReviewedCasePlacement(
          f.db as never,
          scope.actorId,
          request(),
          auth,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.db.$transaction).toHaveBeenCalledOnce();
    }
  });
  it("missing/duplicate/foreign locked identities refuse before the second projection or mutation", async () => {
    for (const lockRows of [
      [{ id: "main" }],
      [{ id: "main" }, { id: "main" }, { id: "target" }],
      [{ id: "main" }, { id: "foreign" }, { id: "target" }],
    ]) {
      const f = fixture();
      f.state.lockRows = lockRows;
      await expect(
        moveReviewedCasePlacement(
          f.db as never,
          scope.actorId,
          request(),
          auth,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state.cohortCalls).toBe(1);
      expect(f.tx.testCase.updateMany).not.toHaveBeenCalled();
      expect(f.tx.caseFolderWrite.create).not.toHaveBeenCalled();
    }
  });
  it("corrupted accepted complete receipt cannot produce a replacement success or repair", async () => {
    for (const change of [
      { suitePath: "different" },
      { sortPosition: 0 },
      { beforeCohortHash: "a".repeat(64) },
      { after: baseRows },
    ]) {
      const f = fixture(),
        input = request();
      f.state.prior = [
        {
          id: "receipt",
          kind: "CasePlacementReviewedMove",
          version: "1",
          organizationId: scope.organizationId,
          inputHash: placementMoveRequestHash(input),
          bytes: 1000n,
        },
      ];
      f.state.stored = {
        kind: "CasePlacementReviewedMove",
        version: 1,
        organizationId: scope.organizationId,
        scope,
        caseId: input.caseId,
        requestId: input.requestId,
        requestHash: placementMoveRequestHash(input),
        before: baseRows,
        after: reviewedPlacementOrders(baseRows, input).after,
        beforeCohortHash: input.expectedCohortHash,
        suitePath: "auth",
        sortPosition: 1,
        ...change,
      };
      await expect(
        moveReviewedCasePlacement(f.db as never, scope.actorId, input, auth),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.events).toEqual(["receipt-metadata"]);
      expect(f.tx.testCase.updateMany).not.toHaveBeenCalled();
      expect(f.tx.caseFolderWrite.create).not.toHaveBeenCalled();
    }
  });
  it("source uses existing native unique tuple, sorted locks, no placement body/header/source-file/history rewrite", () => {
    const source = readFileSync(
      new URL("./casePlacementReviewed.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain("projectId_actorId_requestId");
    expect(source).toContain("ORDER BY id FOR UPDATE");
    expect(source).not.toMatch(
      /testCaseSource\.(update|delete)|snapshotTestCaseVersion|customFields:|verificationProfile:|sourceFilePath:/,
    );
    expect(source).toContain("CasePlacementReviewedMove");
  });
});
