import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { architectureRouter } from "./architecture.js";
import { architectureAnalysisScope } from "../services/architectureAnalysisScope.js";
import { currentApprovedAnalysisSpend } from "../services/approvedAnalysisSpend.js";
import { InsufficientAiCreditsError } from "../services/aiCredits.js";

const mocks = vi.hoisted(() => ({
  model: vi.fn(),
  debit: vi.fn(),
  meter: vi.fn(),
  fields: vi.fn(),
  version: vi.fn(),
}));
vi.mock("@vaettir/ai-agent", async (original) => ({
  ...(await original<object>()),
  reviewArchitecture: mocks.model,
}));
vi.mock("../services/caseFields.js", () => ({
  assertCaseFieldAuthoring: mocks.fields,
  lockCaseFieldProject: vi.fn(),
}));
vi.mock("../services/testCaseVersion.js", () => ({
  snapshotTestCaseVersion: mocks.version,
}));
vi.mock("../services/aiCredits.js", async (original) => ({
  ...(await original<object>()),
  chargeAiCredits: mocks.debit,
  meterAiCall: mocks.meter,
  getAiCreditBalance: async () => 100,
}));

const input = {
  projectId: "project",
  organizationId: "org",
  fileName: "payment.puml",
  content:
    "@startuml\ncomponent API\ndatabase Ledger\nAPI --> Ledger : reserve funds\n@enduml",
};
const definition = {
  id: "case",
  displayId: "PAY-1",
  title: "Reserve funds",
  background: null,
  given: [],
  when: [],
  then: [],
  verificationProfile: {},
  sharedSteps: null,
  steps: [
    {
      action: "Reserve funds",
      expectedActionOrData: null,
      expectedResult: "One reservation is persisted",
      expectedResponse: null,
    },
  ],
};
type Row = {
  id: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  [key: string]: unknown;
};
function fixture(role = "EDITOR") {
  const rows: Row[] = [],
    cases = [{ ...definition, sharedStepGroup: null }];
  let user: unknown = {
    id: "actor",
    clerkUserId: "clerk",
    memberships: [{ organizationId: "org", role, seatType: "FULL" }],
  };
  const state = { balance: 100, createdCases: [] as unknown[], revoked: false };
  const whereMatches = (r: Row, w: Record<string, unknown>): boolean =>
    Object.entries(w).every(([k, v]) =>
      k === "NOT"
        ? !whereMatches(r, v as Record<string, unknown>)
        : k === "createdAt"
          ? true
          : r[k] === v,
    );
  const db = {
    user: { findUnique: vi.fn(async () => user) },
    project: {
      findUnique: vi.fn(async () => ({ id: "project", organizationId: "org" })),
    },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    testCase: {
      findMany: vi.fn(async () => cases),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        state.createdCases.push(data);
        return {
          ...data,
          id: "created",
          displayId: "PAY-2",
          priority: "MEDIUM",
        };
      }),
      findFirst: vi.fn(async () =>
        state.createdCases.length
          ? { id: "created", displayId: "PAY-2" }
          : null,
      ),
    },
    auditLog: {
      findMany: vi.fn(async ({ where }: { where: Record<string, unknown> }) =>
        rows.filter((r) => whereMatches(r, where)),
      ),
      findUnique: vi.fn(
        async ({ where }: { where: { id: string } }) =>
          rows.find((r) => r.id === where.id) ?? null,
      ),
      findFirst: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.find((r) => whereMatches(r, where)) ?? null,
      ),
      count: vi.fn(
        async ({ where }: { where: Record<string, unknown> }) =>
          rows.filter((r) => whereMatches(r, where)).length,
      ),
      create: vi.fn(async ({ data }: { data: Row }) => {
        rows.push(data);
        return data;
      }),
    },
    $queryRaw: vi.fn(async (strings: TemplateStringsArray) =>
      strings.join("").includes('"Membership"')
        ? state.revoked
          ? []
          : [{ role, seatType: "FULL" }]
        : strings.join("").includes('"Project"')
          ? [{ organizationId: "org" }]
          : [{ suspendedAt: null }],
    ),
  };
  const prisma = {
    ...db,
    $transaction: async <T>(work: (tx: typeof db) => Promise<T>) => {
      const before = [...rows],
        balance = state.balance;
      try {
        return await work(db);
      } catch (e) {
        rows.splice(0, rows.length, ...before);
        state.balance = balance;
        throw e;
      }
    },
  };
  mocks.debit.mockImplementation(async (tx: typeof db) => {
    const scope = currentApprovedAnalysisSpend()!;
    expect(scope.maximumCredits).toBe(12);
    await scope.validate(tx as never, "CHARGE");
    if (state.balance < 12)
      throw new InsufficientAiCreditsError(
        "reviewTestDesign",
        12,
        state.balance,
      );
    state.balance -= 12;
    await scope.recordCharge(tx as never, "charge", 12);
    return { transactionId: "charge" };
  });
  const caller = architectureRouter.createCaller({
    user,
    prisma,
    authenticatedClerkSubject: "clerk",
  } as unknown as Context);
  const review = architectureAnalysisScope(
    input.projectId,
    input.fileName,
    input.content,
    [definition],
  );
  const batch = {
    ...input,
    expectedScopeHash: review.scopeHash,
    approvedMaximumCredits: 24,
    approveAiProcessing: true as const,
    batchIndex: 0,
  };
  return {
    caller,
    db,
    rows,
    cases,
    state,
    review,
    batch,
    revokeUser: () => {
      user = null;
    },
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.model.mockImplementation(
    async (_elements, cases: Array<{ id: string }>) => ({
      mappings: cases.map((c) => ({
        caseId: c.id,
        unmappedReason: "No defensible diagram interaction",
        matches: [],
      })),
      suggestions: [],
    }),
  );
  mocks.meter.mockImplementation(async (_db, _charge, work) => work());
  mocks.fields.mockResolvedValue({});
  mocks.version.mockResolvedValue(undefined);
});
describe("Vaettir-native architecture workflow (no Atlassian dependency)", () => {
  it("inspects the complete inventory without provider calls, credit debit or record writes", async () => {
    const f = fixture();
    const p = await f.caller.preview(input);
    expect(p).toMatchObject({
      projectId: "project",
      organizationId: "org",
      actorClerkUserId: "clerk",
      maximumCredits: 24,
      batchCount: 2,
      results: [],
    });
    expect(p.cases).toEqual([
      { id: "case", displayId: "PAY-1", title: "Reserve funds" },
    ]);
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.debit).not.toHaveBeenCalled();
    expect(f.rows).toEqual([]);
  });
  it("rejects wrong workspace, viewers, revoked actors and stale approvals before paid work", async () => {
    const f = fixture();
    await expect(
      f.caller.preview({ ...input, organizationId: "other" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const viewer = fixture("VIEWER");
    await expect(
      viewer.caller.analyzeBatch(viewer.batch),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.revokeUser();
    await expect(f.caller.preview(input)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
    const stale = fixture();
    stale.cases[0]!.title = "Changed";
    await expect(stale.caller.analyzeBatch(stale.batch)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.debit).not.toHaveBeenCalled();
  });
  it("atomically rolls back attempt reservation on balance refusal and allows a funded retry", async () => {
    const f = fixture();
    f.state.balance = 0;
    await expect(f.caller.analyzeBatch(f.batch)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    expect(f.rows).toEqual([]);
    expect(mocks.model).not.toHaveBeenCalled();
    f.state.balance = 100;
    await f.caller.analyzeBatch(f.batch);
    expect(f.state.balance).toBe(88);
    expect(
      f.rows.filter((r) => r.entityType === "ArchitectureReviewResult"),
    ).toHaveLength(1);
    await f.caller.analyzeBatch(f.batch);
    expect(f.state.balance).toBe(88);
    expect(mocks.model).toHaveBeenCalledTimes(1);
  });
  it("refuses a premature gap batch without reserving or charging it", async () => {
    const f = fixture();
    await expect(
      f.caller.analyzeBatch({ ...f.batch, batchIndex: 1 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.rows).toEqual([]);
    expect(mocks.debit).not.toHaveBeenCalled();
  });
  it("recovers a completed gap result without another debit or inference", async () => {
    const f = fixture();
    await f.caller.analyzeBatch(f.batch);
    await f.caller.analyzeBatch({ ...f.batch, batchIndex: 1 });
    await f.caller.analyzeBatch({ ...f.batch, batchIndex: 1 });
    expect(mocks.model).toHaveBeenCalledTimes(2);
    expect(f.state.balance).toBe(76);
  });
  it("retains an unconfirmed provider failure and does not automatically repeat it", async () => {
    const f = fixture();
    mocks.model.mockRejectedValue(new Error("timeout"));
    await expect(f.caller.analyzeBatch(f.batch)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
    });
    await expect(f.caller.analyzeBatch(f.batch)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(mocks.model).toHaveBeenCalledTimes(1);
    expect(f.state.balance).toBe(88);
  });
  it("will not publish results against edited cases or newly revoked access", async () => {
    const f = fixture();
    mocks.model.mockImplementation(async () => {
      f.cases[0]!.title = "Edited during provider call";
      return { mappings: [], suggestions: [] };
    });
    await expect(f.caller.analyzeBatch(f.batch)).rejects.toMatchObject({
      code: "CONFLICT",
    });
    expect(
      f.rows.some((r) => r.entityType === "ArchitectureReviewResult"),
    ).toBe(false);
    const revoked = fixture();
    mocks.model.mockImplementation(async () => {
      revoked.state.revoked = true;
      return { mappings: [], suggestions: [] };
    });
    await expect(
      revoked.caller.analyzeBatch(revoked.batch),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(
      revoked.rows.some((r) => r.entityType === "ArchitectureReviewResult"),
    ).toBe(false);
  });
  it("records reviewed traceability only and replays JSONB-reordered receipts safely", async () => {
    const f = fixture(),
      value = {
        ...input,
        expectedScopeHash: f.review.scopeHash,
        caseId: "case",
        elementId: f.review.document.elements[0]!.id,
        decision: "CONFIRMED" as const,
        requestId: "10000000-0000-4000-8000-000000000001",
      };
    await f.caller.decide(value);
    const receipt = f.rows.find(row => row.entityType === "ArchitectureMappingDecision")!;
    receipt.metadata = Object.fromEntries(
      Object.entries(receipt.metadata).reverse(),
    );
    await f.caller.decide(value);
    expect(f.rows.filter(row => row.entityType === "ArchitectureMappingDecision")).toHaveLength(1);
    expect(f.rows.filter(row => row.entityType === "ArchitectureDocument")).toHaveLength(1);
    expect(f.rows.find(row => row.entityType === "ArchitectureDocument")!.metadata.content).toBe(input.content);
    await expect(
      f.caller.decide({ ...value, decision: "REJECTED" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.testCase.create).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled();
    expect(mocks.debit).not.toHaveBeenCalled();
  });
  it("orders later review decisions by a locked revision, not colliding timestamps or random receipt IDs", async () => {
    const f = fixture();
    const value = {
      ...input,
      expectedScopeHash: f.review.scopeHash,
      caseId: "case",
      elementId: f.review.document.elements[0]!.id,
      decision: "CONFIRMED" as const,
      requestId: "10000000-0000-4000-8000-000000000011",
    };
    await f.caller.decide(value);
    await f.caller.decide({
      ...value,
      decision: "REJECTED",
      requestId: "10000000-0000-4000-8000-000000000012",
    });
    expect(f.rows.filter(r => r.entityType === "ArchitectureMappingDecision").map((r) => r.metadata.revision)).toEqual([1, 2]);
    expect((await f.caller.preview(input)).decisions).toMatchObject([
      { decision: "REJECTED", revision: 2 },
    ]);
  });
  it("keeps reviewed links when another case changes, but withholds links for the edited case", async () => {
    const f = fixture(),
      value = {
        ...input,
        expectedScopeHash: f.review.scopeHash,
        caseId: "case",
        elementId: f.review.document.elements[0]!.id,
        decision: "CONFIRMED" as const,
        requestId: "10000000-0000-4000-8000-000000000002",
      };
    await f.caller.decide(value);
    f.cases.push({ ...definition, id: "new-case", sharedStepGroup: null });
    expect((await f.caller.preview(input)).decisions).toHaveLength(1);
    f.cases[0]!.steps = [
      { ...definition.steps[0]!, action: "Different behavior" },
    ];
    expect((await f.caller.preview(input)).decisions).toEqual([]);
    expect(f.rows.filter(r => r.entityType === "ArchitectureMappingDecision")).toHaveLength(1);
  });
  it("saves only an explicit reviewed draft with original AI evidence and a non-Gherkin procedure", async () => {
    const f = fixture();
    const draft = {
      title: "Original AI proposal",
      preconditions: ["Funds available"],
      actions: ["Reserve funds"],
      expectedResults: ["One reservation"],
      elementIds: [f.review.document.elements[0]!.id],
      diagramEvidence: ["component API"],
      assumptions: ["Reservation uniqueness needs confirmation"],
      confidence: "MEDIUM",
    };
    mocks.model.mockImplementation(async (_elements, cases: unknown[]) =>
      cases.length
        ? {
            mappings: [
              { caseId: "case", unmappedReason: "Not mapped", matches: [] },
            ],
            suggestions: [],
          }
        : { mappings: [], suggestions: [draft] },
    );
    await f.caller.analyzeBatch(f.batch);
    await f.caller.analyzeBatch({ ...f.batch, batchIndex: 1 });
    const create = {
      ...input,
      resultScopeHash: f.review.scopeHash,
      batchIndex: 1,
      draftIndex: 0,
      requestId: "10000000-0000-4000-8000-000000000003",
      reviewedAssumptions: true as const,
      title: "Human revised title",
      preconditions: ["Known balance"],
      actions: ["Reserve funds", "Read ledger"],
      expectedResults: ["Exactly one entry"],
      testType: "CONTRACT" as const,
    };
    await expect(
      f.caller.createDraft({ ...create, draftIndex: 5 }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.db.testCase.create).not.toHaveBeenCalled();
    expect(await f.caller.createDraft(create)).toEqual({
      id: "created",
      displayId: "PAY-2",
    });
    expect(f.state.createdCases[0]).toMatchObject({
      title: "Human revised title",
      given: [],
      when: [],
      then: [],
      testType: "CONTRACT",
      reviewStatus: "PENDING_REVIEW",
      origin: "AI_REVERSE_ENGINEERED",
      aiSnapshot: { title: "Original AI proposal", original: draft },
      steps: {
        create: [
          { order: 0, action: "Reserve funds", expectedResult: null },
          {
            order: 1,
            action: "Read ledger",
            expectedResult: "Exactly one entry",
          },
        ],
      },
    });
    await f.caller.createDraft(create);
    expect(f.db.testCase.create).toHaveBeenCalledTimes(1);
    await expect(
      f.caller.createDraft({ ...create, title: "Different retry" }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.version).toHaveBeenCalledTimes(1);
  });
});
