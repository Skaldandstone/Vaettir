import type { CaseExecutionHistoryItem } from "@vaettir/core";
import { hasIdentityControl } from "./control-characters.ts";

type Summary = Pick<CaseExecutionHistoryItem, "runId" | "source" | "outcomeMode" | "definition">;
type Input = { projectId: string; testCaseId: string; displayId: string; item: Summary };
function encodedIdentity(value: string) {
  if (!value || value.length > 200 || hasIdentityControl(value)) return null;
  try { return encodeURIComponent(value); } catch { return null; }
}
/** DOM id shared with the native run page. Encode the returned id AGAIN in a
 * URL fragment so browser fragment decoding targets this exact DOM identity. */
export function manualCaseHistoryAnchor(testCaseId: string): string | null {
  const encoded = encodedIdentity(testCaseId);
  return encoded === null ? null : `manual-case-${encoded}`;
}
/** Navigation metadata only, not an access decision. Caller must supply an exact
 * fresh authorized run response. Never reconstruct a frozen case from live text. */
export function manualCaseHistorySelection(input: {
  requestedCaseIds: readonly string[]; projectId: string; testRunId: string; fresh: boolean;
  response?: {
    projectId: string; testRunId: string; cases: readonly { testCaseId: string }[];
    executionContext: { caseDefinitions: readonly { testCaseId: string }[] } | null;
  };
}) {
  if (!input.requestedCaseIds.length) return { kind: "NONE" as const };
  if (!input.fresh || !input.response) return { kind: "WAITING" as const };
  const caseId = input.requestedCaseIds[0] ?? "";
  const anchor = manualCaseHistoryAnchor(caseId);
  if (input.requestedCaseIds.length !== 1 || anchor === null ||
      input.response.projectId !== input.projectId || input.response.testRunId !== input.testRunId ||
      input.response.cases.filter(row => row.testCaseId === caseId).length !== 1 ||
      input.response.executionContext?.caseDefinitions.filter(row => row.testCaseId === caseId).length !== 1)
    return { kind: "UNAVAILABLE" as const };
  return { kind: "SELECTED" as const, caseId, anchor };
}
export function caseObservationHistoryEntry(input: Input) {
  const project = encodedIdentity(input.projectId), run = encodedIdentity(input.item.runId);
  const anchor = manualCaseHistoryAnchor(input.testCaseId);
  if (project === null || run === null || anchor === null || encodedIdentity(input.displayId) === null)
    return { kind: "UNAVAILABLE" as const, reason: "Exact native project, run or case identity is unsupported. No substitute route was guessed." };
  if (input.item.source !== "MANUAL")
    return { kind: "UNAVAILABLE" as const, reason: "Imported CI observations do not identify this native manual correction workflow." };
  if (input.item.definition.originalCaseId !== input.testCaseId)
    return { kind: "UNAVAILABLE" as const, reason: "The saved summary does not identify the selected native case. No other case or first result was substituted." };
  if (input.item.definition.source !== "FROZEN_MANUAL_SUMMARY")
    return { kind: "UNAVAILABLE" as const, reason: "A supported frozen manual procedure is not confirmed by this summary. Legacy or incomplete metadata is not reconstructed from the current case." };
  const step = input.item.outcomeMode === "STEP_RESULTS" || input.item.outcomeMode === "PARTIAL_STEPS";
  const mode = step ? "STEP" as const : input.item.outcomeMode === "CASE_RESULT" ? "WHOLE_CASE" as const : "INSPECT_RUN" as const;
  const label = step ? "Open saved run and step history" : mode === "WHOLE_CASE" ? "Open saved run and whole-case history" : "Open saved run and check observations";
  const caseQuery = new URLSearchParams({ caseId: input.testCaseId }).toString();
  return { kind: "SUPPORTED" as const, mode, label, anchor,
    href: `/projects/${project}/test-runs/manual/${run}?${caseQuery}#${encodeURIComponent(anchor)}`,
    limitations: [
      "One native run is one execution. Correcting an observation within it is not another execution, a verified defect fix or qualified sign-off.",
      "This link selects the exact native case inside its saved run. It does not open the current case editor or substitute current wording for the frozen procedure.",
      step ? "Step revisions belong to this run's step history; they are not whole-case revisions. Partial steps do not confirm a completed case."
        : mode === "WHOLE_CASE" ? "Whole-case revision availability is not queried by this summary. The native run verifies retained history; an older unversioned observation can have unknown original recorder and time."
          : "This summary does not establish a completed whole-case observation or revision sequence. Planned, missing and multiple reported results are not converted into a chosen result.",
    ] };
}
