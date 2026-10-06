import { describe, expect, it, vi } from "vitest";
import type { Context } from "../trpc.js";
import { testPlansRouter } from "./testPlans.js";
import { lockCaseFieldProject } from "../services/caseFields.js";
import { snapshotTestPlanVersion } from "../services/testPlanVersion.js";
import { recordAudit } from "../services/auditLog.js";
import { executionTemplateHash, testPlanExecutionTemplateSchema, type TestPlanExecutionTemplate } from "../services/testPlanExecution.js";
import type { Prisma } from "@vaettir/db";

// Explicit synthetic lock model. These tests invoke the actual router and
// helpers, but do not execute PostgreSQL or diagnose a prior native CI failure.
class ModeledLocks {
  private owners = new Map<string, string>();
  private waits = new Map<string, string>();
  private pending: Array<{ owner: string; resource: string; resolve: () => void }> = [];
  private notices = new Map<string, () => void>();
  readonly trace: string[] = [];
  waitFor(owner: string, resource: string) {
    return new Promise<void>(resolve => this.notices.set(`${owner}:${resource}`, resolve));
  }
  async acquire(owner: string, resource: string) {
    this.trace.push(`${owner}:request:${resource}`);
    const held = this.owners.get(resource);
    if (!held || held === owner) { this.owners.set(resource, owner); return; }
    this.waits.set(owner, held);
    let current: string | undefined = held;
    const seen = new Set<string>();
    while (current && !seen.has(current)) {
      if (current === owner) {
        this.waits.delete(owner);
        throw Object.assign(Error("Synthetic opposing lock graph only"), { code: "MODELED_LOCK_CYCLE" });
      }
      seen.add(current); current = this.waits.get(current);
    }
    this.notices.get(`${owner}:${resource}`)?.();
    await new Promise<void>(resolve => this.pending.push({ owner, resource, resolve }));
  }
  release(owner: string) {
    for (const [resource, held] of this.owners) if (held === owner) this.owners.delete(resource);
    this.waits.delete(owner);
    for (const waiter of [...this.pending]) if (!this.owners.has(waiter.resource)) {
      this.pending.splice(this.pending.indexOf(waiter), 1);
      this.waits.delete(waiter.owner); this.owners.set(waiter.resource, waiter.owner); waiter.resolve();
    }
  }
}
const template = (cases = ["case-a", "case-b"]): TestPlanExecutionTemplate => testPlanExecutionTemplateSchema.parse({
  version: 1, testCaseIds: cases,
  configurations: [{ id: "90be61dc-a314-4793-95e2-e3db8d56048a", name: "Synthetic configuration", context: { platform: "Synthetic" } }],
});
function fixture({ service = false, cachedSeat = "FULL" }: { service?: boolean; cachedSeat?: string } = {}) {
  const locks = new ModeledLocks();
  const state = {
    organizationId: "original-org", planProjectId: "project", role: "EDITOR", seatType: "FULL",
    suspendedAt: null as Date | null, membership: true, caseCount: 2, planStatus: "DRAFT",
    name: " Exact plan name ", description: " Exact\nplan description ",
    customFields: { objective: "Human content", future: { keep: [null, false, 0] } },
    executionTemplate: template(),
  };
  const versions: Array<Record<string, unknown>> = [{ versionNumber: 1 }];
  const audits: Array<Record<string, unknown>> = [];
  const transactionOptions: unknown[] = [];
  let beforeTransaction: (() => void) | undefined;
  let sequence = 0;
  const plan = () => ({ id: "plan", projectId: state.planProjectId, name: state.name, description: state.description,
    status: state.planStatus, customFields: state.customFields, executionTemplate: state.executionTemplate });
  const update = vi.fn(async ({ data }: { data: { executionTemplate: TestPlanExecutionTemplate; updatedById: string } }) => {
    state.executionTemplate = data.executionTemplate; return plan();
  });
  const versionCreate = vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
    const saved = { id: `version-${versions.length + 1}`, ...data }; versions.push(saved); return saved;
  });
  function transaction(owner: string) {
    const project = { findUnique: vi.fn(async () => ({ id: "project", organizationId: state.organizationId,
      organization: { suspendedAt: state.suspendedAt } })), findUniqueOrThrow: vi.fn(async () => ({ organizationId: state.organizationId })) };
    const tx = {
      project,
      membership: { findUnique: vi.fn(async () => state.membership ? { role: state.role, seatType: state.seatType } : null) },
      testPlan: { findUniqueOrThrow: vi.fn(async () => plan()), update },
      testCase: { count: vi.fn(async () => state.caseCount) },
      testPlanVersion: { findFirst: vi.fn(async () => ({ versionNumber: Math.max(...versions.map(row => Number(row.versionNumber))) })), create: versionCreate },
      auditLog: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        // MODELED FK parent-key check: Project UPDATE conflicts with this check.
        await locks.acquire(owner, "project"); audits.push(data); return data;
      }) },
      $queryRaw: vi.fn(async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        if (sql.includes("pg_advisory_xact_lock")) { await locks.acquire(owner, "advisory"); return []; }
        if (sql.includes('FROM "Project"') && sql.includes("FOR UPDATE")) {
          await locks.acquire(owner, "project"); return [{ organizationId: state.organizationId }];
        }
        if (sql.includes('FROM "TestPlan"') && sql.includes("FOR UPDATE")) {
          await locks.acquire(owner, "plan"); return [{ id: "plan" }];
        }
        if (sql.includes('FROM "Organization"') || sql.includes('FROM "Membership"')) return [{ id: "scope" }];
        throw Error("Unexpected synthetic lock query");
      }),
    };
    return tx;
  }
  const db = {
    project: { findUnique: vi.fn(async () => ({ id: "project", organizationId: "original-org" })) },
    organization: { findUnique: vi.fn(async () => ({ suspendedAt: null })) },
    testPlan: { findUnique: vi.fn(async () => ({ projectId: "project" })) },
    $transaction: vi.fn(async (callback: (tx: ReturnType<typeof transaction>) => Promise<unknown>, options: unknown) => {
      beforeTransaction?.(); transactionOptions.push(options);
      const owner = `save-${++sequence}`;
      try { return await callback(transaction(owner)); } finally { locks.release(owner); }
    }),
  };
  const ctx = { prisma: db, user: { id: "actor", email: "synthetic@example.com", clerkUserId: service ? null : "clerk",
    memberships: [{ organizationId: "original-org", role: "EDITOR", seatType: cachedSeat }] }, staff: null } as unknown as Context;
  const caller = testPlansRouter.createCaller(ctx);
  return { state, locks, versions, audits, transactionOptions, update, versionCreate, db, transaction,
    before: (callback: () => void) => { beforeTransaction = callback; },
    save: (next = template(["case-b", "case-a"]), expectedTemplateHash = executionTemplateHash(template())) => caller.saveExecutionTemplate({ id: "plan", expectedTemplateHash, template: next }),
  };
}

