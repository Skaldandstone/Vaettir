"use client";

import { useState } from "react";
import type { CSSProperties, ChangeEvent } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";

const cellStyle: CSSProperties = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" };

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// A field-by-field comparison, not a line-level text diff -- the point is
// "did the human change this since the AI wrote it", not a patch-style
// rendering. Only fields that actually differ are worth showing; a case a
// reviewer approved verbatim has nothing here to look at.
function DiffField({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="eyebrow" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ color: "var(--ember)", textDecoration: "line-through", opacity: 0.75, fontSize: 13 }}>{before || "(empty)"}</div>
      <div style={{ color: "var(--frost)", fontSize: 13 }}>{after || "(empty)"}</div>
    </div>
  );
}

type AutomationFramework =
  | "MAESTRO" | "PLAYWRIGHT" | "CYPRESS" | "JEST_VITEST" | "MOCHA_CHAI"
  | "XCUITEST" | "XCTEST" | "SWIFT_TESTING"
  | "ESPRESSO" | "COMPOSE_UI" | "UI_AUTOMATOR" | "ROBOLECTRIC"
  | "APPIUM_WEBDRIVERIO" | "DETOX" | "FLUTTER_INTEGRATION_TEST"
  | "PYTEST" | "JUNIT5" | "TESTNG" | "NUNIT" | "XUNIT_DOTNET" | "MSTEST"
  | "POSTMAN" | "PACT" | "REST_ASSURED"
  | "UNITY_TEST_FRAMEWORK" | "UNREAL_AUTOMATION" | "GODOT_GDUNIT4";

