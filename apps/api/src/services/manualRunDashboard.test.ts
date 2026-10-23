import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
import { readFileSync } from "node:fs";
import { assembleManualRunDashboard, type DashboardScope, type DashboardResult, type DashboardCaseHead, type DashboardStepHead } from "./manualRunDashboardAssembly.js";
import { readManualRunDashboard, manualRunDashboardRequestKey } from "./manualRunDashboard.js";
import { manualRunDashboardInputSchema, manualRunDashboardOutputSchema } from "./manualRunDashboardSchema.js";
const input = { projectId: "project", originalOrganizationId: "org", start: "2026-01-01", end: "2026-01-02" };
function run(id = "run", ids = ["case"], steps = 2): DashboardScope { return { id, projectId: "project", startedAt: new Date("2026-01-01T12:00:00Z"), status: "RUNNING", scopeSupported: true, plannedIds: ids, definitions: ids.map(caseId => ({ caseId, stepCount: steps, completeProcedure: true })) }; }
function result(runId = "run", caseId = "case", status = "PASS", id = `${runId}-${caseId}`): DashboardResult { return { id, runId, caseId, status }; }
function head(runId = "run", caseId = "case", status = "PASS"): DashboardCaseHead { return { runId, caseId, organizationId: "org", projectId: "project", resultId: `${runId}-${caseId}`, revisionId: `rev-${runId}-${caseId}`, revisionRunId: runId, revisionCaseId: caseId, revisionOrganizationId: "org", revisionProjectId: "project", revisionResultId: `${runId}-${caseId}`, revisionCount: 2, revisionNumber: 2, status }; }
function step(index: number, status = "PASS", runId = "run", caseId = "case"): DashboardStepHead { return { runId, caseId, stepIndex: index, revisionId: `rev-${runId}-${caseId}-${index}`, revisionRunId: runId, revisionCaseId: caseId, revisionStepIndex: index, revisionNumber: 2, revisionCount: 2, status }; }
const assemble = (runs: DashboardScope[], results: DashboardResult[] = [], heads: DashboardCaseHead[] = [], steps: DashboardStepHead[] = []) => assembleManualRunDashboard("project", "org", input.start, input.end, runs, results, heads, steps);

