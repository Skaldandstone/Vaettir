import { describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@vaettir/db";
import {
  prepareManualRetest,
  startManualRetest,
  retestClosure,
} from "./manualRetest.js";
import {
  qualityProfileHash,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";
import { manualRetestMetadataSchema } from "./manualRetestSchema.js";

// Actual prepare/start services; all native-query and ORM responses below are
// synthetic. No real database, identity provider, media or source is accessed.
function fixture(count: number) {
  const ids = Array.from({ length: count }, (_, i) => `synthetic-case-${i}`);
  const snapshot = {
    version: 1,
    experience: null,
    profileHash: qualityProfileHash({}),
    configuration: runConfigurationSchema.parse({
      build: "Frozen synthetic build",
    }),
    stepFieldLabels: { action: "Saved tester action" },
    caseDefinitions: ids.map((id) => ({
      testCaseId: id,
      title: "Frozen synthetic case",
      validationDomain: "SOFTWARE",
      reviewStatus: "APPROVED",
      background: null,
      given: [],
      when: [],
      then: [],
      verificationProfile: {
        setup: "",
        safety: "",
        instruments: "",
        acceptanceCriteria: "",
      },
      steps: [
        {
          order: 0,
          action: "Original frozen instruction",
          expectedActionOrData: "GET /synthetic",
          expectedResult: "Expected synthetic response",
          expectedResponse: null,
          mediaAttachmentIds: [],
        },
      ],
    })),
  };
  const graph = Object.fromEntries(ids.map((id) => [id, []]));
  const source = {
    id: "synthetic-source-run",
    ciProvider: "manual",
    status: "FAILED",
    manualTestCaseIds: ids,
  };
  const receipts = new Map<string, Record<string, any>>();
  const state = {
    note: "Original recorded synthetic failure",
    remapped: false,
  };
  const tx = {
    project: {
      findUnique: vi.fn(async () => ({ organizationId: "synthetic-org" })),
    },
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(
      async (
        raw: TemplateStringsArray | { sql: string; values: unknown[] },
        ...parameters: unknown[]
      ) => {
        const sql = Array.isArray(raw)
          ? raw.join("?")
          : (raw as { sql: string }).sql;
        const values = Array.isArray(raw)
          ? parameters
          : (raw as { values: unknown[] }).values;
        if (sql.includes('FROM "Organization"')) return [{ suspendedAt: null }];
        if (sql.includes('FROM "Membership"'))
          return [{ role: "EDITOR", seatType: "FULL" }];
        if (sql.includes('FROM "Project"'))
          return [{ organizationId: "synthetic-org" }];
        if (sql.includes('FROM "User"'))
          return [
            {
              clerkUserId: state.remapped
                ? "synthetic-other-clerk"
                : "synthetic-clerk",
            },
          ];
        if (sql.includes("pg_advisory") || sql.includes('FROM "TestCase"'))
          return [];
        if (sql.includes('cardinality("manualTestCaseIds")'))
          return [
            { count, bytes: BigInt(Buffer.byteLength(JSON.stringify(ids))) },
          ];
        if (sql.includes('octet_length("manualPrerequisites"::text)'))
          return [
            {
              bytes: BigInt(
                Buffer.byteLength(JSON.stringify(snapshot)) +
                  Buffer.byteLength(JSON.stringify(graph)),
              ),
            },
          ];
        if (sql.includes('FROM "TestResult"'))
          return [{ bytes: 100n, count: 1 }];
        if (sql.includes('"projectId","startedById"')) {
          const value = receipts.get(String(values[0]));
          return value
            ? [{ projectId: value.projectId, startedById: value.startedById }]
            : [];
        }
        if (sql.includes('octet_length("executionContext"::text)'))
          return [
            {
              bytes: BigInt(
                Buffer.byteLength(
                  JSON.stringify(
                    receipts.get(String(values[0]))?.executionContext,
                  ),
                ),
              ),
            },
          ];
        if (sql.includes('FROM "TestRun"') && sql.includes("FOR UPDATE"))
          return [];
        throw Error("Unexpected synthetic native-query shape");
      },
    ),
    testRun: {
      findFirst: vi.fn(async () => source),
      findUniqueOrThrow: vi.fn(async () => ({
        executionContext: snapshot,
        manualPrerequisites: graph,
      })),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          receipts.get(where.id) ?? null,
      ),
      create: vi.fn(async ({ data }: { data: Record<string, any> }) => {
        receipts.set(data.id, structuredClone(data));
        return data;
      }),
    },
    testCase: {
      findMany: vi.fn(
        async ({
          where,
          select,
        }: {
          where: { id: { in: string[] } };
          select: unknown;
        }) => {
          expect(select).toEqual({ id: true, displayId: true });
          return where.id.in.map((id) => ({
            id,
            displayId: `TC-${id.split("-").at(-1)}`,
          }));
        },
      ),
    },
    testResult: {
      findMany: vi.fn(async () => [
        {
          id: "synthetic-result",
          testCaseId: ids[0],
          status: "FAIL",
          note: state.note,
          errorMessage: null,
          observations: {},
        },
      ]),
    },
    manualStepResultHead: { findMany: vi.fn(async () => []) },
  };
  const db = {
    ...tx,
    $transaction: vi.fn(async (work: (db: typeof tx) => unknown) => work(tx)),
  };
  const input = {
    projectId: "synthetic-project",
    sourceRunId: source.id,
    testCaseId: ids[0],
    expectedScope: {
      projectId: "synthetic-project",
      organizationId: "synthetic-org",
      clerkActorId: "synthetic-clerk",
    },
  };
  return {
    tx,
    db,
    input,
    receipts,
    snapshot,
    state,
    preview: () =>
      prepareManualRetest(
        tx as unknown as Prisma.TransactionClient,
        "synthetic-actor",
        input,
        false,
        "synthetic-clerk",
      ),
  };
}
describe("one-case retest from a supported large original frozen run", () => {
  it.each([851, 1000])(
    "reviews a selected failure from %s original cases without borrowing current bodies",
    async (count) => {
      const f = fixture(count),
        review = await f.preview();
      expect(review.ordered).toEqual([f.input.testCaseId]);
      expect(review.caseDefinitions).toEqual([f.snapshot.caseDefinitions[0]]);
      expect(review.configuration.build).toBe("Frozen synthetic build");
      expect(review.sourceResults[0].note).toBe(
        "Original recorded synthetic failure",
      );
      expect(review.credits).toBe(0);
      expect(review.scope).toMatchObject(f.input.expectedScope);
    },
  );
  it("starts once and recovers the identical retained request after original evidence changes", async () => {
    const f = fixture(851),
      review = await f.preview();
    const input = {
      ...f.input,
      expectedReviewHash: review.reviewHash,
      idempotencyKey: "24d85e07-0ed0-4cc2-aad4-3611d3858148",
    };
    const first = await startManualRetest(
      f.db as unknown as PrismaClient,
      "synthetic-actor",
      input,
      "synthetic-clerk",
    );
    const before = structuredClone(f.receipts.get(first.testRunId));
    const bodyReads = f.tx.testRun.findUniqueOrThrow.mock.calls.length;
    f.state.note =
      "Later source observation, not a replacement for the retained retest";
    const retry = await startManualRetest(
      f.db as unknown as PrismaClient,
      "synthetic-actor",
      input,
      "synthetic-clerk",
    );
    expect(first.recovered).toBe(false);
    expect(retry).toMatchObject({
      testRunId: first.testRunId,
      recovered: true,
    });
    expect(f.tx.testRun.create).toHaveBeenCalledTimes(1);
    expect(f.tx.testRun.findUniqueOrThrow.mock.calls.length).toBe(bodyReads);
    expect(f.receipts.get(first.testRunId)).toEqual(before);
    f.state.remapped = true;
    await expect(
      startManualRetest(
        f.db as unknown as PrismaClient,
        "synthetic-actor",
        input,
        "synthetic-clerk",
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("1,001-case original scopes refuse before frozen procedure bodies are fetched", async () => {
    const f = fixture(1001);
    await expect(f.preview()).rejects.toThrow("original case scope exceeds");
    expect(f.tx.testRun.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(f.tx.testRun.create).not.toHaveBeenCalled();
  });
  it("a 1,000-case frozen graph is supported, but a 1,001-case scope is not", () => {
    const ids = Array.from({ length: 1000 }, (_, i) => String(i));
    expect(retestClosure(ids, { "0": ids.slice(1) }, "0").ordered.length).toBe(
      1000,
    );
    expect(() => retestClosure([...ids, "1000"], {}, "0")).toThrow("invalid");
  });
  it("separate captured-evidence metadata still refuses over 500 result/step references", async () => {
    const review = await fixture(851).preview();
    const metadata = review.frozen.retest!;
    expect(
      manualRetestMetadataSchema.safeParse({
        ...metadata,
        sourceResults: Array.from(
          { length: 501 },
          () => metadata.sourceResults[0],
        ),
      }).success,
    ).toBe(false);
    expect(
      manualRetestMetadataSchema.safeParse({
        ...metadata,
        sourceStepRevisions: Array.from({ length: 501 }, () => ({
          testCaseId: "synthetic-case-0",
          stepIndex: 0,
          revisionId: "synthetic-revision",
          revisionNumber: 1,
        })),
      }).success,
    ).toBe(false);
  });
});
