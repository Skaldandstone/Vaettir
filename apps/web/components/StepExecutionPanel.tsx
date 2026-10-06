"use client";

import { useState } from "react";
import type { RouterOutputs } from "@/lib/trpcReact";
import { currentSessionScope } from "@/lib/auth-query-cache";
import { StepPanelRetention } from "@/lib/step-panel-retention";
import { technicalBehaviorLabel } from "@/lib/case-authoring-fields";
import { ReviewedStepObservation } from "./ReviewedStepObservation";

type ExecutionCase = RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];
type ReadScope = { projectId: string; originalOrganizationId?: string; expectedClerkActorId?: string };

/** Actual caller cutover. Visited original step editors never unmount on row
 * collapse, filtering, auth loss or a later case-summary refresh. The child
 * native reader/controller, not these presentation props, authorizes writes. */
export function StepExecutionPanel({ testRunId, testCase, stepFieldLabels, active, readable = true, readScope, disabled, blockedBy, onModeActive, onChanged, onUnconfirmedChange }: {
  testRunId: string; testCase: ExecutionCase; stepFieldLabels: Record<string, string>; active: boolean; readable?: boolean; readScope?: ReadScope;
  disabled: boolean; blockedBy: string[]; onModeActive: () => void; onChanged: () => Promise<unknown>; onUnconfirmedChange?: (pending: boolean) => void;
}) {
  const [original] = useState({ testRunId, testCaseId: testCase.testCaseId, projectId: readScope?.projectId ?? "", organizationId: readScope?.originalOrganizationId ?? "", clerkActorId: readScope?.expectedClerkActorId ?? "" });
  const [retention] = useState(() => new StepPanelRetention());
  const [visited, setVisited] = useState<number[]>([]);
  const same = original.testRunId === testRunId && original.testCaseId === testCase.testCaseId && original.projectId === readScope?.projectId && original.organizationId === readScope?.originalOrganizationId && original.clerkActorId === readScope?.expectedClerkActorId;
  const visible = readable && same && !!original.projectId && !!original.organizationId && !!original.clerkActorId;
  const hasSteps = testCase.stepResults.some(item => item.current);
  const canBrowse = visible && (active || hasSteps);
  const supported = testCase.stepExecutionAvailable || hasSteps;
  function currentPresentation() {
    const session = currentSessionScope(window.Clerk?.loaded ? window.Clerk.session : null);
    return visible && session?.userId === original.clerkActorId;
  }
  function visit(index: number) {
    if (!currentPresentation() || !canBrowse || !supported || !retention.visit(index, testCase.steps.length)) return;
    setVisited(retention.indexes());
  }
  return <section aria-label="Reviewed step execution" style={{ margin: "14px 0" }}>
    {visible && <>
      {disabled && <p role="status" className="text-muted">Recording requires current edit access and an active run. Recorded step history remains available.</p>}
      {blockedBy.length > 0 && <p role="status">Required prerequisites have not passed. Native review controls decide which outcomes are currently recordable; no prerequisite is assumed to pass.</p>}
      {!supported ? <p className="text-muted">This run has no supported frozen structured-step view. No current case procedure was substituted. Use an explicit case-level result when available.</p> : !canBrowse ? <><button type="button" className="btn-secondary" disabled={disabled} onClick={() => { if (currentPresentation() && !disabled) onModeActive(); }}>Record step-by-step</button><p className="text-muted">Choose individual step outcomes or case-level recording. Recording a step locks this case into step-level results for this run.</p></> : <>
        <h3>Step outcomes</h3><p className="text-muted">{testCase.stepResults.filter(item => item.current).length} / {testCase.steps.length} recorded in this summary. The case verdict is derived only after all steps have an outcome; no missing step is assumed to pass.</p>
        <ol style={{ paddingLeft: 20, margin: 0 }}>{testCase.steps.map((step, index) => {
          const result = testCase.stepResults.find(item => item.stepIndex === index);
          return <li key={index} className="panel" style={{ padding: 10, marginBottom: 10, overflowWrap: "anywhere" }}><strong style={{ whiteSpace: "pre-wrap" }}>{step.action}</strong><p>{result?.current?.status ?? "Not recorded"}</p><p className="text-muted">Open the native review to see the aligned saved tester/technical fields, exact observation and history.</p>{!retention.has(index) && <button type="button" className="btn-secondary" onClick={() => visit(index)}>Review step {index + 1} observation</button>}{retention.has(index) && <p className="text-muted">Step {index + 1} has retained review controls below.</p>}</li>;
        })}</ol>
      </>}
    </>}
    {/* Deliberately outside the conditional list: no summary/collapse can erase
        a visited draft, UUID, ACK or resource-search intent. */}
    <div hidden={!visible || !canBrowse}>{visited.map(index => <ReviewedStepObservation key={`${original.projectId}:${original.testRunId}:${original.testCaseId}:${index}`}
      projectId={original.projectId} testRunId={original.testRunId} testCaseId={original.testCaseId} stepIndex={index}
      initiallyOpen active={visible && canBrowse} disabled={disabled} physical={testCase.validationDomain !== "SOFTWARE"} stepFieldLabels={{ ...stepFieldLabels, expectedActionOrData: technicalBehaviorLabel(stepFieldLabels.expectedActionOrData) }}
      onChanged={async () => { onModeActive(); await onChanged(); }}
      onUnconfirmedChange={pending => { onUnconfirmedChange?.(retention.markPending(index, pending)); }} />)}</div>
  </section>;
}
