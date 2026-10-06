// Actual admission/writer with explicit synthetic native boundaries. NO SQL,
// native codec acceptance, concurrent commits, provider or customer execution.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@vaettir/db";
const mocks = vi.hoisted(() => ({
  cached: vi.fn(),
  plan: vi.fn(),
  Known: class extends Error {
    readonly code: string;
    constructor(code: string) {
      super("Synthetic native rollback");
      this.code = code;
    }
  },
}));
vi.mock("@vaettir/db", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings
        .map(
          (s, i) =>
            s +
            (values[i] && typeof values[i] === "object" && "sql" in values[i]
              ? (values[i] as { sql: string }).sql
              : i < values.length
                ? "<parameter>"
                : ""),
        )
        .join(""),
      values,
    }),
    join: (values: unknown[]) => ({
      sql: values.map(() => "<parameter>").join(","),
      values,
    }),
    PrismaClientKnownRequestError: mocks.Known,
  },
}));
vi.mock("../trpc.js", () => ({ requireProjectAccess: mocks.cached }));
vi.mock("./testPlanExecution.js", async (original) => ({
  ...(await original<typeof import("./testPlanExecution.js")>()),
  requireCurrentPlanAccess: mocks.plan,
}));
import {
  admitReviewedRunStart,
  admitReviewedStartJson,
  reviewedStartReceipt,
  REVIEWED_START_BODY_BYTES,
} from "./manualRunStartReviewedAdmission.js";
import {
  startManualRun,
  type ManualRunStartContext,
  type ManualRunStartReviewedAuthorization,
} from "./manualRunStart.js";
import { manualRunStartLegacyInputSchema } from "./manualRunStartLegacySchema.js";
import {
  qualityProfileHash,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";

const request = {
  projectId: "project",
  testCaseIds: ["case"],
  idempotencyKey: "00000000-0000-4000-8000-000000000001",
  expectedProfileHash: qualityProfileHash({}),
  originalOrganizationId: "org",
  expectedClerkActorId: "human",
  executionContext: { build: " retained\n build " },
};
const reviewed: ManualRunStartReviewedAuthorization = {
  mode: "REVIEWED_START",
  projectId: "project",
  originalOrganizationId: "org",
  expectedClerkActorId: "human",
  expectedNativeActorId: "native",
  authenticatedClerkSubject: "human",
};
function requestHash() {
  return qualityProfileHash({
    testCaseIds: ["case"],
    expectedProfileHash: request.expectedProfileHash,
    configuration: runConfigurationSchema.parse(request.executionContext),
    originalOrganizationId: "org",
    expectedClerkActorId: "human",
  });
}
const validCase = () => ({
  id: "case",
  title: " Raw\n title ",
  validationDomain: "SOFTWARE",
  reviewStatus: "APPROVED",
  background: null,
  given: ["", " Raw Given ", "same", "same"],
  when: [],
  then: [],
  verificationProfile: {},
  steps: [
    {
      order: 0,
      action: " Click\n here ",
      expectedActionOrData: " API GET\n /retained ",
      expectedResult: "",
      expectedResponse: null,
      mediaAttachmentIds: [],
    },
  ],
  sharedStepGroup: null,
  dataset: null,
});
type SyntheticCase = ReturnType<typeof validCase>;
function fixture() {
  const log: string[] = [];
  const state = {
    role: "EDITOR",
    subject: "human",
    suspended: null as Date | null,
    cases: [validCase()] as unknown[],
    links: [] as Array<{ dependentId: string; prerequisiteId: string }>,
    project: {
      qualityProfile: {} as Record<string, unknown>,
      stepFieldLabels: null as Record<string, string> | null,
    },
    plan: null as null | {
      id: string;
      projectId: string;
      name: string;
      status: string;
      executionTemplate: unknown;
    },
    receipt: null as null | {
      id: string;
      projectId: string;
      startedById: string;
      startRequestHash: string;
    },
    sizeOverrides: {} as Record<
      string,
      Partial<{ count: bigint; bytes: bigint; invalid: boolean }>
    >,
    exact: {} as Record<string, boolean>,
    bodies: {} as Record<string, string>,
    createRollback: false,
  };
  const oldReceipt = vi.fn(() => {
    throw Error("Reviewed path must not decode legacy receipt bodies");
  });
  const oldCases = vi.fn(() => {
    throw Error("Reviewed path must not load whole native cases");
  });
  const oldPlan = vi.fn(() => {
    throw Error("Reviewed path must not load whole native plans");
  });
  const links = vi.fn(async () => state.links);
  const query = vi.fn(
    async (
      first: TemplateStringsArray | { sql: string; values: unknown[] },
    ) => {
      const sql = Array.isArray(first)
        ? first.join("")
        : (first as { sql: string }).sql;
      const marker = /reviewed-start-([\w-]+)/.exec(sql)?.[1];
      if (marker) {
        log.push(marker);
        if (marker.endsWith("-size")) {
          const key = marker.slice(0, -5);
          const count =
            key === "receipt"
              ? state.receipt
                ? 1n
                : 0n
              : key === "graph"
                ? BigInt(state.links.length)
                : key === "cases"
                  ? BigInt(state.cases.length)
                  : 1n;
          const bytes =
            key === "cases"
              ? state.cases.reduce<number>(
                  (total, value) =>
                    total +
                    Buffer.byteLength(
                      state.bodies.case ?? JSON.stringify(value),
                      "utf8",
                    ),
                  0,
                )
              : key === "project"
                ? Buffer.byteLength(
                    state.bodies.project ?? JSON.stringify(state.project),
                    "utf8",
                  )
                : key === "plan"
                  ? Buffer.byteLength(
                      state.bodies.plan ?? JSON.stringify(state.plan),
                      "utf8",
                    )
                  : count
                    ? 1000
                    : 0;
          return [
            {
              count,
              bytes: BigInt(bytes),
              invalid: false,
              ...state.sizeOverrides[key],
            },
          ];
        }
        if (marker === "receipt-scalars")
          return state.receipt ? [state.receipt] : [];
        if (marker === "project-body")
          return [
            { body: state.bodies.project ?? JSON.stringify(state.project) },
          ];
        if (marker === "plan-body")
          return [{ body: state.bodies.plan ?? JSON.stringify(state.plan) }];
        if (marker === "cases-body")
          return state.cases.map((value) => ({
            body: state.bodies.case ?? JSON.stringify(value),
          }));
        if (marker.endsWith("-exact") || marker === "plan-interpretation")
          return [
            {
              exact: state.exact[marker] ?? true,
              ...(marker === "case-exact"
                ? { count: BigInt(Math.min(32, state.cases.length)) }
                : {}),
            },
          ];
        throw Error("Unexpected synthetic admission stage " + marker);
      }
      if (sql.includes('FROM "Organization"')) {
        log.push("org");
        return [{ suspendedAt: state.suspended }];
      }
      if (sql.includes('FROM "Membership"')) {
        log.push("member");
        return [{ role: state.role, seatType: "FULL" }];
      }
      if (sql.includes('FROM "Project"')) {
        log.push("project-lock");
        return [{ organizationId: "org" }];
      }
      if (sql.includes('FROM "User"')) {
        log.push("actor");
        return [{ clerkUserId: state.subject }];
      }
      if (sql.includes('FROM "TestRun"')) {
        log.push("receipt-lock");
        return [];
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        log.push("advisory");
        return [];
      }
      throw Error("Unexpected synthetic SQL");
    },
  );
  const create = vi.fn(async ({ data }: { data: { id: string } }) => {
    log.push("create");
    if (state.createRollback) {
      state.receipt = {
        id: data.id,
        projectId: "project",
        startedById: "native",
        startRequestHash: requestHash(),
      };
      throw new mocks.Known("P2002");
    }
    return { id: data.id };
  });
  const projectRead = vi.fn(
    async ({ select }: { select: Record<string, unknown> }) => {
      if (select.qualityProfile)
        throw Error("Reviewed path must not load unbounded profile JSON");
      return { organizationId: "org" };
    },
  );
  const tx = {
    $queryRaw: query,
    $executeRaw: vi.fn(async () => 0),
    project: { findUnique: projectRead },
    testRun: { findUnique: oldReceipt, create },
    testCase: { findMany: oldCases },
    testPlan: { findUnique: oldPlan },
    testCasePrerequisite: { findMany: links },
  };
  const transaction = vi.fn(
    async (work: (tx: unknown) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({
        timeout: 20000,
        isolationLevel: "RepeatableRead",
      });
      return work(tx);
    },
  );
  mocks.plan.mockResolvedValue(undefined);
  const ctx = {
    prisma: { $transaction: transaction },
    user: { id: "native", clerkUserId: "cached-other", memberships: [] },
  } as unknown as ManualRunStartContext;
  return {
    state,
    log,
    query,
    tx: tx as unknown as Prisma.TransactionClient,
    ctx,
    create,
    links,
    oldReceipt,
    oldCases,
    oldPlan,
    transaction,
  };
}
const parsed = () => manualRunStartLegacyInputSchema.parse(request);

describe("reviewed run start native admission, synthetic boundaries only", () => {
  it("current auth + exact receipt precede new graph/body checks, with no whole legacy JSON read", async () => {
    const h = fixture();
    h.state.createRollback = true;
    await expect(
      startManualRun(h.ctx, request, reviewed),
    ).resolves.toMatchObject({
      originalOrganizationId: "org",
      expectedClerkActorId: "human",
      idempotencyKey: request.idempotencyKey,
    });
    expect(h.transaction).toHaveBeenCalledTimes(3);
    expect(h.create).toHaveBeenCalledOnce();
    expect(h.oldReceipt).not.toHaveBeenCalled();
    expect(h.oldCases).not.toHaveBeenCalled();
    expect(h.oldPlan).not.toHaveBeenCalled();
    const replay = h.log.lastIndexOf("receipt-scalars");
    expect(h.log.lastIndexOf("actor")).toBeLessThan(replay);
    expect(h.log.lastIndexOf("create")).toBeLessThan(replay);
    expect(h.log.filter((v) => v === "graph-size")).toHaveLength(1);
  });
  it("native scope refusal precedes even scalar receipt reads", async () => {
    const h = fixture();
    h.state.subject = "remapped";
    await expect(
      startManualRun(h.ctx, request, reviewed),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.log).not.toContain("receipt-size");
    expect(h.create).not.toHaveBeenCalled();
  });
  it.each(["graph", "cases", "project"])(
    "actual reviewed writer %s refusal cannot fall through to run creation or legacy body reads",
    async (stage) => {
      const h = fixture();
      h.state.sizeOverrides[stage] = { invalid: true };
      await expect(
        startManualRun(h.ctx, request, reviewed),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.create).not.toHaveBeenCalled();
      expect(h.oldReceipt).not.toHaveBeenCalled();
      expect(h.oldCases).not.toHaveBeenCalled();
      expect(h.oldPlan).not.toHaveBeenCalled();
      expect(h.log.indexOf("actor")).toBeLessThan(
        h.log.indexOf(`${stage}-size`),
      );
      expect(h.log).not.toContain("cases-body");
    },
  );
  it("known accepted scalar receipt remains recoverable despite later body caps and unsupported profile", async () => {
    const h = fixture();
    h.state.receipt = {
      id: "durable",
      projectId: "project",
      startedById: "native",
      startRequestHash: requestHash(),
    };
    h.state.sizeOverrides.cases = { invalid: true, bytes: 999999999n };
    h.state.project.qualityProfile = { unsupported: 1e30 };
    await expect(
      reviewedStartReceipt(h.tx, "durable", "project", "native", requestHash()),
    ).resolves.toBe("durable");
    expect(h.log).toEqual(["receipt-size", "receipt-scalars"]);
    expect(h.create).not.toHaveBeenCalled();
  });
  it("absent legacy recovery receipt cannot create or begin new admission", async () => {
    const h = fixture();
    await expect(
      startManualRun(h.ctx, request, { ...reviewed, mode: "LEGACY_RECOVERY" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.log).not.toContain("graph-size");
    expect(h.create).not.toHaveBeenCalled();
  });
  it.each(["projectId", "startedById", "startRequestHash"] as const)(
    "retained receipt %s disagreement conflicts without new body reads",
    async (key) => {
      const h = fixture();
      h.state.receipt = {
        id: "durable",
        projectId: "project",
        startedById: "native",
        startRequestHash: requestHash(),
        [key]: key === "startRequestHash" ? "f".repeat(64) : "foreign",
      };
      await expect(
        reviewedStartReceipt(
          h.tx,
          "durable",
          "project",
          "native",
          requestHash(),
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(h.log).toEqual(["receipt-size", "receipt-scalars"]);
    },
  );
  it.each(["graph", "cases", "project", "plan"])(
    "%s native byte refusal happens before every JSON body read",
    async (stage) => {
      const h = fixture();
      h.state.sizeOverrides[stage] = {
        bytes: BigInt(REVIEWED_START_BODY_BYTES + 1),
      };
      const input = {
        ...parsed(),
        ...(stage === "plan"
          ? {
              planReference: {
                testPlanId: "plan",
                expectedTemplateHash: "a".repeat(64),
                configurationId: request.idempotencyKey,
              },
            }
          : {}),
      };
      await expect(admitReviewedRunStart(h.tx, input)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(h.log.some((v) => v.endsWith("-body"))).toBe(false);
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it.each([
    { count: 10001n },
    { count: -1n },
    { bytes: -1n },
    { invalid: true },
    { count: 1 as unknown as bigint },
  ])(
    "unsupported graph scalar scenario %# does not fetch any graph IDs",
    async (override) => {
      const h = fixture();
      h.state.sizeOverrides.graph = override;
      await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject(
        { code: "PRECONDITION_FAILED" },
      );
      expect(h.links).not.toHaveBeenCalled();
      expect(h.log.some((v) => v.endsWith("-body"))).toBe(false);
    },
  );
  it("empty graph makes no scalar link fetch, raw known descriptors survive explicit {} interpretation", async () => {
    const h = fixture(),
      result = await admitReviewedRunStart(h.tx, parsed());
    expect(h.links).not.toHaveBeenCalled();
    expect(result.interpretation).toBe(
      "LEGACY_SUPPORTED_MISSING_FIELD_INTERPRETATION",
    );
    expect(result.cases[0]).toEqual(validCase());
    expect(result.cases[0]?.steps[0]?.action).toBe(" Click\n here ");
    expect(result.cases[0]?.steps[0]?.expectedResult).toBe("");
    expect(result.cases[0]?.steps[0]?.expectedResponse).toBeNull();
    expect(result.cases[0]?.given).toEqual(["", " Raw Given ", "same", "same"]);
    const firstBody = h.log.findIndex((v) => v.endsWith("-body"));
    for (const stage of ["graph-size", "cases-size", "project-size"])
      expect(h.log.indexOf(stage)).toBeLessThan(firstBody);
  });
  it.each(["cases", "project", "plan"])(
    "%s projected bytes must exactly match admitted native bytes",
    async (stage) => {
      const h = fixture();
      h.state.sizeOverrides[stage] = { bytes: 1n };
      const input = {
        ...parsed(),
        ...(stage === "plan"
          ? {
              planReference: {
                testPlanId: "plan",
                expectedTemplateHash: "a".repeat(64),
                configurationId: request.idempotencyKey,
              },
            }
          : {}),
      };
      await expect(admitReviewedRunStart(h.tx, input)).rejects.toMatchObject({
        code: "PRECONDITION_FAILED",
      });
      expect(h.log).not.toContain("case-exact");
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it("duplicate native graph and scalar/projection count disagreement refuse before private JSON", async () => {
    for (const mismatch of [false, true]) {
      const h = fixture();
      h.state.links = [
        { dependentId: "case", prerequisiteId: "other" },
        { dependentId: "case", prerequisiteId: "other" },
      ];
      if (mismatch) h.state.sizeOverrides.graph = { count: 1n };
      await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject(
        { code: "PRECONDITION_FAILED" },
      );
      expect(h.log.some((v) => v.endsWith("-body"))).toBe(false);
    }
  });
  it("selected dependency cycle retains semantic CONFLICT before any private JSON", async () => {
    const h = fixture();
    h.state.links = [
      { dependentId: "case", prerequisiteId: "other" },
      { dependentId: "other", prerequisiteId: "case" },
    ];
    await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(h.log.some((v) => v.endsWith("-body"))).toBe(false);
  });
  it.each([{ count: 2n }, { bytes: 2049n }, { invalid: true }])(
    "unsupported receipt scalar scenario %# cannot read retained hash scalars",
    async (override) => {
      const h = fixture();
      h.state.sizeOverrides.receipt = override;
      await expect(
        reviewedStartReceipt(
          h.tx,
          "durable",
          "project",
          "native",
          requestHash(),
        ),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(h.log).toEqual(["receipt-size"]);
    },
  );
  it("unknown verification prose refuses instead of being silently stripped/defaulted", async () => {
    const h = fixture();
    (h.state.cases[0] as SyntheticCase).verificationProfile = {
      authoredUnknown: " Raw prose ",
    };
    await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(h.create).not.toHaveBeenCalled();
  });
  it("complete raw profile siblings and reserved own keys remain part of the actual native profile hash", async () => {
    const h = fixture();
    const raw = JSON.parse(
      '{"__proto__":{"retained":"raw prose"},"unknown":[null,false,0,"",{"nested":" retained\\n "}]}',
    ) as Record<string, unknown>;
    h.state.project.qualityProfile = raw;
    h.state.project.stepFieldLabels = JSON.parse(
      '{"__proto__":" Raw label ","action":" Literal\\n action "}',
    ) as Record<string, string>;
    const admitted = await admitReviewedRunStart(h.tx, parsed());
    expect(Object.hasOwn(admitted.project.qualityProfile, "__proto__")).toBe(
      true,
    );
    expect(admitted.project.qualityProfile).toEqual(raw);
    expect(qualityProfileHash(admitted.project.qualityProfile)).toBe(
      qualityProfileHash(raw),
    );
    expect(
      Object.hasOwn(
        admitted.project.organization.stepFieldLabels!,
        "__proto__",
      ),
    ).toBe(true);
    expect(admitted.project.organization.stepFieldLabels?.action).toBe(
      " Literal\n action ",
    );
  });
  it("unknown shared-step properties refuse rather than disappear in frozen snapshot parsing", async () => {
    const h = fixture();
    Object.assign(h.state.cases[0] as object, {
      sharedStepGroup: {
        steps: [{ order: 0, action: " retained ", authoredUnknown: "prose" }],
      },
    });
    await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it.each(["project-exact", "case-exact", "plan-exact", "plan-interpretation"])(
    "native %s mismatch refuses unsupported precision/normalization",
    async (stage) => {
      const h = fixture();
      h.state.exact[stage] = false;
      h.state.plan = {
        id: "plan",
        projectId: "project",
        name: " Raw plan ",
        status: "DRAFT",
        executionTemplate: {
          version: 1,
          testCaseIds: ["case"],
          configurations: [],
        },
      };
      await expect(
        admitReviewedRunStart(h.tx, {
          ...parsed(),
          planReference: {
            testPlanId: "plan",
            expectedTemplateHash: "a".repeat(64),
            configurationId: request.idempotencyKey,
          },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    },
  );
  it("native precision canary remains an explicit equality refusal, never a silently rounded snapshot", async () => {
    const h = fixture();
    h.state.bodies.project =
      '{"qualityProfile":{"retained":9007199254740993},"stepFieldLabels":null}';
    h.state.exact["project-exact"] = false;
    await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(h.log).not.toContain("cases-body");
  });
  it.each(["duplicate", "foreign", "count"])(
    "%s projected cohort disagrees with full native admission and is refused",
    async (kind) => {
      const h = fixture();
      if (kind === "duplicate") {
        h.state.cases = [validCase(), validCase()];
        h.state.links = [{ dependentId: "case", prerequisiteId: "other" }];
      } else if (kind === "foreign")
        (h.state.cases[0] as SyntheticCase).id = "foreign";
      else h.state.sizeOverrides.cases = { count: 2n };
      await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject(
        { code: kind === "count" ? "BAD_REQUEST" : "PRECONDITION_FAILED" },
      );
    },
  );
  it("foreign/archived shared metadata scalar refuses before case/shared bodies", async () => {
    const h = fixture();
    h.state.sizeOverrides.cases = { invalid: true };
    await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(h.log).not.toContain("cases-body");
  });
  it("1,000 bounded cases use no more than 32 native equality batches and freeze the whole cohort", async () => {
    const h = fixture(),
      ids = Array.from({ length: 1000 }, (_, i) => `case-${i}`);
    h.state.cases = ids.map((id) => ({ ...validCase(), id }));
    // Final batch has eight, not an invented full32 response.
    let batches = 0;
    const original = h.query.getMockImplementation()!;
    h.query.mockImplementation(async (first) => {
      const sql = Array.isArray(first)
        ? first.join("")
        : (first as { sql: string }).sql;
      if (sql.includes("reviewed-start-case-exact")) {
        batches++;
        return [{ count: BigInt(batches === 32 ? 8 : 32), exact: true }];
      }
      return original(first);
    });
    const result = await admitReviewedRunStart(h.tx, {
      ...parsed(),
      testCaseIds: ids,
    });
    expect(result.cases.map((c) => c.id)).toEqual(ids);
    expect(batches).toBe(32);
  });
  it("native equality batch count mismatch cannot publish a partial cohort", async () => {
    const h = fixture(),
      original = h.query.getMockImplementation()!;
    h.query.mockImplementation(async (first) => {
      const sql = Array.isArray(first)
        ? first.join("")
        : (first as { sql: string }).sql;
      return sql.includes("reviewed-start-case-exact")
        ? [{ count: 0n, exact: true }]
        : original(first);
    });
    await expect(admitReviewedRunStart(h.tx, parsed())).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
  });
  it.each(["null", "array", "unknown", "oversized", "depth"])(
    "unsupported projected %s value is generically refused",
    (kind) => {
      const value =
        kind === "null"
          ? "null"
          : kind === "array"
            ? "[]"
            : kind === "unknown"
              ? "{broken"
              : kind === "oversized"
                ? JSON.stringify("x".repeat(REVIEWED_START_BODY_BYTES))
                : "[".repeat(66) + "0" + "]".repeat(66);
      if (kind === "null" || kind === "array")
        expect(admitReviewedStartJson(value).value).toEqual(
          kind === "null" ? null : [],
        );
      else expect(() => admitReviewedStartJson(value)).toThrow();
    },
  );
  it("source admission selects only freeze-relevant bodies and refuses shared foreign/archive/type before JSON", () => {
    const source = readFileSync(
      new URL("./manualRunStartReviewedAdmission.ts", import.meta.url),
      "utf8",
    );
    expect(source).toContain(
      'g."projectId"<>c."projectId" OR g."archivedAt" IS NOT NULL',
    );
    expect(source).toContain(
      "jsonb_typeof(c.\"verificationProfile\") IS DISTINCT FROM 'object'",
    );
    expect(source).not.toMatch(
      /customFields|sourceFilePath|riskAssessment|observations|note,/,
    );
    expect(source).not.toMatch(/\b(fetch|deleteMany|updateMany)\s*\(/);
  });
});
