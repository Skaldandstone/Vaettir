/** Presentation admission only. Never grants read/write/export authority. */
export function admittedManualRunProgress(value: {
  plannedCaseIds: unknown;
  unavailableCases: unknown;
  scopeAvailability: unknown;
  cases: readonly { testCaseId: string; currentResult: unknown }[];
}) {
  const identity = (id: unknown): id is string => typeof id === "string" && id.length > 0 && id.length <= 200 && !id.includes("\0") && !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(id);
  if (!Array.isArray(value.plannedCaseIds) || value.plannedCaseIds.length > 1000 || !value.plannedCaseIds.every(identity) || !Array.isArray(value.unavailableCases) || value.unavailableCases.length > 1000 || !Array.isArray(value.cases) || value.cases.length > 1000) return null;
  const plannedCaseIds: string[] = value.plannedCaseIds;
  const planned = new Set(plannedCaseIds), available = new Set<string>(), unavailableCaseIds: string[] = [];
  if (planned.size !== plannedCaseIds.length) return null;
  let recorded = 0;
  for (const row of value.cases) {
    if (!row || !identity(row.testCaseId) || !planned.has(row.testCaseId) || available.has(row.testCaseId)) return null;
    available.add(row.testCaseId);
    if (row.currentResult !== null && row.currentResult !== undefined) {
      if (typeof row.currentResult !== "object" || Array.isArray(row.currentResult)) return null;
      recorded++;
    }
  }
  for (const raw of value.unavailableCases) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
    const row = raw as { testCaseId?: unknown; reason?: unknown };
    if (!identity(row.testCaseId) || !planned.has(row.testCaseId) || available.has(row.testCaseId) || unavailableCaseIds.includes(row.testCaseId) || row.reason !== "MISSING_CASE_AND_FROZEN_DEFINITION") return null;
    unavailableCaseIds.push(row.testCaseId);
  }
  if (available.size + unavailableCaseIds.length !== planned.size || !value.scopeAvailability || typeof value.scopeAvailability !== "object" || Array.isArray(value.scopeAvailability)) return null;
  const scope = value.scopeAvailability as Record<string, unknown>;
  if (scope.plannedCount !== planned.size || scope.availableCount !== available.size || scope.unavailableCount !== unavailableCaseIds.length || scope.complete !== (unavailableCaseIds.length === 0) || !["FROZEN_RUN_DEFINITIONS", "LEGACY_CURRENT_CASE_DEFINITIONS"].includes(scope.procedureBasis as string)) return null;
  return { plannedCount: planned.size, availableCount: available.size, unavailableCaseIds, recorded, remaining: planned.size - recorded, percentRecorded: planned.size ? Math.round(recorded * 100 / planned.size) : 0, procedureBasis: scope.procedureBasis as "FROZEN_RUN_DEFINITIONS" | "LEGACY_CURRENT_CASE_DEFINITIONS" };
}
export type ManualRunProgress = NonNullable<ReturnType<typeof admittedManualRunProgress>>;
