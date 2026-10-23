import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@vaettir/db";
const access = vi.hoisted(() => vi.fn());
vi.mock("./caseAnalysisQueue.js", async original => ({ ...await original<typeof import("./caseAnalysisQueue.js")>(), analysisAccess: access }));
import { prepareRiskReviewQueue, riskReviewQueueStatus } from "./caseRiskReviewPreparation.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";

const sha = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
function fixture(count = 1) {
  const ids = Array.from({ length: count }, (_, index) => `case-${String(index).padStart(4, "0")}`);
  const input = { projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "clerk", action: "RISK" as const, ids: [...ids].reverse(), requestId: randomUUID() };
  const cases = ids.map((id, index) => ({ id, projectId: "project", archived: false, title: ` Exact title ${index} λ🎮 `, displayId: `TC-${index + 1}`, background: "Retained prose", given: ["", " ", "same", "same"], when: ["second", "first"], then: ["Result\nretained"], tags: ["tag,exact"], testType: "FUNCTIONAL", priority: "MEDIUM", suitePath: null, testPlanId: null, validationDomain: "SOFTWARE", verificationProfile: {}, sharedStepGroupId: null as string | null, sharedStepGroup: null as null | { projectId: string; archivedAt: Date | null; steps: unknown }, steps: [{ order: 1, action: "Exact tester action", expectedActionOrData: "Separate technical behavior", expectedResult: "", expectedResponse: null, mediaAttachmentIds: [] }], source: null as null | { filePath: string; framework: string; lastSyncedCommitSha: string | null }, updatedAt: new Date("2026-10-05T12:00:00Z"), riskAssessedAt: null as Date | null }));
  type Receipt = { id: string; selectionHash: string; organizationId: string };
  const state = { prior: null as Receipt | null, foreignSource: false, unavailableShared: false, caseBytes: 1000n, stepCount: 1n, sourceBytes: 0n, missingBound: false, badLastBytes: false, missingBody: false, duplicateBody: false, missingFlags: false, duplicateFlags: false, reversedNative: false, p2002: false, bodyBatches: [] as string[][], paid: new Map<string, string>() };
  const events: string[] = [];
  const tx = {
    $queryRaw: vi.fn(async (raw: { sql: string; values: unknown[] }) => {
      const sql = raw.sql;
      if (sql.includes('AS "unavailableShared"')) { events.push("identity-relations"); return [{ unavailableShared: state.unavailableShared, foreignSource: state.foreignSource }]; }
      if (sql.includes('AS "sourceBytes"')) { events.push("native-preflight"); const selected = cases.filter(tc => input.ids.includes(tc.id)); return (state.missingBound ? selected.slice(1) : selected).map((tc, index) => ({ id: tc.id, bytes: state.badLastBytes && index === selected.length - 1 ? 64001n : state.caseBytes, steps: state.stepCount, sourceBytes: state.sourceBytes })); }
      if (sql.includes('wanted("caseId","inputHash")')) {
        events.push("paid-fixed-flags");
        const wanted = raw.values.filter(value => typeof value === "string" && cases.some(tc => tc.id === value)) as string[];
        let rows = wanted.map(caseId => ({ caseId, ready: state.paid.get(caseId) === "READY", nonemptyStatus: Boolean(state.paid.get(caseId)) }));
        if (state.missingFlags) rows = rows.slice(1);
        if (state.duplicateFlags && rows[0]) rows[rows.length - 1] = rows[0];
        return state.reversedNative ? rows.reverse() : rows;
      }
      throw Error(`Unexpected synthetic SQL ${sql}`);
    }),
    testCase: { findMany: vi.fn(async ({ where, take }: { where: { id: { in: string[] } }; take: number }) => {
      events.push("private-case-batch"); state.bodyBatches.push([...where.id.in]); expect(take).toBe(32); expect(where.id.in.length).toBeLessThanOrEqual(32);
      let rows = cases.filter(tc => where.id.in.includes(tc.id));
      if (state.missingBody) rows = rows.slice(1);
      if (state.duplicateBody && rows[0]) rows[rows.length - 1] = rows[0];
      return state.reversedNative ? rows.reverse() : rows;
    }) },
    testCaseRiskReview: { findMany: vi.fn(() => { throw Error("Private paid bodies must not be loaded"); }), findUnique: vi.fn(() => { throw Error("Per-case paid reads must not run"); }) },
    aiCreditTransaction: { aggregate: vi.fn(() => { throw Error("Preparation must not read balance"); }), create: vi.fn(() => { throw Error("REVIEW cannot charge"); }) },
    caseAnalysisQueue: {
      findUnique: vi.fn(async () => { events.push("prior-receipt"); return state.prior; }),
      findUniqueOrThrow: vi.fn(async () => { events.push("recovery-receipt"); if (!state.prior) throw Error("Missing receipt"); return state.prior; }),
      create: vi.fn(async ({ data }: { data: { selectionHash: string; organizationId: string; scopeHash: string; maximumCredits: number; caseCount: number; items: { create: unknown[] } } }) => {
        events.push("atomic-queue-create"); state.prior = { id: "queue", selectionHash: data.selectionHash, organizationId: data.organizationId };
        if (state.p2002) { state.p2002 = false; throw new Prisma.PrismaClientKnownRequestError("Synthetic unique race", { code: "P2002", clientVersion: "synthetic" }); }
        return { id: "queue" };
      }),
    },
  };
  const db = { $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => { events.push("transaction"); return work(tx); }) };
  const run = () => prepareRiskReviewQueue(db as never, "actor", "clerk", input);
  return { input, ids, cases, state, events, tx, db, run };
}

