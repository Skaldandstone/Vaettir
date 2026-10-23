import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@vaettir/db";
const readGuard = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("./manualExecutionReadScope.js", () => ({ lockManualExecutionReadScope: readGuard }));
import { assembleManualRunComparison, compareManualRuns, listManualComparisonRuns } from "./manualRunComparison.js";
import { manualRunCatalogInputSchema, manualRunComparisonRequestKey } from "./manualRunComparisonSchema.js";
import { qualityProfileHash, runConfigurationSchema } from "./qualityExperienceProfile.js";
const input = { projectId: "synthetic-project", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk", requestId: "cb6b7abf-250d-40d8-b064-a4f11af18496", baselineRunId: "baseline", candidateRunId: "candidate" };
function pair(count = 851) {
  const ids = Array.from({ length: count }, (_, i) => `case-${String(i).padStart(4, "0")}`);
  const runs = ["baseline", "candidate"].map(id => ({ metadata: { id, status: "PARTIAL" as const, startedAt: new Date("2026-01-01T12:00:00Z"), finishedAt: null, plannedCases: ids.length, versionOneSnapshotPresent: true }, saved: { id, projectId: input.projectId, ciProvider: "manual", manualTestCaseIds: ids, manualPrerequisites: Object.fromEntries(ids.map(id => [id, []])), executionContext: { version: 1, experience: null, profileHash: qualityProfileHash({}), configuration: runConfigurationSchema.parse({ build: "Frozen fixture build" }), stepFieldLabels: { action: "Tester action" }, caseDefinitions: ids.map(testCaseId => ({ testCaseId, title: `Frozen ${testCaseId}`, validationDomain: "SOFTWARE", reviewStatus: "APPROVED", background: null, given: [], when: [], then: [], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps: [{ order: 0, action: "Original saved procedure", expectedActionOrData: "GET /synthetic", expectedResult: "Expected fixture result", expectedResponse: null, mediaAttachmentIds: [] }] })) } } }));
  return runs;
}
describe("genuine frozen manual-run comparison", () => {
  it("compares all 851 planned identities with deterministic 50-row hash-bound pages", () => {
    const runs = pair(), results = [{ id: "a", runId: "baseline", caseId: "case-0000", status: "FAIL" as const }, { id: "b", runId: "candidate", caseId: "case-0000", status: "PASS" as const }, { id: "unmatched", runId: "candidate", caseId: null, status: "PASS" as const }];
    const first = assembleManualRunComparison(input, "actor", runs, results);
    expect(first.unionCaseCount).toBe(851);
    expect(first.items).toHaveLength(50);
    expect(first.baselineSummary).toMatchObject({ total: 851, recorded: 1, remaining: 850 });
    expect(first.candidateSummary).toMatchObject({ recorded: 1, ignoredOutsideScopeResults: 1 });
    expect(first.items[0]).toMatchObject({ baseline: { title: "Frozen case-0000", outcome: "FAIL" }, candidate: { outcome: "PASS" }, definitionState: "SAME_SAVED_DEFINITION" });
    const seen = first.items.map(item => item.caseId);
    let cursor = first.nextCursor;
    while (cursor) { const page = assembleManualRunComparison({ ...input, cursor }, "actor", runs, results); seen.push(...page.items.map(item => item.caseId)); cursor = page.nextCursor; }
    expect(seen).toHaveLength(851); expect(new Set(seen).size).toBe(851);
  });
  it("distinguishes saved scope absence from a planned case with no verdict, and preserves both frozen titles", () => {
    const runs = pair(2); runs[1]!.saved.manualTestCaseIds = ["case-0001"];
    runs[1]!.saved.executionContext.caseDefinitions = [{ ...runs[1]!.saved.executionContext.caseDefinitions[1]!, title: "Changed saved title" }];
    runs[1]!.saved.manualPrerequisites = { "case-0001": [] }; runs[1]!.metadata.plannedCases = 1;
    const value = assembleManualRunComparison(input, "actor", runs, []);
    expect(value.items[0]).toMatchObject({ baseline: { outcome: "NO_CASE_VERDICT" }, candidate: null, definitionState: "BASELINE_ONLY" });
    expect(value.items[1]).toMatchObject({ baseline: { title: "Frozen case-0001" }, candidate: { title: "Changed saved title" }, definitionState: "SAVED_DEFINITION_CHANGED" });
  });
  it("refuses legacy, incomplete or ambiguous frames instead of borrowing current cases", () => {
    const legacy = pair(1); (legacy[0]!.saved as { executionContext: unknown }).executionContext = null;
    expect(() => assembleManualRunComparison(input, "actor", legacy, [])).toThrow("legacy");
    const incomplete = pair(1); incomplete[0]!.saved.executionContext.caseDefinitions[0]!.steps = [];
    expect(() => assembleManualRunComparison(input, "actor", incomplete, [])).toThrow("complete");
    const missing = pair(2); missing[0]!.saved.executionContext.caseDefinitions.pop();
    expect(() => assembleManualRunComparison(input, "actor", missing, [])).toThrow("incomplete or ambiguous");
  });
  it("never guesses the newer duplicate outcome and invalidates pages for metadata/definition/status changes", () => {
    const runs = pair(51), results = [{ id: "a", runId: "baseline", caseId: "case-0000", status: "FAIL" as const }];
    expect(() => assembleManualRunComparison(input, "actor", runs, [...results, { id: "b", runId: "baseline", caseId: "case-0000", status: "PASS" }])).toThrow("duplicate/conflicting");
    const first = assembleManualRunComparison(input, "actor", runs, results);
    for (const change of ["metadata", "definition", "status"]) {
      const changed = structuredClone(runs), observations = structuredClone(results);
      if (change === "metadata") changed[0]!.metadata.startedAt = new Date("2026-01-02T12:00:00Z");
      if (change === "definition") changed[0]!.saved.executionContext.caseDefinitions[0]!.steps[0]!.action = "Changed saved action";
      if (change === "status") observations[0]!.status = "PASS" as "FAIL";
      expect(() => assembleManualRunComparison({ ...input, cursor: first.nextCursor! }, "actor", changed, observations)).toThrow("population changed");
    }
  });
  it("keeps exact saved configuration labels descriptive and rejects 1,001-case source scopes", () => {
    const runs = pair(1); runs[1]!.saved.executionContext.configuration.build = "Different fixture build";
    expect(assembleManualRunComparison(input, "actor", runs, []).configuration.sameRecordedConfiguration).toBe(false);
    expect(() => assembleManualRunComparison(input, "actor", pair(1001), [])).toThrow(/unsupported or invalid|incomplete or ambiguous/);
  });
  it("supports empty frozen scopes without converting legacy records into empty comparisons", () => {
    const empty = assembleManualRunComparison(input, "actor", pair(0), []);
    expect(empty).toMatchObject({ unionCaseCount: 0, items: [], nextCursor: null, baseline: { plannedCases: 0, scopeUnsupported: false }, baselineSummary: { total: 0, recorded: 0, percentComplete: 0 } });
    const legacy = pair(0); (legacy[0]!.saved as { executionContext: unknown }).executionContext = null;
    expect(() => assembleManualRunComparison(input, "actor", legacy, [])).toThrow("legacy");
  });
  it("pins current friendly ID labels separately from saved titles and invalidates pages on relabelling", () => {
    const runs = pair(51), labels = [{ id: "case-0000", label: "TC-42" }];
    const first = assembleManualRunComparison(input, "actor", runs, [], labels);
    expect(first.items[0]).toMatchObject({ currentCaseIdLabel: "TC-42", baseline: { title: "Frozen case-0000" } });
    expect(first.limitations.join(" ")).toContain("not captured historical labels");
    expect(() => assembleManualRunComparison({ ...input, cursor: first.nextCursor! }, "actor", runs, [], [{ id: "case-0000", label: "TC-43" }])).toThrow("population changed");
  });
  it("refuses unsupported result identities and repeated identities even outside planned scope", () => {
    const runs = pair(1);
    expect(() => assembleManualRunComparison(input, "actor", runs, [{ id: "a".repeat(201), runId: "baseline", caseId: null, status: "PASS" }])).toThrow("identities");
    expect(() => assembleManualRunComparison(input, "actor", runs, ["baseline", "candidate"].map(runId => ({ id: "same", runId, caseId: null, status: "PASS" })))).toThrow("identities");
  });
});
function databaseFixture() {
  const runs = pair(1), state = { actor: "synthetic-clerk", role: "VIEWER", seat: "READ_ONLY", organization: input.originalOrganizationId, suspended: false, overflow: false, bytes: 0n, invalidIdentity: false }, events: string[] = [];
  const tx = { $executeRaw: vi.fn(async () => 0), $queryRaw: vi.fn(async (raw: TemplateStringsArray | { sql: string }) => {
    const sql = Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql;
    if (sql.includes('FROM "Organization"')) return [{ suspendedAt: state.suspended ? new Date() : null }];
    if (sql.includes('FROM "Membership"')) return [{ role: state.role, seatType: state.seat }];
    if (sql.includes('FROM "Project"')) return [{ organizationId: state.organization }];
    if (sql.includes('FROM "User"')) return [{ clerkUserId: state.actor }];
    if (sql.includes('FROM "TestResult"') && sql.includes("count(*)")) return [{ count: state.overflow ? 20001n : 0n, bytes: state.bytes, invalidIdentity: state.invalidIdentity }];
    if (sql.includes('FROM "TestResult"')) { events.push("result-metadata"); return []; }
    if (sql.includes('FROM "TestCase"')) { events.push("current-id-labels-only"); return []; }
    if (sql.includes('FROM "TestRun"')) { events.push("run-metadata"); return runs.map(run => run.metadata); }
    throw Error("Unexpected synthetic SQL");
  }), testRun: { findMany: vi.fn(async () => { events.push("frozen-body"); return runs.map(run => run.saved); }) } };
  const db = { $transaction: vi.fn(async (work: (tx: typeof tx) => unknown) => work(tx)) };
  return { db: db as unknown as PrismaClient, tx, state, events, runs };
}
describe("current native scope and bounded population plumbing", () => {
  it("uses both canonical native read guards, permits READ_ONLY viewing and never loads notes/source", async () => {
    readGuard.mockClear(); const f = databaseFixture();
    const response = await compareManualRuns(f.db, "actor", "synthetic-clerk", input);
    expect(response.requestKey).toBe(manualRunComparisonRequestKey(input));
    expect(readGuard.mock.calls.map(call => (call as unknown as unknown[])[3])).toEqual(["baseline", "candidate"].map(testRunId => ({ testRunId, projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId })));
    expect(f.tx.testRun.findMany.mock.calls).toHaveLength(1);
    const selection = (f.tx.testRun.findMany.mock.calls[0] as unknown as [{ select: Record<string, unknown> }])[0].select;
    expect(Object.keys(selection).sort()).toEqual(["ciProvider", "executionContext", "id", "manualPrerequisites", "manualTestCaseIds", "projectId"]);
    const statements = f.tx.$queryRaw.mock.calls.map(([raw]) => Array.isArray(raw) ? raw.join("?") : (raw as { sql: string }).sql);
    expect(statements.find(sql => sql.includes('FROM "TestResult"') && !sql.includes("count(*)"))).not.toMatch(/note|error|attachment|step|SELECT \*/i);
    expect(statements.find(sql => sql.includes('FROM "TestCase"'))).not.toMatch(/"(?:title|given|when|then|steps)"|SELECT \*/i);
    expect(statements.find(sql => sql.includes('FROM "Project"'))).toContain('octet_length("organizationId")<=800');
    expect(statements.find(sql => sql.includes('FROM "User"'))).toContain('octet_length("clerkUserId")<=800');
  });
  it.each(["actor", "suspended", "role", "organization"] as const)("%s changes deny before frozen body projection", async field => {
    const f = databaseFixture(); if (field === "actor") f.state.actor = "other-actor"; if (field === "suspended") f.state.suspended = true; if (field === "role") f.state.role = "UNSUPPORTED";
    if (field === "organization") f.state.organization = "foreign-org";
    await expect(compareManualRuns(f.db, "actor", "synthetic-clerk", input)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(f.events).not.toContain("frozen-body");
  });
  it("result population overflow refuses before frozen JSON projection", async () => {
    const f = databaseFixture(); f.state.overflow = true;
    await expect(compareManualRuns(f.db, "actor", "synthetic-clerk", input)).rejects.toThrow("bounded comparison");
    expect(f.events).not.toContain("frozen-body");
  });
  it.each(["bytes", "identity"])("native result %s overflow refuses before bodies", async boundary => {
    const f = databaseFixture(); if (boundary === "bytes") f.state.bytes = 2n * 1024n * 1024n + 1n; else f.state.invalidIdentity = true;
    await expect(compareManualRuns(f.db, "actor", "synthetic-clerk", input)).rejects.toThrow("bounded comparison");
    expect(f.events).not.toContain("frozen-body");
  });
  it("catalogue unsupported cardinality stays nullable and is not relabelled zero", async () => {
    const f = databaseFixture(); (f.runs[0]!.metadata as { plannedCases: number | null }).plannedCases = null;
    const { baselineRunId: _a, candidateRunId: _b, ...scope } = input;
    const value = await listManualComparisonRuns(f.db, "actor", "synthetic-clerk", { ...scope, interval: { start: "2026-01-01", end: "2026-01-02" } });
    expect(value.items[0]).toMatchObject({ plannedCases: null, scopeUnsupported: true });
    expect(f.tx.testRun.findMany).not.toHaveBeenCalled();
  });
  it("catalogue is UTC run-start filtered, exact manual only, and rejects future or oversized windows", async () => {
    const f = databaseFixture(), catalogInput = { ...input, interval: { start: "2026-01-01", end: "2026-01-02" } };
    const { baselineRunId: _a, candidateRunId: _b, ...request } = catalogInput;
    const value = await listManualComparisonRuns(f.db, "actor", "synthetic-clerk", request);
    expect(value.items).toHaveLength(2); expect(f.tx.testRun.findMany).not.toHaveBeenCalled();
    expect(manualRunCatalogInputSchema.safeParse({ ...request, interval: { start: "2026-01-01", end: "2026-04-01" } }).success).toBe(false);
    expect(manualRunCatalogInputSchema.safeParse({ ...request, interval: { start: "2099-01-01", end: "2099-01-02" } }).success).toBe(false);
  });
});
