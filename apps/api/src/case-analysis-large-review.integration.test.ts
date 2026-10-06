// AUTHORED SOURCE ONLY, NOT RUN. No 851-case/native/performance pass is implied.
// Later execution requires VAETTIR_OWNED_LARGE_REVIEW_FIXTURE=yes AND the exact
// existing owned-database admission. Only synthetic REVIEW/replay is exercised:
// no approval, worker, provider, charge, grant, purchase or customer records.
// Fixture records remain under the printed synthetic namespace for subsequent
// owner-controlled disposal. There is deliberately NO destructive cleanup.
import { createHash, randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { Prisma, PrismaClient } from "@vaettir/db";
import type { appRouter as AppRouter } from "./router.js";
import type { Context } from "./trpc.js";
import { admitOwnedLargeReviewFixture } from "./testOnlyLargeReviewSafety.js";
import { buildCaseRiskInput } from "./services/caseRiskInput.js";
import { testCaseContentRevision } from "./services/testCaseContentRevision.js";

vi.mock("@vaettir/ai-agent", async original => ({
  ...(await original<typeof import("@vaettir/ai-agent")>()),
  assessTestCaseRisk: vi.fn(() => { throw Error("Provider calls are forbidden in this review-only fixture"); }),
  reviewTestDesign: vi.fn(() => { throw Error("Provider calls are forbidden in this review-only fixture"); }),
}));
type Metrics = { phase: string; elapsedMs: number; logicalCalls: number; operations: Record<string, number>; observedSqlEvents: number; observedSqlDurationMs: number };
const optIn = process.env.VAETTIR_OWNED_LARGE_REVIEW_FIXTURE === "yes";
describe.skipIf(!optIn)("owned 851-case native risk REVIEW (AUTHORED NOT RUN)", () => {
  const namespace = `risk-large-review-${randomUUID()}`, clerkId = `${namespace}-actor`;
  let client: PrismaClient | undefined, db: PrismaClient, caller: ReturnType<typeof AppRouter.createCaller>;
  let organizationId: string, projectId: string, actorId: string;
  let activeMetric: Metrics | null = null;
  const metrics: Metrics[] = [], ids = Array.from({ length: 851 }, (_, index) => `${namespace}-case-${String(index).padStart(4, "0")}`);
  const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
  function record(name: string) { if (activeMetric) { activeMetric.logicalCalls++; activeMetric.operations[name] = (activeMetric.operations[name] ?? 0) + 1; } }
  // Transparent test instrumentation. Preserve the real constraint-checked
  // transaction method/options and bind delegates; never inspect SQL/args.
  function observed<T extends object>(target: T): T {
    return new Proxy(target, { get(object, property) {
      const value = Reflect.get(object, property, object);
      if (property === "$transaction" && typeof value === "function") return (...args: unknown[]) => {
        record("$transaction");
        const work = args[0];
        return Reflect.apply(value, object, typeof work === "function" ? [(tx: object) => work(observed(tx)), ...args.slice(1)] : args);
      };
      if (typeof value === "function") return (...args: unknown[]) => { if (String(property).startsWith("$")) record(String(property)); return Reflect.apply(value, object, args); };
      if (value && typeof value === "object" && typeof Reflect.get(value, "findMany") === "function") return new Proxy(value, { get(delegate, operation) {
        const method = Reflect.get(delegate, operation, delegate);
        return typeof method === "function" ? (...args: unknown[]) => { record(`${String(property)}.${String(operation)}`); return Reflect.apply(method, delegate, args); } : method;
      } });
      return value;
    } });
  }
  async function measured<T>(phase: string, work: () => Promise<T>): Promise<T> {
    const facts: Metrics = { phase, elapsedMs: 0, logicalCalls: 0, operations: {}, observedSqlEvents: 0, observedSqlDurationMs: 0 }, started = performance.now();
    activeMetric = facts;
    try { return await work(); } finally { facts.elapsedMs = performance.now() - started; activeMetric = null; metrics.push(facts); }
  }
  beforeAll(async () => {
    const captured = { ...process.env }, admission = admitOwnedLargeReviewFixture(captured);
    if (!admission) throw Error("Explicit owned large-review fixture admission required");
    console.info(JSON.stringify({ kind: "owned_large_review_fixture_namespace", syntheticNamespace: namespace, admittedRoute: admission.route, recordsRetainedForOwnerDisposal: true, nativePerformanceAccepted: false }));
    // Database/router imports and all DB client construction follow admission.
    const [{ ConstraintCheckedPrismaClient }, { appRouter }] = await Promise.all([import("@vaettir/db/dist/constraintCheckedClient.js"), import("./router.js")]);
    const native = new ConstraintCheckedPrismaClient({ datasources: { db: { url: captured.DATABASE_URL! } }, log: [{ level: "query", emit: "event" }] });
    client = native;
    // The nongeneric subclass cannot infer configured event-log types. This
    // subscription stores ONLY native duration/count metadata, never query/params.
    (native.$on as unknown as (event: "query", listener: (event: Prisma.QueryEvent) => void) => void)("query", event => {
      if (activeMetric) { activeMetric.observedSqlEvents++; activeMetric.observedSqlDurationMs += event.duration; }
    });
    db = observed(native);
    const tier = await db.planTier.findUniqueOrThrow({ where: { key: "free" } });
    organizationId = (await db.organization.create({ data: { name: namespace, slug: namespace, planTierId: tier.id } })).id;
    projectId = (await db.project.create({ data: { organizationId, name: namespace, slug: `${namespace}-project` } })).id;
    const user = await db.user.create({ data: { clerkUserId: clerkId, email: `${namespace}@example.invalid`, memberships: { create: { organizationId, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
    actorId = user.id; caller = appRouter.createCaller({ prisma: db as Context["prisma"], user, authenticatedClerkSubject: clerkId, staff: null, securityLogger: { warn: () => {} }, staffAttempt: { tokenConfigured: false, tokenPresented: false, actorHeaderPresented: false } });
    // Supply internal fixture IDs only. The real native allocator owns every
    // project-local case number/display ID; this fixture cannot prescribe them.
    await db.testCase.createMany({ data: ids.map((id, index) => ({ id, projectId, title: `Synthetic review ${String(index).padStart(4, "0")}`, background: "Synthetic setup only", given: ["", " exact, retained setup ", "same", "same"], when: ["Synthetic action\nno external system"], then: ["Synthetic observation"], tags: ["synthetic-owned-review"], testType: "FUNCTIONAL", reviewStatus: "APPROVED" })) });
  }, 120000); // Infrastructure hang guard, not a passing performance threshold.
  afterAll(async () => {
    // Disconnect only; retain the exact synthetic namespace and all evidence.
    if (client) await client.$disconnect();
  }, 30000);
  it("records all 851 exact baselines and unchanged risk hashes, recovers one UUID scope and observes only metadata performance facts", async () => {
    const source = await db.testCase.findMany({ where: { projectId, id: { in: ids } }, orderBy: { id: "asc" }, include: { steps: { orderBy: { order: "asc" } }, sharedStepGroup: { select: { projectId: true, steps: true, archivedAt: true } }, source: { select: { filePath: true, framework: true, lastSyncedCommitSha: true } } } });
    expect(source.map(row => row.id)).toEqual(ids);
    const identity = await caller.project.caseIdentity({ projectId });
    expect(identity).toMatchObject({ allocatedCount: 851, keyLocked: true });
    expect(identity.caseKey).toMatch(/^[a-z][a-z0-9-]{0,23}$/);
    expect(new Set(source.map(row => row.displayId)).size).toBe(851);
    expect(new Set(source.map(row => row.caseNumber)).size).toBe(851);
    expect(source.map(row => row.caseNumber).sort((a, b) => a - b)).toEqual(Array.from({ length: 851 }, (_, index) => index + 1));
    for (const row of source) expect(row.displayId).toBe(`${identity.caseKey}-${String(row.caseNumber).padStart(2, "0")}`);
    const input = { projectId, originalOrganizationId: organizationId, expectedClerkActorId: clerkId, ids: [...ids].reverse(), action: "RISK" as const, requestId: randomUUID() };
    const first = await measured("review-851", () => caller.caseAnalysisQueue.review(input));
    expect(first).toMatchObject({ caseCount: 851, maximumCredits: 1702, status: "REVIEW", counts: { QUEUED: 851 }, approvedAt: null });
    const stored = await db.caseAnalysisQueueItem.findMany({ where: { queueId: first.id }, orderBy: { position: "asc" } });
    expect(stored.map(item => item.caseId)).toEqual(ids); expect(stored.map(item => item.position)).toEqual(ids.map((_, index) => index));
    const expectedItems = source.map((row, position) => {
      const oldRiskHash = sha({ title: row.title, given: row.given, when: row.when, then: row.then, testType: row.testType, sourceFilePath: row.source?.filePath ?? null });
      expect(buildCaseRiskInput(row).hash).toBe(oldRiskHash);
      return { caseId: row.id, displayId: row.displayId, contentRevision: testCaseContentRevision(row), sourceRevision: sha(row.source), caseUpdatedAt: row.updatedAt, position, inputHash: oldRiskHash, status: "QUEUED", maximumCredits: 2, reason: null };
    });
    for (const [position, expected] of expectedItems.entries()) expect(stored[position]).toMatchObject(expected);
    const queue = await db.caseAnalysisQueue.findUniqueOrThrow({ where: { id: first.id } });
    expect(queue.selectionHash).toBe(sha({ selection: [projectId, "RISK", ids], originalOrganizationId: organizationId, expectedClerkActorId: clerkId }));
    expect(queue.scopeHash).toBe(sha({ originalOrganizationId: organizationId, expectedClerkActorId: clerkId, projectId, actorId, action: "RISK", maximumCredits: 1702, items: expectedItems }));
    const replay = await measured("review-851-identical-replay", () => caller.caseAnalysisQueue.review({ ...input, ids: [...ids] }));
    expect(replay.id).toBe(first.id); expect(replay.scopeHash).toBe(first.scopeHash);
    await expect(caller.caseAnalysisQueue.review({ ...input, ids: ids.slice(0, 850) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect(await db.caseAnalysisQueue.count({ where: { projectId, requestedById: actorId, requestId: input.requestId } })).toBe(1);
    expect(await db.caseAnalysisQueueItem.count({ where: { queueId: first.id } })).toBe(851);
    expect(stored.every(item => item.chargeId === null)).toBe(true);
    expect(await db.aiCreditTransaction.count({ where: { organizationId } })).toBe(0);
    expect(await db.testCaseRiskReview.count({ where: { testCaseId: { in: ids } } })).toBe(0);
    const retainedIdentities = await db.testCase.findMany({ where: { projectId, id: { in: ids } }, orderBy: { id: "asc" }, select: { id: true, caseNumber: true, displayId: true } });
    expect(retainedIdentities).toEqual(source.map(({ id, caseNumber, displayId }) => ({ id, caseNumber, displayId })));
    const provider = await import("@vaettir/ai-agent");
    expect(provider.assessTestCaseRisk).not.toHaveBeenCalled(); expect(provider.reviewTestDesign).not.toHaveBeenCalled();
    // No maximum time/query-count assertion: these are measurements to compare
    // after batching, never invented production/performance acceptance.
    console.info(JSON.stringify({ kind: "owned_large_risk_review_measurement", syntheticNamespace: namespace, count: 851, metrics, nativePerformanceAccepted: false, recordsRetainedForOwnerDisposal: true }));
  }, 600000);
});