function oldItems(f: ReturnType<typeof fixture>) {
  return [...f.cases].filter(tc => f.input.ids.includes(tc.id)).sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((tc, position) => {
    const oldData = { title: tc.title, given: tc.given, when: tc.when, then: tc.then, testType: tc.testType, sourceFilePath: tc.source?.filePath ?? null };
    const paid = f.state.paid.get(tc.id), status = paid === "READY" ? "SAVED" : paid ? "UNKNOWN" : tc.riskAssessedAt !== null ? "SKIPPED" : "QUEUED";
    return { caseId: tc.id, displayId: tc.displayId, contentRevision: testCaseContentRevision(tc), sourceRevision: sha(tc.source), caseUpdatedAt: tc.updatedAt, position, inputHash: sha(oldData), status, maximumCredits: status === "QUEUED" ? 2 : 0, reason: status === "UNKNOWN" ? "An earlier paid request needs reconciliation; it will not be retried." : status === "SKIPPED" ? "Existing human or imported risk assessment preserved." : null };
  });
}

describe("RISK-only bounded preparation, mock native queries NOT SQL/performance acceptance", () => {
  beforeEach(() => access.mockReset().mockImplementation(async () => ({ organizationId: "org", canSpend: false })));
  it.each([1, 32, 33, 851, 1000])("prepares all %i exact items in <=32-case batches with unchanged scoped hashes", async count => {
    const f = fixture(count), expected = oldItems(f); await expect(f.run()).resolves.toEqual({ id: "queue" });
    const data = f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data;
    expect(data.items.create).toEqual(expected); expect(JSON.stringify(data.items.create)).toBe(JSON.stringify(expected));
    expect(data.maximumCredits).toBe(count * 2); expect(data.caseCount).toBe(count);
    expect(data.selectionHash).toBe(sha({ selection: ["project", "RISK", f.ids], originalOrganizationId: "org", expectedClerkActorId: "clerk" }));
    expect(data.scopeHash).toBe(sha({ originalOrganizationId: "org", expectedClerkActorId: "clerk", projectId: "project", actorId: "actor", action: "RISK", maximumCredits: count * 2, items: expected }));
    expect(f.state.bodyBatches.flat()).toEqual(f.ids); expect(f.state.bodyBatches).toHaveLength(Math.ceil(count / 32));
    expect(f.tx.testCaseRiskReview.findMany).not.toHaveBeenCalled(); expect(f.tx.aiCreditTransaction.aggregate).not.toHaveBeenCalled(); expect(f.tx.aiCreditTransaction.create).not.toHaveBeenCalled();
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 15000 });
    expect(access).toHaveBeenCalledWith(f.tx, "project", "actor", false, undefined, f.input, "clerk");
    expect(access).toHaveBeenCalledBefore(f.tx.caseAnalysisQueue.findUnique);
    expect(f.events.indexOf("prior-receipt")).toBeLessThan(f.events.indexOf("native-preflight"));
    expect(f.events.indexOf("native-preflight")).toBeLessThan(f.events.indexOf("private-case-batch"));
  });
  it("retains exact legacy unscoped selection/scope hashes without inventing default pins", async () => {
    const f = fixture(2); delete (f.input as Partial<typeof f.input>).originalOrganizationId; delete (f.input as Partial<typeof f.input>).expectedClerkActorId;
    await f.run(); const data = f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data, items = oldItems(f);
    expect(data.selectionHash).toBe(sha(["project", "RISK", f.ids])); expect(data.scopeHash).toBe(sha({ projectId: "project", actorId: "actor", action: "RISK", maximumCredits: 4, items }));
  });
  it("uses one snapshot's exact source/reference/structured content without forwarding new context", async () => {
    const f = fixture(2); f.cases[0]!.source = { filePath: " exact/path, λ\n", framework: "custom: exact\n", lastSyncedCommitSha: " " };
    f.cases[1]!.source = { filePath: "", framework: "", lastSyncedCommitSha: null };
    f.cases[0]!.sharedStepGroupId = "shared"; f.cases[0]!.sharedStepGroup = { projectId: "project", archivedAt: null, steps: [{ action: "Retained shared", expectedResult: null }] };
    await f.run(); expect(f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data.items.create).toEqual(oldItems(f));
    const encoded = JSON.stringify(f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data);
    expect(encoded).not.toContain("Separate technical behavior"); expect(encoded).not.toContain("exact/path");
  });
  it("keeps legacy paid-cache precedence, empty native TEXT status, human assessment and zero allowances", async () => {
    const f = fixture(7), statuses = ["READY", "GENERATING", "NEEDS_RECONCILIATION", "future-state", "", undefined, undefined];
    statuses.forEach((status, index) => { if (status !== undefined) f.state.paid.set(f.ids[index]!, status); });
    f.cases[0]!.riskAssessedAt = new Date(); f.cases[1]!.riskAssessedAt = new Date(); f.cases[5]!.riskAssessedAt = new Date();
    await f.run(); const items = f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data.items.create;
    expect(items).toEqual(oldItems(f)); expect(items.map(item => (item as { status: string }).status)).toEqual(["SAVED", "UNKNOWN", "UNKNOWN", "UNKNOWN", "QUEUED", "SKIPPED", "QUEUED"]);
    expect(f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data.maximumCredits).toBe(4);
    expect(riskReviewQueueStatus(true, true, true)).toBe("SAVED");
  });
  it("reorders native result collation independently from exact JS-sorted positions", async () => {
    const f = fixture(4); f.state.reversedNative = true; await f.run(); expect(f.tx.caseAnalysisQueue.create.mock.calls[0]![0].data.items.create).toEqual(oldItems(f));
  });
  it("current access precedes UUID lookup and all private bodies, including replay", async () => {
    const f = fixture(); f.state.prior = { id: "queue", organizationId: "org", selectionHash: "old" };
    access.mockRejectedValueOnce(new TRPCErrorFixture());
    await expect(f.run()).rejects.toThrow("Current original actor revoked");
    expect(f.tx.caseAnalysisQueue.findUnique).not.toHaveBeenCalled(); expect(f.tx.$queryRaw).not.toHaveBeenCalled();
  });
  it("exact original UUID replays before later oversize/missing/foreign procedure admission", async () => {
    const f = fixture(2); await f.run(); const original = f.state.prior;
    f.state.sourceBytes = 64001n; f.state.foreignSource = true; f.state.missingBound = true;
    f.tx.$queryRaw.mockClear(); f.tx.testCase.findMany.mockClear(); await expect(f.run()).resolves.toEqual({ id: "queue" });
    expect(f.state.prior).toBe(original); expect(f.tx.$queryRaw).not.toHaveBeenCalled(); expect(f.tx.caseAnalysisQueue.create).toHaveBeenCalledTimes(1);
    f.input.ids = f.input.ids.slice(1); await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" });
    f.input.ids = [...f.ids]; f.state.prior!.organizationId = "foreign"; await expect(f.run()).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("P2002 recovers in a new current-authorized RR snapshot without re-preparing or spending", async () => {
    const f = fixture(33); f.state.p2002 = true; await expect(f.run()).resolves.toEqual({ id: "queue" });
    expect(f.db.$transaction).toHaveBeenCalledTimes(2); expect(access).toHaveBeenCalledTimes(2);
    expect(access.mock.calls[1]).toEqual([f.tx, "project", "actor", false, "org", f.input, "clerk"]);
    expect(f.tx.caseAnalysisQueue.findUniqueOrThrow).toHaveBeenCalledTimes(1); expect(f.state.bodyBatches).toHaveLength(2);
    const denied = fixture(); denied.state.p2002 = true; access.mockReset().mockResolvedValueOnce({ organizationId: "org" }).mockRejectedValueOnce(new TRPCErrorFixture());
    await expect(denied.run()).rejects.toThrow("Current original actor revoked"); expect(denied.tx.caseAnalysisQueue.findUniqueOrThrow).not.toHaveBeenCalled();
  });
  it("native case/procedure and separate source exact limits admit, overflow refuses entire scope before bodies", async () => {
    const exact = fixture(); exact.state.caseBytes = 64000n; exact.state.stepCount = 1000n; exact.state.sourceBytes = 64000n; await exact.run();
    for (const change of [{ caseBytes: 64001n }, { stepCount: 1001n }, { sourceBytes: 64001n }, { badLastBytes: true }]) {
      const f = fixture(33); Object.assign(f.state, change); await expect(f.run()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.tx.testCase.findMany).not.toHaveBeenCalled(); expect(f.tx.caseAnalysisQueue.create).not.toHaveBeenCalled();
    }
  });
  it("foreign source or unavailable shared identities refuse before native private-body measurement", async () => {
    for (const change of [{ foreignSource: true }, { unavailableShared: true }]) { const f = fixture(); Object.assign(f.state, change); await expect(f.run()).rejects.toMatchObject({ code: change.foreignSource ? "FORBIDDEN" : "CONFLICT" }); expect(f.events).not.toContain("native-preflight"); expect(f.tx.testCase.findMany).not.toHaveBeenCalled(); }
  });
  it("missing/duplicate projected cases or paid flags refuse, never truncate/create a partial scope", async () => {
    for (const change of [{ missingBound: true }, { missingBody: true }, { duplicateBody: true }, { missingFlags: true }, { duplicateFlags: true }]) { const f = fixture(2); Object.assign(f.state, change); await expect(f.run()).rejects.toMatchObject({ code: "CONFLICT" }); expect(f.tx.caseAnalysisQueue.create).not.toHaveBeenCalled(); }
  });
  it("1,001, duplicate or empty identities reject before authorization/native access", async () => {
    for (const f of [fixture(1001), fixture(0)]) { await expect(f.run()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.db.$transaction).not.toHaveBeenCalled(); }
    const f = fixture(2); f.input.ids = [f.ids[0]!, f.ids[0]!]; await expect(f.run()).rejects.toMatchObject({ code: "BAD_REQUEST" }); expect(f.db.$transaction).not.toHaveBeenCalled();
  });
  it("serialized legacy risk-input overflow still refuses without clipping or queued work", async () => {
    const f = fixture(); f.cases[0]!.title = "λ".repeat(32000); await expect(f.run()).rejects.toMatchObject({ code: "BAD_REQUEST", message: expect.stringContaining("risk review size limit") }); expect(f.tx.caseAnalysisQueue.create).not.toHaveBeenCalled();
  });
  it("source contracts preserve native bounds/whitelisted source/hash and isolate REVIEW from all paid operations", () => {
    const source = readFileSync(new URL("./caseRiskReviewPreparation.ts", import.meta.url), "utf8"), router = readFileSync(new URL("../routers/caseAnalysisQueue.ts", import.meta.url), "utf8");
    expect(source).toContain('filePath: true, framework: true, lastSyncedCommitSha: true'); expect(source).toContain("sourceRevision: analysisHash(tc.source)"); expect(source).toContain("buildCaseRiskInput(tc).hash");
    expect(source).toContain('COALESCE(r.status<>\'\',false) AS "nonemptyStatus"');
    const paidSql = source.slice(source.indexOf('SELECT wanted."caseId"'), source.indexOf("const flagsById")); expect(paidSql).not.toMatch(/r\.content|r\.\*|row_to_json\(r\)/);
    expect(source).toContain('lastSyncedCommitSha\',s."lastSyncedCommitSha"'); expect(source).not.toContain("jsonb::text");
    const sourceScope = source.slice(source.indexOf('EXISTS(SELECT 1 FROM "TestCaseSource"'), source.indexOf('AS "foreignSource"'));
    expect(sourceScope).toContain('LEFT JOIN "TestCase" source_case ON source_case.id=s."testCaseId"');
    expect(sourceScope).toContain('WHERE s."testCaseId" IN');
    expect(sourceScope).toContain('source_case.id IS NULL OR source_case."projectId"<>');
    expect(sourceScope).not.toContain('JOIN "TestCase" c ON');
    expect(source).not.toMatch(/chargeAiCredits\(|assessTestCaseRisk\(|\.approve\(|runCaseAnalysisQueueOnce\(|getAiCreditBalance\(/);
    expect(router).toContain('if (input.action === "RISK")'); expect(router).not.toContain("risk.riskPreview("); expect(router).toContain("design.preview({ id: caseId })");
    expect(source).toContain("timeout: 15000"); expect(source).not.toContain("timeout: 30000");
  });
});
class TRPCErrorFixture extends Error { constructor() { super("Current original actor revoked"); } }