const AUTOMATION_FRAMEWORKS: Array<{ value: AutomationFramework; label: string }> = [
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

function AutomationDraftSection({ testCaseId }: { testCaseId: string }) {
  const [framework, setFramework] = useState<AutomationFramework>("MAESTRO");
  const [projectContext, setProjectContext] = useState("");
  const [draft, setDraft] = useState<RouterOutputs["testCases"]["generateAutomationDraft"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generateMutation = trpcReact.testCases.generateAutomationDraft.useMutation();

  async function generate() {
    setError(null);
    setCopied(false);
    try {
      const nextDraft = await generateMutation.mutateAsync({
        id: testCaseId,
        framework,
        projectContext: projectContext.trim() || undefined,
      });
      setDraft(nextDraft);
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
      setError("The browser could not copy the draft. Select the source and copy it manually.");
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
    <section style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <strong>Automation draft</strong>
      <p className="text-muted" style={{ fontSize: 13, margin: "5px 0 12px" }}>
        Turn this reviewed case into framework-specific source. Vaettir returns a draft for human review and never
        writes to your repository or claims that the source was executed.
      </p>
      <div style={{ display: "grid", gap: 10 }}>
        <label>
          <span className="eyebrow" style={{ display: "block", marginBottom: 4 }}>Framework</span>
          <select
            value={framework}
            onChange={(event) => setFramework(event.target.value as AutomationFramework)}
            style={{ width: "100%" }}
          >
            {AUTOMATION_FRAMEWORKS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span className="eyebrow" style={{ display: "block", marginBottom: 4 }}>Project context (optional)</span>
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
          <button onClick={generate} disabled={generateMutation.isPending}>
            {generateMutation.isPending ? "Generating…" : "Generate review draft"}
          </button>
          <span className="text-muted" style={{ fontSize: 12, marginLeft: 8 }}>Uses 10 AI credits</span>
        </div>
      </div>

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {draft && (
        <div style={{ borderTop: "1px solid var(--line)", marginTop: 14, paddingTop: 14 }}>
          <p style={{ fontSize: 13 }}><strong>Stable ID:</strong> <code>{draft.automationId}</code></p>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
            <strong>{draft.fileName}</strong>
            <div style={{ display: "flex", gap: 6 }}>
              <button className="btn-secondary" onClick={copyDraft}>{copied ? "Copied" : "Copy"}</button>
              <button className="btn-secondary" onClick={downloadDraft}>Download</button>
            </div>
          </div>
          <pre style={{ overflowX: "auto", background: "var(--panel-2)", border: "1px solid var(--line)", borderRadius: 6, padding: 12, whiteSpace: "pre", fontSize: 12 }}>
            <code>{draft.code}</code>
          </pre>
          <p style={{ fontSize: 13 }}>{draft.explanation}</p>
          {draft.assumptions.length > 0 && (
            <div>
              <strong style={{ fontSize: 13 }}>Assumptions and TODOs</strong>
              <ul style={{ marginTop: 4 }}>
                {draft.assumptions.map((assumption, index) => <li key={index}>{assumption}</li>)}
              </ul>
            </div>
          )}
          {draft.requiredDependencies.length > 0 && (
            <p style={{ fontSize: 13 }}><strong>Dependencies:</strong> {draft.requiredDependencies.join(", ")}</p>
          )}
          {draft.validationCommands.length > 0 && (
            <div>
              <strong style={{ fontSize: 13 }}>Suggested local validation</strong>
              <ul style={{ marginTop: 4 }}>
                {draft.validationCommands.map((command, index) => <li key={index}><code>{command}</code></li>)}
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
  const mappedQuery = trpcReact.compliance.testCaseControls.useQuery({ testCaseId });
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
  const unmappedCandidates = candidates.filter((c) => !mapped.some((m) => m.id === c.id));

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <strong>Compliance controls:</strong>
      {mapped.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>Not mapped to any control.</p>}
      {mapped.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0" }}>
          {mapped.map((c) => (
            <li key={c.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
              <span>
                {c.frameworkName}: <strong>{c.code}</strong> {c.title}
              </span>
              {!readOnly && (
                <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => removeMapping(c.id)} disabled={busy}>
                  Unmap
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && frameworks.length > 0 && (
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <select value={frameworkId} onChange={(e) => setFrameworkId(e.target.value)} style={{ fontSize: 12 }}>
            {frameworks.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
          <select value={controlId} onChange={(e) => setControlId(e.target.value)} style={{ fontSize: 12, flex: 1 }}>
            <option value="">Map to a control…</option>
            {unmappedCandidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.code} — {c.title}
              </option>
            ))}
          </select>
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={addMapping} disabled={busy || !controlId}>
            Map
          </button>
        </div>
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
function DatasetSection({ testCaseId, readOnly }: { testCaseId: string; readOnly?: boolean }) {
  const utils = trpcReact.useUtils();
  const datasetQuery = trpcReact.testCaseDatasets.get.useQuery({ testCaseId });
  const previewQuery = trpcReact.testCaseDatasets.expandedPreview.useQuery({ testCaseId });
  const preview = previewQuery.data ?? [];
  const saveMutation = trpcReact.testCaseDatasets.save.useMutation();
  const deleteMutation = trpcReact.testCaseDatasets.delete.useMutation();
  const savedParameterNames = datasetQuery.data?.parameterNames ?? [];
  const savedRows = datasetQuery.data?.rows ?? [];
  const [draft, setDraft] = useState<{ parameterNames: string[]; rows: DatasetRow[] } | null>(null);
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
      const base = d ?? { parameterNames: savedParameterNames, rows: savedRows };
      return { ...base, parameterNames: update(base.parameterNames) };
    });
  }
  function setRows(update: (prev: DatasetRow[]) => DatasetRow[]) {
    setDraft((d) => {
      const base = d ?? { parameterNames: savedParameterNames, rows: savedRows };
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
    setRows((rs) => rs.map((r) => ({ ...r, values: { ...r.values, [name.trim()]: "" } })));
  }

  function addRow() {
    setRows((rs) => [...rs, { name: `Row ${rs.length + 1}`, values: Object.fromEntries(parameterNames.map((p) => [p, ""])) }]);
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
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <strong>Data set</strong>
        {!readOnly && !editing && (
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setEditing(true)}>
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
            <button className="btn-secondary" style={{ fontSize: 11, marginTop: 6 }} onClick={removeDataset}>
              Remove data set
            </button>
          )}
        </div>
      )}
      {!editing && preview.length === 0 && (
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>
          No data set. Use <code>&lt;paramName&gt;</code> in given/when/then steps, then add parameters and rows here.
        </p>
      )}

      {editing && (
        <div style={{ marginTop: 8 }}>
          <div style={{ marginBottom: 6 }}>
            {parameterNames.map((p) => (
              <span key={p} className="text-muted" style={{ fontSize: 12, marginRight: 8 }}>
                &lt;{p}&gt;
              </span>
            ))}
            <button className="btn-secondary" style={{ fontSize: 11 }} onClick={addParameter}>
              + Parameter
            </button>
          </div>
          {rows.map((row, i) => (
            <div key={i} style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 8, marginBottom: 6 }}>
              <input
                value={row.name}
                onChange={(e) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, name: e.target.value } : r)))}
                style={{ fontWeight: 600, marginBottom: 4 }}
              />
              <button
                style={{ float: "right", fontSize: 11 }}
                onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
              >
                Remove row
              </button>
              {parameterNames.map((p) => (
                <div key={p} style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 4 }}>
                  <span style={{ fontSize: 12, width: 100 }}>{p}</span>
                  <input
                    value={row.values[p] ?? ""}
                    onChange={(e) =>
                      setRows((rs) => rs.map((r, j) => (j === i ? { ...r, values: { ...r.values, [p]: e.target.value } } : r)))
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
            <button className="btn-primary" onClick={save} disabled={saving || parameterNames.length === 0 || rows.length === 0}>
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
// bytes directly to S3 (never through this API server), then refresh -
// the row is already recorded by the time requestUpload returns.
function AttachmentsSection({ testCaseId, readOnly }: { testCaseId: string; readOnly?: boolean }) {
  const utils = trpcReact.useUtils();
  const attachmentsQuery = trpcReact.testCaseAttachments.list.useQuery({ testCaseId });
  const attachments = attachmentsQuery.data ?? [];
  const requestUploadMutation = trpcReact.testCaseAttachments.requestUpload.useMutation();
  const deleteMutation = trpcReact.testCaseAttachments.delete.useMutation();
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
      const { uploadUrl } = await requestUploadMutation.mutateAsync({
        testCaseId,
        fileName: file.name,
        contentType: file.type || "application/octet-stream",
        sizeBytes: file.size,
      });
      const res = await fetch(uploadUrl, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  async function view(id: string) {
    const { viewUrl } = await utils.testCaseAttachments.getViewUrl.fetch({ attachmentId: id });
    window.open(viewUrl, "_blank");
  }

  async function remove(id: string) {
    await deleteMutation.mutateAsync({ attachmentId: id });
    load();
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <strong>Attachments</strong>
      {error && <p style={{ color: "var(--ember)", fontSize: 12 }}>{error}</p>}
      <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
        {attachments.map((a) => (
          <li key={a.id} style={{ display: "flex", justifyContent: "space-between", fontSize: 13, padding: "3px 0" }}>
            <button onClick={() => view(a.id)} style={{ background: "none", border: "none", color: "var(--frost)", cursor: "pointer", padding: 0 }}>
              {a.fileName}
            </button>
            <span>
              <span className="text-muted" style={{ marginRight: 8 }}>
                {(a.sizeBytes / 1024).toFixed(0)} KB
              </span>
              {!readOnly && (
                <button className="btn-secondary" style={{ fontSize: 11 }} onClick={() => remove(a.id)}>
                  Remove
                </button>
              )}
            </span>
          </li>
        ))}
        {attachments.length === 0 && <p className="text-muted" style={{ fontSize: 13, margin: "4px 0" }}>No attachments.</p>}
      </ul>
      {!readOnly && (
        <div style={{ marginTop: 8 }}>
          <input type="file" onChange={handleFile} disabled={uploading} />
          {uploading && <span style={{ fontSize: 12 }}> Uploading…</span>}
        </div>
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

  function changesFrom(version: RouterOutputs["testCases"]["history"][number], index: number): string[] {
    const prev = versions[index + 1];
    if (!prev) return ["Initial version"];
    const changes: string[] = [];
    if (version.title !== prev.title) changes.push(`title: "${prev.title}" → "${version.title}"`);
    if (JSON.stringify(version.given) !== JSON.stringify(prev.given)) changes.push("given changed");
    if (JSON.stringify(version.when) !== JSON.stringify(prev.when)) changes.push("when changed");
    if (JSON.stringify(version.then) !== JSON.stringify(prev.then)) changes.push("then changed");
    if (JSON.stringify(version.steps) !== JSON.stringify(prev.steps)) changes.push("structured steps changed");
    if (version.priority !== prev.priority) changes.push(`priority: ${prev.priority} → ${version.priority}`);
    if (version.testType !== prev.testType) changes.push(`type: ${prev.testType} → ${version.testType}`);
    if (JSON.stringify(version.tags) !== JSON.stringify(prev.tags)) changes.push("tags changed");
    return changes.length > 0 ? changes : ["No changes"];
  }

  return (
    <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
      <strong>History</strong>
      {loading && <p>Loading…</p>}
      {!loading && (
        <ul style={{ listStyle: "none", padding: 0, margin: "6px 0 0" }}>
          {versions.map((v, i) => (
            <li key={v.versionNumber} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
                <strong style={{ fontSize: 13 }}>v{v.versionNumber}</strong>
                <span className="text-muted" style={{ fontSize: 12 }}>
                  {new Date(v.createdAt).toLocaleString()}
                  {v.createdBy && ` by ${v.createdBy.name ?? v.createdBy.email}`}
                </span>
              </div>
              <ul style={{ margin: "4px 0 0 16px", fontSize: 12, color: "var(--muted)" }}>
                {changesFrom(v, i).map((c, j) => (
                  <li key={j}>{c}</li>
                ))}
              </ul>
            </li>
          ))}
          {versions.length === 0 && <p className="text-muted">No history yet.</p>}
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
export function TestCaseDetailContent({
  id,
  projectId,
  onEditHref,
  onChanged,
  readOnly,
}: {
  id: string;
  projectId: string;
  onEditHref?: string;
  onChanged?: () => void;
  readOnly?: boolean;
}) {
  const utils = trpcReact.useUtils();
  const tcQuery = trpcReact.testCases.byId.useQuery({ id });
  const tc = tcQuery.data ?? null;
  const approveMutation = trpcReact.testCases.approve.useMutation();
  const rejectMutation = trpcReact.testCases.reject.useMutation();
  const assessRiskMutation = trpcReact.testCases.assessRisk.useMutation();
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
      await (decision === "approve" ? approveMutation : rejectMutation).mutateAsync({ id, note: reviewNote || undefined });
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
    setAssessingRisk(true);
    setError(null);
    try {
      await assessRiskMutation.mutateAsync({ id });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssessingRisk(false);
    }
  }

  if (error ?? tcQuery.error) return <p style={{ color: "var(--ember)" }}>{error ?? String(tcQuery.error)}</p>;
  if (!tc) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>{tc.title}</h1>
        {!readOnly && <a href={onEditHref ?? `/projects/${projectId}/test-cases/${tc.id}/edit`}>Edit</a>}
      </div>
      <p>
        <strong>Type:</strong> {tc.testType} &nbsp; <strong>Priority:</strong> {tc.priority} &nbsp;
        <strong>Origin:</strong> {tc.origin}
        {tc.confidence != null && ` (confidence ${(tc.confidence * 100).toFixed(0)}%)`}
      </p>

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <strong>Risk assessment:</strong>{" "}
        {tc.riskScore != null ? (
          <>
            {tc.riskScore}/100 ({tc.riskSeverity})
            {tc.riskRationale && <p style={{ color: "var(--muted)", margin: "6px 0 0" }}>{tc.riskRationale}</p>}
            {tc.riskAssessedAt && (
              <p style={{ color: "var(--muted-dim)", fontSize: 12, margin: "4px 0 0" }}>
                Assessed {new Date(tc.riskAssessedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <span style={{ color: "var(--muted-dim)" }}>Not yet assessed</span>
        )}
        {!readOnly && (
          <div style={{ marginTop: 8 }}>
            <button onClick={assessRisk} disabled={assessingRisk}>
              {assessingRisk ? "Assessing…" : tc.riskScore != null ? "Re-assess risk" : "Assess risk"}
            </button>
          </div>
        )}
      </div>

      {tc.suitePath && (
        <p>
          <strong>Suite:</strong> {tc.suitePath}
        </p>
      )}

      {tc.source && (
        <p>
          <strong>Source:</strong> {tc.source.filePath}
          {tc.source.functionName && ` :: ${tc.source.functionName}`} ({tc.source.framework})
        </p>
      )}

      {!readOnly && <AutomationDraftSection testCaseId={tc.id} />}
      <ComplianceControlsSection testCaseId={tc.id} projectId={projectId} readOnly={readOnly} />
      <AttachmentsSection testCaseId={tc.id} readOnly={readOnly} />
      <DatasetSection testCaseId={tc.id} readOnly={readOnly} />
      <TestCaseVersionHistorySection testCaseId={tc.id} />

      {tc.origin === "AI_REVERSE_ENGINEERED" && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            background: tc.reviewStatus === "PENDING_REVIEW" ? "var(--ember-dim)" : tc.reviewStatus === "REJECTED" ? "var(--ember-dim)" : "var(--frost-dim)",
          }}
        >
          <strong>Review status:</strong> {tc.reviewStatus}
          {tc.reviewedByName && (
            <span style={{ color: "var(--muted)" }}>
              {" "}
              — {tc.reviewStatus === "REJECTED" ? "rejected" : "reviewed"} by {tc.reviewedByName}
              {tc.reviewedAt && ` on ${new Date(tc.reviewedAt).toLocaleDateString()}`}
            </span>
          )}
          {tc.reviewNote && <p style={{ fontStyle: "italic", margin: "6px 0" }}>&ldquo;{tc.reviewNote}&rdquo;</p>}

          {!readOnly && tc.reviewStatus === "PENDING_REVIEW" && (
            <div style={{ marginTop: 8 }}>
              <input
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Optional note"
                style={{ width: "50%", marginRight: 8 }}
              />
              <button onClick={() => review("approve")} disabled={reviewing} style={{ marginRight: 8 }}>
                Approve
              </button>
              <button onClick={() => review("reject")} disabled={reviewing}>
                Reject
              </button>
            </div>
          )}

          {tc.aiSnapshot && (() => {
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
                <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Matches what the AI originally generated — no human edits since.
                </p>
              );
            }
            return (
              <div style={{ marginTop: 10 }}>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? "Hide" : "Show"} changes since AI generated this
                </button>
                {showDiff && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    <p className="text-muted" style={{ fontSize: 11, margin: "0 0 8px" }}>
                      <span style={{ color: "var(--ember)" }}>AI original</span> vs{" "}
                      <span style={{ color: "var(--frost)" }}>current</span>
                    </p>
                    {snap.title !== tc.title && <DiffField label="Title" before={snap.title} after={tc.title} />}
                    {(snap.background ?? "") !== (tc.background ?? "") && (
                      <DiffField label="Background" before={snap.background ?? ""} after={tc.background ?? ""} />
                    )}
                    {!arraysEqual(snap.given, tc.given) && (
                      <DiffField label="Given" before={snap.given.join(" / ")} after={tc.given.join(" / ")} />
                    )}
                    {!arraysEqual(snap.when, tc.when) && (
                      <DiffField label="When" before={snap.when.join(" / ")} after={tc.when.join(" / ")} />
                    )}
                    {!arraysEqual(snap.then, tc.then) && (
                      <DiffField label="Then" before={snap.then.join(" / ")} after={tc.then.join(" / ")} />
                    )}
                    {!arraysEqual(snap.tags, tc.tags) && (
                      <DiffField label="Tags" before={snap.tags.join(", ")} after={tc.tags.join(", ")} />
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {tc.background && <p><strong>Background:</strong> {tc.background}</p>}

      {(tc.given.length > 0 || tc.when.length > 0 || tc.then.length > 0) && (
        <>
          <h3>Given</h3>
          <ul>{tc.given.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>When</h3>
          <ul>{tc.when.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>Then</h3>
          <ul>{tc.then.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {tc.steps.length > 0 && (
        <>
          <h3>Steps</h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cellStyle}>#</th>
                <th style={cellStyle}>{tc.stepFieldLabels.action}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedActionOrData}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedResult}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedResponse}</th>
              </tr>
            </thead>
            <tbody>
              {tc.steps.map((s) => (
                <tr key={s.order}>
                  <td style={cellStyle}>{s.order + 1}</td>
                  <td style={cellStyle}>{s.action}</td>
                  <td style={cellStyle}>{s.expectedActionOrData ?? "—"}</td>
                  <td style={cellStyle}>{s.expectedResult ?? "—"}</td>
                  <td style={cellStyle}>{s.expectedResponse ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tc.given.length === 0 && tc.when.length === 0 && tc.then.length === 0 && tc.steps.length === 0 && (
        <p className="text-muted">
          No content yet — this case was quick-added with just a title.{" "}
          <a href={onEditHref ?? `/projects/${projectId}/test-cases/${tc.id}/edit`}>Fill it in</a>.
        </p>
      )}

      {tc.tags.length > 0 && (
        <p>
          <strong>Tags:</strong> {tc.tags.join(", ")}
        </p>
      )}
    </div>
  );
}
