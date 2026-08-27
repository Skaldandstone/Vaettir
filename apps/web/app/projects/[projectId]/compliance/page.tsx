"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { Modal } from "@/components/Modal";
import { Drawer } from "@/components/Drawer";
import { downloadCsv } from "@/lib/csv";

// P3-02: minimal RFC 4180 CSV parser (quoted fields, embedded commas,
// escaped quotes as "") - the inverse of csvField/downloadCsv above.
// Expects a header row containing at least "code" and "title"; a
// "description" column is optional. Good enough for a control-set export
// from a spreadsheet, which is the realistic source for this data.
function parseControlsCsv(text: string): { code: string; title: string; description?: string }[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const nonEmpty = rows.filter((r) => r.some((f) => f.trim().length > 0));
  if (nonEmpty.length < 2) return [];
  const header = (nonEmpty[0] ?? []).map((h) => h.trim().toLowerCase());
  const codeIdx = header.indexOf("code");
  const titleIdx = header.indexOf("title");
  const descIdx = header.indexOf("description");
  if (codeIdx === -1 || titleIdx === -1) {
    throw new Error('CSV must have a header row with "code" and "title" columns');
  }
  return nonEmpty
    .slice(1)
    .filter((r) => (r[codeIdx] ?? "").trim() && (r[titleIdx] ?? "").trim())
    .map((r) => ({
      code: (r[codeIdx] ?? "").trim(),
      title: (r[titleIdx] ?? "").trim(),
      description: descIdx >= 0 && r[descIdx]?.trim() ? r[descIdx]?.trim() : undefined,
    }));
}

// P3-05/P3-07: evidence (a dated proof point) and sign-offs (a formal
// ComplianceAuditor attestation) for one control, in a side drawer so the
// control list stays visible. Both lists are append-only from this UI --
// no edit/delete action exists, matching the backend's immutability.
function ControlEvidenceDrawer({
  projectId,
  control,
}: {
  projectId: string;
  control: RouterOutputs["compliance"]["controlCoverage"][number];
}) {
  const [evidence, setEvidence] = useState<RouterOutputs["compliance"]["listEvidence"]>([]);
  const [signOffs, setSignOffs] = useState<RouterOutputs["compliance"]["listSignOffs"]>([]);
  const [mappedCases, setMappedCases] = useState<RouterOutputs["compliance"]["mappedTestCases"]>([]);

  const [evidenceTestCaseId, setEvidenceTestCaseId] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");
  const [recordingEvidence, setRecordingEvidence] = useState(false);

  const [signOffPeriod, setSignOffPeriod] = useState("");
  const [signOffStatement, setSignOffStatement] = useState("");
  const [signingOff, setSigningOff] = useState(false);
  const [signOffError, setSignOffError] = useState<string | null>(null);

  function load() {
    trpc.compliance.listEvidence.query({ projectId, controlId: control.id }).then(setEvidence);
    trpc.compliance.listSignOffs.query({ projectId, controlId: control.id }).then(setSignOffs);
    trpc.compliance.mappedTestCases.query({ projectId, controlId: control.id }).then(setMappedCases);
  }

  useEffect(load, [projectId, control.id]);

  async function recordEvidence() {
    if (!evidenceTestCaseId) return;
    setRecordingEvidence(true);
    try {
      await trpc.compliance.recordEvidence.mutate({
        projectId,
        controlId: control.id,
        testCaseId: evidenceTestCaseId,
        note: evidenceNote || undefined,
      });
      setEvidenceNote("");
      load();
    } finally {
      setRecordingEvidence(false);
    }
  }

  async function signOff() {
    if (!signOffPeriod.trim() || !signOffStatement.trim()) return;
    setSigningOff(true);
    setSignOffError(null);
    try {
      await trpc.compliance.signOffControl.mutate({ projectId, controlId: control.id, period: signOffPeriod.trim(), statement: signOffStatement.trim() });
      setSignOffPeriod("");
      setSignOffStatement("");
      load();
    } catch (e) {
      setSignOffError(e instanceof Error ? e.message : String(e));
    } finally {
      setSigningOff(false);
    }
  }

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>
        {control.code} {control.title}
      </h2>
      {control.description && <p className="text-muted" style={{ fontSize: 13 }}>{control.description}</p>}

      <h3 style={{ marginBottom: 6 }}>Evidence</h3>
      <ul style={{ listStyle: "none", padding: 0, marginBottom: 12 }}>
        {evidence.map((e) => (
          <li key={e.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <strong>{e.testCaseTitle}</strong>{" "}
            <span className="text-muted">— recorded {new Date(e.recordedAt).toLocaleDateString()} by {e.recordedByEmail}</span>
            {e.note && <div className="text-muted">{e.note}</div>}
          </li>
        ))}
        {evidence.length === 0 && <p className="text-muted" style={{ fontSize: 13 }}>No evidence recorded yet.</p>}
      </ul>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 24 }}>
        <select value={evidenceTestCaseId} onChange={(e) => setEvidenceTestCaseId(e.target.value)} style={{ fontSize: 12 }}>
          <option value="">Pick a mapped test case…</option>
          {mappedCases.map((tc) => (
            <option key={tc.id} value={tc.id}>
              {tc.title}
            </option>
          ))}
        </select>
        <input
          value={evidenceNote}
          onChange={(e) => setEvidenceNote(e.target.value)}
          placeholder="Optional note"
          style={{ fontSize: 12, flex: 1 }}
        />
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={recordEvidence} disabled={recordingEvidence || !evidenceTestCaseId}>
          Record evidence
        </button>
      </div>
      {mappedCases.length === 0 && (
        <p className="text-muted" style={{ fontSize: 12, marginTop: -16, marginBottom: 24 }}>
          Map a test case to this control first before recording evidence against it.
        </p>
      )}

      <h3 style={{ marginBottom: 6 }}>Sign-offs</h3>
      <ul style={{ listStyle: "none", padding: 0, marginBottom: 12 }}>
        {signOffs.map((s) => (
          <li key={s.id} style={{ borderBottom: "1px solid var(--line)", padding: "6px 0", fontSize: 13 }}>
            <strong>{s.period}</strong>{" "}
            <span className="text-muted">— signed {new Date(s.signedAt).toLocaleDateString()} by {s.signedByEmail}</span>
            <div>{s.statement}</div>
          </li>
        ))}
        {signOffs.length === 0 && <p className="text-muted" style={{ fontSize: 13 }}>No sign-offs yet.</p>}
      </ul>
      <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
        <input value={signOffPeriod} onChange={(e) => setSignOffPeriod(e.target.value)} placeholder="Period (e.g. 2026-Q3)" style={{ fontSize: 12 }} />
        <textarea
          value={signOffStatement}
          onChange={(e) => setSignOffStatement(e.target.value)}
          placeholder="Attestation statement"
          rows={3}
          style={{ fontSize: 12 }}
        />
        <button
          className="btn-primary"
          style={{ fontSize: 12, width: "fit-content" }}
          onClick={signOff}
          disabled={signingOff || !signOffPeriod.trim() || !signOffStatement.trim()}
        >
          Sign off
        </button>
        <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
          Requires the Compliance Auditor role (or an org Admin/Owner).
        </p>
        {signOffError && <p style={{ color: "var(--ember)", fontSize: 12 }}>{signOffError}</p>}
      </div>
    </div>
  );
}

