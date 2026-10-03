"use client";

import { useId, useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { RiskMeter } from "@/components/MetricVisuals";
import { TestDesignReview } from "@/components/TestDesignReview";
import { TestCasePrerequisites } from "@/components/TestCasePrerequisites";
import { TestCaseExecutionHistory } from "@/components/TestCaseExecutionHistory";
import { CaseTraceabilityPanel } from "@/components/CaseTraceabilityPanel";
import { Modal } from "@/components/Modal";
import { automationTargetForFramework } from "@vaettir/core";
import {
  INSPECTOR_SECTIONS,
  inspectorLabel,
  inspectorSectionForKey,
  type InspectorSection,
} from "@/lib/case-inspector";
import styles from "./CaseInspector.module.css";

const cellStyle: CSSProperties = {
  border: "1px solid var(--line)",
  padding: "6px 10px",
  textAlign: "left",
};

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// A field-by-field comparison, not a line-level text diff -- the point is
// "did the human change this since the AI wrote it", not a patch-style
// rendering. Only fields that actually differ are worth showing; a case a
// reviewer approved verbatim has nothing here to look at.
function DiffField({
  label,
  before,
  after,
}: {
  label: string;
  before: string;
  after: string;
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="eyebrow" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div
        style={{
          color: "var(--ember)",
          textDecoration: "line-through",
          opacity: 0.75,
          fontSize: 13,
        }}
      >
        {before || "(empty)"}
      </div>
      <div style={{ color: "var(--frost)", fontSize: 13 }}>
        {after || "(empty)"}
      </div>
    </div>
  );
}

type AutomationFramework =
  | "MAESTRO"
  | "PLAYWRIGHT"
  | "CYPRESS"
  | "JEST_VITEST"
  | "MOCHA_CHAI"
  | "XCUITEST"
  | "XCTEST"
  | "SWIFT_TESTING"
  | "ESPRESSO"
  | "COMPOSE_UI"
  | "UI_AUTOMATOR"
  | "ROBOLECTRIC"
  | "APPIUM_WEBDRIVERIO"
  | "DETOX"
  | "FLUTTER_INTEGRATION_TEST"
  | "PYTEST"
  | "JUNIT5"
  | "TESTNG"
  | "NUNIT"
  | "XUNIT_DOTNET"
  | "MSTEST"
  | "POSTMAN"
  | "PACT"
  | "REST_ASSURED"
  | "UNITY_TEST_FRAMEWORK"
  | "UNREAL_AUTOMATION"
  | "GODOT_GDUNIT4";

const AUTOMATION_FRAMEWORKS: Array<{
  value: AutomationFramework;
  label: string;
}> = [
  { value: "MAESTRO", label: "Maestro" },
  { value: "APPIUM_WEBDRIVERIO", label: "Appium + WebdriverIO" },
  { value: "DETOX", label: "Detox" },
  { value: "FLUTTER_INTEGRATION_TEST", label: "Flutter integration_test" },
  { value: "XCUITEST", label: "XCUITest" },
  { value: "XCTEST", label: "XCTest" },
  { value: "SWIFT_TESTING", label: "Swift Testing" },
  { value: "ESPRESSO", label: "Espresso" },
  { value: "COMPOSE_UI", label: "Jetpack Compose UI" },
  { value: "UI_AUTOMATOR", label: "UI Automator" },
  { value: "ROBOLECTRIC", label: "Robolectric" },
  { value: "PLAYWRIGHT", label: "Playwright" },
  { value: "CYPRESS", label: "Cypress" },
  { value: "JEST_VITEST", label: "Jest / Vitest" },
  { value: "MOCHA_CHAI", label: "Mocha + Chai" },
  { value: "PYTEST", label: "pytest" },
  { value: "JUNIT5", label: "JUnit 5" },
  { value: "TESTNG", label: "TestNG" },
  { value: "NUNIT", label: "NUnit" },
  { value: "XUNIT_DOTNET", label: "xUnit.net" },
  { value: "MSTEST", label: "MSTest" },
  { value: "POSTMAN", label: "Postman" },
  { value: "PACT", label: "Pact" },
  { value: "REST_ASSURED", label: "REST Assured" },
  { value: "UNITY_TEST_FRAMEWORK", label: "Unity Test Framework" },
  { value: "UNREAL_AUTOMATION", label: "Unreal Automation" },
  { value: "GODOT_GDUNIT4", label: "Godot GdUnit4" },
];

function AutomationDraftSection({
  testCaseId,
  sourceFramework,
  readOnly = false,
}: {
  testCaseId: string;
  sourceFramework?: string;
  readOnly?: boolean;
}) {
  const linkedTarget = automationTargetForFramework(sourceFramework);
  const suggested = AUTOMATION_FRAMEWORKS.find(
    (option) => option.value === linkedTarget,
  );
  const [framework, setFramework] = useState<AutomationFramework | "">(
    suggested?.value ?? "",
  );
  const [projectContext, setProjectContext] = useState("");
  const saved = trpcReact.testCases.automationDraft.useQuery(
    { id: testCaseId },
    {
      refetchInterval: (query) =>
        query.state.data?.status === "GENERATING" ? 3000 : false,
    },
  );
  const draft = saved.data?.content;
  const [confirmReject, setConfirmReject] = useState(false);
  const rejectMutation =
    trpcReact.testCases.rejectAutomationDraft.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generateMutation =
    trpcReact.testCases.generateAutomationDraft.useMutation();

  async function generate() {
    if (!framework) return;
    setError(null);
    setCopied(false);
    try {
      await generateMutation.mutateAsync({
        id: testCaseId,
        framework,
        projectContext: projectContext.trim() || undefined,
      });
      await saved.refetch();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function copyDraft() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft.code);
      setCopied(true);
    } catch {
      setError(
        "The browser could not copy the draft. Select the source and copy it manually.",
      );
    }
  }

  function downloadDraft() {
    if (!draft) return;
    const blob = new Blob([draft.code], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = draft.fileName.replace(/[\\/:*?"<>|]/g, "-");
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <strong>Automation draft</strong>
      <div style={{ margin: "10px 0" }}>
        <TestDesignReview
          testCaseId={testCaseId}
          readOnly={readOnly}
          canUseDraft={
            !readOnly && !saved.data && !saved.isLoading && !saved.error
          }
          onUse={(review) => {
            if (review.framework) setFramework(review.framework);
            setProjectContext(
              JSON.stringify({ reviewedDesign: review }).slice(0, 12000),
            );
          }}
        />
      </div>
      {saved.isLoading && <p role="status">Loading saved draft…</p>}
      {saved.error && (
        <p role="alert">
          Could not load saved draft.{" "}
          <button onClick={() => void saved.refetch()}>Retry</button>
        </p>
      )}
      {saved.data?.status === "GENERATING" && (
        <p role="status">
          Your draft is generating. You can close this panel and return. If this
          status persists, contact an administrator; starting another paid
          request is blocked.
        </p>
      )}
      <p className="text-muted" style={{ fontSize: 13, margin: "5px 0 12px" }}>
        Turn this reviewed case into framework-specific source. Vaettir returns
        a draft for human review and never writes to your repository or claims
        that the source was executed.
      </p>
      {!readOnly && !saved.data && !saved.isLoading && !saved.error && (
        <details>
          <summary>Prepare an automation draft</summary>
          <div style={{ display: "grid", gap: 10 }}>
            <label>
              <span
                className="eyebrow"
                style={{ display: "block", marginBottom: 4 }}
              >
                Framework
              </span>
              <select
                value={framework}
                onChange={(event) =>
                  setFramework(event.target.value as AutomationFramework)
                }
                style={{ width: "100%" }}
              >
                <option value="">Choose a framework</option>
                {AUTOMATION_FRAMEWORKS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small className="text-muted">
                {suggested
                  ? `Suggested from this case's linked ${sourceFramework} test metadata. Confirm it fits the current stack and test level.`
                  : "No supported framework is verified for this case. Choose deliberately; project type alone is not stack evidence."}
              </small>
            </label>
            <label>
              <span
                className="eyebrow"
                style={{ display: "block", marginBottom: 4 }}
              >
                Project context (optional)
              </span>
              <textarea
                value={projectContext}
                onChange={(event) => setProjectContext(event.target.value)}
                maxLength={12_000}
                rows={4}
                placeholder="Add known app IDs, accessibility identifiers, resource IDs, routes, or existing test helpers. Missing details remain explicit TODOs."
                style={{ width: "100%", resize: "vertical" }}
              />
            </label>
            <div>
              <button
                onClick={generate}
                disabled={generateMutation.isPending || !framework}
              >
                {generateMutation.isPending
                  ? "Generating…"
                  : "Generate review draft"}
              </button>
              <span
                className="text-muted"
                style={{ fontSize: 12, marginLeft: 8 }}
              >
                Starts at 10 AI credits; final cost is reconciled to usage.
              </span>
            </div>
          </div>
        </details>
      )}

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {draft && (
        <div
          style={{
            borderTop: "1px solid var(--line)",
            marginTop: 14,
            paddingTop: 14,
          }}
        >
          <p className="text-muted">
            Saved with this test case. Reopening, copying or downloading does
            not use credits.
          </p>
          {!readOnly &&
            (!confirmReject ? (
              <button
                className="btn-secondary"
                onClick={() => setConfirmReject(true)}
              >
                Reject draft…
              </button>
            ) : (
              <div role="group" aria-label="Confirm draft rejection">
                <p>
                  Reject this saved draft? Creating a replacement uses credits.
                  Rejection does not refund the original generation.
                </p>
                <button
                  disabled={rejectMutation.isPending}
                  onClick={async () => {
                    if (!saved.data) return;
                    try {
                      await rejectMutation.mutateAsync({
                        id: testCaseId,
                        draftId: saved.data.id,
                      });
                      await saved.refetch();
                      setConfirmReject(false);
                    } catch (cause) {
                      setError(
                        cause instanceof Error ? cause.message : String(cause),
                      );
                    }
                  }}
                >
                  Reject draft
                </button>
                <button
                  className="btn-secondary"
                  disabled={rejectMutation.isPending}
                  onClick={() => setConfirmReject(false)}
                >
                  Keep draft
                </button>
              </div>
            ))}
          <p style={{ fontSize: 13 }}>
            <strong>Stable ID:</strong> <code>{draft.automationId}</code>
          </p>
          <div className="case-draft-toolbar">
            <strong>{draft.fileName}</strong>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-secondary" onClick={copyDraft}>
                {copied ? "Copied" : "Copy"}
              </button>
              <button className="btn-secondary" onClick={downloadDraft}>
                Download
              </button>
            </div>
          </div>
          <pre
            style={{
              overflowX: "auto",
              background: "var(--panel-2)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 12,
              whiteSpace: "pre",
              fontSize: 12,
            }}
          >
            <code>{draft.code}</code>
          </pre>
          <p style={{ fontSize: 13 }}>{draft.explanation}</p>
          {draft.assumptions.length > 0 && (
            <div>
              <strong style={{ fontSize: 13 }}>Assumptions and TODOs</strong>
              <ul style={{ marginTop: 4 }}>
                {draft.assumptions.map((assumption, index) => (
                  <li key={index}>{assumption}</li>
                ))}
              </ul>
            </div>
          )}
          {draft.requiredDependencies.length > 0 && (
            <p style={{ fontSize: 13 }}>
              <strong>Dependencies:</strong>{" "}
              {draft.requiredDependencies.join(", ")}
            </p>
          )}
          {draft.validationCommands.length > 0 && (
            <div>
              <strong style={{ fontSize: 13 }}>
                Suggested local validation
              </strong>
              <ul style={{ marginTop: 4 }}>
                {draft.validationCommands.map((command, index) => (
                  <li key={index}>
                    <code>{command}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

// P3-03: which compliance controls this specific case is evidence for.
// Mapping a control here is what feeds the coverage view on the project's
// /compliance page ("which controls have zero mapped test cases").
function ComplianceControlsSection({
  testCaseId,
  projectId,
  readOnly,
}: {
  testCaseId: string;
  projectId: string;
  readOnly?: boolean;
}) {
  // P1-15: the framework select defaults to the first framework until the
  // user picks one (derived, not seeded via an effect); candidates are a
  // dependent query on the chosen framework.
  const utils = trpcReact.useUtils();
  const mappedQuery = trpcReact.compliance.testCaseControls.useQuery({
    testCaseId,
  });
  const mapped = mappedQuery.data ?? null;
  const frameworksQuery = trpcReact.compliance.listFrameworks.useQuery();
  const frameworks = frameworksQuery.data ?? [];
  const [chosenFrameworkId, setFrameworkId] = useState("");
  const frameworkId = chosenFrameworkId || frameworks[0]?.id || "";
  const candidatesQuery = trpcReact.compliance.controlCoverage.useQuery(
    { projectId, frameworkId },
    { enabled: frameworkId.length > 0 },
  );
  const candidates = candidatesQuery.data ?? [];
  const mapMutation = trpcReact.compliance.mapTestCase.useMutation();
  const unmapMutation = trpcReact.compliance.unmapTestCase.useMutation();
  const [controlId, setControlId] = useState("");
  const [busy, setBusy] = useState(false);

  function load() {
    void utils.compliance.testCaseControls.invalidate({ testCaseId });
  }

  async function addMapping() {
    if (!controlId) return;
    setBusy(true);
    try {
      await mapMutation.mutateAsync({ testCaseId, controlId });
      setControlId("");
      load();
    } finally {
      setBusy(false);
    }
  }

  async function removeMapping(id: string) {
    setBusy(true);
    try {
      await unmapMutation.mutateAsync({ testCaseId, controlId: id });
      load();
    } finally {
      setBusy(false);
    }
  }

  if (!mapped) return null;
  const unmappedCandidates = candidates.filter(
    (c) => !mapped.some((m) => m.id === c.id),
  );

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <strong>Compliance controls:</strong>
      {mapped.length === 0 && (
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>
          Not mapped to any control.
        </p>
      )}
      {mapped.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0" }}>
          {mapped.map((c) => (
            <li
              key={c.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 13,
                padding: "3px 0",
              }}
            >
              <span>
                {c.frameworkName}: <strong>{c.code}</strong> {c.title}
              </span>
              {!readOnly && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11 }}
                  onClick={() => removeMapping(c.id)}
                  disabled={busy}
                >
                  Unmap
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && frameworks.length > 0 && (
        <details>
          <summary>Map a compliance control</summary>
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 6 }}
          >
            <select
              aria-label="Compliance framework"
              value={frameworkId}
              onChange={(e) => setFrameworkId(e.target.value)}
              style={{ fontSize: 12 }}
            >
              {frameworks.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Compliance control"
              value={controlId}
              onChange={(e) => setControlId(e.target.value)}
              style={{ fontSize: 12, flex: 1 }}
            >
              <option value="">Map to a control…</option>
              {unmappedCandidates.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} — {c.title}
                </option>
              ))}
            </select>
            <button
              className="btn-secondary"
              style={{ fontSize: 12 }}
              onClick={addMapping}
              disabled={busy || !controlId}
            >
              Map
            </button>
          </div>
        </details>
      )}
    </div>
  );
}

type DatasetRow = { name: string; values: Record<string, string> };

// 2026-08-27 competitor parity audit: data-driven testing for the
// structured step-table format (Gherkin already gets this via Scenario
// Outline + Examples, P2-13). <placeholder> syntax matches Gherkin's own
// Examples-table convention. Shows the expanded preview (real
// substitution, not a display approximation) alongside a simple
// parameter/row editor.
// P1-15: the saved data set and its expanded preview are queries; edits
// accumulate in a local draft that starts as a copy of the saved row the
// first time an updater runs, so a background refetch never overwrites
// in-progress edits and cancelling the editor drops the draft.
function DatasetSection({
  testCaseId,
  readOnly,
}: {
  testCaseId: string;
  readOnly?: boolean;
}) {
  const utils = trpcReact.useUtils();
  const datasetQuery = trpcReact.testCaseDatasets.get.useQuery({ testCaseId });
  const previewQuery = trpcReact.testCaseDatasets.expandedPreview.useQuery({
    testCaseId,
  });
  const preview = previewQuery.data ?? [];
  const saveMutation = trpcReact.testCaseDatasets.save.useMutation();
  const deleteMutation = trpcReact.testCaseDatasets.delete.useMutation();
  const savedParameterNames = datasetQuery.data?.parameterNames ?? [];
  const savedRows = datasetQuery.data?.rows ?? [];
  const [draft, setDraft] = useState<{
    parameterNames: string[];
    rows: DatasetRow[];
  } | null>(null);
  const parameterNames = draft?.parameterNames ?? savedParameterNames;
  const rows = draft?.rows ?? savedRows;
  const [editingState, setEditingState] = useState(false);
  const editing = editingState;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function setEditing(next: boolean) {
    if (!next) setDraft(null);
    setEditingState(next);
  }
  function setParameterNames(update: (prev: string[]) => string[]) {
    setDraft((d) => {
      const base = d ?? {
        parameterNames: savedParameterNames,
        rows: savedRows,
      };
      return { ...base, parameterNames: update(base.parameterNames) };
    });
  }
  function setRows(update: (prev: DatasetRow[]) => DatasetRow[]) {
    setDraft((d) => {
      const base = d ?? {
        parameterNames: savedParameterNames,
        rows: savedRows,
      };
      return { ...base, rows: update(base.rows) };
    });
  }

  function load() {
    void utils.testCaseDatasets.get.invalidate({ testCaseId });
    void utils.testCaseDatasets.expandedPreview.invalidate({ testCaseId });
  }

  function addParameter() {
    const name = prompt("Parameter name (used in steps as <name>)");
    if (!name?.trim()) return;
    setParameterNames((p) => [...p, name.trim()]);
    setRows((rs) =>
      rs.map((r) => ({ ...r, values: { ...r.values, [name.trim()]: "" } })),
    );
  }

  function addRow() {
    setRows((rs) => [
      ...rs,
      {
        name: `Row ${rs.length + 1}`,
        values: Object.fromEntries(parameterNames.map((p) => [p, ""])),
      },
    ]);
  }

  async function save() {
    if (parameterNames.length === 0 || rows.length === 0) return;
    setSaving(true);
    setError(null);
    try {
      await saveMutation.mutateAsync({ testCaseId, parameterNames, rows });
      setEditing(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeDataset() {
    if (!confirm("Remove this data set?")) return;
    await deleteMutation.mutateAsync({ testCaseId });
    load();
  }

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>Data set</strong>
        {!readOnly && !editing && (
          <button
            className="btn-secondary"
            style={{ fontSize: 12 }}
            onClick={() => setEditing(true)}
          >
            {parameterNames.length > 0 ? "Edit" : "Add data set"}
          </button>
        )}
      </div>
      {error && <p style={{ color: "var(--ember)", fontSize: 12 }}>{error}</p>}

      {!editing && preview.length > 0 && (
        <div style={{ marginTop: 8 }}>
          {preview.map((row, i) => (
            <details key={i} style={{ fontSize: 13, marginBottom: 4 }}>
              <summary>{row.rowName}</summary>
              <div style={{ paddingLeft: 12 }}>
                <div>
                  <em>Given</em> {row.given.join("; ")}
                </div>
                <div>
                  <em>When</em> {row.when.join("; ")}
                </div>
                <div>
                  <em>Then</em> {row.then.join("; ")}
                </div>
              </div>
            </details>
          ))}
          {!readOnly && (
            <button
              className="btn-secondary"
              style={{ fontSize: 11, marginTop: 6 }}
              onClick={removeDataset}
            >
              Remove data set
            </button>
          )}
        </div>
      )}
      {!editing && preview.length === 0 && (
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>
          No data set. Use <code>&lt;paramName&gt;</code> in given/when/then
          steps, then add parameters and rows here.
        </p>
      )}

      {editing && (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 6 }}>
            {parameterNames.map((p) => (
              <span
                key={p}
                className="text-muted"
                style={{ fontSize: 12, marginRight: 8 }}
              >
                &lt;{p}&gt;
              </span>
            ))}
            <button
              className="btn-secondary"
              style={{ fontSize: 11 }}
              onClick={addParameter}
            >
              + Parameter
            </button>
          </div>
          {rows.map((row, i) => (
            <div
              key={i}
              style={{
                border: "1px solid var(--line)",
                borderRadius: 6,
                padding: 8,
                marginBottom: 6,
              }}
            >
              <input
                value={row.name}
                onChange={(e) =>
                  setRows((rs) =>
                    rs.map((r, j) =>
                      j === i ? { ...r, name: e.target.value } : r,
                    ),
                  )
                }
                style={{ fontWeight: 600, marginBottom: 4 }}
              />
              <button
                style={{ float: "right", fontSize: 11 }}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                Remove row
              </button>
              {parameterNames.map((p) => (
                <div
                  key={p}
                  style={{
                    display: "flex",
                    gap: 6,
                    alignItems: "center",
                    marginTop: 4,
                  }}
                >
                  <span style={{ fontSize: 12, width: 100 }}>{p}</span>
                  <input
                    value={row.values[p] ?? ""}
                    onChange={(e) =>
                      setRows((rs) =>
                        rs.map((r, j) =>
                          j === i
                            ? {
                                ...r,
                                values: { ...r.values, [p]: e.target.value },
                              }
                            : r,
                        ),
                      )
                    }
                    style={{ flex: 1 }}
                  />
                </div>
              ))}
            </div>
          ))}
          <button onClick={addRow} disabled={parameterNames.length === 0}>
            + Row
          </button>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setEditing(false)}>
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={save}
              disabled={
                saving || parameterNames.length === 0 || rows.length === 0
              }
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// 2026-08-27 competitor parity audit: attachments on the test case's own
// authoring record - a reference mockup, a log, a spec doc. Two-step
// upload matching P5-15's proven pattern: get a presigned PUT, upload
// bytes directly to S3, then verify stored metadata before offering evidence.
function AttachmentsSection({
  testCaseId,
  readOnly,
}: {
  testCaseId: string;
  readOnly?: boolean;
}) {
  const utils = trpcReact.useUtils();
  const attachmentsQuery = trpcReact.testCaseAttachments.list.useQuery({
    testCaseId,
  });
  const attachments = attachmentsQuery.data ?? [];
  const requestUploadMutation =
    trpcReact.testCaseAttachments.requestUpload.useMutation();
  const deleteMutation = trpcReact.testCaseAttachments.delete.useMutation();
  const confirmMutation =
    trpcReact.testCaseAttachments.confirmUpload.useMutation();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function load() {
    void utils.testCaseAttachments.list.invalidate({ testCaseId });
  }

  async function handleFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setUploading(true);
    setError(null);
    try {
      const { uploadUrl, attachmentId } =
        await requestUploadMutation.mutateAsync({
          testCaseId,
          fileName: file.name,
          contentType: file.type || "application/octet-stream",
          sizeBytes: file.size,
        });
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "content-type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      await confirmMutation.mutateAsync({ attachmentId });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      load();
      setUploading(false);
    }
  }

  async function view(id: string) {
    const { viewUrl } = await utils.testCaseAttachments.getViewUrl.fetch({
      attachmentId: id,
    });
    window.open(viewUrl, "_blank");
  }

  async function remove(id: string) {
    await deleteMutation.mutateAsync({ attachmentId: id });
    load();
  }

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <strong>Attachments</strong>
      {error && <p style={{ color: "var(--ember)", fontSize: 12 }}>{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
        {attachments.map((a) => (
          <li
            key={a.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              fontSize: 13,
              padding: "3px 0",
            }}
          >
            <button
              onClick={() => view(a.id)}
              style={{
                background: "none",
                border: "none",
                color: "var(--frost)",
                cursor: "pointer",
                padding: 0,
              }}
            >
              {a.fileName}
            </button>
            <span>
              <span className="text-muted" style={{ marginRight: 8 }}>
                {(a.sizeBytes / 1024).toFixed(0)} KB
              </span>
              {!a.uploadCompletedAt && (
                <span className="text-muted">
                  Not verified for execution evidence{" "}
                </span>
              )}
              {!readOnly && !a.uploadCompletedAt && (
                <button
                  className="btn-secondary"
                  disabled={confirmMutation.isPending}
                  onClick={async () => {
                    setError(null);
                    try {
                      await confirmMutation.mutateAsync({ attachmentId: a.id });
                      load();
                    } catch (cause) {
                      setError(
                        cause instanceof Error
                          ? cause.message
                          : "Verification failed. Retry after upload completes.",
                      );
                    }
                  }}
                >
                  Verify uploaded file
                </button>
              )}
              {!readOnly && (
                <button
                  className="btn-secondary"
                  style={{ fontSize: 11 }}
                  onClick={() => remove(a.id)}
                >
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
        {attachments.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>
            No attachments.
          </p>
        )}
      </ul>
      {!readOnly && (
        <details style={{ marginTop: 8 }}>
          <summary>Add an attachment</summary>
          <input
            aria-label="Upload case attachment"
            type="file"
            onChange={handleFile}
            disabled={uploading}
          />
          {uploading && <span style={{ fontSize: 12 }}> Uploading…</span>}
        </details>
      )}
    </div>
  );
}

// P5-16-adjacent (2026-08-27 competitor parity audit): every competitor
// versions the individual test case, not just its parent plan (which
// TestPlanDetailContent's VersionHistorySection already covers, P4-05).
// Same pattern: full snapshots from the API, diff computed client-side.
function TestCaseVersionHistorySection({ testCaseId }: { testCaseId: string }) {
  const historyQuery = trpcReact.testCases.history.useQuery({ testCaseId });
  const versions = historyQuery.data ?? [];
  const loading = historyQuery.isPending;

  function changesFrom(
    version: RouterOutputs["testCases"]["history"][number],
    index: number,
  ): string[] {
    const prev = versions[index + 1];
    if (!prev) return ["Initial version"];
    const changes: string[] = [];
    if (version.title !== prev.title)
      changes.push(`title: "${prev.title}" → "${version.title}"`);
    if (JSON.stringify(version.given) !== JSON.stringify(prev.given))
      changes.push("Given changed");
    if (JSON.stringify(version.when) !== JSON.stringify(prev.when))
      changes.push("When changed");
    if (JSON.stringify(version.then) !== JSON.stringify(prev.then))
      changes.push("Then changed");
    if (JSON.stringify(version.steps) !== JSON.stringify(prev.steps))
      changes.push("structured steps changed");
    if (version.priority !== prev.priority)
      changes.push(`priority: ${prev.priority} → ${version.priority}`);
    if (version.testType !== prev.testType)
      changes.push(`type: ${prev.testType} → ${version.testType}`);
    if (JSON.stringify(version.tags) !== JSON.stringify(prev.tags))
      changes.push("tags changed");
    return changes.length > 0 ? changes : ["No changes"];
  }

  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 8,
        padding: 12,
        marginBottom: 16,
      }}
    >
      <strong>Case changes</strong>
      {loading && <p>Loading…</p>}
      {!loading && (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
          {versions.map((v, i) => (
            <li
              key={v.versionNumber}
              style={{
                borderBottom: "1px solid var(--line)",
                padding: "6px 0",
              }}
            >
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "baseline",
                }}
              >
                <strong style={{ fontSize: 13 }}>v{v.versionNumber}</strong>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(v.createdAt).toLocaleString()}
                  {v.createdBy &&
                    ` by ${v.createdBy.name ?? v.createdBy.email}`}
                </span>
              </div>
              <ul
                style={{
                  margin: "4px 0 0 16px",
                  fontSize: 12,
                  color: "var(--muted)",
                }}
              >
                {changesFrom(v, i).map((c, j) => (
                  <li key={j}>{c}</li>
                ))}
              </ul>
              <details style={{ marginTop: 8 }}>
                <summary>View saved procedure</summary>
                <p><strong>{v.title}</strong></p>
                {v.background && <p style={{ whiteSpace: "pre-wrap" }}>{v.background}</p>}
                {(["given", "when", "then"] as const).map(phase => (
                  <div key={phase}>
                    <strong>{inspectorLabel(phase)}</strong>
                    {v[phase].length ? <ol>{v[phase].map((text, index) => <li key={index} style={{ whiteSpace: "pre-wrap" }}>{text}</li>)}</ol> : <p className="text-muted">Not recorded in this version.</p>}
                  </div>
                ))}
                {Array.isArray(v.steps) && v.steps.length > 0 && (
                  <div>
                    <strong>Structured steps (saved snapshot)</strong>
                    <pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontSize: 12 }}>{JSON.stringify(v.steps, null, 2)}</pre>
                  </div>
                )}
              </details>
            </li>
          ))}
          {versions.length === 0 && (
            <p className="text-muted">No history yet.</p>
          )}
        </ul>
      )}
    </div>
  );
}

// Shared between the full detail page (/test-cases/[id], for deep links and
// bookmarking) and the drawer opened from the list -- see
// STYLE_GUIDE-adjacent decision in TestCaseTree.tsx's commit: don't force a
// page navigation for the common "look at / triage a case" action when a
// pop-out view will do, matching how TestRail/Qase's own case repository
// works (a side panel, not a page hop, for viewing/light editing).
type TestCaseDetailProps = {
  id: string;
  projectId: string;
  onEditHref?: string;
  onChanged?: () => void;
  onSuiteSelect?: (path: string) => void;
  readOnly?: boolean;
};

export function TestCaseDetailContent(props: TestCaseDetailProps) {
  // Switching records must not carry mutation notes or draft context into another case.
  // Within a record, all section panels remain mounted across tab changes.
  return <TestCaseInspector key={props.id} {...props} />;
}

function TestCaseInspector({
  id,
  projectId,
  onEditHref,
  onChanged,
  onSuiteSelect,
  readOnly,
}: TestCaseDetailProps) {
  const sectionId = useId();
  const [sectionState, setSectionState] = useState<{
    caseId: string;
    section: InspectorSection;
  }>({ caseId: id, section: "Procedure" });
  const section =
    sectionState.caseId === id ? sectionState.section : "Procedure";
  function setSection(next: InspectorSection) {
    setSectionState({ caseId: id, section: next });
  }
  const [expandedTitleFor, setExpandedTitleFor] = useState<string | null>(null);
  const utils = trpcReact.useUtils();
  const tcQuery = trpcReact.testCases.byId.useQuery({ id });
  const tc = tcQuery.data ?? null;
  const savedAutomation = trpcReact.testCases.automationDraft.useQuery(
    { id },
    {
      refetchInterval: (query) =>
        query.state.data?.status === "GENERATING" ? 3000 : false,
    },
  );
  const stepAttachments = trpcReact.testCaseAttachments.list.useQuery({
    testCaseId: id,
  });
  const approveMutation = trpcReact.testCases.approve.useMutation();
  const rejectMutation = trpcReact.testCases.reject.useMutation();
  const assessRiskMutation = trpcReact.testCases.assessRisk.useMutation();
  const [riskDialogOpen, setRiskDialogOpen] = useState(false);
  const [riskApproved, setRiskApproved] = useState(false);
  const riskPreview = trpcReact.testCases.riskPreview.useQuery(
    { id },
    { enabled: riskDialogOpen },
  );
  const riskReviews = trpcReact.testCases.riskReviews.useQuery({ id });
  const prioritySuggestion = trpcReact.testCases.prioritySuggestion.useQuery({
    id,
  });
  const decidePriorityMutation =
    trpcReact.testCases.decidePriority.useMutation();
  const [businessPriority, setBusinessPriority] = useState<"HIGH" | "CRITICAL">(
    "HIGH",
  );
  const [businessRationale, setBusinessRationale] = useState("");
  const [priorityBusy, setPriorityBusy] = useState(false);
  const [priorityError, setPriorityError] = useState("");
  const [stepMediaError, setStepMediaError] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [assessingRisk, setAssessingRisk] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  function load() {
    void utils.testCases.byId.invalidate({ id });
    void utils.testCases.history.invalidate({ testCaseId: id });
  }

  async function review(decision: "approve" | "reject") {
    setReviewing(true);
    setError(null);
    try {
      await (
        decision === "approve" ? approveMutation : rejectMutation
      ).mutateAsync({ id, note: reviewNote || undefined });
      setReviewNote("");
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }

  async function assessRisk() {
    if (!riskPreview.data || !riskApproved) return;
    setAssessingRisk(true);
    setError(null);
    try {
      await assessRiskMutation.mutateAsync({
        id,
        expectedHash: riskPreview.data.inputHash,
        approved: true,
      });
      load();
      await riskPreview.refetch();
      await riskReviews.refetch();
      await prioritySuggestion.refetch();
      setRiskDialogOpen(false);
      setRiskApproved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssessingRisk(false);
    }
  }

  async function decidePriority(mode: "MATCH_RISK" | "BUSINESS_OVERRIDE") {
    const suggestion = prioritySuggestion.data;
    if (!suggestion) return;
    setPriorityBusy(true);
    setPriorityError("");
    try {
      await decidePriorityMutation.mutateAsync({
        id,
        mode,
        expectedPriority: suggestion.currentPriority,
        expectedRiskSeverity: suggestion.riskSeverity,
        expectedRiskScore: suggestion.riskScore,
        ...(mode === "BUSINESS_OVERRIDE"
          ? { priority: businessPriority, rationale: businessRationale.trim() }
          : {}),
      });
      load();
      await prioritySuggestion.refetch();
      onChanged?.();
    } catch (cause) {
      setPriorityError(
        cause instanceof Error ? cause.message : "Could not update priority.",
      );
    } finally {
      setPriorityBusy(false);
    }
  }

  async function viewStepMedia(attachmentId: string) {
    setStepMediaError("");
    try {
      const { viewUrl } = await utils.testCaseAttachments.getViewUrl.fetch({
        attachmentId,
      });
      window.open(viewUrl, "_blank", "noopener,noreferrer");
    } catch (cause) {
      setStepMediaError(
        cause instanceof Error ? cause.message : "Could not open step media.",
      );
    }
  }

  if (!tc && tcQuery.error)
    return (
      <p role="alert" style={{ color: "var(--ember)" }}>
        {tcQuery.error.message}{" "}
        <button onClick={() => void tcQuery.refetch()}>Retry</button>
      </p>
    );
  if (!tc) return <p>Loading…</p>;

  return (
    <div className={`test-case-details-content ${styles.inspector}`}>
      {(error || tcQuery.error) && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          {error ?? tcQuery.error?.message}{" "}
          <button
            className="btn-secondary"
            onClick={() => {
              setError(null);
              void tcQuery.refetch();
            }}
          >
            Retry
          </button>
        </p>
      )}
      <div className={styles.header}>
        <div className={styles.titleBlock}>
          <h1
            className={styles.title}
            data-expanded={tc.title.length <= 110 || expandedTitleFor === tc.id}
          >
            {tc.title}
          </h1>
          {tc.title.length > 110 && (
            <button
              type="button"
              className={styles.titleToggle}
              aria-expanded={expandedTitleFor === tc.id}
              onClick={() =>
                setExpandedTitleFor(expandedTitleFor === tc.id ? null : tc.id)
              }
            >
              {expandedTitleFor === tc.id ? "Compact title" : "Show full title"}
            </button>
          )}
        </div>
        {!readOnly && (
          <a
            href={
              onEditHref ?? `/projects/${projectId}/test-cases/${tc.id}/edit`
            }
          >
            Edit case
          </a>
        )}
      </div>
      <div className={styles.identity}>
        <span>
          <strong>Suite:</strong>{" "}
          {tc.suitePath ? (
            <a
              href={`/projects/${projectId}/test-cases?suite=${encodeURIComponent(tc.suitePath)}`}
              onClick={(event) => {
                if (onSuiteSelect && tc.suitePath) {
                  event.preventDefault();
                  onSuiteSelect(tc.suitePath);
                }
              }}
            >
              {tc.suitePath}
            </a>
          ) : (
            "Unassigned"
          )}
        </span>
        <span>
          Case ID: <code>{tc.displayId}</code>
        </span>
      </div>
      <dl className={styles.metadata}>
        {(
          [
            ["Domain", tc.validationDomain],
            ["Type", tc.testType],
            ["Priority", tc.priority],
            ["Origin", tc.origin],
          ] as const
        ).map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{inspectorLabel(value)}</dd>
          </div>
        ))}
        <div>
          <dt>Risk</dt>
          <dd>
            {tc.riskScore == null
              ? "Not assessed"
              : `${inspectorLabel(tc.riskSeverity ?? "UNKNOWN")} · ${Math.round(tc.riskScore)}/100`}
          </dd>
        </div>
        <div>
          <dt>Review</dt>
          <dd>{inspectorLabel(tc.reviewStatus)}</dd>
        </div>
      </dl>
      {(tc.reviewStatus === "PENDING_REVIEW" || savedAutomation.data) && (
        <div className={styles.row} style={{ marginBottom: 10 }}>
          {tc.reviewStatus === "PENDING_REVIEW" && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSection("History")}
            >
              Review case
            </button>
          )}
          {savedAutomation.data && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setSection("Intelligence")}
            >
              {savedAutomation.data.status === "GENERATING"
                ? "Automation draft generating"
                : "Open saved automation draft"}
            </button>
          )}
        </div>
      )}
      <div
        role="tablist"
        aria-label="Test case sections"
        className={styles.tabs}
      >
        {INSPECTOR_SECTIONS.map((name) => (
          <button
            key={name}
            type="button"
            role="tab"
            id={`${sectionId}-tab-${name}`}
            aria-controls={`${sectionId}-panel-${name}`}
            aria-selected={section === name}
            tabIndex={section === name ? 0 : -1}
            onClick={() => setSection(name)}
            onKeyDown={(event) => {
              const next = inspectorSectionForKey(name, event.key);
              if (!next) return;
              event.preventDefault();
              setSection(next);
              document.getElementById(`${sectionId}-tab-${next}`)?.focus();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {/* Panels stay mounted: tab changes must not discard paid outputs or local drafts. */}
      <section
        className={styles.section}
        role="tabpanel"
        id={`${sectionId}-panel-Procedure`}
        aria-labelledby={`${sectionId}-tab-Procedure`}
        hidden={section !== "Procedure"}
      >
        {(tc.given.length > 0 || tc.when.length > 0 || tc.then.length > 0) && (
          <section className="case-step-table" aria-label="Scenario steps">
            <h3>Steps · Given / When / Then</h3>
            <table>
              <thead>
                <tr>
                  <th style={cellStyle}>#</th>
                  <th style={cellStyle}>Phase</th>
                  <th style={cellStyle}>Condition or action</th>
                  <th style={cellStyle}>Expected outcome</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ...tc.given.map((text) => ({ phase: "Given", text })),
                  ...tc.when.map((text) => ({ phase: "When", text })),
                  ...tc.then.map((text) => ({ phase: "Then", text })),
                ].map((step, index) => (
                  <tr key={index}>
                    <td style={cellStyle}>{index + 1}</td>
                    <td style={cellStyle}>{step.phase}</td>
                    <td style={cellStyle}>
                      {step.phase !== "Then" ? step.text : "—"}
                    </td>
                    <td style={cellStyle}>
                      {step.phase === "Then" ? step.text : "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {tc.steps.length === 0 &&
              [tc.given, tc.when, tc.then].some((phase) => phase.length === 0) && (
                <p role="status" className="text-muted">
                  {[
                    ...(tc.given.length === 0 ? ["Given"] : []),
                    ...(tc.when.length === 0 ? ["When"] : []),
                    ...(tc.then.length === 0 ? ["Then"] : []),
                  ].join(" / ")} not recorded. Prerequisites do not replace scenario
                  steps. Review the original source or{" "}
                  <button type="button" className="btn-secondary" onClick={() => setSection("History")}>
                    View case history
                  </button>
                  {!readOnly && <> before using Edit case to complete the procedure.</>}
                </p>
              )}
          </section>
        )}

        {tc.steps.length > 0 && (
          <section className="case-step-table">
            <h3>Steps</h3>
            <table style={{ borderCollapse: "collapse", width: "100%" }}>
              <thead>
                <tr>
                  <th style={cellStyle}>#</th>
                  <th style={cellStyle}>{tc.stepFieldLabels.action}</th>
                  <th style={cellStyle}>
                    {tc.stepFieldLabels.expectedActionOrData}
                  </th>
                  <th style={cellStyle}>{tc.stepFieldLabels.expectedResult}</th>
                  <th style={cellStyle}>
                    {tc.stepFieldLabels.expectedResponse}
                  </th>
                </tr>
              </thead>
              <tbody>
                {tc.steps.map((s) => (
                  <tr key={s.order}>
                    <td style={cellStyle}>{s.order + 1}</td>
                    <td style={cellStyle}>
                      <div>{s.action}</div>
                      {s.mediaAttachmentIds.length > 0 && (
                        <ul
                          aria-label={`Media for step ${s.order + 1}`}
                          style={{ margin: "6px 0 0", paddingLeft: 18 }}
                        >
                          {s.mediaAttachmentIds.map((attachmentId) => {
                            const attachment = stepAttachments.data?.find(
                              (item) => item.id === attachmentId,
                            );
                            return (
                              <li key={attachmentId}>
                                {attachment ? (
                                  <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={() =>
                                      void viewStepMedia(attachmentId)
                                    }
                                  >
                                    {attachment.contentType.startsWith("video/")
                                      ? "Video"
                                      : "Image"}
                                    : {attachment.fileName}
                                  </button>
                                ) : (
                                  <span>
                                    {stepAttachments.isLoading
                                      ? "Loading media…"
                                      : `Media unavailable (${attachmentId.slice(0, 8)})`}
                                  </span>
                                )}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </td>
                    <td style={cellStyle}>{s.expectedActionOrData ?? "—"}</td>
                    <td style={cellStyle}>{s.expectedResult ?? "—"}</td>
                    <td style={cellStyle}>{s.expectedResponse ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {stepMediaError && <p role="alert">{stepMediaError}</p>}
          </section>
        )}

        {tc.given.length === 0 &&
          tc.when.length === 0 &&
          tc.then.length === 0 &&
          tc.steps.length === 0 && (
            <p className="text-muted">
              No content yet — this case was quick-added with just a title.{" "}
              {!readOnly && (
                <a
                  href={
                    onEditHref ??
                    `/projects/${projectId}/test-cases/${tc.id}/edit`
                  }
                >
                  Fill it in
                </a>
              )}
              .
            </p>
          )}

        {tc.background && (
          <details>
            <summary>Background / setup context</summary>
            <p style={{ whiteSpace: "pre-wrap" }}>{tc.background}</p>
          </details>
        )}
        <TestCasePrerequisites
          projectId={projectId}
          caseId={tc.id}
          canEdit={!readOnly}
        />
        <DatasetSection testCaseId={tc.id} readOnly={readOnly} />
        {Object.values(tc.verificationProfile).some(Boolean) && (
          <section className="panel">
            <h3>Physical verification procedure</h3>
            {(
              [
                ["setup", "Fixture and setup"],
                ["safety", "Safety and stop conditions"],
                ["instruments", "Instruments and calibration"],
                ["acceptanceCriteria", "Measurement acceptance criteria"],
              ] as const
            ).map(
              ([key, label]) =>
                tc.verificationProfile[key] && (
                  <div key={key}>
                    <strong>{label}</strong>
                    <p style={{ whiteSpace: "pre-wrap" }}>
                      {tc.verificationProfile[key]}
                    </p>
                  </div>
                ),
            )}
          </section>
        )}
        {tc.tags.length > 0 && (
          <ul className={styles.tags} aria-label="Case tags">
            {tc.tags.map((tag) => (
              <li key={tag}>{tag}</li>
            ))}
          </ul>
        )}
      </section>
      <section
        className={styles.section}
        role="tabpanel"
        id={`${sectionId}-panel-Intelligence`}
        aria-labelledby={`${sectionId}-tab-Intelligence`}
        hidden={section !== "Intelligence"}
      >
        <div className="risk-assessment-panel">
          <strong>Risk assessment</strong>
          {riskReviews.data && riskReviews.data.length > 0 && (
            <details style={{ marginTop: 12 }}>
              <summary>
                Saved AI risk suggestions ({riskReviews.data.length})
              </summary>
              <p style={{ color: "var(--muted)" }}>
                Previous paid suggestions remain available, including when a
                case was edited before one could be applied. Viewing them does
                not replace the current assessment or use credits.
              </p>
              {riskReviews.data.map((review) => {
                return (
                  <article
                    key={review.id}
                    style={{
                      borderTop: "1px solid var(--line)",
                      paddingBlock: 10,
                    }}
                  >
                    <strong>
                      {new Date(review.createdAt).toLocaleString()} ·{" "}
                      {review.status === "READY"
                        ? "Saved suggestion"
                        : review.status === "GENERATING"
                          ? "Generating"
                          : "Needs reconciliation"}
                    </strong>
                    {review.status === "READY" && (
                      <p style={{ whiteSpace: "pre-wrap" }}>
                        {review.severity ?? "Risk suggestion"}
                        {review.riskScore != null
                          ? ` · ${Math.round(review.riskScore)}/100`
                          : ""}
                        {review.rationale ? `\n${review.rationale}` : ""}
                      </p>
                    )}
                    {review.status === "GENERATING" && (
                      <p>
                        The approved review is still running. Starting an
                        identical paid request is blocked.
                      </p>
                    )}
                    {review.status !== "READY" &&
                      review.status !== "GENERATING" && (
                        <p>
                          No completed suggestion is available. An administrator
                          may need to reconcile this request before it can be
                          retried.
                        </p>
                      )}
                  </article>
                );
              })}
            </details>
          )}
          {tc.riskScore != null ? (
            <>
              <RiskMeter
                score={tc.riskScore}
                severity={tc.riskSeverity ?? "UNKNOWN"}
              >
                {tc.riskRationale && (
                  <p className="risk-rationale">{tc.riskRationale}</p>
                )}
                {tc.riskAssessedAt && (
                  <p className="risk-assessed-at">
                    Assessed {new Date(tc.riskAssessedAt).toLocaleDateString()}
                  </p>
                )}
              </RiskMeter>
            </>
          ) : (
            <span style={{ color: "var(--muted-dim)" }}>Not yet assessed</span>
          )}
          {!readOnly && (
            <div style={{ marginTop: 8 }}>
              <button
                onClick={() => setRiskDialogOpen(true)}
                disabled={assessingRisk}
              >
                {assessingRisk
                  ? "Assessing…"
                  : tc.riskScore != null
                    ? "Review risk assessment"
                    : "Assess risk"}
              </button>
            </div>
          )}
        </div>

        <section
          className="risk-assessment-panel"
          aria-label="Priority and business need"
        >
          <strong>Priority and business need</strong>
          {prioritySuggestion.data?.suggestedPriority ? (
            <>
              <p>
                Current: {prioritySuggestion.data.currentPriority.toLowerCase()}
                . Risk suggests{" "}
                {prioritySuggestion.data.suggestedPriority.toLowerCase()}.
                Priority is scheduling intent; a high business need can justify
                a different choice.
              </p>
              {prioritySuggestion.data.latestDecision?.mode ===
                "BUSINESS_OVERRIDE" && (
                <p>
                  Business override:{" "}
                  {prioritySuggestion.data.latestDecision.rationale}
                </p>
              )}
              {prioritySuggestion.data.latestDecision?.mode === "MANUAL" && (
                <p>A person last set this priority in the case editor.</p>
              )}
              {!readOnly && prioritySuggestion.data.canEdit && (
                <details>
                  <summary>Change priority</summary>
                  <div style={{ display: "grid", gap: 8, marginTop: 8 }}>
                    <button
                      className="btn-secondary"
                      disabled={
                        priorityBusy ||
                        prioritySuggestion.data.currentPriority ===
                          prioritySuggestion.data.suggestedPriority
                      }
                      onClick={() => void decidePriority("MATCH_RISK")}
                    >
                      Use risk suggestion (
                      {prioritySuggestion.data.suggestedPriority.toLowerCase()})
                    </button>
                    <label>
                      Business-critical priority
                      <select
                        value={businessPriority}
                        disabled={priorityBusy}
                        onChange={(event) =>
                          setBusinessPriority(
                            event.target.value as "HIGH" | "CRITICAL",
                          )
                        }
                        style={{ display: "block", width: "100%" }}
                      >
                        <option value="HIGH">High</option>
                        <option value="CRITICAL">Critical</option>
                      </select>
                    </label>
                    <label>
                      Why does the business need this priority?
                      <textarea
                        value={businessRationale}
                        disabled={priorityBusy}
                        maxLength={500}
                        rows={2}
                        onChange={(event) =>
                          setBusinessRationale(event.target.value)
                        }
                        style={{ display: "block", width: "100%" }}
                      />
                    </label>
                    <button
                      className="btn-secondary"
                      disabled={
                        priorityBusy || businessRationale.trim().length < 10
                      }
                      onClick={() => void decidePriority("BUSINESS_OVERRIDE")}
                    >
                      Save business override
                    </button>
                  </div>
                </details>
              )}
              {priorityError && <p role="alert">{priorityError}</p>}
            </>
          ) : (
            <p>
              {prioritySuggestion.data?.riskNeedsReview
                ? "The saved risk review no longer matches this case. Reassess risk before using it to change priority; the current priority stays unchanged."
                : "Assess this case’s risk to get a priority suggestion. Existing authored or imported priority stays unchanged."}
            </p>
          )}
        </section>

        <AutomationDraftSection
          key={tc.id}
          testCaseId={tc.id}
          sourceFramework={tc.source?.frameworkFamily ?? undefined}
          readOnly={readOnly}
        />
      </section>

      <Modal
        open={riskDialogOpen}
        title="Review risk assessment cost"
        onClose={() => setRiskDialogOpen(false)}
        dismissible={!assessingRisk}
      >
        <p>
          Assess this case from its text and source-file path. No repository
          content is fetched. The result is saved with the case; an identical
          retry does not charge again.
        </p>
        {riskPreview.error && <p role="alert">{riskPreview.error.message}</p>}
        {riskPreview.data && (
          <>
            <p>
              Initial charge:{" "}
              {riskPreview.data.savedStatus === "READY"
                ? 0
                : riskPreview.data.cost}{" "}
              AI credits. Current balance: {riskPreview.data.balance}. Final
              cost may differ after metering.
            </p>
            {riskPreview.data.savedStatus === "READY" && (
              <p role="status">
                A saved review for this unchanged case is available. Confirming
                returns that review without another charge or overwriting manual
                edits.
              </p>
            )}
            {riskPreview.data.savedStatus === "GENERATING" ||
            riskPreview.data.savedStatus === "NEEDS_RECONCILIATION" ? (
              <p role="status">
                This input already has a pending or interrupted review. No new
                charge is allowed until it is reconciled.
              </p>
            ) : (
              <>
                {!riskPreview.data.canSpend && (
                  <p role="alert">
                    Ask your workspace administrator for a full editor seat to
                    use AI credits.
                  </p>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={riskApproved}
                    onChange={(event) => setRiskApproved(event.target.checked)}
                  />{" "}
                  I approve processing this case with the AI provider and the
                  credit charge.
                </label>
                <button
                  disabled={
                    !riskApproved ||
                    !riskPreview.data.canSpend ||
                    riskPreview.data.balance <
                      (riskPreview.data.savedStatus === "READY"
                        ? 0
                        : riskPreview.data.cost) ||
                    assessingRisk
                  }
                  onClick={() => void assessRisk()}
                >
                  {assessingRisk ? "Assessing…" : "Confirm assessment"}
                </button>
              </>
            )}
          </>
        )}
      </Modal>

      <section
        className={styles.section}
        role="tabpanel"
        id={`${sectionId}-panel-Evidence`}
        aria-labelledby={`${sectionId}-tab-Evidence`}
        hidden={section !== "Evidence"}
      >
        <CaseTraceabilityPanel key={tc.id} projectId={projectId} caseId={tc.id} canEdit={!readOnly} />
        {tc.source && (
          <p>
            <strong>Source:</strong> {tc.source.filePath}
            {tc.source.functionName && ` :: ${tc.source.functionName}`} (
            {tc.source.framework})
          </p>
        )}

        <a href={`/projects/${projectId}/populate/documents`}>
          Review project document evidence
        </a>
        <ComplianceControlsSection
          testCaseId={tc.id}
          projectId={projectId}
          readOnly={readOnly}
        />
        <AttachmentsSection testCaseId={tc.id} readOnly={readOnly} />
      </section>
      <section
        className={styles.section}
        role="tabpanel"
        id={`${sectionId}-panel-History`}
        aria-labelledby={`${sectionId}-tab-History`}
        hidden={section !== "History"}
      >
        <TestCaseExecutionHistory
          key={tc.id}
          projectId={projectId}
          testCaseId={tc.id}
          active={section === "History"}
        />
        <TestCaseVersionHistorySection testCaseId={tc.id} />

        {tc.origin === "AI_REVERSE_ENGINEERED" && (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 8,
              padding: 12,
              marginBottom: 16,
              background:
                tc.reviewStatus === "PENDING_REVIEW"
                  ? "var(--ember-dim)"
                  : tc.reviewStatus === "REJECTED"
                    ? "var(--ember-dim)"
                    : "var(--frost-dim)",
            }}
          >
            <strong>Review status:</strong> {inspectorLabel(tc.reviewStatus)}
            {tc.reviewedByName && (
              <span style={{ color: "var(--muted)" }}>
                {" "}
                — {tc.reviewStatus === "REJECTED"
                  ? "rejected"
                  : "reviewed"} by {tc.reviewedByName}
                {tc.reviewedAt &&
                  ` on ${new Date(tc.reviewedAt).toLocaleDateString()}`}
              </span>
            )}
            {tc.reviewNote && (
              <p style={{ fontStyle: "italic", margin: "6px 0" }}>
                &ldquo;{tc.reviewNote}&rdquo;
              </p>
            )}
            {!readOnly && tc.reviewStatus === "PENDING_REVIEW" && (
              <div style={{ marginTop: 8 }}>
                <input
                  value={reviewNote}
                  onChange={(e) => setReviewNote(e.target.value)}
                  placeholder="Optional note"
                  style={{ width: "50%", marginRight: 8 }}
                />
                <button
                  onClick={() => review("approve")}
                  disabled={reviewing}
                  style={{ marginRight: 8 }}
                >
                  Approve
                </button>
                <button onClick={() => review("reject")} disabled={reviewing}>
                  Reject
                </button>
              </div>
            )}
            {tc.aiSnapshot &&
              (() => {
                const snap = tc.aiSnapshot;
                const changed =
                  snap.title !== tc.title ||
                  (snap.background ?? "") !== (tc.background ?? "") ||
                  !arraysEqual(snap.given, tc.given) ||
                  !arraysEqual(snap.when, tc.when) ||
                  !arraysEqual(snap.then, tc.then) ||
                  !arraysEqual(snap.tags, tc.tags);
                if (!changed) {
                  return (
                    <p
                      className="text-muted"
                      style={{ fontSize: 12, marginTop: 8 }}
                    >
                      Matches what the AI originally generated — no human edits
                      since.
                    </p>
                  );
                }
                return (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="btn-secondary"
                      style={{ fontSize: 12 }}
                      onClick={() => setShowDiff((v) => !v)}
                    >
                      {showDiff ? "Hide" : "Show"} changes since AI generated
                      this
                    </button>
                    {showDiff && (
                      <div
                        style={{
                          marginTop: 10,
                          borderTop: "1px solid var(--line)",
                          paddingTop: 10,
                        }}
                      >
                        <p
                          className="text-muted"
                          style={{ fontSize: 11, margin: "0 0 8px" }}
                        >
                          <span style={{ color: "var(--ember)" }}>
                            AI original
                          </span>{" "}
                          vs{" "}
                          <span style={{ color: "var(--frost)" }}>current</span>
                        </p>
                        {snap.title !== tc.title && (
                          <DiffField
                            label="Title"
                            before={snap.title}
                            after={tc.title}
                          />
                        )}
                        {(snap.background ?? "") !== (tc.background ?? "") && (
                          <DiffField
                            label="Background"
                            before={snap.background ?? ""}
                            after={tc.background ?? ""}
                          />
                        )}
                        {!arraysEqual(snap.given, tc.given) && (
                          <DiffField
                            label="Given"
                            before={snap.given.join(" / ")}
                            after={tc.given.join(" / ")}
                          />
                        )}
                        {!arraysEqual(snap.when, tc.when) && (
                          <DiffField
                            label="When"
                            before={snap.when.join(" / ")}
                            after={tc.when.join(" / ")}
                          />
                        )}
                        {!arraysEqual(snap.then, tc.then) && (
                          <DiffField
                            label="Then"
                            before={snap.then.join(" / ")}
                            after={tc.then.join(" / ")}
                          />
                        )}
                        {!arraysEqual(snap.tags, tc.tags) && (
                          <DiffField
                            label="Tags"
                            before={snap.tags.join(", ")}
                            after={tc.tags.join(", ")}
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
          </div>
        )}
      </section>
    </div>
  );
}
