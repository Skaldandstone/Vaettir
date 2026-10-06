// Actual extracted writer + synthetic native transaction boundaries. No SQL,
// accepted native concurrency, profile precision or production proof implied.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  cached: vi.fn(),
  currentPlan: vi.fn(),
  KnownError: class extends Error {
    readonly code: string;
    constructor(
      message: string,
      options: { code: string; clientVersion: string },
    ) {
      super(message);
      this.code = options.code;
    }
  },
}));
vi.mock("@vaettir/db", () => ({
  Prisma: {
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.map((part, index) => part + (values[index] && typeof values[index] === "object" && "sql" in values[index] ? (values[index] as { sql: string }).sql : index < values.length ? "<parameter>" : "")).join(""),
      values,
    }),
    join: (values: unknown[]) => ({ sql: values.map(() => "<parameter>").join(","), values }),
    PrismaClientKnownRequestError: mocks.KnownError,
  },
}));
vi.mock("../trpc.js", () => ({ requireProjectAccess: mocks.cached }));
vi.mock("./testPlanExecution.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./testPlanExecution.js")>()),
  requireCurrentPlanAccess: mocks.currentPlan,
}));
import { Prisma } from "@vaettir/db";
import {
  startManualRun,
  type ManualRunStartContext,
  type ManualRunStartReviewedAuthorization,
} from "./manualRunStart.js";
import {
  manualRunStartLegacyInputSchema,
  type ManualRunStartLegacyRawInput,
} from "./manualRunStartLegacySchema.js";
import {
  qualityProfileHash,
  runConfigurationSchema,
} from "./qualityExperienceProfile.js";
const uuid = "00000000-0000-4000-8000-000000000001";
const raw = {
  projectId: "project",
  testCaseIds: ["two", "one"],
  idempotencyKey: uuid,
};
const scoped = {
  ...raw,
  expectedProfileHash: qualityProfileHash({}),
  executionContext: { build: " raw\n0 " },
  originalOrganizationId: "org",
  expectedClerkActorId: "human",
};
const reviewed: ManualRunStartReviewedAuthorization = {
  mode: "REVIEWED_START",
  projectId: "project",
  originalOrganizationId: "org",
  expectedClerkActorId: "human",
  expectedNativeActorId: "native",
  authenticatedClerkSubject: "human",
};
function hash(request: ManualRunStartLegacyRawInput) {
  const input = manualRunStartLegacyInputSchema.parse(request);
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
function fixture(request: ManualRunStartLegacyRawInput = raw) {
  const log: string[] = [],
    id = `manual_${createHash("sha256")
      .update(
        JSON.stringify([request.projectId, "native", request.idempotencyKey]),
      )
      .digest("hex")}`;
  const state = {
    role: "OWNER",
    seatType: "FULL",
    org: "org",
    userClerk: "human",
    suspended: null as Date | null,
    existing: null as null | {
      id: string;
      projectId: string;
      startedById: string;
      executionContext: unknown;
    },
    profile: {} as unknown,
    links: [] as Array<{ dependentId: string; prerequisiteId: string }>,
  };
  const verification = {
    setup: "",
    safety: "",
    instruments: "",
    acceptanceCriteria: "",
  };
  const cases = ["one", "two"].map((caseId) => ({
    id: caseId,
    title: ` ${caseId}\nraw title `,
    validationDomain: "SOFTWARE",
    reviewStatus: "APPROVED",
    background: null,
    given: [" Given "],
    when: [" When "],
    then: [" Then "],
    verificationProfile: verification,
    steps: [],
    sharedStepGroup: null,
    dataset: null,
  }));
  const execute = vi.fn(async () => {
    log.push("8s");
    return 0;
  });
  const query = vi.fn(
    async (strings: TemplateStringsArray | { sql: string; values: unknown[] }, ..._values: unknown[]) => {
      const sql = Array.isArray(strings) ? strings.join("") : (strings as { sql: string }).sql;
      const stage = /reviewed-start-([\w-]+)/.exec(sql)?.[1];
      if (stage) {
        log.push(stage);
        if (stage.endsWith("-size")) {
          const key = stage.slice(0, -5);
          const count = key === "receipt" ? state.existing ? 1n : 0n : key === "graph" ? BigInt(state.links.length) : key === "cases" ? BigInt(cases.length) : 1n;
          const wire = key === "project" ? [JSON.stringify({ qualityProfile: state.profile, stepFieldLabels: {} })] : key === "cases" ? cases.map(value => JSON.stringify(value)) : key === "graph" ? state.links.map(value => JSON.stringify(value)) : [];
          const bytes = wire.length ? BigInt(wire.reduce((total, body) => total + Buffer.byteLength(body, "utf8"), 0)) : count ? 200n : 0n;
          return [{ count, bytes, invalid: false }];
        }
        if (stage === "receipt-scalars") {
          const existing = state.existing;
          return existing ? [{ id: existing.id, projectId: existing.projectId, startedById: existing.startedById, startRequestHash: (existing.executionContext as { startRequestHash: string }).startRequestHash }] : [];
        }
        if (stage === "project-body") return [{ body: JSON.stringify({ qualityProfile: state.profile, stepFieldLabels: {} }) }];
        if (stage === "cases-body") return cases.map(value => ({ body: JSON.stringify(value) }));
        if (stage === "project-exact") return [{ exact: true }];
        if (stage === "case-exact") return [{ count: BigInt(cases.length), exact: true }];
        throw Error("Unexpected synthetic reviewed SQL stage " + stage);
      }
      if (sql.includes('FROM "Organization"')) {
        log.push("org");
        return [{ suspendedAt: state.suspended }];
      }
      if (sql.includes('FROM "Membership"')) {
        log.push("member");
        return [{ role: state.role, seatType: state.seatType }];
      }
      if (sql.includes('FROM "Project"')) {
        log.push("project");
        return [{ organizationId: state.org }];
      }
      if (sql.includes('FROM "User"')) {
        log.push("user");
        return [{ clerkUserId: state.userClerk }];
      }
      if (sql.includes('FROM "TestRun"')) {
        log.push("receipt-lock");
        return state.existing ? [{ id }] : [];
      }
      if (sql.includes("pg_advisory_xact_lock")) {
        log.push("graph-lock");
        return [];
      }
      throw Error("Unexpected synthetic SQL");
    },
  );
  const receipt = vi.fn(async () => {
    log.push("receipt");
    return state.existing;
  });
  const create = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    log.push("create");
    return {
      id: (data.id as string | undefined) ?? "ordinary-native-generated-id",
    };
  });
  const tx = {
    $executeRaw: execute,
    $queryRaw: query,
    project: {
      findUnique: vi.fn(
        async ({ select }: { select: Record<string, unknown> }) => {
          if (select.qualityProfile) {
            log.push("profile");
            return {
              qualityProfile: state.profile,
              organization: { stepFieldLabels: {} },
            };
          }
          log.push("discover");
          return { organizationId: state.org };
        },
      ),
    },
    testRun: { findUnique: receipt, create },
    testPlan: { findUnique: vi.fn(async () => null) },
    testCasePrerequisite: {
      findMany: vi.fn(async () => {
        log.push("links");
        return state.links;
      }),
    },
    testCase: {
      findMany: vi.fn(async () => {
        log.push("cases");
        return cases;
      }),
    },
  };
  const transaction = vi.fn(
    async (work: (value: typeof tx) => Promise<unknown>, options: unknown) => {
      expect(options).toEqual({
        timeout: 20000,
        isolationLevel: "RepeatableRead",
      });
      log.push("tx");
      return work(tx);
    },
  );
  mocks.cached.mockReset();
  mocks.currentPlan.mockReset();
  mocks.cached.mockImplementation(async () => {
    log.push("cached");
    return { membership: { role: "OWNER", seatType: "FULL" } };
  });
  mocks.currentPlan.mockImplementation(async () => {
    log.push("current-plan");
  });
  const ctx = {
    prisma: { $transaction: transaction },
    user: { id: "native", clerkUserId: "human", memberships: [] },
    authenticatedClerkSubject: "untrusted-by-legacy-mode",
  } as unknown as ManualRunStartContext;
  function accepted() {
    state.existing = {
      id,
      projectId: "project",
      startedById: "native",
      executionContext: {
        version: 1,
        experience: null,
        profileHash: qualityProfileHash({}),
        startRequestHash: hash(request),
        configuration: runConfigurationSchema.parse({}),
        stepFieldLabels: {},
        caseDefinitions: [],
      },
    };
  }
  return {
    ctx,
    state,
    log,
    tx,
    transaction,
    receipt,
    create,
    accepted,
    id,
    cases,
  };
}
function declarations(source: string, names: string[]) {
  const ast = ts.createSourceFile(
      "source.ts",
      source,
      ts.ScriptTarget.Latest,
      true,
    ),
    printer = ts.createPrinter({ removeComments: true }),
    result: Record<string, string> = {};
  const visit = (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      names.includes(node.name.text) &&
      node.initializer
    )
      result[node.name.text] = printer.printNode(
        ts.EmitHint.Unspecified,
        node.initializer,
        ast,
      );
    if (
      ts.isFunctionDeclaration(node) &&
      node.name &&
      names.includes(node.name.text)
    )
      result[node.name.text] = printer.printNode(
        ts.EmitHint.Unspecified,
        node,
        ast,
      );
    ts.forEachChild(node, visit);
  };
  visit(ast);
  return result;
}
function semantics(code: string, legacyReceiptOnly = false) {
  const ast = ts.createSourceFile(
    "semantic.ts",
    code,
    ts.ScriptTarget.Latest,
    true,
  );
  const visit = (node: ts.Node): unknown => {
    if (ts.isParenthesizedExpression(node)) return visit(node.expression);
    const children: unknown[] = [];
    ts.forEachChild(node, (child) => {
      if (legacyReceiptOnly && ts.isIfStatement(child) && child.expression.getText(ast) === "reviewed") {
        // Verify the exact additive branch, then compare EVERY unchanged
        // legacy receipt statement against the still-mounted original router.
        expect(child.getText(ast).replace(/\s+/g, " ")).toBe("if (reviewed) { const retained = await reviewedStartReceipt(tx, durableId, input.projectId, ctx.user.id, startRequestHash); return retained ? acknowledgeRun(retained) : null; }");
        return;
      }
      children.push(visit(child));
    });
    return [
      ts.SyntaxKind[node.kind],
      node.kind !== ts.SyntaxKind.SourceFile &&
      "text" in node &&
      typeof node.text === "string"
        ? node.text
        : null,
      children,
    ];
  };
  return visit(ast);
}
describe("unmounted manual run-start extraction (source/mock only)", () => {
  it("original identity/hash/ACK/receipt function ASTs and body property order are unchanged", () => {
    const names = [
      "configuration",
      "startRequestHash",
      "durableId",
      "acknowledgeRun",
      "previousRunInTransaction",
      "previousRun",
      "snapshot",
      "executionContext",
    ];
    const original = declarations(
        readFileSync(
          new URL("../routers/manualExecution.ts", import.meta.url),
          "utf8",
        ),
        names,
      ),
      extracted = declarations(
        readFileSync(new URL("./manualRunStart.ts", import.meta.url), "utf8"),
        names,
      );
    for (const name of names)
      expect(semantics(extracted[name]!, name === "previousRunInTransaction"), name).toEqual(
        semantics(original[name]!),
      );
  });
  it("unpinned legacy create retains plain ACK, exact sorted-request hash and original native ID", async () => {
    const h = fixture();
    const result = await startManualRun(h.ctx, raw);
    expect(result).toEqual({ testRunId: h.id });
    expect(h.create.mock.calls[0]![0].data.executionContext).toMatchObject({
      startRequestHash: hash(raw),
      caseDefinitions: [
        { title: " two\nraw title " },
        { title: " one\nraw title " },
      ],
    });
    expect(h.log.slice(0, 8)).toEqual([
      "cached",
      "current-plan",
      "tx",
      "8s",
      "discover",
      "org",
      "member",
      "project",
    ]);
    expect(h.tx.testCasePrerequisite.findMany).toHaveBeenCalledWith({
      where: { projectId: "project" },
      select: { dependentId: true, prerequisiteId: true },
      take: 10001,
    });
    expect(raw).not.toHaveProperty("originalOrganizationId");
  });
  it("legacy no-UUID create stays non-durable without inventing an acknowledgement UUID", async () => {
    const h = fixture();
    const result = await startManualRun(h.ctx, {
      projectId: "project",
      testCaseIds: ["one", "two"],
    });
    expect(result).toEqual({ testRunId: "ordinary-native-generated-id" });
    expect(h.create.mock.calls[0]![0].data.id).toBeUndefined();
    expect(h.transaction).toHaveBeenCalledOnce();
  });
  it("paired inner pins/profile/context hash retain exact current ACK and raw input is not edited", async () => {
    const h = fixture(scoped),
      before = JSON.stringify(scoped);
    const result = await startManualRun(h.ctx, scoped);
    expect(result).toEqual({
      testRunId: h.id,
      originalOrganizationId: "org",
      expectedClerkActorId: "human",
      idempotencyKey: uuid,
    });
    expect(h.create.mock.calls[0]![0].data.executionContext).toMatchObject({
      startRequestHash: hash(scoped),
      configuration: { build: "raw\n0" },
    });
    expect(JSON.stringify(scoped)).toBe(before);
  });
  it("exact receipt precedes new profile/case/graph admission and stays unchanged after later unsupported profile", async () => {
    const h = fixture(scoped);
    h.accepted();
    h.state.profile = null;
    h.cases.length = 0;
    expect(await startManualRun(h.ctx, scoped)).toEqual({
      testRunId: h.id,
      originalOrganizationId: "org",
      expectedClerkActorId: "human",
      idempotencyKey: uuid,
    });
    expect(h.log).not.toContain("profile");
    expect(h.log).not.toContain("links");
    expect(h.create).not.toHaveBeenCalled();
    expect(h.log.indexOf("user")).toBeLessThan(h.log.indexOf("receipt"));
  });
  it("changed request under an accepted UUID is genuine CONFLICT, not a new create", async () => {
    const h = fixture(scoped);
    h.accepted();
    await expect(
      startManualRun(h.ctx, {
        ...scoped,
        executionContext: { build: "changed" },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.create).not.toHaveBeenCalled();
  });
  it("current legacy cached seat gate and current native mapping remain unchanged", async () => {
    const h = fixture();
    mocks.cached.mockResolvedValue({ membership: { seatType: "READ_ONLY" } });
    await expect(startManualRun(h.ctx, raw)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(h.transaction).not.toHaveBeenCalled();
    mocks.cached.mockResolvedValue({ membership: { seatType: "FULL" } });
    h.state.userClerk = "changed";
    await expect(startManualRun(h.ctx, raw)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(h.receipt).not.toHaveBeenCalled();
  });
  it("separate reviewed subject checks native mapping without impersonating cached ctx.user", async () => {
    const h = fixture(scoped);
    h.ctx.user.clerkUserId = "cached-other";
    const before = JSON.stringify(h.ctx.user);
    await startManualRun(h.ctx, scoped, reviewed);
    expect(JSON.stringify(h.ctx.user)).toBe(before);
    expect(mocks.cached).not.toHaveBeenCalled();
    expect(h.log.indexOf("user")).toBeLessThan(h.log.indexOf("receipt-size"));
    expect(h.receipt).not.toHaveBeenCalled();
  });
  it.each([
    "projectId",
    "originalOrganizationId",
    "expectedClerkActorId",
    "expectedNativeActorId",
    "authenticatedClerkSubject",
  ])(
    "wrong reviewed %s refuses before private receipt/profile in every transaction",
    async (field) => {
      const h = fixture(scoped);
      h.accepted();
      await expect(
        startManualRun(h.ctx, scoped, { ...reviewed, [field]: "other" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.receipt).not.toHaveBeenCalled();
      expect(h.create).not.toHaveBeenCalled();
      expect(h.log).not.toContain("profile");
    },
  );
  it.each(["role", "seat", "suspension"])(
    "native %s change refuses even exact reviewed recovery before receipt",
    async (reason) => {
      const h = fixture();
      h.accepted();
      if (reason === "role") h.state.role = "VIEWER";
      if (reason === "seat") h.state.seatType = "READ_ONLY";
      if (reason === "suspension") h.state.suspended = new Date();
      await expect(
        startManualRun(h.ctx, raw, { ...reviewed, mode: "LEGACY_RECOVERY" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(h.receipt).not.toHaveBeenCalled();
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it("legacy recovery-only returns exactly old unpinned ACK without inventing historical outer provenance", async () => {
    const h = fixture();
    h.accepted();
    const before = JSON.stringify(raw);
    expect(
      await startManualRun(h.ctx, raw, {
        ...reviewed,
        mode: "LEGACY_RECOVERY",
      }),
    ).toEqual({ testRunId: h.id });
    expect(h.create).not.toHaveBeenCalled();
    expect(JSON.stringify(raw)).toBe(before);
    expect(h.log).not.toContain("profile");
  });
  it("legacy recovery-only with no exact receipt cannot create or substitute newer cohort/profile", async () => {
    const h = fixture();
    await expect(
      startManualRun(h.ctx, raw, { ...reviewed, mode: "LEGACY_RECOVERY" }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.create).not.toHaveBeenCalled();
    expect(h.log).not.toContain("graph-lock");
    expect(h.log).not.toContain("profile");
  });
  it("P2002 recovery repeats the original native authorization before reading exact receipt", async () => {
    const h = fixture(scoped);
    h.create.mockImplementationOnce(async () => {
      h.accepted();
      throw new Prisma.PrismaClientKnownRequestError("Synthetic duplicate", {
        code: "P2002",
        clientVersion: "synthetic",
      });
    });
    expect(await startManualRun(h.ctx, scoped, reviewed)).toMatchObject({
      testRunId: h.id,
    });
    expect(h.transaction).toHaveBeenCalledTimes(3);
    expect(h.log.filter((entry) => entry === "user")).toHaveLength(3);
    expect(h.create).toHaveBeenCalledOnce();
  });
  it("P2002 retry cannot recover after native actor mapping is lost", async () => {
    const h = fixture(scoped);
    h.create.mockImplementationOnce(async () => {
      h.accepted();
      h.state.userClerk = "different-human";
      throw new Prisma.PrismaClientKnownRequestError("Synthetic duplicate", {
        code: "P2002",
        clientVersion: "synthetic",
      });
    });
    await expect(startManualRun(h.ctx, scoped, reviewed)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    expect(h.transaction).toHaveBeenCalledTimes(3);
    expect(h.receipt).not.toHaveBeenCalled();
    expect(h.log.filter(entry => entry === "receipt-size")).toHaveLength(2);
    expect(h.log).not.toContain("receipt-scalars");
  });
  it("P2034/unknown errors remain original and are not retried by extraction", async () => {
    const h = fixture(scoped),
      error = new Prisma.PrismaClientKnownRequestError("Synthetic rollback", {
        code: "P2034",
        clientVersion: "synthetic",
      });
    h.create.mockRejectedValue(error);
    await expect(startManualRun(h.ctx, scoped, reviewed)).rejects.toBe(error);
    expect(h.transaction).toHaveBeenCalledTimes(2);
  });
  it("plan-reference case order/context/template hash are preserved rather than sorted into a different request", async () => {
    const context = runConfigurationSchema.parse({ build: "plan build" }),
      configurationId = "00000000-0000-4000-8000-000000000002";
    const template = {
      version: 1,
      testCaseIds: ["two", "one"],
      configurations: [
        { id: configurationId, name: " Native configuration ", context },
      ],
    };
    const request = {
      ...raw,
      expectedProfileHash: qualityProfileHash({}),
      executionContext: context,
      planReference: {
        testPlanId: "plan",
        expectedTemplateHash: qualityProfileHash(template),
        configurationId,
      },
    };
    const h = fixture(request);
    h.tx.testPlan.findUnique.mockResolvedValue({
      id: "plan",
      projectId: "project",
      name: "Native plan",
      status: "DRAFT",
      executionTemplate: template,
    } as never);
    await startManualRun(h.ctx, request);
    expect(h.create.mock.calls[0]![0].data.executionContext).toMatchObject({
      startRequestHash: hash(request),
      plan: {
        testPlanId: "plan",
        templateHash: qualityProfileHash(template),
        configurationId,
      },
    });
    expect(hash(request)).not.toBe(
      hash({ ...request, testCaseIds: ["one", "two"] }),
    );
    h.accepted();
    await expect(
      startManualRun(h.ctx, { ...request, testCaseIds: ["one", "two"] }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("native authorization is repeated before second-transaction replay, not only before first receipt search", async () => {
    const h = fixture(scoped),
      ordinary = h.transaction.getMockImplementation()!;
    h.transaction.mockImplementationOnce(async (...args) => {
      const result = await ordinary(...args);
      h.state.userClerk = "remapped";
      return result;
    });
    await expect(startManualRun(h.ctx, scoped, reviewed)).rejects.toMatchObject(
      { code: "FORBIDDEN" },
    );
    expect(h.transaction).toHaveBeenCalledTimes(2);
    expect(h.receipt).not.toHaveBeenCalled();
    expect(h.log.filter(entry => entry === "receipt-size")).toHaveLength(1);
    expect(h.log).not.toContain("receipt-scalars");
    expect(h.log).not.toContain("profile");
    expect(h.create).not.toHaveBeenCalled();
  });
  it("P2002 structural imitation is UNKNOWN/original, not adopted as proof of native rollback or recovery", async () => {
    const h = fixture(scoped),
      cause = { code: "P2002", message: "synthetic structural imitation" };
    h.create.mockRejectedValue(cause);
    await expect(startManualRun(h.ctx, scoped, reviewed)).rejects.toBe(cause);
    expect(h.transaction).toHaveBeenCalledTimes(2);
    expect(h.receipt).not.toHaveBeenCalled();
    expect(h.log.filter(entry => entry === "receipt-size")).toHaveLength(2);
    expect(h.log).not.toContain("receipt-scalars");
  });
  it.each(["archived-or-missing", "review", "dataset", "cycle", "profile"])(
    "original %s refusal remains before create with no partial run",
    async (reason) => {
      const h = fixture(scoped);
      if (reason === "archived-or-missing") h.cases.pop();
      if (reason === "review") h.cases[0]!.reviewStatus = "PENDING_REVIEW";
      if (reason === "dataset")
        h.cases[0]!.dataset = { id: "dataset" } as never;
      if (reason === "cycle")
        h.state.links = [
          { dependentId: "one", prerequisiteId: "two" },
          { dependentId: "two", prerequisiteId: "one" },
        ];
      if (reason === "profile") h.state.profile = null;
      await expect(startManualRun(h.ctx, scoped)).rejects.toMatchObject({
        code: reason === "cycle" ? "CONFLICT" : "BAD_REQUEST",
      });
      expect(h.create).not.toHaveBeenCalled();
    },
  );
  it("reviewed authorization shape is separate and strict, never merged into a retained inner body", async () => {
    const h = fixture(scoped),
      original = JSON.stringify(scoped);
    await expect(
      startManualRun(h.ctx, scoped, {
        ...reviewed,
        authenticatedClerkSubject: "",
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.transaction).not.toHaveBeenCalled();
    expect(JSON.stringify(scoped)).toBe(original);
    expect(
      manualRunStartLegacyInputSchema.parse({
        ...scoped,
        readRequestId: uuid,
        expectedNativeActorId: "other",
      }),
    ).toEqual(manualRunStartLegacyInputSchema.parse(scoped));
  });
});