function ControlRow({
  projectId,
  control,
  onChanged,
}: {
  projectId: string;
  control: RouterOutputs["compliance"]["controlCoverage"][number];
  onChanged: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [candidates, setCandidates] = useState<RouterOutputs["compliance"]["unmappedTestCases"]>([]);
  const [selected, setSelected] = useState("");
  const [busy, setBusy] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  function openPicker() {
    setPicking(true);
    trpc.compliance.unmappedTestCases.query({ projectId, controlId: control.id }).then(setCandidates);
  }

  async function map() {
    if (!selected) return;
    setBusy(true);
    try {
      await trpc.compliance.mapTestCase.mutate({ testCaseId: selected, controlId: control.id });
      setPicking(false);
      setSelected("");
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        borderBottom: "1px solid var(--line)",
        padding: "8px 0",
      }}
    >
      <div>
        <strong>{control.code}</strong> {control.title}
        {control.description && <div className="text-muted" style={{ fontSize: 12 }}>{control.description}</div>}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}>
        {control.mappedTestCaseCount === 0 ? (
          <span style={{ color: "var(--ember)", fontSize: 12, fontWeight: 600 }}>0 mapped</span>
        ) : (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {control.mappedTestCaseCount} mapped
          </span>
        )}
        {picking ? (
          <>
            <select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ fontSize: 12 }}>
              <option value="">Pick a test case…</option>
              {candidates.map((tc) => (
                <option key={tc.id} value={tc.id}>
                  {tc.title}
                </option>
              ))}
            </select>
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={map} disabled={busy || !selected}>
              Map
            </button>
            <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setPicking(false)}>
              Cancel
            </button>
          </>
        ) : (
          <button className="btn-secondary" style={{ fontSize: 12 }} onClick={openPicker}>
            + Map a test case
          </button>
        )}
        <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setDrawerOpen(true)}>
          Evidence & sign-off
        </button>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <ControlEvidenceDrawer projectId={projectId} control={control} />
      </Drawer>
    </li>
  );
}

