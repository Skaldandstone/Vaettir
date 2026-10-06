import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import {
  previewPlanGovernance,
  editGovernedCriterionDescription,
  setGovernedCriterionVerdict,
  setLegacyCriterionVerdict,
  attachGovernedUnassignedPlan,
  listPlanGovernanceHistory,
} from "./testPlanGovernance.js";
import {
  MAX_GOVERNANCE_SNAPSHOT_BYTES,
  MAX_GOVERNANCE_RECEIPT_BYTES,
  MAX_GOVERNANCE_HISTORY_REVISIONS,
} from "./testPlanGovernanceSchema.js";
import {
  governanceRequestHash,
  validatedGovernanceReceipt,
  boundedGovernanceSnapshot,
} from "./testPlanGovernanceRevision.js";

function fixture() {
  let state = {
    role: "EDITOR",
    seatType: "FULL",
    suspendedAt: null as Date | null,
    clerkActorId: "clerk",
    nativePlanBytes: 1000n,
    nativeAuditBytes: null as number | null,
    historyCount: null as number | null,
    hasPlanCases: false,
    plan: {
      id: "plan",
      projectId: "project",
      testPlanTypeId: "regression",
      releaseId: null as string | null,
      strategyId: "strategy",
      name: "Synthetic plan",
      description: "Retained plan prose",
      status: "DRAFT",
      customFields: { unknown: ["preserve"] },
      executionTemplate: { opaque: "retained" },
      createdById: "creator",
      updatedById: "creator",
      createdAt: new Date("2026-10-05T10:00:00Z"),
      updatedAt: new Date("2026-10-05T10:00:00Z"),
    },
    criteria: [
      {
        id: "criterion",
        testPlanId: "plan",
        requirementId: "requirement",
        description: "Original requirement",
        status: "AT_RISK",
        createdAt: new Date("2026-10-05T10:00:00Z"),
      },
    ],
    versions: [{ id: "version-1", versionNumber: 1 }],
    audits: new Map<string, { id: string; metadata: unknown }>(),
    release: { id: "release", projectId: "project", status: "PLANNING" },
  };
  const calls: string[] = [];
  const raw = vi.fn(async (query: unknown, ...values: unknown[]) => {
    const text = Array.isArray(query)
      ? query.join("?")
      : String((query as { sql?: string }).sql ?? query);
    calls.push(text);
    if (text.includes('FROM "User"'))
      return [{ clerkUserId: state.clerkActorId }];
    if (text.includes('FROM "Organization"'))
      return [{ id: "org", suspendedAt: state.suspendedAt }];
    if (text.includes('FROM "Membership"'))
      return [{ id: "member", role: state.role, seatType: state.seatType }];
    if (text.includes('FROM "Project"')) return [{ organizationId: "org" }];
    if (text.includes('FROM "TestPlan"') && text.includes("FOR "))
      return values[0] === state.plan.id && values[1] === state.plan.projectId
        ? [{ id: state.plan.id }]
        : [];
    if (text.includes('FROM "Release"'))
      return values[0] === state.release.id &&
        values[1] === state.release.projectId
        ? [state.release]
        : [];
    if (text.includes('FROM "TestPlan" p'))
      return [
        { bytes: state.nativePlanBytes, criteria: state.criteria.length },
      ];
    if (text.includes('FROM "AcceptanceCriterion"'))
      return state.criteria.map((c) => ({ id: c.id }));
    if (text.includes('FROM "TestCase"'))
      return state.hasPlanCases ? [{ id: "case" }] : [];
    if (text.includes("SELECT id,octet_length(metadata")) {
      const row = state.audits.get(values[0] as string);
      return row
        ? [
            {
              id: row.id,
              bytes: Buffer.byteLength(JSON.stringify(row.metadata)),
            },
          ]
        : [];
    }
    if (text.includes("SELECT count(*)::int AS count"))
      return [
        {
          count: state.historyCount ?? state.audits.size,
          bytes: BigInt(
            [...state.audits.values()].reduce(
              (sum, row) =>
                sum + Buffer.byteLength(JSON.stringify(row.metadata)),
              0,
            ),
          ),
        },
      ];
    if (text.includes("coalesce(max(octet_length"))
      return [{ bytes: 1000n, largest: state.nativeAuditBytes ?? 1000 }];
    if (text.includes("SELECT octet_length(metadata")) {
      const row = state.audits.get(values[0] as string);
      return row
        ? [
            {
              bytes:
                state.nativeAuditBytes ??
                Buffer.byteLength(JSON.stringify(row.metadata)),
            },
          ]
        : [];
    }
    return [];
  });
  const tx = {
    $queryRaw: raw,
    $executeRaw: vi.fn(async () => 0),
    project: {
      findUnique: vi.fn(async () => ({
        organizationId: "org",
        organization: { suspendedAt: state.suspendedAt },
      })),
      findUniqueOrThrow: vi.fn(async () => ({ organizationId: "org" })),
    },
    membership: {
      findUnique: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
      findUniqueOrThrow: vi.fn(async () => ({
        role: state.role,
        seatType: state.seatType,
      })),
    },
    testPlan: {
      findFirstOrThrow: vi.fn(async () =>
        structuredClone({
          ...state.plan,
          acceptanceCriteria: state.criteria,
          versions: state.versions.slice(-1).map((version) => ({
            id: version.id,
            versionNumber: version.versionNumber,
          })),
        }),
      ),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        Object.assign(state.plan, data);
        state.plan.updatedAt = new Date(state.plan.updatedAt.getTime() + 1);
        return structuredClone(state.plan);
      }),
      updateMany: vi.fn(async () => {
        if (state.plan.releaseId !== null) return { count: 0 };
        state.plan.releaseId = "release";
        return { count: 1 };
      }),
    },
    acceptanceCriterion: {
      update: vi.fn(
        async ({
          data,
        }: {
          data: { description?: string; status?: string };
        }) => {
          Object.assign(state.criteria[0]!, data);
          return state.criteria[0];
        },
      ),
    },
    testPlanVersion: {
      findFirst: vi.fn(async () => state.versions.at(-1)),
      create: vi.fn(async ({ data }: { data: { versionNumber: number } }) => {
        const version = { ...data, id: `version-${data.versionNumber}` };
        state.versions.push(version);
        return version;
      }),
    },
    auditLog: {
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) =>
        state.audits.get(where.id),
      ),
      findMany: vi.fn(async () =>
        [...state.audits.values()].map((row) => ({
          ...row,
          createdAt: new Date("2026-10-05T10:00:01Z"),
        })),
      ),
      create: vi.fn(
        async ({ data }: { data: { id: string; metadata: unknown } }) => {
          state.audits.set(data.id, structuredClone(data));
          return data;
        },
      ),
    },
  };
  const db = {
    $transaction: async (callback: (tx: unknown) => Promise<unknown>) => {
      const saved = structuredClone(state);
      try {
        return await callback(tx);
      } catch (cause) {
        state = saved;
        throw cause;
      }
    },
  } as unknown as PrismaClient;
  const scope = {
    projectId: "project",
    testPlanId: "plan",
    originalOrganizationId: "org",
    expectedClerkActorId: "clerk",
  };
  const preview = () =>
    previewPlanGovernance(db, "actor", scope, { clerkActorId: "clerk" });
  const edit = async () => {
    const baseline = await preview();
    return {
      ...scope,
      requestId: "fd14eb16-af5d-4cb8-914b-c5412b5f6181",
      expectedPlanRevision: baseline.planRevision,
      reason: "Clarify synthetic wording",
      confirmed: true as const,
      criterionId: "criterion",
      expectedCriterionRevision: baseline.criterionRevisions.criterion!,
      description: "Reviewed requirement",
    };
  };
  return { db, tx, scope, calls, preview, edit, state: () => state };
}
describe("dedicated bounded plan governance (mocked transactions, not native acceptance)", () => {
  async function verdict(f: ReturnType<typeof fixture>) {
    const { description: _description, ...input } = await f.edit();
    return { ...input, status: "MET" as const };
  }
  it("verdict-only mutation preserves exact raw wording/requirement and all unrelated native plan fields", async () => {
    const f = fixture(),
      input = await verdict(f);
    const ack = await setGovernedCriterionVerdict(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
      where: { id: "criterion" },
      data: { status: "MET" },
    });
    expect(f.state().criteria[0]).toMatchObject({
      description: "Original requirement",
      requirementId: "requirement",
      status: "MET",
    });
    const saved = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    expect(saved.ack.operation).toBe("SET_CRITERION_VERDICT");
    expect(saved.before.criteria[0]!.status).toBe("AT_RISK");
    expect(saved.after.criteria[0]!.status).toBe("MET");
    expect(ack.versionNumber).toBe(2);
  });
  it("exact verdict replay precedes newer approval/case-evidence/CAS state and never records a second decision", async () => {
    const f = fixture(),
      input = await verdict(f),
      first = await setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
    f.state().plan.status = "APPROVED";
    f.state().hasPlanCases = true;
    expect(
      await setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...first, replayed: true });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledTimes(1);
    await expect(
      setGovernedCriterionVerdict(
        f.db,
        "actor",
        { ...input, status: "NOT_MET" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("refuses verdict updates after raw wording or native status changes", async () => {
    for (const changed of [
      { description: "New governed wording" },
      { status: "NOT_MET" },
      { requirementId: "new-requirement" },
    ]) {
      const f = fixture(),
        input = await verdict(f);
      Object.assign(f.state().criteria[0]!, changed);
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
    }
  });
  it("rechecks current actor/role/seat/suspension before verdict receipt replay", async () => {
    for (const changed of [
      { role: "VIEWER" },
      { seatType: "READ_ONLY" },
      { suspendedAt: new Date() },
      { clerkActorId: "other" },
    ]) {
      const f = fixture(),
        input = await verdict(f);
      await setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
      Object.assign(f.state(), changed);
      f.calls.length = 0;
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.calls.some((call) => call.includes('FROM "AuditLog"'))).toBe(
        false,
      );
    }
  });
  it("does not substitute manual verdicts for effective computed case evidence", async () => {
    const f = fixture(),
      input = await verdict(f);
    f.state().hasPlanCases = true;
    expect(await f.preview()).toMatchObject({ manualVerdicts: false });
    await expect(
      setGovernedCriterionVerdict(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().criteria[0]!.status).toBe("AT_RISK");
    expect(f.state().audits.size).toBe(0);
  });
  it("verdict receipts cannot change wording even when a forged after-hash is recomputed", async () => {
    const f = fixture(),
      input = await verdict(f);
    await setGovernedCriterionVerdict(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const saved = validatedGovernanceReceipt(
      [...f.state().audits.values()][0]!.metadata,
    );
    saved.after.criteria[0]!.description = "Silently overwritten";
    saved.ack.afterRevision = governanceRequestHash(saved.after);
    expect(() => validatedGovernanceReceipt(saved)).toThrow(
      "complete scoped snapshot",
    );
  });
  it("legacy status alias never writes supplied wording or requirement and refuses stale/intentional text changes", async () => {
    const f = fixture(),
      input = {
        projectId: "project",
        testPlanId: "plan",
        id: "criterion",
        description: "Original requirement",
        status: "MET" as const,
        requirementId: "requirement",
      };
    await setLegacyCriterionVerdict(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
      where: { id: "criterion" },
      data: { status: "MET" },
    });
    expect(f.state().audits.size).toBe(0); // No UUID/history guarantee was invented for legacy input.
    for (const changed of [
      { description: "Old/intentional text edit" },
      { requirementId: null },
    ])
      await expect(
        setLegacyCriterionVerdict(
          f.db,
          "actor",
          { ...input, ...changed },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().criteria[0]!.description).toBe("Original requirement");
  });
  it("legacy alias shares current role/actor and reopened-state guards", async () => {
    for (const changed of [
      { role: "VIEWER" },
      { clerkActorId: "other" },
      { suspendedAt: new Date() },
      { seatType: "READ_ONLY" },
      { hasPlanCases: true },
    ]) {
      const f = fixture();
      Object.assign(f.state(), changed);
      await expect(
        setLegacyCriterionVerdict(
          f.db,
          "actor",
          {
            projectId: "project",
            testPlanId: "plan",
            id: "criterion",
            description: "Original requirement",
            status: "MET",
          },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toBeDefined();
      expect(f.tx.acceptanceCriterion.update).not.toHaveBeenCalled();
    }
  });
  it("new verdict decisions explicitly refuse reviewed or frozen planning states", async () => {
    for (const status of ["APPROVED", "ARCHIVED"]) {
      const f = fixture();
      f.state().plan.status = status;
      const input = await verdict(f);
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().criteria[0]!.status).toBe("AT_RISK");
    }
    for (const status of ["READY", "SHIPPED"]) {
      const f = fixture();
      f.state().plan.releaseId = "release";
      f.state().release.status = status;
      const input = await verdict(f);
      await expect(
        setGovernedCriterionVerdict(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().criteria[0]!.status).toBe("AT_RISK");
    }
  });
  it("description-only edit preserves raw status/requirement/plan JSON and captures complete linked version snapshots", async () => {
    const f = fixture(),
      input = await f.edit();
    const ack = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(f.state().criteria[0]).toMatchObject({
      description: "Reviewed requirement",
      status: "AT_RISK",
      requirementId: "requirement",
    });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledWith({
      where: { id: "criterion" },
      data: { description: "Reviewed requirement" },
    });
    const receipt = [...f.state().audits.values()][0]!.metadata;
    expect(validatedGovernanceReceipt(receipt)).toMatchObject({
      before: { criteria: [{ description: "Original requirement" }] },
      after: {
        customFields: { unknown: ["preserve"] },
        strategyId: "strategy",
        criteria: [{ description: "Reviewed requirement" }],
      },
    });
    expect(ack.versionNumber).toBe(2);
  });
  it("replays before stale CAS without another write or snapshot and refuses changed UUID intent", async () => {
    const f = fixture(),
      input = await f.edit();
    const first = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const retry = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    expect(retry).toEqual({ ...first, replayed: true });
    expect(f.tx.acceptanceCriterion.update).toHaveBeenCalledTimes(1);
    expect(f.tx.testPlanVersion.create).toHaveBeenCalledTimes(1);
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...input, description: "Changed intent" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("checks current readonly/revoked/suspended/changed actors before any receipt body", async () => {
    for (const change of [
      { role: "VIEWER" },
      { seatType: "READ_ONLY" },
      { suspendedAt: new Date() },
      { clerkActorId: "other" },
    ]) {
      const f = fixture(),
        input = await f.edit();
      await editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      });
      f.calls.length = 0;
      Object.assign(f.state(), change);
      await expect(
        editGovernedCriterionDescription(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(f.calls.some((call) => call.includes('FROM "AuditLog"'))).toBe(
        false,
      );
    }
  });
  it("rejects wrong original organization, stale native criterion and stale assignment without partial writes", async () => {
    const f = fixture(),
      input = await f.edit();
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...input, originalOrganizationId: "foreign" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.state().criteria[0]!.status = "MET";
    await expect(
      editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    const baseline = await f.preview();
    f.state().plan.releaseId = "another";
    await expect(
      attachGovernedUnassignedPlan(
        f.db,
        "actor",
        {
          ...f.scope,
          expectedPlanRevision: baseline.planRevision,
          requestId: input.requestId,
          expectedReleaseId: null,
          releaseId: "release",
          reason: "Assign synthetic plan",
          confirmed: true,
        },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    expect(f.state().audits.size).toBe(0);
  });
  it("attaches only an unassigned same-project planning release and preserves its criteria", async () => {
    const f = fixture(),
      baseline = await f.preview(),
      input = await f.edit();
    const ack = await attachGovernedUnassignedPlan(
      f.db,
      "actor",
      {
        ...f.scope,
        expectedPlanRevision: baseline.planRevision,
        requestId: input.requestId,
        expectedReleaseId: null,
        releaseId: "release",
        reason: "Assign synthetic plan",
        confirmed: true,
      },
      { clerkActorId: "clerk" },
    );
    expect(ack.releaseId).toBe("release");
    expect(f.state().criteria[0]!.description).toBe("Original requirement");
    const g = fixture(),
      foreign = await g.edit();
    g.state().release.projectId = "foreign";
    await expect(
      attachGovernedUnassignedPlan(
        g.db,
        "actor",
        {
          ...g.scope,
          expectedPlanRevision: foreign.expectedPlanRevision,
          requestId: foreign.requestId,
          expectedReleaseId: null,
          releaseId: "release",
          reason: "Assign",
          confirmed: true,
        },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(g.state().plan.releaseId).toBeNull();
  });
  it("retains approved/archived plans and READY/SHIPPED release states without silently invalidating approval", async () => {
    for (const status of ["APPROVED", "ARCHIVED"]) {
      const f = fixture(),
        input = await f.edit();
      f.state().plan.status = status;
      await expect(
        editGovernedCriterionDescription(f.db, "actor", input, {
          clerkActorId: "clerk",
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().plan.status).toBe(status);
    }
    for (const status of ["READY", "SHIPPED"]) {
      const f = fixture(),
        input = await f.edit();
      f.state().release.status = status;
      await expect(
        attachGovernedUnassignedPlan(
          f.db,
          "actor",
          {
            ...f.scope,
            expectedPlanRevision: input.expectedPlanRevision,
            requestId: input.requestId,
            expectedReleaseId: null,
            releaseId: "release",
            reason: "Assign",
            confirmed: true,
          },
          { clerkActorId: "clerk" },
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      expect(f.state().plan.releaseId).toBeNull();
    }
  });
  it("bounds native payload before materialization and rolls back complete changes on native receipt expansion", async () => {
    const f = fixture(),
      input = await f.edit();
    f.state().nativePlanBytes = BigInt(MAX_GOVERNANCE_SNAPSHOT_BYTES + 1);
    const reads = f.tx.testPlan.findFirstOrThrow.mock.calls.length;
    await expect(
      editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.tx.testPlan.findFirstOrThrow.mock.calls).toHaveLength(reads);
    const g = fixture(),
      next = await g.edit();
    g.state().nativeAuditBytes = MAX_GOVERNANCE_RECEIPT_BYTES + 1;
    await expect(
      editGovernedCriterionDescription(g.db, "actor", next, {
        clerkActorId: "clerk",
      }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(g.state().criteria[0]!.description).toBe("Original requirement");
    expect(g.state().audits.size).toBe(0);
    expect(g.state().versions).toHaveLength(1);
  });
  it("a receipt cannot silently alter unrelated associations or raw verdicts", async () => {
    const f = fixture(),
      input = await f.edit();
    await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    const saved = validatedGovernanceReceipt(
      structuredClone([...f.state().audits.values()][0]!.metadata),
    );
    saved.after.criteria[0]!.status = "MET";
    saved.ack.afterRevision = governanceRequestHash(saved.after);
    expect(() => validatedGovernanceReceipt(saved)).toThrow(
      "complete scoped snapshot",
    );
  });
  it("conservatively bounds cumulative history while still acknowledging exact earlier writes", async () => {
    const f = fixture(),
      input = await f.edit();
    const ack = await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().historyCount = MAX_GOVERNANCE_HISTORY_REVISIONS;
    expect(
      await editGovernedCriterionDescription(f.db, "actor", input, {
        clerkActorId: "clerk",
      }),
    ).toEqual({ ...ack, replayed: true });
    const next = await f.edit();
    await expect(
      editGovernedCriterionDescription(
        f.db,
        "actor",
        { ...next, requestId: "6bd36763-03c7-4d73-81a1-4114a7332b1a" },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.state().versions).toHaveLength(2);
  });
  it("lets current viewers read complete scoped history but bounds metadata and refuses another original tenant", async () => {
    const f = fixture(),
      input = await f.edit();
    await editGovernedCriterionDescription(f.db, "actor", input, {
      clerkActorId: "clerk",
    });
    f.state().role = "VIEWER";
    f.state().seatType = "READ_ONLY";
    const history = await listPlanGovernanceHistory(
      f.db,
      "actor",
      { ...f.scope, take: 5 },
      { clerkActorId: "clerk" },
    );
    expect(history.entries[0]?.receipt.before.criteria[0]?.description).toBe(
      "Original requirement",
    );
    await expect(
      listPlanGovernanceHistory(
        f.db,
        "actor",
        { ...f.scope, originalOrganizationId: "foreign", take: 5 },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    f.state().nativeAuditBytes = MAX_GOVERNANCE_RECEIPT_BYTES + 1;
    await expect(
      listPlanGovernanceHistory(
        f.db,
        "actor",
        { ...f.scope, take: 5 },
        { clerkActorId: "clerk" },
      ),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("exposes explicit reopened-state instructions and refuses to truncate oversized unknown JSON", async () => {
    const f = fixture();
    f.state().plan.status = "APPROVED";
    expect(await f.preview()).toMatchObject({
      canEdit: false,
      editBlockedReason: expect.stringMatching(/Reopen/),
    });
    const current = (await f.preview()).snapshot;
    expect(() =>
      boundedGovernanceSnapshot({
        ...current,
        customFields: { preserved: "x".repeat(MAX_GOVERNANCE_SNAPSHOT_BYTES) },
      }),
    ).toThrow("No criteria");
    expect(() =>
      boundedGovernanceSnapshot({
        ...current,
        criteria: Array.from({ length: 201 }, () => current.criteria[0]),
      }),
    ).toThrow("No criteria");
  });
});
