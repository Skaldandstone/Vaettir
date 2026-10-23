import { TRPCError } from "@trpc/server";
import { supportedManualExecutionIdentity } from "./manualExecutionReadScopeSchema.js";
const identity = (value: unknown): value is string => typeof value === "string" && supportedManualExecutionIdentity(value);

export type DashboardScope = { id: string; projectId: string; startedAt: Date; status: string; scopeSupported: boolean; plannedIds: string[]; definitions: Array<{ caseId: string | null; stepCount: number; completeProcedure: boolean }> };
export type DashboardResult = { id: string; runId: string; caseId: string | null; status: string };
export type DashboardCaseHead = { runId: string; caseId: string; organizationId: string; projectId: string; resultId: string; revisionId: string; revisionRunId: string | null; revisionCaseId: string | null; revisionOrganizationId: string | null; revisionProjectId: string | null; revisionResultId: string | null; revisionNumber: number | null; revisionCount: number; status: string | null };
export type DashboardStepHead = { runId: string; caseId: string; stepIndex: number; revisionId: string; revisionRunId: string | null; revisionCaseId: string | null; revisionStepIndex: number | null; revisionNumber: number | null; revisionCount: number; status: string | null };
export const manualDashboardExclusionReasons = ["UNSUPPORTED_FROZEN_SCOPE", "AMBIGUOUS_RESULT", "UNTRACKED_RESULT", "HEAD_PROJECTION_MISMATCH"] as const;
type Reason = typeof manualDashboardExclusionReasons[number];
const outcomes = ["PASS", "FAIL", "BLOCKED", "SKIP", "FLAKY"] as const;
export const emptyManualDashboardCounts = () => ({ runs: 0, trustedRuns: 0, excludedRuns: 0, inProgressTrustedRuns: 0, plannedInstances: 0, recordedInstances: 0, remainingInstances: 0, partialStepInstances: 0, ignoredOutsideScopeResultRows: 0, outcomes: { PASS: 0, FAIL: 0, BLOCKED: 0, SKIP: 0, FLAKY: 0 }, exclusions: Object.fromEntries(manualDashboardExclusionReasons.map(reason => [reason, 0])) as Record<Reason, number> });
type Counts = ReturnType<typeof emptyManualDashboardCounts>;
const refuse = (message: string): never => { throw new TRPCError({ code: "PRECONDITION_FAILED", message }); };
const forbidden = (): never => { throw new TRPCError({ code: "FORBIDDEN", message: "Current heads or case references leave the original organization/project. No foreign evidence counts were disclosed." }); };
export function manualDashboardBudget(deadline: number) {
  if (Date.now() >= deadline) refuse("Manual dashboard processing exceeded its bounded read budget. Narrow the scope; no partial aggregate was returned.");
}
function merge(target: Counts, row: Counts) {
  for (const key of ["runs", "trustedRuns", "excludedRuns", "inProgressTrustedRuns", "plannedInstances", "recordedInstances", "remainingInstances", "partialStepInstances", "ignoredOutsideScopeResultRows"] as const) target[key] += row[key];
  for (const status of outcomes) target.outcomes[status] += row.outcomes[status];
  for (const reason of manualDashboardExclusionReasons) target.exclusions[reason] += row.exclusions[reason];
}
function groupByRun<T extends { runId: string }>(rows: T[], runs: Set<string>, deadline: number) {
  const groups = new Map<string, T[]>();
  rows.forEach((row, index) => {
    if (index % 256 === 0) manualDashboardBudget(deadline);
    if (!runs.has(row.runId)) refuse("A projected row leaves the exact selected run population.");
    const group = groups.get(row.runId) ?? []; group.push(row); groups.set(row.runId, group);
  });
  return groups;
}
/** Counts case instances in each saved run, never distinct cases across runs,
 * source rows, revision history, elapsed effort or a release verdict. */