describe("trusted saved manual run-case instance aggregation", () => {
  it("counts the same case separately in two runs and keeps future-window empty days literal zero", () => {
    const value = assemble([run("a"), run("b")], [result("a")], [head("a")]);
    expect(value.totals).toMatchObject({ runs: 2, trustedRuns: 2, plannedInstances: 2, recordedInstances: 1, remainingInstances: 1, outcomes: { PASS: 1 }, inProgressTrustedRuns: 2 });
    expect(value.days[1]).toMatchObject({ day: "2026-01-02", runs: 0, plannedInstances: 0 });
  });
  it("current corrected head counts once, not revision count or earlier status", () => {
    const value = assemble([run()], [result("run", "case", "FAIL")], [head("run", "case", "FAIL")]);
    expect(value.totals).toMatchObject({ recordedInstances: 1, remainingInstances: 0, outcomes: { FAIL: 1, PASS: 0 } });
  });
  it("complete current step heads derive the current unique verdict with correct precedence", () => {
    for (const [statuses, verdict] of [[["PASS", "PASS"], "PASS"], [["BLOCKED", "FAIL"], "FAIL"], [["SKIP", "BLOCKED"], "BLOCKED"], [["PASS", "SKIP"], "SKIP"]] as const) {
      expect(assemble([run()], [result("run", "case", verdict)], [], statuses.map((status, index) => step(index, status))).totals).toMatchObject({ trustedRuns: 1, recordedInstances: 1, outcomes: { [verdict]: 1 } });
    }
  });
  it("partial step evidence does not masquerade as a completed case or proof no attempt happened", () => {
    expect(assemble([run()], [], [], [step(0)]).totals).toMatchObject({ trustedRuns: 1, recordedInstances: 0, remainingInstances: 1, partialStepInstances: 1 });
  });
  it("legacy/untracked results exclude their entire run, never inflate remaining or trusted totals", () => {
    const legacy = run("legacy"); legacy.scopeSupported = false;
    const value = assemble([run("clean"), legacy, run("untracked", ["case", "another"])], [result("untracked")]);
    expect(value.totals).toMatchObject({ runs: 3, trustedRuns: 1, excludedRuns: 2, plannedInstances: 1, remainingInstances: 1, exclusions: { UNSUPPORTED_FROZEN_SCOPE: 1, UNTRACKED_RESULT: 1 } });
  });
  it("duplicate identical and conflicting result rows both exclude a run rather than choose a latest observation", () => {
    for (const status of ["PASS", "FAIL"]) expect(assemble([run()], [result(), result("run", "case", status, "second")], [head()]).totals).toMatchObject({ trustedRuns: 0, plannedInstances: 0, recordedInstances: 0, exclusions: { AMBIGUOUS_RESULT: 1 } });
  });
  it("projection disagreement, missing/current revision and mixed head sources never produce trusted progress", () => {
    const variants: Array<[DashboardResult[], DashboardCaseHead[], DashboardStepHead[]]> = [
      [[result("run", "case", "FAIL")], [head()], []],
      [[result()], [{ ...head(), revisionRunId: null }], []],
      [[result()], [{ ...head(), revisionNumber: 1 }], []],
      [[result()], [{ ...head(), revisionOrganizationId: null }], []],
      [[result()], [{ ...head(), revisionId: "bad\u0000revision" }], []],
      [[result()], [head()], [step(0), step(1)]],
      [[result()], [], [step(0)]],
      [[], [], [step(0), step(1)]],
      [[result()], [], [step(0), { ...step(1), revisionStepIndex: 0 }]],
      [[result()], [], [step(0), step(0)]],
    ];
    for (const [results, heads, steps] of variants) expect(assemble([run()], results, heads, steps).totals).toMatchObject({ trustedRuns: 0, plannedInstances: 0, exclusions: { HEAD_PROJECTION_MISMATCH: 1 } });
  });
  it("native unsupported frozen scopes are explicit, including 1001 IDs, duplicates, missing definitions and incomplete procedures", () => {
    const overflow = run("run", Array.from({ length: 1001 }, (_, index) => `case-${index}`)), duplicate = run("run", ["case", "case"]), missing = run(), incomplete = run();
    missing.definitions = []; incomplete.definitions[0]!.completeProcedure = false;
    for (const value of [overflow, duplicate, missing, incomplete]) expect(assemble([value]).totals).toMatchObject({ trustedRuns: 0, plannedInstances: 0, exclusions: { UNSUPPORTED_FROZEN_SCOPE: 1 } });
  });
  it("foreign original heads refuse before even legacy exclusions, with no foreign count result", () => {
    const legacy = run(); legacy.scopeSupported = false;
    for (const change of [{ organizationId: "other" }, { projectId: "other" }, { revisionOrganizationId: "other" }, { revisionProjectId: "other" }]) expect(() => assemble([legacy], [], [{ ...head(), ...change }])).toThrow("No foreign evidence counts");
  });
  it("outside-scope rows never advance completion and expose no native identities in summaries", () => {
    const value = assemble([run()], [result("run", "outside"), { ...result("run", "unmatched"), caseId: null }]);
    expect(value.totals).toMatchObject({ trustedRuns: 1, recordedInstances: 0, remainingInstances: 1, ignoredOutsideScopeResultRows: 2 });
    expect(JSON.stringify(value)).not.toContain("outside");
  });
  it("supports exactly 1000 cases/run and 100000 instances, refusing above the cohort boundary atomically", () => {
    const ids = Array.from({ length: 1000 }, (_, index) => `case-${index}`), runs = Array.from({ length: 100 }, (_, index) => run(`run-${index}`, ids));
    expect(assemble(runs).totals).toMatchObject({ plannedInstances: 100000, remainingInstances: 100000, trustedRuns: 100 });
    expect(() => assemble([...runs, run("extra")])).toThrow("100,000 planned");
    expect(() => assembleManualRunDashboard("project", "org", input.start, input.end, [run()], [], [], [], Date.now() - 1)).toThrow("bounded read budget");
  });
  it("empty supported scope is not 100% passing and dates/populations outside the exact request refuse", () => {
    expect(assemble([run("empty", [])]).totals).toMatchObject({ trustedRuns: 1, plannedInstances: 0, recordedInstances: 0 });
    expect(() => assemble([run()], [result("not-selected")])).toThrow("exact selected");
    expect(() => assemble([{ ...run(), startedAt: new Date("2026-01-03") }])).toThrow("exact applied UTC");
  });
});

