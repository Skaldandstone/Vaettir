"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { resolveQualityExperience } from "@vaettir/core";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { StepExecutionPanel } from "@/components/StepExecutionPanel";

type ExecutionCase =
  RouterOutputs["manualExecution"]["getForExecution"]["cases"][number];
type Observations = NonNullable<ExecutionCase["currentResult"]>["observations"];
type Reading = {
  name: string;
  unit: string;
  value: string;
  lowerLimit: string;
  upperLimit: string;
  instrument: string;
};

const STATUS_COLORS: Record<string, string> = {
  PASS: "var(--frost)",
  FAIL: "var(--ember)",
  BLOCKED: "var(--ember)",
  SKIP: "var(--muted)",
};

function CaseRow({
  testCase,
  stepFieldLabels,
  onRecord,
  disabled,
  prerequisites,
  blockedBy,
  testRunId,
  onStepsChanged,
  onUnconfirmedStep,
}: {
  testCase: ExecutionCase;
  stepFieldLabels: Record<string, string>;
  onRecord: (
    testCaseId: string,
    status: "PASS" | "FAIL" | "BLOCKED" | "SKIP",
    note: string,
    observations: Observations,
  ) => Promise<void>;
  disabled: boolean;
  prerequisites: { id: string; title: string; status: string | null }[];
  blockedBy: string[];
  testRunId: string;
  onStepsChanged: () => Promise<unknown>;
  onUnconfirmedStep: (pending: boolean) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(testCase.currentResult?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [stepModeChosen, setStepModeChosen] = useState(false);
  const stepMode = stepModeChosen || testCase.stepResults.some(step => step.current);
  const [context, setContext] = useState({
    specimen: testCase.currentResult?.observations.specimen ?? "",
    hardwareRevision:
      testCase.currentResult?.observations.hardwareRevision ?? "",
    firmwareVersion: testCase.currentResult?.observations.firmwareVersion ?? "",
    environment: testCase.currentResult?.observations.environment ?? "",
  });
  const [readings, setReadings] = useState<Reading[]>(
    (testCase.currentResult?.observations.measurements ?? []).map((m) => ({
      ...m,
      value: String(m.value),
      lowerLimit: m.lowerLimit === undefined ? "" : String(m.lowerLimit),
      upperLimit: m.upperLimit === undefined ? "" : String(m.upperLimit),
    })),
  );

  async function record(status: "PASS" | "FAIL" | "BLOCKED" | "SKIP") {
    setBusy(true);
    setError(null);
    try {
      if (
        readings.some(
          (m) => !m.value.trim() || !Number.isFinite(Number(m.value)),
        )
      )
        throw new Error(
          "Enter a finite measured value for each reading, or remove the unused reading.",
        );
      await onRecord(testCase.testCaseId, status, note, {
        ...context,
        measurements: readings.map((m) => ({
          ...m,
          value: Number(m.value),
          lowerLimit: m.lowerLimit.trim() ? Number(m.lowerLimit) : undefined,
          upperLimit: m.upperLimit.trim() ? Number(m.upperLimit) : undefined,
        })),
      });
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Result could not be saved. Your entries are preserved.",
      );
    } finally {
      setBusy(false);
    }
  }

  const currentStatus = testCase.currentResult?.status ?? null;

  return (
    <div className="panel" style={{ marginBottom: 10, padding: 12 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            textAlign: "left",
            fontWeight: 600,
            padding: 0,
          }}
        >
          {expanded ? "▾" : "▸"} {testCase.title}
        </button>
        {currentStatus && (
          <span
            style={{
              color: STATUS_COLORS[currentStatus] ?? "var(--muted)",
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            {currentStatus}
          </span>
        )}
      </div>

      {prerequisites.length > 0 && <p className="text-muted" style={{ fontSize: 12, marginTop: 6 }}>
        Prerequisites in this run: {prerequisites.map(({ id, title, status }) => <span key={id} style={{ marginRight: 10 }}>{title} ({status ?? "not run"})</span>)}
      </p>}
      {blockedBy.length > 0 && <p role="status" style={{ color: "var(--warning)", fontSize: 12, marginTop: 4 }}>
        Complete {blockedBy.join(", ")} with Pass before recording Pass or Fail here. Blocked and Skip remain available.
      </p>}

      {expanded && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
          {testCase.background && <p style={{ whiteSpace: "pre-wrap" }}>{testCase.background}</p>}
          <p>
            <strong>{testCase.validationDomain.replace(/_/g, " ")}</strong>
          </p>
          {(
            [
              ["setup", "Fixture and setup"],
              ["safety", "Safety and stop conditions"],
              ["instruments", "Instruments and calibration"],
              ["acceptanceCriteria", "Measurement acceptance criteria"],
            ] as const
          ).map(
            ([key, label]) =>
              testCase.verificationProfile[key] && (
                <div key={key}>
                  <strong>{label}</strong>
                  <p style={{ whiteSpace: "pre-wrap" }}>
                    {testCase.verificationProfile[key]}
                  </p>
                </div>
              ),
          )}
          {!stepMode && <>
          {testCase.given.length > 0 && (
            <div style={{ marginBottom: 8 }}>
              <div className="eyebrow" style={{ fontSize: 11 }}>
                Given
              </div>
              {testCase.given.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              <div className="eyebrow" style={{ fontSize: 11, marginTop: 4 }}>
                When
              </div>
              {testCase.when.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
              <div className="eyebrow" style={{ fontSize: 11, marginTop: 4 }}>
                Then
              </div>
              {testCase.then.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
          )}
          {testCase.steps.length > 0 && (
            <table
              style={{
                width: "100%",
                borderCollapse: "collapse",
                marginBottom: 8,
              }}
            >
              <thead>
                <tr>
                  <th style={{ textAlign: "left", fontSize: 11 }}>#</th>
                  <th style={{ textAlign: "left", fontSize: 11 }}>
                    {stepFieldLabels.action ?? "Step"}
                  </th>
                  <th style={{ textAlign: "left", fontSize: 11 }}>
                    {stepFieldLabels.expectedActionOrData ??
                      "Expected action/data"}
                  </th>
                  <th style={{ textAlign: "left", fontSize: 11 }}>
                    {stepFieldLabels.expectedResult ?? "Expected result"}
                  </th>
                </tr>
              </thead>
              <tbody>
                {testCase.steps.map((s) => (
                  <tr key={s.order}>
                    <td>{s.order}</td>
                    <td>{s.action}</td>
                    <td>{s.expectedActionOrData ?? "—"}</td>
                    <td>{s.expectedResult ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="What actually happened (optional)…"
            style={{ width: "100%", marginBottom: 8 }}
          />
          <details style={{ margin: "14px 0" }}>
            <summary>Hardware, HIL or laboratory evidence</summary>
            <p>
              Operator-entered evidence, not an automated instrument capture or
              regulated electronic signature. Record approved limits and
              calibrated instrument IDs.
            </p>
            {(
              [
                ["specimen", "Device serial / specimen / batch"],
                ["hardwareRevision", "Hardware revision"],
                ["firmwareVersion", "Firmware / software version"],
                ["environment", "Fixture and environmental conditions"],
              ] as const
            ).map(([key, label]) => (
              <label key={key} style={{ display: "block", margin: "8px 0" }}>
                {label}
                <input
                  disabled={disabled || busy}
                  value={context[key]}
                  onChange={(e) =>
                    setContext((prev) => ({ ...prev, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            {readings.map((reading, index) => (
              <fieldset key={index} style={{ margin: "12px 0" }}>
                <legend>Measurement {index + 1}</legend>
                {(
                  [
                    ["name", "Measurement"],
                    ["value", "Measured value"],
                    ["unit", "Unit (V, A, W, °C…)"],
                    ["lowerLimit", "Lower limit (optional)"],
                    ["upperLimit", "Upper limit (optional)"],
                    ["instrument", "Instrument / calibration reference"],
                  ] as const
                ).map(([key, label]) => (
                  <label key={key} style={{ display: "block" }}>
                    {label}
                    <input
                      disabled={disabled || busy}
                      value={reading[key]}
                      onChange={(e) =>
                        setReadings((prev) =>
                          prev.map((r, i) =>
                            i === index ? { ...r, [key]: e.target.value } : r,
                          ),
                        )
                      }
                    />
                  </label>
                ))}
                <button
                  disabled={disabled || busy}
                  onClick={() =>
                    setReadings((prev) => prev.filter((_, i) => i !== index))
                  }
                >
                  Remove reading
                </button>
              </fieldset>
            ))}
            <button
              disabled={disabled || busy || readings.length >= 100}
              onClick={() =>
                setReadings((prev) => [
                  ...prev,
                  {
                    name: "",
                    value: "",
                    unit: "",
                    lowerLimit: "",
                    upperLimit: "",
                    instrument: "",
                  },
                ])
              }
            >
              Add measurement
            </button>
          </details>
          </>}
        </div>
      )}

      <div hidden={!expanded}>
        <StepExecutionPanel testRunId={testRunId} testCase={testCase} stepFieldLabels={stepFieldLabels} active={stepMode} disabled={disabled || busy} blockedBy={blockedBy} onModeActive={() => setStepModeChosen(true)} onChanged={onStepsChanged} onUnconfirmedChange={onUnconfirmedStep} />
      </div>

      {!stepMode && <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        <button
          className="btn-secondary"
          onClick={() => record("PASS")}
          disabled={disabled || busy || blockedBy.length > 0}
        >
          Pass
        </button>
        <button
          className="btn-secondary"
          onClick={() => record("FAIL")}
          disabled={disabled || busy || blockedBy.length > 0}
        >
          Fail
        </button>
        <button
          className="btn-secondary"
          onClick={() => record("BLOCKED")}
          disabled={disabled || busy}
        >
          Blocked
        </button>
        <button
          className="btn-secondary"
          onClick={() => record("SKIP")}
          disabled={disabled || busy}
        >
          Skip
        </button>
      </div>}
      {error && <p role="alert">{error}</p>}
    </div>
  );
}

// P1-15
export default function ManualExecutionPage() {
  const { projectId, testRunId } = useParams<{
    projectId: string;
    testRunId: string;
  }>();
  const router = useRouter();
  const { canEdit } = useProjectPermissions(projectId);
  const utils = trpcReact.useUtils();
  const dataQuery = trpcReact.manualExecution.getForExecution.useQuery({
    testRunId,
  });
  const [error, setError] = useState<string | null>(null);
  const [unconfirmedStepCases, setUnconfirmedStepCases] = useState<Set<string>>(() => new Set());

  const recordMutation = trpcReact.manualExecution.recordResult.useMutation();
  const completeMutation = trpcReact.manualExecution.complete.useMutation({
    onSuccess: () => router.push(`/projects/${projectId}/test-runs`),
    onError: (e) => setError(e.message),
  });

  async function handleRecord(
    caseId: string,
    status: "PASS" | "FAIL" | "BLOCKED" | "SKIP",
    note: string,
    observations: Observations,
  ) {
    await recordMutation.mutateAsync({
      testRunId,
      testCaseId: caseId,
      status,
      note: note || undefined,
      observations,
    });
    await utils.manualExecution.getForExecution.invalidate({ testRunId });
  }

  const data = dataQuery.data;
  const pageError = error ?? dataQuery.error?.message ?? null;

  if (!data) return pageError ? <div><p role="alert" style={{ color: "var(--ember)" }}>{pageError}</p><button className="btn-secondary" onClick={() => void dataQuery.refetch()}>Retry loading run</button></div> : <p>Loading…</p>;

  const recordedCount = data.cases.filter((c) => c.currentResult).length;

  return (
    <div style={{ maxWidth: 800 }}>
      {pageError && <div><p role="alert" style={{ color: "var(--ember)" }}>{pageError} Displayed evidence and open drafts are retained.</p><button className="btn-secondary" onClick={() => { setError(null); void dataQuery.refetch(); }}>Refresh run without discarding drafts</button></div>}
      {unconfirmedStepCases.size > 0 && <p role="status">Confirm pending step responses before completing this run. Retry receipts and entered evidence remain retained.</p>}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h1>Manual test run</h1>
        <button
          className="btn-primary"
          onClick={() => {
            if (
              recordedCount === data.cases.length ||
              confirm("Some cases have no result. Finish as an incomplete run?")
            )
              completeMutation.mutate({ testRunId });
          }}
          disabled={
            !canEdit ||
            completeMutation.isPending ||
            recordMutation.isPending ||
            unconfirmedStepCases.size > 0 ||
            data.status !== "RUNNING"
          }
        >
          {completeMutation.isPending ? "Completing…" : "Complete run"}
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {recordedCount} / {data.cases.length} recorded · status: {data.status}
      </p>
      {data.executionContext?.datasetExecution && <section style={{border:"1px solid var(--line)",padding:12,marginBottom:16}}>
        <h2 style={{fontSize:18}}>Dataset row {data.executionContext.datasetExecution.rowIndex + 1}: {data.executionContext.datasetExecution.rowName}</h2>
        <p>{data.executionContext.datasetExecution.sourceDisplayId} · one independently recorded row run. Prerequisites must pass within this run, not in a sibling row or another configuration.</p>
        <details><summary>Frozen parameter values</summary><dl>{Object.entries(data.executionContext.datasetExecution.values).map(([key,value]) => <div key={key}><dt>{key}</dt><dd style={{marginLeft:0,whiteSpace:"pre-wrap",overflowWrap:"anywhere"}}>{value || "(empty text)"}</dd></div>)}</dl></details>
        <details><summary>Other rows in this reviewed batch</summary><ul>{data.datasetBatchRuns.map(row => <li key={row.testRunId}>{row.testRunId === testRunId ? <strong>Current row: {row.rowName}</strong> : <a href={`/projects/${projectId}/test-runs/manual/${row.testRunId}`}>Row {row.rowIndex + 1}: {row.rowName}</a>} <span className="text-muted">({row.status.toLowerCase()})</span></li>)}</ul></details>
      </section>}
      {data.executionContext ? <details style={{ marginBottom: 16 }}>
        <summary>Saved execution context{data.executionContext.experience ? `: ${resolveQualityExperience(data.executionContext.experience).title}` : ""}</summary>
        <p>These case definitions and configuration were saved when this run started. Later profile or case edits do not rewrite this run. Recorded results remain separate evidence; this context does not certify safety or compliance.</p>
        {data.executionContext.plan && <section style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 16 }}>Frozen plan definition</h2>
          <dl>
            <dt>Plan</dt>
            <dd style={{ marginLeft: 0 }}><a href={`/projects/${projectId}/test-plans/${data.executionContext.plan.testPlanId}`}>{data.executionContext.plan.name}</a> <span className="text-muted">(link opens the current plan)</span></dd>
            <dt>Saved configuration</dt>
            <dd style={{ marginLeft: 0 }}>{data.executionContext.plan.template.configurations.find(configuration => configuration.id === data.executionContext!.plan!.configurationId)?.name ?? data.executionContext.plan.configurationId}</dd>
            <dt>Definition fingerprint</dt>
            <dd style={{ marginLeft: 0, overflowWrap: "anywhere" }}><code>{data.executionContext.plan.templateHash}</code></dd>
          </dl>
          <p className="text-muted">This execution retains the reviewed plan and preset. Editing the current plan does not change this record; repeating it creates a separate run.</p>
        </section>}
        <dl>{Object.entries(data.executionContext.configuration).filter(([, value]) => value).map(([key, value]) => <div key={key} style={{ marginBottom: 8 }}><dt>{key.replace(/([A-Z])/g, " $1")}</dt><dd style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{value}</dd></div>)}</dl>
        {data.executionContext.experience && <ul>{resolveQualityExperience(data.executionContext.experience).runGuidance.map(note => <li key={note}>{note}</li>)}</ul>}
      </details> : <p className="text-muted">Legacy run: no saved profile/configuration snapshot. The displayed procedure may reflect later case edits.</p>}

      {data.cases.map((tc) => (
        <CaseRow
          key={tc.testCaseId}
          testCase={tc}
          testRunId={testRunId}
          onStepsChanged={() => utils.manualExecution.getForExecution.invalidate({ testRunId })}
          onUnconfirmedStep={pending => setUnconfirmedStepCases(current => { const next = new Set(current); if (pending) next.add(tc.testCaseId); else next.delete(tc.testCaseId); return next; })}
          prerequisites={tc.prerequisiteIds.map(id => {
            const prerequisite = data.cases.find(candidate => candidate.testCaseId === id);
            return { id, title: prerequisite?.title ?? "Unavailable case", status: prerequisite?.currentResult?.status ?? null };
          })}
          blockedBy={tc.prerequisiteIds.filter(id => data.cases.find(candidate => candidate.testCaseId === id)?.currentResult?.status !== "PASS").map(id => data.cases.find(candidate => candidate.testCaseId === id)?.title ?? "Unavailable case")}
          stepFieldLabels={data.stepFieldLabels}
          onRecord={handleRecord}
          disabled={
            !canEdit || data.status !== "RUNNING" || completeMutation.isPending
          }
        />
      ))}
    </div>
  );
}