export function assembleManualRunDashboard(projectId: string, organizationId: string, start: string, end: string, scopes: DashboardScope[], results: DashboardResult[], caseHeads: DashboardCaseHead[], stepHeads: DashboardStepHead[], deadline = Date.now() + 8000) {
  manualDashboardBudget(deadline);
  if (scopes.length > 20000 || [results, caseHeads, stepHeads].some(rows => rows.length > 100000)) refuse("Manual dashboard population exceeds its hard count boundary; nothing was truncated.");
  const runIds = new Set(scopes.map(run => run.id));
  if (runIds.size !== scopes.length || scopes.some(run => !identity(run.id) || run.projectId !== projectId)) refuse("Selected run identities are incomplete or leave the current project.");
  // Guard original attribution before excluding unsupported/legacy scopes.
  for (const [index, head] of caseHeads.entries()) {
    if (index % 256 === 0) manualDashboardBudget(deadline);
    if (head.organizationId !== organizationId || head.projectId !== projectId || (head.revisionOrganizationId !== null && head.revisionOrganizationId !== organizationId) || (head.revisionProjectId !== null && head.revisionProjectId !== projectId)) forbidden();
  }
  if (new Set(results.map(row => row.id)).size !== results.length || results.some(row => !identity(row.id) || (row.caseId !== null && !identity(row.caseId)))) refuse("Result identities exceed the supported native boundary or are ambiguous.");
  const native = groupByRun(results, runIds, deadline), whole = groupByRun(caseHeads, runIds, deadline), steps = groupByRun(stepHeads, runIds, deadline);
  const days = new Map<string, Counts>();
  for (let date = Date.parse(start); date <= Date.parse(end); date += 86400000) days.set(new Date(date).toISOString().slice(0, 10), emptyManualDashboardCounts());
  const totals = emptyManualDashboardCounts();
  let admittedInstances = 0;
  scopes.forEach((run, index) => {
    if (index % 64 === 0) manualDashboardBudget(deadline);
    const day = Number.isFinite(run.startedAt.getTime()) ? run.startedAt.toISOString().slice(0, 10) : "";
    if (!days.has(day)) refuse("Stored run-start dates leave the exact applied UTC window.");
    const row = emptyManualDashboardCounts(); row.runs = 1;
    let reason: Reason | null = null;
    const planned = new Set(run.plannedIds), definitions = new Map(run.definitions.map(definition => [definition.caseId, definition]));
    if (!run.scopeSupported || run.plannedIds.length > 1000 || planned.size !== run.plannedIds.length || run.plannedIds.some(id => !identity(id)) || definitions.size !== run.definitions.length || definitions.size !== planned.size || run.definitions.some(definition => !definition.caseId || !planned.has(definition.caseId) || !definition.completeProcedure || !Number.isInteger(definition.stepCount) || definition.stepCount < 0 || definition.stepCount > 500)) reason = "UNSUPPORTED_FROZEN_SCOPE";
    admittedInstances += run.plannedIds.length;
    if (admittedInstances > 100000) refuse("More than 100,000 planned run-case instances match. No subset was aggregated.");
    const runResults = native.get(run.id) ?? [], runWhole = whole.get(run.id) ?? [], runSteps = steps.get(run.id) ?? [];
    const resultsByCase = new Map<string, DashboardResult[]>(), wholeByCase = new Map<string, DashboardCaseHead[]>(), stepsByCase = new Map<string, DashboardStepHead[]>();
    for (const result of runResults) if (result.caseId && planned.has(result.caseId)) { const list = resultsByCase.get(result.caseId) ?? []; list.push(result); resultsByCase.set(result.caseId, list); } else row.ignoredOutsideScopeResultRows++;
    for (const head of runWhole) { const list = wholeByCase.get(head.caseId) ?? []; list.push(head); wholeByCase.set(head.caseId, list); if (!planned.has(head.caseId)) reason ??= "HEAD_PROJECTION_MISMATCH"; }
    for (const head of runSteps) { const list = stepsByCase.get(head.caseId) ?? []; list.push(head); stepsByCase.set(head.caseId, list); if (!planned.has(head.caseId)) reason ??= "HEAD_PROJECTION_MISMATCH"; }
    if (!reason) {
      let inspected = 0;
      for (const caseId of planned) {
        if (++inspected % 256 === 0) manualDashboardBudget(deadline);
        const observed = resultsByCase.get(caseId) ?? [], heads = wholeByCase.get(caseId) ?? [], currentSteps = stepsByCase.get(caseId) ?? [], definition = definitions.get(caseId)!;
        if (observed.length > 1 || heads.length > 1) { reason = "AMBIGUOUS_RESULT"; break; }
        const result = observed[0], head = heads[0];
        let status: string | null = null;
        if (head) {
          if (currentSteps.length || !result || !identity(head.revisionId) || head.revisionOrganizationId !== organizationId || head.revisionProjectId !== projectId || head.resultId !== result.id || head.revisionResultId !== result.id || head.revisionRunId !== run.id || head.revisionCaseId !== caseId || head.revisionNumber !== head.revisionCount || !Number.isInteger(head.revisionCount) || head.revisionCount < 1 || head.revisionCount > 100 || head.status !== result.status) { reason = "HEAD_PROJECTION_MISMATCH"; break; }
          status = head.status;
        } else if (currentSteps.length) {
          if (!definition.stepCount || new Set(currentSteps.map(step => step.stepIndex)).size !== currentSteps.length || currentSteps.some(step => !identity(step.revisionId) || !Number.isInteger(step.stepIndex) || step.stepIndex < 0 || step.stepIndex >= definition.stepCount || step.revisionRunId !== run.id || step.revisionCaseId !== caseId || step.revisionStepIndex !== step.stepIndex || step.revisionNumber !== step.revisionCount || !Number.isInteger(step.revisionCount) || step.revisionCount < 1 || step.revisionCount > 100 || !["PASS", "FAIL", "BLOCKED", "SKIP"].includes(step.status ?? ""))) { reason = "HEAD_PROJECTION_MISMATCH"; break; }
          if (currentSteps.length === definition.stepCount) {
            status = ["FAIL", "BLOCKED", "SKIP"].find(value => currentSteps.some(step => step.status === value)) ?? "PASS";
            if (!result || result.status !== status) { reason = "HEAD_PROJECTION_MISMATCH"; break; }
          } else {
            if (result) { reason = "HEAD_PROJECTION_MISMATCH"; break; }
            row.partialStepInstances++;
          }
        } else if (result) { reason = "UNTRACKED_RESULT"; break; }
        if (status !== null) {
          if (!outcomes.includes(status as typeof outcomes[number])) { reason = "HEAD_PROJECTION_MISMATCH"; break; }
          row.outcomes[status as typeof outcomes[number]]++; row.recordedInstances++;
        }
      }
    }
    if (reason) { const excluded = emptyManualDashboardCounts(); excluded.runs = 1; excluded.excludedRuns = 1; excluded.exclusions[reason] = 1; merge(totals, excluded); merge(days.get(day)!, excluded); }
    else { row.trustedRuns = 1; row.inProgressTrustedRuns = run.status === "RUNNING" ? 1 : 0; row.plannedInstances = planned.size; row.remainingInstances = planned.size - row.recordedInstances; merge(totals, row); merge(days.get(day)!, row); }
  });
  manualDashboardBudget(deadline);
  return { totals, days: [...days].map(([day, counts]) => ({ day, ...counts })) };
}