function fixture() {
  const data = { scopes: [run()], results: [result()], cases: [head()], steps: [] as DashboardStepHead[] };
  const state = { clerkActor: "clerk", role: "VIEWER", seatType: "READ_ONLY", organizationId: "org", suspended: false, foreign: false, dateRuns: 1n, dateBytes: 0n, instances: 1n, definitions: 1n, scopeBytes: 0n, frozenBytes: 0n, maxFrozenBytes: 0n, resultCount: null as bigint | null, caseCount: null as bigint | null, stepCount: null as bigint | null, projectionBytes: 0n, scopeProjectionBytes: 0n, invalidProjection: false };
  const events: string[] = [];
  const tx = { $executeRaw: vi.fn(async () => 0), testRun: { findMany: vi.fn(async () => { events.push("selected-identities"); return data.scopes.map(({ id }) => ({ id })); }) }, $queryRaw: vi.fn(async (raw: TemplateStringsArray | { sql: string }) => {
    const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
    if (sql.includes('FROM "Organization"')) return [{ suspendedAt: state.suspended ? new Date() : null }];
    if (sql.includes('FROM "Membership"')) return [{ role: state.role, seatType: state.seatType }];
    if (sql.includes('FROM "Project"')) return [{ organizationId: state.organizationId }];
    if (sql.includes('FROM "User"')) return [{ clerkUserId: state.clerkActor }];
    if (!sql.includes("WITH selected") && sql.includes('FROM "TestRun"')) { events.push("date-population-preflight"); return [{ count: state.dateRuns, bytes: state.dateBytes, invalid: false }]; }
    if (sql.includes('AS "scopeBytes"')) { events.push("native-frozen-preflight"); return [{ count: BigInt(data.scopes.length), instances: state.instances, definitions: state.definitions, scopeBytes: state.scopeBytes, bytes: state.frozenBytes, maxBytes: state.maxFrozenBytes }]; }
    if (sql.includes('AS "foreign"')) { events.push("relationship-check"); return [{ foreign: state.foreign }]; }
    if (sql.includes("metadata AS")) { events.push("native-head-preflight"); return [{ results: state.resultCount ?? BigInt(data.results.length), caseHeads: state.caseCount ?? BigInt(data.cases.length), stepHeads: state.stepCount ?? BigInt(data.steps.length), bytes: state.projectionBytes + state.scopeProjectionBytes, invalid: state.invalidProjection }]; }
    if (sql.includes('AS "scopeSupported"')) { events.push("frozen-identity-projection"); return data.scopes; }
    if (sql.includes('FROM "TestResult"')) { events.push("native-result-projection"); return data.results; }
    if (sql.includes('FROM "ManualCaseResultHead"')) { events.push("current-case-head-projection"); return data.cases; }
    if (sql.includes('FROM "ManualStepResultHead"')) { events.push("current-step-head-projection"); return data.steps; }
    throw Error(`Unexpected synthetic SQL: ${sql}`);
  }) };
  const db = { $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => work(tx)) };
  return { data, state, tx, db: db as unknown as PrismaClient, events };
}
describe("bounded native read plumbing, mocked only", () => {
  it("READ_ONLY viewer uses original-org/actor locks and exact filter compiler without loading frozen bodies or notes", async () => {
    const f = fixture(), value = await readManualRunDashboard(f.db, "actor", "clerk", { ...input, platform: "recorded-platform" });
    expect(value).toMatchObject({ projectId: "project", organizationId: "org", clerkActorId: "clerk", requestKey: manualRunDashboardRequestKey({ ...input, platform: "recorded-platform" }), totals: { trustedRuns: 1, recordedInstances: 1 } });
    expect(f.events).toEqual(["date-population-preflight", "selected-identities", "native-frozen-preflight", "relationship-check", "native-head-preflight", "frozen-identity-projection", "native-result-projection", "current-case-head-projection", "current-step-head-projection"]);
    expect((f.tx.testRun.findMany.mock.calls[0] as unknown as [{ select: unknown }])[0].select).toEqual({ id: true });
    const statements = f.tx.$queryRaw.mock.calls.map(([raw]) => Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql);
    expect(statements.join("\n")).not.toMatch(/note|errorMessage|evidenceAttachment|actorLabel|SELECT \*/);
    expect(statements.find(sql => sql.includes('AS "scopeSupported"'))).not.toMatch(/SELECT\s+r\."executionContext"/);
    expect(f.db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 20000 });
  });
  it("revoked role, changed actor/project original scope and suspended organization deny before native private population", async () => {
    for (const change of [{ role: "UNKNOWN" }, { seatType: "UNKNOWN" }, { clerkActor: "other" }, { organizationId: "other" }, { suspended: true }]) { const f = fixture(); Object.assign(f.state, change); await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(f.events).toEqual([]); }
  });
  it("native 20k/4MiB date window gate refuses before configuration selection or JSON scope projection", async () => {
    for (const change of [{ dateRuns: 20001n }, { dateBytes: 4n * 1024n * 1024n + 1n }]) { const f = fixture(); Object.assign(f.state, change); await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.events).toEqual(["date-population-preflight"]); }
  });
  it("native frozen count/bytes gate precedes extraction; bounds never cause a partial aggregate", async () => {
    for (const change of [{ instances: 100001n }, { definitions: 100001n }, { scopeBytes: 8n * 1024n * 1024n + 1n }, { frozenBytes: 64n * 1024n * 1024n + 1n }, { maxFrozenBytes: 4n * 1024n * 1024n + 1n }]) { const f = fixture(); Object.assign(f.state, change); await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.events).not.toContain("frozen-identity-projection"); expect(f.events).not.toContain("native-head-preflight"); }
  });
  it("foreign native relationships refuse all counts, not a discoverable exclusion", async () => {
    const f = fixture(); f.state.foreign = true;
    await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).not.toContain("native-head-preflight");
  });
  it("relationship preflight follows actual revision run/case/result and head-result pointers before reading statuses", async () => {
    const f = fixture(); f.state.foreign = true;
    await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    const raw = f.tx.$queryRaw.mock.calls.find(([raw]) => (Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql).includes('AS "foreign"'))![0];
    const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
    for (const expression of [
      'hr.id=h."testResultId"', 'hrr.id=hr."testRunId"', 'hrc.id=hr."testCaseId"',
      'vr.id=v."testRunId"', 'vc.id=v."testCaseId"', 'rr.id=v."testResultId"', 'rrr.id=rr."testRunId"', 'rrc.id=rr."testCaseId"',
      'hrr."projectId"<>', 'hrc."projectId"<>', 'vr."projectId"<>', 'vc."projectId"<>', 'rrr."projectId"<>', 'rrc."projectId"<>',
    ]) expect(sql).toContain(expression);
    expect(sql.match(/vr.id=v\."testRunId"/g)).toHaveLength(2); expect(sql.match(/vc.id=v\."testCaseId"/g)).toHaveLength(2);
    expect(f.events).not.toContain("native-head-preflight"); expect(f.events).not.toContain("native-result-projection");
  });
  it("head count/16MiB preflight refuses before projecting current heads or scope arrays", async () => {
    for (const change of [{ resultCount: 100001n }, { caseCount: 100001n }, { stepCount: 100001n }, { projectionBytes: 16n * 1024n * 1024n + 1n }, { projectionBytes: 8n * 1024n * 1024n, scopeProjectionBytes: 9n * 1024n * 1024n }, { invalidProjection: true }]) { const f = fixture(); Object.assign(f.state, change); await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(f.events).not.toContain("frozen-identity-projection"); }
  });
  it("native scope projection refuses wide/null identities before JS and shares the combined metadata byte cap", async () => {
    const f = fixture(); await readManualRunDashboard(f.db, "actor", "clerk", input);
    const statements = f.tx.$queryRaw.mock.calls.map(([raw]) => Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql);
    const preflight = statements.find(sql => sql.includes("metadata AS"))!;
    expect(preflight).toContain("UNION ALL SELECT to_jsonb(t) FROM scopes t");
    const scope = statements.find(sql => sql.includes('AS "scopeSupported"') && !sql.includes("metadata AS"))!;
    for (const condition of ['x.id IS NULL', 'length(x.id) NOT BETWEEN 1 AND 200', 'octet_length(x.id)>800', "length(d->>'testCaseId') BETWEEN 1 AND 200", "octet_length(d->>'testCaseId')<=800", "ELSE NULL END", "ELSE ARRAY[]::text[] END", "jsonb_array_length(r.\"executionContext\"->'caseDefinitions') BETWEEN 0 AND 1000", "BETWEEN 1 AND 500"]) expect(scope).toContain(condition);
    expect(scope).not.toMatch(/left\(.*testCaseId|substring\(.*testCaseId/);
    const unsupported = run(); unsupported.scopeSupported = false; unsupported.plannedIds = [];
    expect(assemble([unsupported]).totals).toMatchObject({ excludedRuns: 1, plannedInstances: 0, exclusions: { UNSUPPORTED_FROZEN_SCOPE: 1 } });
  });
  it("a missing projected row refuses instead of trusting a native preflight count or silently shrinking cohort", async () => {
    const f = fixture(); f.state.resultCount = 2n;
    await expect(readManualRunDashboard(f.db, "actor", "clerk", input)).rejects.toThrow("entire selected native population");
  });
  it("an empty successfully authorized exact scope has zero trusted instances and no invented pass rate", async () => {
    const f = fixture(); f.data.scopes = []; f.data.results = []; f.data.cases = [];
    const value = await readManualRunDashboard(f.db, "actor", "clerk", input);
    expect(value.totals).toMatchObject({ runs: 0, plannedInstances: 0, recordedInstances: 0, remainingInstances: 0 });
    expect(value.days).toHaveLength(2); expect(f.events).not.toContain("native-frozen-preflight");
  });
  it("scope schema enforces UTC90-day window and aggregate response refuses inconsistent daily/exclusion totals", async () => {
    expect(manualRunDashboardInputSchema.safeParse({ ...input, start: "2026-01-01", end: "2026-03-31" }).success).toBe(true);
    expect(manualRunDashboardInputSchema.safeParse({ ...input, start: "2026-01-01", end: "2026-04-01" }).success).toBe(false);
    const f = fixture(), value = await readManualRunDashboard(f.db, "actor", "clerk", input);
    const changed = structuredClone(value); changed.days[0]!.remainingInstances++;
    expect(manualRunDashboardOutputSchema.safeParse(changed).success).toBe(false);
    const incomplete = structuredClone(value); incomplete.days.pop();
    expect(manualRunDashboardOutputSchema.safeParse(incomplete).success).toBe(false);
    expect(value.limitations.join(" ")).toContain("not complete procedure-field validation");
  });
  it("source has independent hard budgets, parameterized predicates, no mutation/provider/revision body projection", () => {
    const source = readFileSync(new URL("./manualRunDashboard.ts", import.meta.url), "utf8");
    expect(source).toContain("Date.now() + 18000"); expect(source).toContain("statement_timeout='8000ms'");
    expect(source).toMatch(/manualDashboardBudget\(deadline\)/); expect(source).not.toMatch(/\$queryRawUnsafe|\.(create|update|delete|upsert|mutate)\(|fetch\(|sendEmail|invokeModel/);
    expect(source).toContain("LIMIT 100001"); expect(source).toContain('CASE WHEN cardinality(r."manualTestCaseIds") BETWEEN 0 AND 1000');
    expect(source).toContain("No database/provider calls are made at import time");
  });
});
