import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import {
  assertUnchangedRiskApprovalCases,
  readBoundedRiskApprovalItems,
} from "./caseRiskApprovalValidation.js";
import { analysisHash } from "./caseAnalysisQueue.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";

function fixture(count = 1) {
  const cases = Array.from({ length: count }, (_, index) => ({
    id: `case-${String(index).padStart(4, "0")}`,
    projectId: "project",
    archived: false,
    title: ` Raw λ🎮 ${index} `,
    displayId: `TC-${index + 1}`,
    background: " retained\n",
    given: ["", "same", "same"],
    when: ["second", "first"],
    then: ["exact\n"],
    tags: ["x, raw"],
    testType: "FUNCTIONAL",
    priority: "MEDIUM",
    suitePath: null,
    testPlanId: null,
    validationDomain: "SOFTWARE",
    verificationProfile: {},
    sharedStepGroupId: null,
    steps: [
      {
        order: 0,
        action: "Raw tester action",
        expectedActionOrData: "API call",
        expectedResult: "",
        expectedResponse: null,
        mediaAttachmentIds: [],
      },
    ],
    sharedStepGroup: null as null | {
      projectId: string;
      steps: unknown;
      archivedAt: Date | null;
    },
    source: null as null | {
      filePath: string;
      framework: string;
      lastSyncedCommitSha: string | null;
    },
    updatedAt: new Date("2026-10-05T12:00:00Z"),
  }));
  const items = cases.map((tc, position) => ({
    queueId: "queue",
    status: "QUEUED",
    caseId: tc.id,
    position,
    contentRevision: testCaseContentRevision(tc),
    sourceRevision: analysisHash(tc.source),
    caseUpdatedAt: tc.updatedAt,
  }));
  const job = {
    id: "queue",
    projectId: "project",
    action: "RISK",
    caseCount: count,
  };
  const state = {
    queuedCount: count,
    metadataBytes: 1000n,
    metadataSupported: true,
    nativeIdentities: null as bigint | null,
    nativePositions: null as bigint | null,
    foreignSource: false,
    unavailableShared: false,
    bytes: 1000n,
    steps: 1n,
    sourceBytes: 0n,
    sourceIdentityBytes: 0n,
    postLockSourceOverflow: false,
    postLockUnavailableShared: false,
    missingLock: false,
    duplicateLock: false,
    missingBound: false,
    duplicateBound: false,
    missingBody: false,
    duplicateBody: false,
    reverse: false,
  };
  const events: string[] = [],
    batches: string[][] = [];
  const tx = {
    $queryRaw: vi.fn(
      async (query: { sql?: string; values?: unknown[] } | string[]) => {
        const sql = Array.isArray(query) ? query.join("?") : query.sql!,
          values = Array.isArray(query) ? [] : query.values!;
        if (sql.includes('AS "nativeQueuedCount"')) {
          events.push("queue-native-admission");
          return [
            {
              nativeQueuedCount: BigInt(state.queuedCount),
              metadataBytes: state.metadataBytes,
              identities: state.nativeIdentities ?? BigInt(state.queuedCount),
              positions: state.nativePositions ?? BigInt(state.queuedCount),
              supported: state.metadataSupported,
            },
          ];
        }
        if (sql.includes('AS "queuedCount"')) {
          events.push("cohort");
          return [{ queuedCount: state.queuedCount }];
        }
        const ids = values.filter(
          (value): value is string =>
            typeof value === "string" && cases.some((tc) => tc.id === value),
        );
        if (sql.includes('AS "unavailableShared"')) {
          events.push("relations");
          return [
            {
              foreignSource: state.foreignSource,
              unavailableShared: state.unavailableShared,
            },
          ];
        }
        if (sql.includes('AS "sourceBytes"')) {
          events.push("bounds");
          let rows = ids.map((id) => ({
            id,
            bytes: state.bytes,
            steps: state.steps,
            sourceBytes: state.sourceBytes,
            sourceIdentityBytes: state.sourceIdentityBytes,
          }));
          if (state.missingBound) rows = rows.slice(1);
          if (state.duplicateBound && rows.length > 1) rows[1] = rows[0]!;
          return rows;
        }
        if (sql.includes('SELECT c.id FROM "TestCase"')) {
          events.push("case-lock");
          let rows = ids.map((id) => ({ id }));
          if (state.missingLock) rows = rows.slice(1);
          if (state.duplicateLock && rows.length > 1) rows[1] = rows[0]!;
          return rows;
        }
        if (sql.includes('FROM "TestCaseStep"')) {
          events.push("step-lock");
          return [];
        }
        if (sql.includes('FROM "TestCaseSource"')) {
          events.push("source-lock");
          if (state.postLockSourceOverflow) state.sourceBytes = 64001n;
          return [];
        }
        if (sql.includes('SELECT g.id FROM "SharedStepGroup"')) {
          events.push("shared-lock");
          if (state.postLockUnavailableShared) state.unavailableShared = true;
          return [];
        }
        throw Error("Unexpected synthetic query");
      },
    ),
    caseAnalysisQueueItem: {
      findMany: vi.fn(async (_args: unknown) => {
        events.push("bounded-queue-scalars");
        return structuredClone(items);
      }),
    },
    testCase: {
      findMany: vi.fn(
        async ({
          where,
          take,
        }: {
          where: { id: { in: string[] }; projectId: string; archived: boolean };
          take: number;
        }) => {
          events.push("private-body");
          expect(where.projectId).toBe("project");
          expect(where.archived).toBe(false);
          expect(take).toBe(32);
          expect(where.id.in.length).toBeLessThanOrEqual(32);
          batches.push([...where.id.in]);
          let rows = cases.filter((tc) => where.id.in.includes(tc.id));
          if (state.missingBody) rows = rows.slice(1);
          if (state.duplicateBody && rows.length > 1) rows[1] = rows[0]!;
          return state.reverse ? rows.reverse() : rows;
        },
      ),
    },
  };
  const run = () =>
    assertUnchangedRiskApprovalCases(tx as never, job as never, items as never);
  return { cases, items, job, state, tx, events, batches, run };
}

