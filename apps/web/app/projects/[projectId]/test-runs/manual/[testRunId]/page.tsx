"use client";

import { useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";

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
}) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState(testCase.currentResult?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
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

      {expanded && (
        <div style={{ marginTop: 10, fontSize: 13 }}>
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
        </div>
      )}

      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          className="btn-secondary"
          onClick={() => record("PASS")}
          disabled={disabled || busy}
        >
          Pass
        </button>
        <button
          className="btn-secondary"
          onClick={() => record("FAIL")}
          disabled={disabled || busy}
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
      </div>
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

  if (pageError) return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
  if (!data) return <p>Loading…</p>;

  const recordedCount = data.cases.filter((c) => c.currentResult).length;

  return (
    <div style={{ maxWidth: 800 }}>
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
            data.status !== "RUNNING"
          }
        >
          {completeMutation.isPending ? "Completing…" : "Complete run"}
        </button>
      </div>
      <p className="text-muted" style={{ fontSize: 13 }}>
        {recordedCount} / {data.cases.length} recorded · status: {data.status}
      </p>

      {data.cases.map((tc) => (
        <CaseRow
          key={tc.testCaseId}
          testCase={tc}
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
