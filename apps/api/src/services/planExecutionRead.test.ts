import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { PrismaClient } from "@vaettir/db";
import type { Context } from "../trpc.js";
const mocks = vi.hoisted(() => ({ scope: vi.fn() }));
vi.mock("@vaettir/db", () => ({ prisma: {}, Prisma: { TransactionIsolationLevel: { RepeatableRead: "RepeatableRead" } } }));
vi.mock("./caseFieldReadScope.js", () => ({ lockCaseFieldReadScope: mocks.scope }));
vi.mock("../clerk.js", () => ({ verifyClerkSessionToken: vi.fn(), getOrCreateLocalUser: vi.fn() }));
import { readPlanExecutionAccess as access, readPlanExecutionPage as page, admitPlanExecutionTemplateText } from "./planExecutionRead.js";
import { PLAN_EXECUTION_READ_BOUNDS as bounds, planExecutionReadKey, planExecutionCandidateScopeKey } from "./planExecutionReadSchema.js";
import { planExecutionReadsRouter } from "../routers/planExecutionReads.js";
import { executionTemplateHash, readPlanExecutionTemplate } from "./testPlanExecution.js";

const input = { projectId: "project", testPlanId: "plan", originalOrganizationId: "org", expectedClerkActorId: "verified", expectedNativeActorId: "native", requestId: "00000000-0000-4000-8000-000000000001", search: "", limit: 2 };
const authorized = { clerkActorId: "verified" };
function fixture() {
  const events: string[] = [];
  const row = (id: string, archived = false) => ({ id, projectId: "project", title: ` Exact\n ${id} `, displayId: "", reviewStatus: "PENDING_REVIEW", archived });
  const raw = { version: 1, testCaseIds: ["selected", "missing", "archived"], configurations: [{ id: "00000000-0000-4000-8000-000000000002", name: " Native name ", context: { configuration: " Native\n context " } }] };
  const state = {
    discovery: [{ projectId: "project", organizationId: "org" }],
    scope: { projectId: "project", organizationId: "org", actorId: "native", actorClerkUserId: "verified" },
    member: [{ role: "VIEWER", seatType: "READ_ONLY" }],
    locked: [{ id: "plan" }],
    size: { templateBytes: BigInt(Buffer.byteLength(JSON.stringify(raw))), planBytes: 100n, kind: "object" as string | null, sqlNull: false, cases: 3n, configurations: 1n, scalarSupported: true },
    relation: { foreign: false, invalid: false },
    population: { selectedBytes: 300n, selectedCount: 2n, candidateBytes: 400n, candidateCount: 3n, scalarSupported: true },
    body: { id: "plan", projectId: "project", name: " Plan\n name ", status: "ACTIVE", templateText: JSON.stringify(raw) },
    selected: [row("selected"), row("archived", true)],
    candidates: [row("a"), row("b"), row("c")],
    equality: true,
    cursor: true,
    failBody: false,
  };
  mocks.scope.mockReset();
  mocks.scope.mockImplementation(async () => { events.push("AUTH_SCOPE"); return state.scope; });
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?");
    if (sql.includes('AS "organizationId"')) { events.push("IDENTITY_DISCOVERY"); return state.discovery; }
    if (sql.includes('SELECT id FROM "TestPlan"')) { events.push("PLAN_LOCK"); return state.locked; }
    if (sql.includes('FROM "Membership"')) { events.push("MEMBER"); return state.member; }
    if (sql.includes('AS "templateBytes"')) { events.push("PLAN_ADMISSION"); return [state.size]; }
    if (sql.includes(" AS foreign")) { events.push("RELATION_ADMISSION"); return [state.relation]; }
    if (sql.includes(" AS present")) { events.push("CURSOR"); return [{ present: state.cursor }]; }
    if (sql.includes('AS "selectedBytes"')) { events.push("METADATA_ADMISSION"); return [state.population]; }
    if (sql.includes("SELECT c.id FROM")) { events.push("CASE_LOCK"); return []; }
    if (sql.includes('AS "templateText"')) { events.push("PRIVATE_TEMPLATE"); if (state.failBody) throw Error("Private SQL/body: native-secret"); return [state.body]; }
    if (sql.includes(" AS exact")) { events.push("NATIVE_EQUALITY"); return [{ exact: state.equality }]; }
    if (sql.includes('SELECT c.id,c."projectId",c.title')) {
      if (sql.includes(" LIMIT ")) { events.push("PRIVATE_CANDIDATES"); return state.candidates; }
      events.push("PRIVATE_SELECTED"); return state.selected;
    }
    throw Error("Unexpected synthetic plan execution query");
  });
  const tx = { $queryRaw: query, $executeRaw: vi.fn(async () => { events.push("STATEMENT_LIMIT"); return 0; }) };
  const transaction = vi.fn(async (work: (transactionScope: typeof tx) => Promise<unknown>, options: unknown) => {
    expect(options).toEqual({ isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 });
    return work(tx);
  });
  const db = { $transaction: transaction } as unknown as PrismaClient;
  function template(value: unknown) { state.body.templateText = JSON.stringify(value); state.size.templateBytes = BigInt(Buffer.byteLength(state.body.templateText)); }
  return { db, query, transaction, tx, events, state, template, raw };
}
function reader(h: ReturnType<typeof fixture>, subject: string | null | undefined, actor = "native", signedIn = true) {
  return planExecutionReadsRouter.createCaller({ prisma: h.db, user: signedIn ? { id: actor, clerkUserId: "stale-cached-mapping", memberships: [] } : null, staff: null, authenticatedClerkSubject: subject } as unknown as Context);
}
describe("additive plan execution native reader, mocked queries only; SQL NOT RUN", () => {
  it.each([undefined, null, "", "bad\0subject", "x".repeat(201)])("missing/invalid independent subject %j refuses before native discovery", async subject => {
    const h = fixture();
    await expect(access(h.db, "native", input, { clerkActorId: subject as unknown as string })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("native N cannot follow native M or replace verified subject with stored mapping", async () => {
    const h = fixture();
    await expect(page(h.db, "remapped", input, authorized)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(page(h.db, "native", input, { clerkActorId: "stored" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.transaction).not.toHaveBeenCalled();
  });
  it("identity-only bootstrap pins scope without template/candidate bodies; read-only membership is not upgraded", async () => {
    const h = fixture(), accessInput = { projectId: input.projectId, testPlanId: input.testPlanId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId, expectedNativeActorId: input.expectedNativeActorId, requestId: input.requestId }, result = await access(h.db, "native", accessInput, authorized);
    expect(h.events).toEqual(["STATEMENT_LIMIT", "IDENTITY_DISCOVERY", "AUTH_SCOPE", "PLAN_LOCK", "MEMBER"]);
    expect(result.hasFullEditorAccess).toBe(false);
    expect(result.readContext.scope).toEqual({ ...h.state.scope, testPlanId: "plan" });
    expect(result.readContext.requestedKey).toBe(planExecutionReadKey(accessInput, "ACCESS"));
    expect(mocks.scope).toHaveBeenCalledWith(h.tx, "native", accessInput, authorized);
  });
  it.each(["project", "organization", "native", "clerk", "plan"])("changed %s original scope refuses before private body", async kind => {
    const h = fixture();
    if (kind === "project") h.state.discovery[0]!.projectId = "foreign";
    if (kind === "organization") h.state.discovery[0]!.organizationId = "foreign";
    if (kind === "native") h.state.scope.actorId = "remapped";
    if (kind === "clerk") h.state.scope.actorClerkUserId = "remapped";
    if (kind === "plan") h.state.locked = [];
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: kind === "plan" ? "NOT_FOUND" : "FORBIDDEN" });
    expect(h.events).not.toContain("PLAN_ADMISSION");
    expect(h.events).not.toContain("PRIVATE_TEMPLATE");
  });
  it("complete saved order retains missing/archived identities outside candidate page; separate normalized view never rewrites raw", async () => {
    const h = fixture(), result = await page(h.db, "native", input, authorized);
    expect(result.rawTemplate.jsonText).toBe(h.state.body.templateText);
    expect(result.templateHash).toBe(executionTemplateHash(h.raw));
    expect(result.interpretation).toBe("LEGACY_NORMALIZED");
    expect(result.template?.configurations[0]?.name).toBe("Native name");
    expect(result.template?.configurations[0]?.context.configuration).toBe("Native\n context");
    expect(result.selected.map(item => [item.testCaseId, item.state])).toEqual([["selected", "AVAILABLE"], ["missing", "MISSING"], ["archived", "ARCHIVED"]]);
    expect(result.candidates.map(item => item.id)).toEqual(["a", "b"]);
    expect(result.nextCursor).toEqual({ scopeKey: planExecutionCandidateScopeKey(input), lastId: "b" });
    expect(result.plan.name).toBe(" Plan\n name ");
    expect(result.candidates[0]?.displayId).toBe("");
    expect(h.events.indexOf("AUTH_SCOPE")).toBeLessThan(h.events.indexOf("PLAN_ADMISSION"));
    expect(h.events.indexOf("METADATA_ADMISSION")).toBeLessThan(h.events.indexOf("PRIVATE_TEMPLATE"));
  });
  it("legacy empty object is unconfigured with its existing real hash, not NULL or an invented blank template", async () => {
    const h = fixture(); h.template({}); h.state.size.cases = 0n; h.state.size.configurations = 0n; h.state.population.selectedCount = 0n; h.state.selected = [];
    const result = await page(h.db, "native", input, authorized);
    expect(result.template).toBeNull(); expect(result.selected).toEqual([]);
    expect(result.templateHash).toBe(executionTemplateHash({}));
    expect(result.interpretation).toBe("UNCONFIGURED_EMPTY_OBJECT");
  });
  it("canonical complete template retains exact-supported interpretation and unchanged legacy hash", async () => {
    const h = fixture(), parsed = readPlanExecutionTemplate(h.raw); h.template(parsed);
    const result = await page(h.db, "native", input, authorized);
    expect(result.interpretation).toBe("EXACT_SUPPORTED");
    expect(result.template).toEqual(parsed); expect(result.templateHash).toBe(executionTemplateHash(parsed));
  });
  it("exact 500-case/20-configuration boundary stays supported with every missing saved identity retained", async () => {
    const h = fixture(), ids = Array.from({ length: 500 }, (_, index) => `missing-${index}`);
    h.template({ version: 1, testCaseIds: ids, configurations: Array.from({ length: 20 }, (_, index) => ({ id: `00000000-0000-4000-8000-${String(index + 10).padStart(12, "0")}`, name: `Configuration ${index}`, context: {} })) });
    h.state.size.cases = 500n; h.state.size.configurations = 20n;
    h.state.population.selectedCount = 0n; h.state.population.selectedBytes = 0n; h.state.selected = [];
    const result = await page(h.db, "native", input, authorized);
    expect(result.selected).toHaveLength(500);
    expect(result.selected.map(item => item.testCaseId)).toEqual(ids);
    expect(result.selected.every(item => item.state === "MISSING" && item.metadata === null)).toBe(true);
    expect(result.template?.configurations).toHaveLength(20);
  });
  it("empty candidate page is genuinely empty while saved identities remain complete", async () => {
    const h = fixture(); h.state.candidates = []; h.state.population.candidateCount = 0n; h.state.population.candidateBytes = 0n;
    const result = await page(h.db, "native", input, authorized);
    expect(result.candidates).toEqual([]); expect(result.nextCursor).toBeNull();
    expect(result.selected).toHaveLength(3);
  });
  it("native current full editor capability remains separate from archive/start/receipt authority", async () => {
    const h = fixture(); h.state.member = [{ role: "OWNER", seatType: "FULL" }]; h.state.body.status = "ARCHIVED";
    const result = await page(h.db, "native", input, authorized);
    expect(result.hasFullEditorAccess).toBe(true); expect(result.plan.status).toBe("ARCHIVED");
    expect(result).not.toHaveProperty("canStart"); expect(result).not.toHaveProperty("canRecover");
    h.state.member = [{ role: "OWNER", seatType: "READ_ONLY" }];
    expect((await page(h.db, "native", input, authorized)).hasFullEditorAccess).toBe(false);
  });
  it.each(["templateBytes", "planBytes", "cases", "configurations", "kind", "sqlNull", "scalarSupported"])("native %s admission refuses before any private body", async field => {
    const h = fixture();
    if (field === "templateBytes") h.state.size.templateBytes = BigInt(bounds.templateBytes + 1);
    if (field === "planBytes") h.state.size.planBytes = 41001n;
    if (field === "cases") h.state.size.cases = 501n;
    if (field === "configurations") h.state.size.configurations = 21n;
    if (field === "kind") h.state.size.kind = "null";
    if (field === "sqlNull") h.state.size.sqlNull = true;
    if (field === "scalarSupported") h.state.size.scalarSupported = false;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("RELATION_ADMISSION"); expect(h.events).not.toContain("PRIVATE_TEMPLATE");
  });
  it.each(["foreign", "invalid"])("whole saved %s relationship refuses before bodies/metadata counts", async field => {
    const h = fixture(); h.state.relation[field as "foreign" | "invalid"] = true;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: field === "foreign" ? "FORBIDDEN" : "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("METADATA_ADMISSION"); expect(h.events).not.toContain("PRIVATE_TEMPLATE");
  });
  it.each(["selectedBytes", "candidateBytes", "candidateCount", "selectedCount", "scalarSupported", "negative"])("metadata %s refuses before materialization", async field => {
    const h = fixture();
    if (field === "selectedBytes") h.state.population.selectedBytes = BigInt(bounds.selectedBytes + 1);
    if (field === "candidateBytes") h.state.population.candidateBytes = BigInt(bounds.candidateBytes + 1);
    if (field === "candidateCount") h.state.population.candidateCount = 4n;
    if (field === "selectedCount") h.state.population.selectedCount = 4n;
    if (field === "scalarSupported") h.state.population.scalarSupported = false;
    if (field === "negative") h.state.population.selectedBytes = -1n;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("PRIVATE_TEMPLATE");
  });
  it("combined native admission cannot sum independent caps into an oversized read", async () => {
    const h = fixture(); h.state.size.templateBytes = BigInt(bounds.templateBytes); h.state.population.selectedBytes = BigInt(bounds.selectedBytes); h.state.population.candidateBytes = 1n;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("PRIVATE_TEMPLATE");
  });
  it("native JSONB equality refuses precision loss before legacy hashing/private metadata projection", async () => {
    const h = fixture(); h.state.equality = false;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).toContain("NATIVE_EQUALITY"); expect(h.events).not.toContain("PRIVATE_SELECTED");
  });
  it("decoded complete template counts must match the exact native count admission", async () => {
    const h = fixture(); h.state.size.cases = 2n;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("PRIVATE_SELECTED");
    h.state.size.cases = 3n; h.state.size.configurations = 0n;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("PRIVATE_SELECTED");
  });
  it.each([null, [], { version: 999 }, { version: 1, testCaseIds: ["selected"], configurations: [], future: { unsafe: true } }])("unsupported retained template %j gets no substitute hash or normalized body", async value => {
    const h = fixture(); h.template(value);
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(h.events).not.toContain("PRIVATE_SELECTED");
  });
  it("deep structure, malformed/oversized text and non-finite JSON are generically refused before hash", () => {
    let deep: unknown = null; for (let index = 0; index < 70; index++) deep = { nested: deep };
    for (const text of [JSON.stringify(deep), "{broken", JSON.stringify("x".repeat(bounds.templateBytes)), "{\"future\":1e9999}"]) expect(() => admitPlanExecutionTemplateText(text)).toThrow("unsupported");
  });
  it("exact cursor is tied to original search/native/page limit and currently matching active identity", async () => {
    const h = fixture();
    await expect(page(h.db, "native", { ...input, cursor: { scopeKey: "wrong", lastId: "a" } }, authorized)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.transaction).not.toHaveBeenCalled();
    h.state.cursor = false;
    await expect(page(h.db, "native", { ...input, cursor: { scopeKey: planExecutionCandidateScopeKey(input), lastId: "a" } }, authorized)).rejects.toMatchObject({ code: "CONFLICT" });
    expect(h.events).not.toContain("PRIVATE_TEMPLATE");
  });
  it.each(["order", "duplicate", "archived", "foreign", "title", "count"])("projected %s disagreement refuses the whole page", async kind => {
    const h = fixture();
    if (kind === "order") h.state.candidates.reverse();
    if (kind === "duplicate") h.state.candidates[1]!.id = "a";
    if (kind === "archived") h.state.candidates[0]!.archived = true;
    if (kind === "foreign") h.state.selected[0]!.projectId = "foreign";
    if (kind === "title") h.state.candidates[0]!.title = "😀".repeat(5001);
    if (kind === "count") h.state.selected.pop();
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: kind === "foreign" ? "FORBIDDEN" : "PRECONDITION_FAILED" });
  });
  it("final complete encoded wire body is separately bounded including duplicate raw/interpreted text", async () => {
    const h = fixture(); const hugeName = "<".repeat(10000);
    h.state.selected = Array.from({ length: 250 }, (_, index) => ({ id: `selected-${index}`, projectId: "project", title: hugeName, displayId: "", reviewStatus: "APPROVED", archived: false }));
    h.template({ version: 1, testCaseIds: h.state.selected.map(item => item.id), configurations: [] });
    h.state.size.cases = 250n; h.state.size.configurations = 0n; h.state.population.selectedCount = 250n;
    await expect(page(h.db, "native", input, authorized)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it.each([undefined, null, "", "bad\0subject"])("actual protected router subject %j refuses without native work", async subject => {
    const h = fixture(); await expect(reader(h, subject).page(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.transaction).not.toHaveBeenCalled();
  });
  it("actual protected router is signed-in only and does not trust cached User Clerk mapping", async () => {
    const h = fixture();
    await expect(reader(h, "verified", "native", false).access(input)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(h.transaction).not.toHaveBeenCalled();
    expect((await reader(h, "verified").page(input)).readContext.scope.actorClerkUserId).toBe("verified");
    expect(mocks.scope).toHaveBeenLastCalledWith(h.tx, "native", input, authorized);
  });
  it("actual router native M and absent legacy subject cannot bypass the expected original pin", async () => {
    const h = fixture();
    await expect(reader(h, "verified", "native-M").page(input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.transaction).not.toHaveBeenCalled();
    const omitted = planExecutionReadsRouter.createCaller({ prisma: h.db, user: { id: "native", clerkUserId: "verified", memberships: [] }, staff: null } as unknown as Context);
    await expect(omitted.page(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.transaction).not.toHaveBeenCalled();
  });
  it("actual router withholds raw native failure text", async () => {
    const h = fixture(); h.state.failBody = true;
    const failure = await reader(h, "verified").page(input).catch(error => error as Error);
    expect(failure).toMatchObject({ code: "INTERNAL_SERVER_ERROR" });
    expect(String(failure)).not.toContain("native-secret");
  });
  it("auth-before-body/native-byte/pointer source contracts contain no writes, whole selects, provider/source actions or legacy caller edits", () => {
    const source = readFileSync(new URL("./planExecutionRead.ts", import.meta.url), "utf8"), router = readFileSync(new URL("../routers/planExecutionReads.ts", import.meta.url), "utf8");
    expect(router).toContain("ctx.authenticatedClerkSubject"); expect(router).not.toContain("ctx.user.clerkUserId");
    expect(source).toContain('octet_length(concat(id,"projectId",title,"displayId","reviewStatus"::text,archived::text))::bigint');
    expect(source).toContain('jsonb_typeof(v)=\'string\'');
    expect(source).toContain("FOR SHARE OF c");
    expect(source).not.toMatch(/SELECT\s+(?:c\.\*|\*)|\.create\(|\.update\(|\.delete\(|storageUrl|ciRunUrl|generateQaStrategy|autoEnqueue|\.fetch\(/);
  });
});
