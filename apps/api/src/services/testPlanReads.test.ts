import { describe, expect, it, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
const guards = vi.hoisted(() => ({ read: vi.fn(), access: vi.fn(), audit: vi.fn(), readiness: vi.fn() }));
vi.mock("./caseFieldReadScope.js", async original => ({ ...await original<typeof import("./caseFieldReadScope.js")>(), lockCaseFieldReadScope: guards.read }));
vi.mock("../trpc.js", async original => ({ ...await original<typeof import("../trpc.js")>(), requireProjectAccess: guards.access }));
vi.mock("./auditLog.js", () => ({ recordAudit: guards.audit }));
vi.mock("./releaseReadiness.js", () => ({ refreshReleaseReadiness: guards.readiness }));
vi.mock("@vaettir/ai-agent", () => ({ generateQaStrategyDraft: vi.fn() }));
import { readTestPlanDetail, readTestPlanHistory, legacyPlanCustomFieldRecord, assertLegacyPlanMetadataRetention, assertLegacyPlanMetadataRootKind } from "./testPlanReads.js";
import { testPlansRouter } from "../routers/testPlans.js";

const authorized = { clerkActorId: "clerk" }, scope = { projectId: "project", organizationId: "org", actorId: "actor", actorClerkUserId: "clerk" };
function fixture() {
  const plan = { id: "plan", projectId: "project", name: " Exact name ", description: null, status: "DRAFT", releaseId: null, customFields: null as unknown, strategyId: null, testPlanType: { id: "type", key: "qa-strategy", name: "QA Strategy", category: "QUALITY_STRATEGY", fieldSchema: { type: "object", properties: {} } }, strategy: null, linkedPlans: [] as Array<{ id: string; name: string; status: string }>, acceptanceCriteria: [] as Array<{ id: string; description: string; status: string; requirementId: string | null }> };
  const state = { projectId: "project" as string | null, organizationId: "org" as string | null, locked: true, foreign: false, detailBytes: 1000n, criteria: 0n, links: 0n, historyCount: 1n, historyBytes: 1000n, metadataRootKind: "null" as string | null };
  const versions = [{ versionNumber: 1, name: plan.name, description: null, status: "DRAFT", customFields: null as unknown, executionTemplate: null as unknown, createdAt: new Date("2026-01-01"), createdBy: null }];
  const events: string[] = [];
  const tx = {
    $executeRaw: vi.fn(async () => 0),
    $queryRaw: vi.fn(async (raw: TemplateStringsArray | { sql: string }) => {
      const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
      if (sql.includes('JOIN "Project" j')) { events.push("identity-discovery"); return [{ projectId: state.projectId, organizationId: state.organizationId }]; }
      if (sql.includes('AS "metadataRootKind"')) { events.push("legacy-native-root-lock"); return state.locked ? [{ id: "plan", metadataRootKind: state.metadataRootKind }] : []; }
      if (sql.includes('AS "foreign"')) { events.push("identity-relationship-check"); return [{ foreign: state.foreign }]; }
      if (sql.includes('AS criteria')) { events.push("detail-native-preflight"); return [{ bytes: state.detailBytes, criteria: state.criteria, links: state.links }]; }
      if (sql.includes('FROM "TestPlanVersion" v LEFT JOIN')) { events.push("history-native-preflight"); return [{ count: state.historyCount, bytes: state.historyBytes }]; }
      if (sql.includes("FOR SHARE")) { events.push("share-lock"); return state.locked ? [{ id: "plan" }] : []; }
      throw Error(`Unexpected synthetic SQL ${sql}`);
    }),
    testPlan: {
      findFirstOrThrow: vi.fn(async () => { events.push("private-detail-body"); return plan; }),
      findUniqueOrThrow: vi.fn(async () => ({ projectId: "project" })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { events.push("legacy-plan-write"); plan.status = String(data.status); if (Object.hasOwn(data, "customFields")) plan.customFields = data.customFields; return { ...plan, executionTemplate: null }; }),
    },
    testPlanVersion: { findMany: vi.fn(async () => { events.push("private-history-bodies"); return versions; }), findFirst: vi.fn(async () => ({ versionNumber: 1 })), create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => ({ id: "version", ...data })) },
  };
  const db = { ...tx, $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => work(tx)) };
  const caller = testPlansRouter.createCaller({ prisma: db, user: { id: "actor", clerkUserId: "clerk" } } as never);
  return { db, tx, state, plan, versions, events, caller };
}
describe("bounded lossless plan reads and legacy retention (mock SQL only)", () => {
  beforeEach(() => { guards.read.mockReset().mockResolvedValue(scope); guards.access.mockReset().mockResolvedValue({ project: { organizationId: "org" } }); guards.audit.mockReset().mockResolvedValue(undefined); guards.readiness.mockReset(); });
  it.each([null,"release","private-foreign-release",""])("registered legacy setRelease %j uniformly refuses without private lookup, writes or invented recovery",async releaseId=>{
    const f=fixture(),before=structuredClone(f.plan),versions=structuredClone(f.versions);
    const request={testPlanId:"private-plan-identity",releaseId};
    const failure=f.caller.setRelease(request);
    await expect(failure).rejects.toMatchObject({code:"PRECONDITION_FAILED",message:expect.stringContaining("Legacy plan release assignment writes no longer accept changes")});
    await expect(failure).rejects.toThrow("testPlanGovernance.detachAttachedPlan");
    await expect(failure).rejects.toThrow("testPlanGovernance.attachUnassignedPlan");
    await expect(failure).rejects.toThrow("may already have applied");await expect(failure).rejects.toThrow("may lack a durable receipt");
    await expect(failure).rejects.toThrow("do not automatically resubmit");await expect(failure).rejects.not.toThrow(request.testPlanId);
    expect(f.plan).toEqual(before);expect(f.versions).toEqual(versions);expect(f.events).toEqual([]);
    for(const callback of [f.db.$transaction,f.tx.$queryRaw,f.tx.$executeRaw,f.tx.testPlan.findUniqueOrThrow,f.tx.testPlan.findFirstOrThrow,f.tx.testPlan.update,
      f.tx.testPlanVersion.findFirst,f.tx.testPlanVersion.findMany,f.tx.testPlanVersion.create,guards.access,guards.read,guards.audit,guards.readiness])expect(callback).not.toHaveBeenCalled();
  });
  it("retired assignment does not infer missing pins/revision/UUID or adopt extra old-client intent",async()=>{
    const f=fixture(),input={testPlanId:"plan",releaseId:null,projectId:"foreign",originalOrganizationId:"foreign",expectedClerkActorId:"foreign",expectedPlanRevision:"a".repeat(64),requestId:"46b926fe-cf36-4bc1-a0d3-c615fbac3dd1",confirmed:true};
    await expect(f.caller.setRelease(input)).rejects.toMatchObject({code:"PRECONDITION_FAILED"});
    expect(f.tx.testPlan.findUniqueOrThrow).not.toHaveBeenCalled();expect(f.tx.testPlan.update).not.toHaveBeenCalled();expect(guards.readiness).not.toHaveBeenCalled();
    const source=readFileSync(new URL("../routers/testPlans.ts",import.meta.url),"utf8"),legacy=source.slice(source.indexOf("  setRelease: protectedProcedure"),source.indexOf("  // P4-02:"));
    expect(legacy).toContain('.mutation(() =>');expect(legacy).not.toMatch(/ctx\.prisma|requireProjectAccess\(|snapshotTestPlanVersion\(|refreshReleaseReadiness\(|requestId:|expectedPlanRevision:|\.update\(/);
  });
  it("retirement remains behind the actual protected procedure for signed-out callers",async()=>{
    const f=fixture(),signedOut=testPlansRouter.createCaller({prisma:f.db,user:null} as never);
    await expect(signedOut.setRelease({testPlanId:"private-plan",releaseId:null})).rejects.toMatchObject({code:"UNAUTHORIZED"});
    expect(f.tx.testPlan.findUniqueOrThrow).not.toHaveBeenCalled();expect(f.tx.testPlan.update).not.toHaveBeenCalled();expect(guards.readiness).not.toHaveBeenCalled();
  });
  it("current original actor/tenant authorization precedes bodies and bounded relation locks", async () => {
    const f = fixture(), value = await readTestPlanDetail(f.db as never, "actor", "plan", authorized);
    expect(value.customFields).toBeNull(); expect(value.strategyName).toBeNull();
    expect(guards.read).toHaveBeenCalledWith(expect.anything(), "actor", { projectId: "project", originalOrganizationId: "org", expectedClerkActorId: "clerk" }, authorized);
    expect(guards.read).toHaveBeenCalledBefore(f.tx.testPlan.findFirstOrThrow);
    expect(f.events).toEqual(["identity-discovery", "share-lock", "identity-relationship-check", "detail-native-preflight", "share-lock", "share-lock", "share-lock", "private-detail-body"]);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 });
  });
  it("minimal unsupported/missing identity and denied actor fail before private lookup or body byte preflight", async () => {
    const wide = fixture(); await expect(readTestPlanDetail(wide.db as never, "actor", "x".repeat(201), authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(wide.tx.$queryRaw).not.toHaveBeenCalled();
    const missing = fixture(); missing.state.projectId = null; await expect(readTestPlanDetail(missing.db as never, "actor", "plan", authorized)).rejects.toMatchObject({ code: "NOT_FOUND" }); expect(missing.events).toEqual(["identity-discovery"]);
    const denied = fixture(); guards.read.mockRejectedValueOnce(new Error("Current actor/member revoked")); await expect(readTestPlanDetail(denied.db as never, "actor", "plan", authorized)).rejects.toThrow("revoked"); expect(denied.events).toEqual(["identity-discovery"]); expect(denied.tx.testPlan.findFirstOrThrow).not.toHaveBeenCalled();
  });
  it("foreign strategy/linked-plan identities deny even native body-size inspection, not an exclusion count", async () => {
    const f = fixture(); f.state.foreign = true;
    await expect(readTestPlanDetail(f.db as never, "actor", "plan", authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).not.toContain("detail-native-preflight"); expect(f.events).not.toContain("private-detail-body");
    const statements = f.tx.$queryRaw.mock.calls.map(([raw]) => Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql);
    expect(statements.find(sql => sql.includes('AS "foreign"'))).not.toMatch(/\.name|description|customFields|fieldSchema/);
  });
  it("exact 128KiB/200 relation boundaries admit; overflow and incomplete collections refuse without truncation", async () => {
    const exact = fixture(); exact.state.detailBytes = 128n * 1024n; exact.state.criteria = 200n; exact.state.links = 200n;
    exact.plan.acceptanceCriteria = Array.from({ length: 200 }, (_, index) => ({ id: `criterion-${index}`, description: "Fixture", status: "PENDING", requirementId: null }));
    exact.plan.linkedPlans = Array.from({ length: 200 }, (_, index) => ({ id: `linked-${index}`, name: "Fixture", status: "DRAFT" }));
    expect((await readTestPlanDetail(exact.db as never, "actor", "plan", authorized)).linkedPlans).toHaveLength(200);
    for (const change of [{ detailBytes: 128n * 1024n + 1n }, { criteria: 201n }, { links: 201n }]) { const f = fixture(); Object.assign(f.state, change); await expect(readTestPlanDetail(f.db as never, "actor", "plan", authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.events).not.toContain("private-detail-body"); }
    const missing = fixture(); missing.state.criteria = 1n; await expect(readTestPlanDetail(missing.db as never, "actor", "plan", authorized)).rejects.toThrow("No smaller list");
  });
  it("router detail/history output preserves null,array,string,boolean,false/zero and ordinary JSON roots", async () => {
    for (const root of [null, ["literal", "", null, false, 0], "  Exact scalar\n", false, 0, { unknown: null, nested: [false, 0, ""] }]) {
      const f = fixture(); f.plan.customFields = root; f.versions[0]!.customFields = root; f.versions[0]!.executionTemplate = root;
      expect((await f.caller.byId({ id: "plan" })).customFields).toEqual(root);
      const versions = await f.caller.history({ testPlanId: "plan" }); expect(versions[0]!.customFields).toEqual(root); expect(versions[0]!.executionTemplate).toEqual(root);
    }
  });
  it("whole history is bounded500/16MiB and locked before materialization, never a hidden partial page", async () => {
    const exact = fixture(); exact.state.historyCount = 500n; exact.state.historyBytes = 16n * 1024n * 1024n;
    exact.versions = Array.from({ length: 500 }, (_, index) => ({ ...exact.versions[0]!, versionNumber: index + 1 }));
    exact.tx.testPlanVersion.findMany.mockImplementation(async () => { exact.events.push("private-history-bodies"); return exact.versions; });
    expect(await readTestPlanHistory(exact.db as never, "actor", "plan", authorized)).toHaveLength(500);
    for (const change of [{ historyCount: 501n }, { historyBytes: 16n * 1024n * 1024n + 1n }]) { const f = fixture(); Object.assign(f.state, change); await expect(readTestPlanHistory(f.db as never, "actor", "plan", authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.events).not.toContain("private-history-bodies"); }
    const missing = fixture(); missing.state.historyCount = 2n; await expect(readTestPlanHistory(missing.db as never, "actor", "plan", authorized)).rejects.toThrow("No subset or empty history");
  });
  it("encoded body overflow is refused even after mocked native byte admission, not cropped prose", async () => {
    const detail = fixture(); detail.plan.name = "x".repeat(128 * 1024); await expect(readTestPlanDetail(detail.db as never, "actor", "plan", authorized)).rejects.toThrow("encoded plan");
    const history = fixture(); history.versions[0]!.name = "x".repeat(16 * 1024 * 1024); await expect(readTestPlanHistory(history.db as never, "actor", "plan", authorized)).rejects.toThrow("encoded legacy history");
  });
  it("deep admitted-byte JSON refuses before encoding without RangeError or replacement", async () => {
    let deep: unknown = { original: "retained" };
    for (let index = 0; index < 80; index++) deep = { nested: deep };
    for (const target of ["metadata", "type-schema", "history-metadata", "history-template"]) {
      const f = fixture();
      if (target === "metadata") f.plan.customFields = deep;
      else if (target === "type-schema") f.plan.testPlanType.fieldSchema = deep as never;
      else if (target === "history-metadata") f.versions[0]!.customFields = deep;
      else f.versions[0]!.executionTemplate = deep;
      const call = target.startsWith("history") ? readTestPlanHistory(f.db as never, "actor", "plan", authorized) : readTestPlanDetail(f.db as never, "actor", "plan", authorized);
      await expect(call).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("bounded safe structure") });
      expect(f.tx.testPlan.update).not.toHaveBeenCalled(); expect(f.tx.testPlanVersion.create).not.toHaveBeenCalled();
    }
  });
  it("deprecated status-only requests preserve every native root without mutation or version capture", async () => {
    for (const [root, kind] of [[null, "null"], [["raw", false], "array"], ["scalar", "string"], [0, "number"], [false, "boolean"], [{ retained: null }, "object"]] as const) {
      const f = fixture(); f.plan.customFields = root; f.state.metadataRootKind = kind;
      await expect(f.caller.update({ id: "plan", status: "ACTIVE" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(f.plan.customFields).toBe(root);
      expect(f.tx.testPlan.update).not.toHaveBeenCalled(); expect(f.tx.testPlanVersion.create).not.toHaveBeenCalled();
    }
  });
  it("explicit object replacement of a retained nonobject root refuses before any mutation/version", async () => {
    for (const kind of ["null", "array", "number", "boolean", "string", null]) { const f = fixture(); f.state.metadataRootKind = kind; await expect(f.caller.update({ id: "plan", status: "ACTIVE", customFields: {} })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.tx.testPlan.update).not.toHaveBeenCalled(); expect(f.tx.testPlanVersion.create).not.toHaveBeenCalled(); }
    expect(assertLegacyPlanMetadataRetention(null, undefined)).toBeUndefined(); expect(() => assertLegacyPlanMetadataRootKind("array", {})).toThrow("Save status without customFields");
  });
  it("supported raw records retain __proto__/constructor/nested/null own keys without prototype modification", async () => {
    const raw = JSON.parse('{"__proto__":{"retained":true},"constructor":"original","future":{"nested":[null,false,0]},"null_value":null}');
    const prototype = Object.getPrototypeOf(raw), parsed = legacyPlanCustomFieldRecord.parse(raw);
    expect(parsed).toBe(raw); expect(Object.hasOwn(parsed, "__proto__")).toBe(true); expect(Object.getPrototypeOf(parsed)).toBe(prototype);
    const f = fixture(); f.state.metadataRootKind = "object"; f.plan.customFields = raw;
    await expect(f.caller.update({ id: "plan", status: "ACTIVE", customFields: raw })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(f.plan.customFields).toBe(raw); expect(Object.keys(f.plan.customFields as object)).toEqual(Object.keys(raw)); expect(Object.getPrototypeOf(f.plan.customFields)).toBe(prototype); expect(({} as { retained?: boolean }).retained).toBeUndefined();
    await expect(f.caller.update({ id: "plan", status: "DRAFT" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.plan.customFields).toBe(raw);
    expect(f.tx.testPlan.update).not.toHaveBeenCalled(); expect(f.tx.testPlanVersion.create).not.toHaveBeenCalled();
  });
  it("raw record acceptance does not widen to nonobject/non-JSON values or invoke serialization hooks", () => {
    for (const value of [null, [], "scalar", 0, false, { unknown: undefined }, { unknown: NaN }, { method() { return {}; } }, new Date()]) expect(legacyPlanCustomFieldRecord.safeParse(value).success).toBe(false);
    let calls = 0; const getter = Object.defineProperty({}, "future", { enumerable: true, get() { calls++; return "not executed"; } });
    expect(legacyPlanCustomFieldRecord.safeParse(getter).success).toBe(false); expect(calls).toBe(0);
  });
  it("legacy header/add/delete refusal protocols remain and reader outputs avoid Record casts/default repair", async () => {
    const f = fixture(); await expect(f.caller.update({ id: "plan", status: "ACTIVE", name: "Forbidden mixed header" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.tx.testPlan.update).not.toHaveBeenCalled();
    const source = readFileSync(new URL("../routers/testPlans.ts", import.meta.url), "utf8"), readSource = readFileSync(new URL("./testPlanReads.ts", import.meta.url), "utf8");
    const update = source.slice(source.indexOf("  update: protectedProcedure"), source.indexOf("  setRelease: protectedProcedure"));
    expect(update).toContain("legacyPlanCustomFieldRecord.optional()"); expect(update).not.toContain(".default({})"); expect(update).toContain("Legacy whole-plan writes no longer accept changes"); expect(update).toContain("testPlanGovernance.setPlanStatus"); expect(update).toContain("testPlanGovernance.editPlanCustomFields"); expect(update).not.toMatch(/ctx\.prisma|testPlan\.update|snapshotTestPlanVersion\(/);
    expect(source).toContain("Legacy criterion additions no longer accept writes"); expect(source).toContain("Legacy criterion removals no longer accept writes");
    expect(readSource).toContain("statement_timeout='8000ms'"); expect(readSource).toContain("FOR SHARE OF t"); expect(readSource).toContain("FOR SHARE OF u"); expect(readSource.slice(readSource.indexOf("export async function readTestPlanDetail"))).not.toMatch(/as Record|\$queryRawUnsafe|fetch\(|invokeModel/);
  });
});