export default function CompliancePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [frameworks, setFrameworks] = useState<RouterOutputs["compliance"]["listFrameworks"]>([]);
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string | null>(null);
  const [controls, setControls] = useState<RouterOutputs["compliance"]["controlCoverage"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [frameworkModalOpen, setFrameworkModalOpen] = useState(false);
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [newVersion, setNewVersion] = useState("");
  const [savingFramework, setSavingFramework] = useState(false);

  const [controlModalOpen, setControlModalOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [savingControl, setSavingControl] = useState(false);

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<{ createdCount: number; skippedCount: number } | null>(null);

  function loadFrameworks() {
    setLoading(true);
    trpc.compliance.listFrameworks
      .query()
      .then((fw) => {
        setFrameworks(fw);
        if (!selectedFrameworkId && fw[0]) setSelectedFrameworkId(fw[0].id);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(loadFrameworks, []);

  // P12-09: retention is configured org-wide (Settings -> Organization),
  // but the evidence/audit views it governs live at the project level --
  // fetched here rather than assumed, since a project doesn't otherwise
  // know its own org's id.
  const [dataRetentionYears, setDataRetentionYears] = useState<number | null>(null);
  useEffect(() => {
    trpc.project.byId
      .query({ id: projectId })
      .then((p) => trpc.organization.byId.query({ id: p.organizationId }))
      .then((org) => setDataRetentionYears(org.dataRetentionYears))
      .catch(() => undefined);
  }, [projectId]);

  function loadControls() {
    if (!selectedFrameworkId) {
      setControls([]);
      return;
    }
    trpc.compliance.controlCoverage.query({ projectId, frameworkId: selectedFrameworkId }).then(setControls);
  }

  useEffect(loadControls, [projectId, selectedFrameworkId]);

  async function createFramework() {
    if (!newKey.trim() || !newName.trim()) return;
    setSavingFramework(true);
    setError(null);
    try {
      const fw = await trpc.compliance.createFramework.mutate({
        key: newKey.trim(),
        name: newName.trim(),
        version: newVersion.trim() || undefined,
      });
      setNewKey("");
      setNewName("");
      setNewVersion("");
      setFrameworkModalOpen(false);
      loadFrameworks();
      setSelectedFrameworkId(fw.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingFramework(false);
    }
  }

  async function createControl() {
    if (!selectedFrameworkId || !newCode.trim() || !newTitle.trim()) return;
    setSavingControl(true);
    setError(null);
    try {
      await trpc.compliance.createControl.mutate({
        frameworkId: selectedFrameworkId,
        code: newCode.trim(),
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewCode("");
      setNewTitle("");
      setNewDescription("");
      setControlModalOpen(false);
      loadFrameworks();
      loadControls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingControl(false);
    }
  }

  async function importControls() {
    if (!selectedFrameworkId) return;
    setImporting(true);
    setError(null);
    setImportResult(null);
    try {
      const controls = parseControlsCsv(importCsvText);
      if (controls.length === 0) {
        setError('No rows found - check the CSV has a header row with "code" and "title" columns.');
        return;
      }
      const result = await trpc.compliance.importControls.mutate({ frameworkId: selectedFrameworkId, controls });
      setImportResult(result);
      setImportCsvText("");
      loadFrameworks();
      loadControls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const [exporting, setExporting] = useState(false);

  async function exportCsv() {
    if (!selectedFrameworkId) return;
    setExporting(true);
    setError(null);
    try {
      const report = await trpc.compliance.exportReport.query({ projectId, frameworkId: selectedFrameworkId });
      const rows: string[][] = [["Control", "Title", "Description", "Mapped test cases", "Gap?"]];
      for (const c of report.controls) {
        const evidence = c.mappedTestCases.map((tc) => `${tc.title} [${tc.reviewStatus}]`).join("; ");
        rows.push([c.code, c.title, c.description ?? "", evidence, c.mappedTestCases.length === 0 ? "YES" : ""]);
      }
      const safeName = report.frameworkName.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      downloadCsv(`${safeName}-coverage-report.csv`, rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const selectedFramework = frameworks.find((f) => f.id === selectedFrameworkId);
  const gapCount = controls.filter((c) => c.mappedTestCaseCount === 0).length;

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Compliance</h1>
        <button className="btn-primary" onClick={() => setFrameworkModalOpen(true)}>
          + New framework
        </button>
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Which controls have test coverage in this project, and which don&apos;t yet.
        {dataRetentionYears !== null && (
          <>
            {" "}
            Evidence and audit-log data is retained for{" "}
            <a href="/settings/organization">{dataRetentionYears} year{dataRetentionYears === 1 ? "" : "s"}</a> per this org&apos;s
            configured policy.
          </>
        )}
      </p>

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && frameworks.length > 0 && (
        <div style={{ display: "flex", gap: 8, marginBottom: 16, flexWrap: "wrap" }}>
          {frameworks.map((f) => (
            <button
              key={f.id}
              className={f.id === selectedFrameworkId ? "btn-primary" : "btn-secondary"}
              style={{ fontSize: 13 }}
              onClick={() => setSelectedFrameworkId(f.id)}
            >
              {f.name}
              {f.version && ` (${f.version})`} — {f.controlCount} control{f.controlCount === 1 ? "" : "s"}
              {!f.isBuiltIn && " · custom"}
            </button>
          ))}
        </div>
      )}

      {selectedFramework && (
        <div className="panel">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h2 style={{ marginTop: 0 }}>{selectedFramework.name}</h2>
            <div style={{ display: "flex", gap: 8 }}>
              <button className="btn-secondary" style={{ fontSize: 13 }} onClick={exportCsv} disabled={exporting || controls.length === 0}>
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: 13 }}
                onClick={() => {
                  setImportResult(null);
                  setImportModalOpen(true);
                }}
              >
                Import controls
              </button>
              <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setControlModalOpen(true)}>
                + Add control
              </button>
            </div>
          </div>
          {controls.length > 0 && (
            <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
              {controls.length - gapCount}/{controls.length} controls have at least one mapped test case
              {gapCount > 0 && <span style={{ color: "var(--ember)" }}> — {gapCount} gap{gapCount === 1 ? "" : "s"}</span>}
            </p>
          )}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {controls.map((c) => (
              <ControlRow key={c.id} projectId={projectId} control={c} onChanged={loadControls} />
            ))}
            {controls.length === 0 && (
              <p className="text-muted">No controls on this framework yet — add one above.</p>
            )}
          </ul>
        </div>
      )}

      {!loading && frameworks.length === 0 && (
        <p className="text-muted">No compliance frameworks yet — create one above.</p>
      )}

      <Modal open={frameworkModalOpen} onClose={() => setFrameworkModalOpen(false)} title="New compliance framework">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Key <span className="text-muted" style={{ fontSize: 12 }}>(short, unique, e.g. "fda-21-cfr-part-11")</span>
            <input value={newKey} onChange={(e) => setNewKey(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Name
            <input value={newName} onChange={(e) => setNewName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Version <span className="text-muted" style={{ fontSize: 12 }}>(optional)</span>
            <input value={newVersion} onChange={(e) => setNewVersion(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setFrameworkModalOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={createFramework} disabled={savingFramework || !newKey.trim() || !newName.trim()}>
              {savingFramework ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={importModalOpen} onClose={() => setImportModalOpen(false)} title="Import controls from CSV">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
            Paste a control set exported as CSV - a header row with <code>code</code>, <code>title</code>, and
            optionally <code>description</code> columns, then one row per control (e.g. the AICPA Trust Services
            Criteria for SOC 2, or NIST CSF subcategories). Existing controls with the same code on this framework
            are left untouched, so re-running an updated import is safe.
          </p>
          <textarea
            value={importCsvText}
            onChange={(e) => setImportCsvText(e.target.value)}
            rows={10}
            placeholder={'code,title,description\nCC6.1,Logical access controls,"Restricts access to..."'}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />
          {importResult && (
            <p style={{ color: "var(--frost)", fontSize: 13 }}>
              Imported {importResult.createdCount} control{importResult.createdCount === 1 ? "" : "s"}
              {importResult.skippedCount > 0 &&
                ` (${importResult.skippedCount} skipped - already exists on this framework)`}
              .
            </p>
          )}
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setImportModalOpen(false)}>
              Close
            </button>
            <button className="btn-primary" onClick={importControls} disabled={importing || !importCsvText.trim()}>
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={controlModalOpen} onClose={() => setControlModalOpen(false)} title="New control">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Code <span className="text-muted" style={{ fontSize: 12 }}>(e.g. "CC6.1")</span>
            <input value={newCode} onChange={(e) => setNewCode(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Title
            <input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Description <span className="text-muted" style={{ fontSize: 12 }}>(optional)</span>
            <textarea value={newDescription} onChange={(e) => setNewDescription(e.target.value)} rows={3} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setControlModalOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={createControl} disabled={savingControl || !newCode.trim() || !newTitle.trim()}>
              {savingControl ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
