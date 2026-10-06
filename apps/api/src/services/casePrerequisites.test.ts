import { describe, expect, it, vi, beforeEach } from "vitest";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
const locks = vi.hoisted(() => ({ project: vi.fn(), actor: vi.fn(), read: vi.fn() }));
vi.mock("./caseFields.js", async original => ({ ...await original<typeof import("./caseFields.js")>(), lockCaseFieldProject: locks.project }));
vi.mock("./caseFieldReadScope.js", async original => ({ ...await original<typeof import("./caseFieldReadScope.js")>(), lockCurrentCaseFieldActor: locks.actor, lockCaseFieldReadScope: locks.read }));
import { readPrerequisiteAccess, readPrerequisitePage, setReviewedPrerequisites } from "./casePrerequisites.js";
import { prerequisiteGraphHash, prerequisiteRequestHash } from "./casePrerequisiteSchema.js";
const scope = { projectId: "synthetic-project", organizationId: "synthetic-org", actorId: "synthetic-native", actorClerkUserId: "synthetic-clerk" }, caseId = "main";
const pins = { projectId: scope.projectId, caseId, originalOrganizationId: scope.organizationId, expectedClerkActorId: scope.actorClerkUserId, expectedActorId: scope.actorId };
const edges = [{ dependentId: caseId, prerequisiteId: "old-pending" }, { dependentId: "archived", prerequisiteId: "unavailable" }];
const request = () => ({ ...pins, requestId: randomUUID(), expectedGraphHash: prerequisiteGraphHash(scope.projectId, edges), expectedPrerequisiteIds: ["old-pending"], prerequisiteIds: ["old-pending", "approved"], confirmed: true as const });
function fixture() {
  const state = { organizationId: scope.organizationId, role: "EDITOR", seatType: "FULL", edges: [...edges], count: 2n, bytes: 100n, unsupported: false, metadataBytes: 100n, populationBytes: 100n, populationCount: 1n, receipts: [] as { organizationId: string | null; requestHash: string | null }[], rows: [{ id: caseId, displayId: "SYN-1", title: "Synthetic main", archived: false, reviewStatus: "APPROVED" }, { id: "old-pending", displayId: "SYN-2", title: "Exact retained pending", archived: false, reviewStatus: "PENDING_REVIEW" }, { id: "approved", displayId: "SYN-3", title: "Synthetic approved", archived: false, reviewStatus: "APPROVED" }] };
  const events: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async (raw: TemplateStringsArray | { sql: string }) => {
      const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
      if (sql.includes('FROM "AuditLog"')) { events.push("receipt"); return state.receipts; }
      if (sql.includes('FROM "TestCasePrerequisite" e LEFT JOIN')) { events.push("graph-preflight"); return [{ count: state.count, bytes: state.bytes, unsupported: state.unsupported }]; }
      if (sql.includes('SELECT md5(')) { events.push("candidate-digest"); return [{ digest: "synthetic-native-population-digest" }]; }
      if (sql.includes('SELECT count(*)::bigint')) { events.push("candidate-preflight"); return [{ count: state.populationCount, bytes: state.populationBytes, unsupported: false }]; }
      if (sql.includes('FROM (SELECT c.id')) { events.push("page-id-preflight"); return [{ unsupported: false }]; }
      if (sql.includes('SELECT c.id FROM')) { events.push("page-ids"); return [{ id: "approved" }]; }
      if (sql.includes('FOR SHARE')) { events.push("case-locks"); return []; }
      if (sql.includes('FROM "TestCase" c')) { events.push("metadata-preflight"); return [{ bytes: state.metadataBytes, unsupported: false }]; }
      throw Error(`Unexpected synthetic SQL: ${sql}`);
    }),
    project: { findUniqueOrThrow: vi.fn(async () => ({ organizationId: state.organizationId })) },
    membership: { findUniqueOrThrow: vi.fn(async () => ({ role: state.role, seatType: state.seatType })) },
    testCasePrerequisite: { findMany: vi.fn(async () => { events.push("graph-ids"); return state.edges; }), deleteMany: vi.fn(async () => { events.push("edge-remove"); return { count: 1 }; }), createMany: vi.fn(async () => { events.push("edge-add"); return { count: 1 }; }) },
    testCase: { findMany: vi.fn(async (args: { where: { id: { in: string[] } }; select: Record<string, boolean> }) => { events.push(args.select.title ? "metadata-rows" : "case-states"); return state.rows.filter(row => args.where.id.in.includes(row.id)); }) },
    auditLog: { create: vi.fn(async () => { events.push("atomic-receipt"); }) },
  };
  const db = { $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => work(tx)) };
  return { state, events, tx, db };
}
const auth = { clerkActorId: scope.actorClerkUserId };
describe("bounded current native prerequisite service, mocked source proof only", () => {
  beforeEach(() => { locks.project.mockReset(); locks.actor.mockReset().mockResolvedValue(scope.actorClerkUserId); locks.read.mockReset().mockResolvedValue(scope); });
  it("bootstrap is schema-independent and emits exact read UUID/current native identity without bodies", async () => {
    const f = fixture(), id = randomUUID(); f.state.seatType = "READ_ONLY";
    const value = await readPrerequisiteAccess(f.db as never, scope.actorId, { projectId: scope.projectId, caseId, readRequestId: id }, auth);
    expect(value).toEqual({ projectId: scope.projectId, caseId, readRequestId: id, readScope: scope, canEdit: false }); expect(f.tx.$queryRaw).not.toHaveBeenCalled(); expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
  });
  it("same Clerk but changed native actor refuses before graph/private materialization", async () => {
    const f = fixture(); await expect(readPrerequisitePage(f.db as never, scope.actorId, { ...pins, expectedActorId: "different-native", readRequestId: randomUUID(), search: "", sort: "case-id" }, auth)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("page preflights graph and all candidate native metadata before identifiers/bodies; retains pending edges exactly", async () => {
    const f = fixture(), id = randomUUID(), value = await readPrerequisitePage(f.db as never, scope.actorId, { ...pins, readRequestId: id, search: "", sort: "case-id" }, auth);
    expect(value.prerequisiteIds).toEqual(["old-pending"]); expect(value.linked[0]).toMatchObject({ reviewStatus: "PENDING_REVIEW", unavailable: false }); expect(value.items.map(item => item.id)).toEqual(["approved"]); expect(value.readRequestId).toBe(id);
    expect(f.events.indexOf("graph-preflight")).toBeLessThan(f.events.indexOf("graph-ids")); expect(f.events.indexOf("candidate-preflight")).toBeLessThan(f.events.indexOf("candidate-digest")); expect(f.events.indexOf("metadata-preflight")).toBeLessThan(f.events.indexOf("metadata-rows")); expect(value).not.toHaveProperty("edges"); expect(value).not.toHaveProperty("procedures");
  });
  it("unavailable retained ID is visible without exposing any foreign case body", async () => {
    const f = fixture(); f.state.rows = f.state.rows.filter(row => row.id !== "old-pending");
    const value = await readPrerequisitePage(f.db as never, scope.actorId, { ...pins, readRequestId: randomUUID(), search: "", sort: "case-id" }, auth); expect(value.linked).toEqual([{ id: "old-pending", displayId: null, title: null, reviewStatus: null, archived: null, unavailable: true }]);
  });
  it("graph cardinality/bytes/foreign references refuse before identifiers are materialized", async () => {
    for (const change of [{ count: 10001n }, { bytes: 2097153n }, { unsupported: true }]) { const f = fixture(); Object.assign(f.state, change); await expect(readPrerequisitePage(f.db as never, scope.actorId, { ...pins, readRequestId: randomUUID(), search: "", sort: "case-id" }, auth)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.tx.testCasePrerequisite.findMany).not.toHaveBeenCalled(); expect(f.tx.testCase.findMany).not.toHaveBeenCalled(); }
  });
  it("candidate metadata bytes and page metadata bytes refuse before body reads", async () => {
    for (const change of [{ populationBytes: 16777217n }, { metadataBytes: 1048577n }]) { const f = fixture(); Object.assign(f.state, change); await expect(readPrerequisitePage(f.db as never, scope.actorId, { ...pins, readRequestId: randomUUID(), search: "", sort: "title" }, auth)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.tx.testCase.findMany).not.toHaveBeenCalled(); }
  });
  it("decoded non-BMP UTF-16 width refuses the entire page generically without clipping or leaking native text", async () => {
    for (const change of [{ title: "🧭".repeat(1005) }, { displayId: "🧭".repeat(101) }]) {
      const f = fixture(); Object.assign(f.state.rows[1]!, change);
      let error: unknown; try { await readPrerequisitePage(f.db as never, scope.actorId, { ...pins, readRequestId: randomUUID(), search: "", sort: "case-id" }, auth); } catch (cause) { error = cause; }
      expect(error).toMatchObject({ code: "PRECONDITION_FAILED", message: "Saved prerequisite metadata exceeds supported bounds. Nothing was clipped, pruned or replaced." });
      expect(JSON.stringify(error)).not.toContain("🧭"); expect(error).not.toHaveProperty("issues"); expect(f.tx.testCasePrerequisite.deleteMany).not.toHaveBeenCalled();
    }
  });
  it("changed population/graph cursor refuses instead of joining unrelated pages", async () => {
    const f = fixture(); await expect(readPrerequisitePage(f.db as never, scope.actorId, { ...pins, readRequestId: randomUUID(), search: "", sort: "case-id", cursor: { offset: 20, graphHash: "a".repeat(64), populationHash: "b".repeat(64) } }, auth)).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.tx.testCase.findMany).not.toHaveBeenCalled();
  });
  it("new approved addition preserves existing pending link and creates one atomic audit/receipt", async () => {
    const f = fixture(), input = request(), ack = await setReviewedPrerequisites(f.db as never, scope.actorId, input, auth);
    expect(ack).toMatchObject({ actorId: scope.actorId, actorClerkUserId: scope.actorClerkUserId, requestHash: prerequisiteRequestHash(input), prerequisiteIds: input.prerequisiteIds, replayed: false });
    expect(locks.project).toHaveBeenCalledBefore(locks.actor); expect(f.events.indexOf("receipt")).toBeLessThan(f.events.indexOf("graph-preflight")); expect(f.tx.testCasePrerequisite.deleteMany).not.toHaveBeenCalled(); expect(f.tx.testCasePrerequisite.createMany).toHaveBeenCalledWith({ data: [{ projectId: scope.projectId, dependentId: caseId, prerequisiteId: "approved", createdById: scope.actorId }] }); expect(f.events.at(-1)).toBe("atomic-receipt");
  });
  it("retained unavailable/archived/pending links can be explicitly removed without any case-body write", async () => {
    const f = fixture(), input = { ...request(), prerequisiteIds: [] }; f.state.rows = f.state.rows.filter(row => row.id !== "old-pending");
    await setReviewedPrerequisites(f.db as never, scope.actorId, input, auth); expect(f.tx.testCasePrerequisite.deleteMany).toHaveBeenCalledWith({ where: { projectId: scope.projectId, dependentId: caseId, prerequisiteId: { in: ["old-pending"] } } }); expect(f.tx.testCasePrerequisite.createMany).not.toHaveBeenCalled();
  });
  it("current pending/rejected/archived/missing additions refuse without pruning or autoapproval", async () => {
    for (const change of [{ reviewStatus: "PENDING_REVIEW" }, { reviewStatus: "REJECTED" }, { archived: true }]) { const f = fixture(); Object.assign(f.state.rows[2]!, change); await expect(setReviewedPrerequisites(f.db as never, scope.actorId, request(), auth)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.tx.testCasePrerequisite.deleteMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); }
    const f = fixture(); f.state.rows.pop(); await expect(setReviewedPrerequisites(f.db as never, scope.actorId, request(), auth)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("original native actor/org/Clerk and current locked membership refusal precedes private receipts", async () => {
    for (const change of [{ expectedActorId: "other-native" }, { originalOrganizationId: "other-org" }, { expectedClerkActorId: "other-clerk" }]) { const f = fixture(); await expect(setReviewedPrerequisites(f.db as never, scope.actorId, { ...request(), ...change }, auth)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.tx.$queryRaw).not.toHaveBeenCalled(); }
    const f = fixture(); locks.project.mockRejectedValueOnce(new Error("Current FULL editor membership revoked")); await expect(setReviewedPrerequisites(f.db as never, scope.actorId, request(), auth)).rejects.toThrow("revoked"); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("exact accepted UUID recovers before later oversized/malformed graphs and never mutates again", async () => {
    const f = fixture(), input = request(); f.state.count = 10001n; f.state.unsupported = true; f.state.receipts = [{ organizationId: scope.organizationId, requestHash: prerequisiteRequestHash(input) }];
    expect((await setReviewedPrerequisites(f.db as never, scope.actorId, input, auth)).replayed).toBe(true); expect(f.events).toEqual(["receipt"]); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.tx.testCasePrerequisite.createMany).not.toHaveBeenCalled();
  });
  it("conflicting/duplicate/unscoped receipt refuses same UUID replacement without graph access", async () => {
    const input = request(); for (const receipts of [[{ organizationId: scope.organizationId, requestHash: "a".repeat(64) }], [{ organizationId: scope.organizationId, requestHash: null }], Array.from({ length: 2 }, () => ({ organizationId: scope.organizationId, requestHash: prerequisiteRequestHash(input) }))]) { const f = fixture(); f.state.receipts = receipts; await expect(setReviewedPrerequisites(f.db as never, scope.actorId, input, auth)).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.events).toEqual(["receipt"]); }
    const f = fixture(); f.state.receipts = [{ organizationId: "other-org", requestHash: prerequisiteRequestHash(input) }]; await expect(setReviewedPrerequisites(f.db as never, scope.actorId, input, auth)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("complete graph or direct baseline conflict refuses before edge mutation", async () => {
    for (const change of [{ expectedGraphHash: "a".repeat(64) }, { expectedPrerequisiteIds: [] }]) { const f = fixture(); await expect(setReviewedPrerequisites(f.db as never, scope.actorId, { ...request(), ...change }, auth)).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.tx.testCasePrerequisite.deleteMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); }
  });
  it("cycle refusal precedes mutation; transaction/SQL time bounds remain explicit", async () => {
    const f = fixture(); f.state.edges.push({ dependentId: "approved", prerequisiteId: caseId }); f.state.count = 3n;
    await expect(setReviewedPrerequisites(f.db as never, scope.actorId, { ...request(), expectedGraphHash: prerequisiteGraphHash(scope.projectId, f.state.edges) }, auth)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.tx.testCasePrerequisite.createMany).not.toHaveBeenCalled(); expect(f.tx.auditLog.create).not.toHaveBeenCalled(); expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 10000, maxWait: 5000 });
  });
  it("legacy branch refuses before reading or mutating and reviewed routes do not use custom schema or providers", () => {
    const router = readFileSync(new URL("../routers/testCaseStructure.ts", import.meta.url), "utf8"), branch = router.slice(router.indexOf("  setPrerequisites:")), service = readFileSync(new URL("./casePrerequisites.ts", import.meta.url), "utf8");
    expect(branch).toContain('mutation(() =>'); expect(branch).not.toMatch(/ctx\.|\$transaction|deleteMany|createMany/); expect(service).not.toMatch(/caseFieldSchema|qualityProfile|steps|fetch\(|invokeModel|testCase\.update|\$queryRawUnsafe/); expect(service).toContain("expectedActorId !== userId"); expect(service).toContain("LIMIT 2"); expect(service).toContain("statement_timeout='8000ms'");
  });
});