describe("configuration project-before-plan serialization (actual callback, synthetic lock model only)", () => {
  it("demonstrates the old opposing Plan→Project-FK / Project→Plan graph without claiming SQL execution", async () => {
    const model = new ModeledLocks();
    await model.acquire("old-save", "plan"); await model.acquire("governance", "project");
    const waiting = model.waitFor("governance", "plan"), governancePlan = model.acquire("governance", "plan");
    await waiting;
    await expect(model.acquire("old-save", "project")).rejects.toMatchObject({ code: "MODELED_LOCK_CYCLE" });
    model.release("old-save"); await governancePlan; model.release("governance");
  });
  it("waits before Plan, retains concurrently saved human fields, and snapshots sequential versions with actual helpers", async () => {
    const h = fixture(), governance = h.transaction("governance");
    await lockCaseFieldProject(governance as unknown as Prisma.TransactionClient, "actor", "project");
    const waiting = h.locks.waitFor("save-1", "advisory"), saving = h.save();
    await waiting;
    expect(h.locks.trace).not.toContain("save-1:request:plan");
    await governance.$queryRaw`SELECT id FROM "TestPlan" WHERE id=${"plan"} FOR UPDATE`;
    h.state.customFields = { ...h.state.customFields, objective: "Concurrent retained human edit" };
    await snapshotTestPlanVersion(governance as unknown as Prisma.TransactionClient, {
      testPlanId: "plan", name: h.state.name, description: h.state.description, status: "DRAFT",
      customFields: h.state.customFields, executionTemplate: h.state.executionTemplate, actorId: "actor",
    });
    await recordAudit(governance as unknown as Parameters<typeof recordAudit>[0], {
      organizationId: "original-org", projectId: "project", actorId: "actor", entityType: "TestPlan", entityId: "plan", action: "UPDATE", summary: "Synthetic governed critical section only",
    });
    h.locks.release("governance");
    const result = await saving;
    expect(result).toEqual({ template: template(["case-b", "case-a"]), templateHash: executionTemplateHash(template(["case-b", "case-a"])) });
    expect(h.versions.map(row => row.versionNumber)).toEqual([1, 2, 3]);
    expect(h.versions[2]).toMatchObject({ name: h.state.name, description: h.state.description, customFields: h.state.customFields, executionTemplate: result.template, createdById: "actor" });
    expect(h.audits[1]).toMatchObject({ organizationId: "original-org", projectId: "project", actorId: "actor", entityType: "TestPlan", entityId: "plan", action: "UPDATE" });
    expect(h.transactionOptions).toEqual([{ timeout: 20000 }]);
    const trace = h.locks.trace;
    expect(trace.indexOf("save-1:request:project")).toBeLessThan(trace.indexOf("save-1:request:plan"));
    await h.save(template(), result.templateHash);
    expect(h.versions.map(row => row.versionNumber)).toEqual([1, 2, 3, 4]);
  });
  it("serializes same-baseline saves with one ACK/version and an unchanged stale-template CAS refusal", async () => {
    const h = fixture();
    const results = await Promise.allSettled([h.save(), h.save(template(["case-a"]))]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "CONFLICT" } });
    expect(h.update).toHaveBeenCalledTimes(1); expect(h.versionCreate).toHaveBeenCalledTimes(1); expect(h.audits).toHaveLength(1);
    expect(h.versions.map(row => row.versionNumber)).toEqual([1, 2]);
    expect(h.transactionOptions).toEqual([{ timeout: 20000 }, { timeout: 20000 }]);
  });
  it("a same-hash no-op retains its ACK and makes no version/update/audit", async () => {
    const h = fixture();
    expect(await h.save(template())).toEqual({ template: template(), templateHash: executionTemplateHash(template()) });
    expect(h.update).not.toHaveBeenCalled(); expect(h.versionCreate).not.toHaveBeenCalled(); expect(h.audits).toEqual([]);
  });
  it.each(["moved-org", "moved-plan", "viewer", "read-only", "missing-member", "suspended", "archived", "missing-case"])(
    "current %s refusal happens before mutation/version/audit and is not automatically retried", async mode => {
      const h = fixture();
      h.before(() => {
        if (mode === "moved-org") h.state.organizationId = "different-org";
        if (mode === "moved-plan") h.state.planProjectId = "different-project";
        if (mode === "viewer") h.state.role = "VIEWER";
        if (mode === "read-only") h.state.seatType = "READ_ONLY";
        if (mode === "missing-member") h.state.membership = false;
        if (mode === "suspended") h.state.suspendedAt = new Date("2026-01-01T00:00:00Z");
        if (mode === "archived") h.state.planStatus = "ARCHIVED";
        if (mode === "missing-case") h.state.caseCount = 1;
      });
      await expect(h.save()).rejects.toMatchObject({ code: ["archived", "missing-case"].includes(mode) ? "BAD_REQUEST" : "FORBIDDEN" });
      expect(h.db.$transaction).toHaveBeenCalledTimes(1); expect(h.update).not.toHaveBeenCalled();
      expect(h.versionCreate).not.toHaveBeenCalled(); expect(h.versions).toHaveLength(1); expect(h.audits).toEqual([]);
    },
  );
  it("preserves service-token user policy instead of inventing a human Clerk requirement", async () => {
    const h = fixture({ service: true });
    expect((await h.save()).template).toEqual(template(["case-b", "case-a"]));
    expect(h.update).toHaveBeenCalledTimes(1); expect(h.versions).toHaveLength(2); expect(h.audits).toHaveLength(1);
  });
  it("preserves the outer cached full-seat refusal without even beginning a transaction", async () => {
    const h = fixture({ cachedSeat: "READ_ONLY" });
    await expect(h.save()).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.db.$transaction).not.toHaveBeenCalled(); expect(h.update).not.toHaveBeenCalled(); expect(h.audits).toEqual([]);
  });
});