describe("RISK approval microbatches (mocked native locks, not SQL/spending/performance acceptance)", () => {
  it.each([0, 851, 1000])(
    "admits exactly %i payable items before narrowly selected scalar materialization",
    async (count) => {
      const f = fixture(Math.max(1, count));
      if (count === 0) {
        f.items.length = 0;
        f.state.queuedCount = 0;
      }
      const result = await readBoundedRiskApprovalItems(
        f.tx as never,
        f.job as never,
      );
      expect(result).toEqual(f.items);
      expect(f.events).toEqual([
        "queue-native-admission",
        "bounded-queue-scalars",
      ]);
      expect(f.tx.caseAnalysisQueueItem.findMany).toHaveBeenCalledWith({
        where: { queueId: "queue", status: "QUEUED" },
        orderBy: { position: "asc" },
        take: 1000,
        select: {
          queueId: true,
          caseId: true,
          status: true,
          position: true,
          contentRevision: true,
          sourceRevision: true,
          caseUpdatedAt: true,
        },
      });
    },
  );
  it("refuses oversized/unbounded/unsupported native queue metadata before any item rows are materialized", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.state.queuedCount = 1001;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.queuedCount = 3;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.metadataBytes = 2048001n;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.metadataBytes = -1n;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.metadataSupported = false;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.nativeIdentities = 1n;
      },
      (f: ReturnType<typeof fixture>) => {
        f.state.nativePositions = 1n;
      },
      (f: ReturnType<typeof fixture>) => {
        f.job.caseCount = 1001;
      },
    ]) {
      const f = fixture(2);
      mutate(f);
      await expect(
        readBoundedRiskApprovalItems(f.tx as never, f.job as never),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(f.tx.caseAnalysisQueueItem.findMany).not.toHaveBeenCalled();
      expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
    }
  });
  it("refuses missing/duplicate/foreign/unsupported Unicode-width scalar rows without clipping or a smaller cohort", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.items.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[1]!.caseId = f.items[0]!.caseId;
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[0]!.queueId = "foreign";
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[0]!.caseId = "🎮".repeat(70);
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[0]!.contentRevision = "unsupported raw hash";
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[0]!.caseUpdatedAt = new Date(NaN);
      },
    ]) {
      const f = fixture(2);
      mutate(f);
      await expect(
        readBoundedRiskApprovalItems(f.tx as never, f.job as never),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
    }
  });
  it.each([1, 32, 33, 851, 1000])(
    "validates every one of %i frozen payable identities in <=32-body batches without repricing or paid reads",
    async (count) => {
      const f = fixture(count);
      f.state.reverse = true;
      const frozen = structuredClone(f.items);
      await f.run();
      expect(f.items).toEqual(frozen);
      expect(f.batches.flat()).toEqual(f.items.map((item) => item.caseId));
      expect(f.batches).toHaveLength(Math.ceil(count / 32));
      const perBatch = [
        "case-lock",
        "relations",
        "bounds",
        "step-lock",
        "source-lock",
        "shared-lock",
        "relations",
        "bounds",
        "private-body",
      ];
      expect(f.events).toEqual([
        "cohort",
        ...Array.from({ length: Math.ceil(count / 32) }, () => perBatch).flat(),
      ]);
      const body = f.tx.testCase.findMany.mock.calls[0]![0] as unknown as {
        include: unknown;
      };
      expect(body.include).toEqual({
        steps: { orderBy: { order: "asc" } },
        sharedStepGroup: {
          select: { projectId: true, steps: true, archivedAt: true },
        },
        source: {
          select: {
            filePath: true,
            framework: true,
            lastSyncedCommitSha: true,
          },
        },
      });
    },
  );
  it("accepts an explicitly empty payable cohort without reintroducing skipped/saved/unknown cases", async () => {
    const f = fixture(3);
    f.items.length = 0;
    f.state.queuedCount = 0;
    await f.run();
    expect(f.events).toEqual(["cohort"]);
    expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
  });
  it.each([
    "missingLock",
    "duplicateLock",
    "missingBound",
    "duplicateBound",
    "missingBody",
    "duplicateBody",
    "foreignSource",
    "unavailableShared",
  ] as const)("refuses %s with no smaller admitted cohort", async (flag) => {
    const f = fixture(2);
    f.state[flag] = true;
    await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" });
    if (!flag.includes("Body"))
      expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
  });
  it.each([
    { bytes: 64001n },
    { steps: 1001n },
    { sourceBytes: 64001n },
    { sourceIdentityBytes: 64001n },
    { bytes: -1n },
  ])(
    "admits native bounds before any private procedure/source materialization",
    async (patch) => {
      const f = fixture();
      Object.assign(f.state, patch);
      await expect(f.run()).rejects.toMatchObject({
        code: patch.bytes === -1n ? "CONFLICT" : "BAD_REQUEST",
      });
      expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
      expect(f.events).not.toContain("step-lock");
    },
  );
  it("rechecks native relation and source bounds after locks before materialization", async () => {
    for (const flag of [
      "postLockSourceOverflow",
      "postLockUnavailableShared",
    ] as const) {
      const f = fixture();
      f.state[flag] = true;
      await expect(f.run()).rejects.toMatchObject({
        code: flag === "postLockSourceOverflow" ? "BAD_REQUEST" : "CONFLICT",
      });
      expect(f.events).toContain("shared-lock");
      expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
    }
  });
  it("refuses missing shared records and unsafe deeply nested native JSON before hashing", async () => {
    const f = fixture();
    (f.cases[0] as unknown as { sharedStepGroupId: string }).sharedStepGroupId =
      "missing";
    await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" });
    const g = fixture();
    let deep: unknown = null;
    for (let depth = 0; depth < 66; depth++) deep = { child: deep };
    g.cases[0]!.verificationProfile = deep as object;
    await expect(g.run()).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses late-case content/source/update/archival and cross-project procedures rather than approving preceding batches", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.cases[32]!.title = "changed";
      },
      (f: ReturnType<typeof fixture>) => {
        f.cases[32]!.source = {
          filePath: "changed",
          framework: "x",
          lastSyncedCommitSha: null,
        };
      },
      (f: ReturnType<typeof fixture>) => {
        f.cases[32]!.updatedAt = new Date("2026-10-05T12:00:01Z");
      },
      (f: ReturnType<typeof fixture>) => {
        f.cases[32]!.archived = true;
      },
      (f: ReturnType<typeof fixture>) => {
        f.cases[32]!.sharedStepGroup = {
          projectId: "foreign",
          archivedAt: null,
          steps: [],
        };
      },
    ]) {
      const f = fixture(33);
      mutate(f);
      await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.batches).toHaveLength(2);
    }
  });
  it("rejects incomplete/duplicate/unsorted/unbounded payable scope without silently selecting a subset", async () => {
    for (const mutate of [
      (f: ReturnType<typeof fixture>) => {
        f.items.pop();
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[1]!.caseId = f.items[0]!.caseId;
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[1]!.position = f.items[0]!.position;
      },
      (f: ReturnType<typeof fixture>) => {
        f.items.reverse();
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[0]!.status = "SAVED";
      },
      (f: ReturnType<typeof fixture>) => {
        f.items[0]!.queueId = "foreign";
      },
      (f: ReturnType<typeof fixture>) => {
        f.job.caseCount = 1001;
      },
      (f: ReturnType<typeof fixture>) => {
        f.job.action = "TYPE_DESIGN";
      },
    ]) {
      const f = fixture(2);
      mutate(f);
      await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
    }
  });
  it("keeps approval atomic current auth/replay/maximum/credit guards and TYPE_DESIGN's existing path", () => {
    const router = readFileSync(
        new URL("../routers/caseAnalysisQueue.ts", import.meta.url),
        "utf8",
      ),
      approval = router.slice(
        router.indexOf("approve: protectedProcedure"),
        router.indexOf("byId: protectedProcedure"),
      );
    expect(approval.indexOf("await ownedAnalysis(")).toBeLessThan(
      approval.indexOf("if (job.approvedAt) return"),
    );
    expect(approval.indexOf("if (job.approvedAt) return")).toBeLessThan(
      approval.indexOf("assertUnchangedRiskApprovalCases(tx, job, items)"),
    );
    expect(approval.indexOf("if (job.approvedAt) return")).toBeLessThan(
      approval.indexOf("readBoundedRiskApprovalItems(tx, job)"),
    );
    expect(approval).toMatch(
      /if \(job\.action === "RISK"\) \{\s*const items = await readBoundedRiskApprovalItems\(tx, job\);[\s\S]*\} else \{\s*const items = await tx\.caseAnalysisQueueItem\.findMany/,
    );
    expect(approval).toMatch(/job\.scopeHash !== input\.scopeHash/);
    expect(approval).toMatch(/job\.maximumCredits !== input\.maximumCredits/);
    expect(approval).toMatch(
      /if \(job\.action === "RISK"\)[\s\S]*assertUnchangedRiskApprovalCases\(tx, job, items\);[\s\S]*else[\s\S]*unchangedAnalysisCase\(tx, job, item\)/,
    );
    expect(approval.match(/getAiCreditBalance\(/g)).toHaveLength(1);
    expect(approval.indexOf("assertUnchangedRiskApprovalCases")).toBeLessThan(
      approval.indexOf("getAiCreditBalance("),
    );
    expect(approval.indexOf("getAiCreditBalance(")).toBeLessThan(
      approval.indexOf("await tx.caseAnalysisQueue.update("),
    );
    expect(approval).toContain("timeout: 30000");
    const helper = readFileSync(
      new URL("./caseRiskApprovalValidation.ts", import.meta.url),
      "utf8",
    );
    expect(helper).not.toMatch(
      /chargeAiCredits\(|getAiCreditBalance\(|assessTestCaseRisk\(|\.approve\(|caseAnalysisQueue\.update|testCaseRiskReview\.|costFor\(/,
    );
    expect(helper).toMatch(/ORDER BY s\.id FOR UPDATE OF s/);
    expect(helper).toMatch(/ORDER BY g\.id FOR UPDATE/);
  });
});
