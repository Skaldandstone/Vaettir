"use client";

import { ActionButton } from "@/components/ui/ActionButton";
import { useCaseFieldAccess } from "@/lib/use-case-field-access";
import { ComplianceReviewWorkflow } from "@/components/ComplianceReviewWorkflow";
import { roleLabel } from "@/lib/membership";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { Modal } from "@/components/Modal";
import { Drawer } from "@/components/Drawer";
import { downloadCsv } from "@/lib/csv";

import { COMPLIANCE_STARTERS } from "@/lib/compliance-starters";
import { CompliancePicker } from "@/components/CompliancePicker";
import { savedComplianceOptions } from "@/lib/compliance-catalog";
import { rankComplianceCandidates } from "@/lib/compliance-proposals";
import {
  ComplianceMappingGuidance,
  ComplianceFrameworkGuidance,
} from "@/components/ComplianceMappingGuidance";

// P3-02: minimal RFC 4180 CSV parser (quoted fields, embedded commas,
// escaped quotes as "") - the inverse of csvField/downloadCsv above.
// Expects a header row containing at least "code" and "title"; a
// "description" column is optional. Good enough for a control-set export
// from a spreadsheet, which is the realistic source for this data.
function parseControlsCsv(
  text: string,
): { code: string; title: string; description?: string }[] {
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
    throw new Error(
      'CSV must have a header row with "code" and "title" columns',
    );
  }
  return nonEmpty
    .slice(1)
    .filter((r) => (r[codeIdx] ?? "").trim() && (r[titleIdx] ?? "").trim())
    .map((r) => ({
      code: (r[codeIdx] ?? "").trim(),
      title: (r[titleIdx] ?? "").trim(),
      description:
        descIdx >= 0 && r[descIdx]?.trim() ? r[descIdx]?.trim() : undefined,
    }));
}

// P3-05/P3-07: evidence (a dated proof point) and sign-offs (a formal
// ComplianceAuditor attestation) for one control, in a side drawer so the
// control list stays visible. Both lists are append-only from this UI --
// no edit/delete action exists, matching the backend's immutability.
function ControlEvidenceDrawer({
  projectId,
  control,
  readOnly = false,
  canSignOff = false,
}: {
  projectId: string;
  control: RouterOutputs["compliance"]["controlCoverage"][number];
  readOnly?: boolean;
  canSignOff?: boolean;
}) {
  const utils = trpcReact.useUtils();
  const scope = { projectId, controlId: control.id };
  const evidenceQuery = trpcReact.compliance.listEvidence.useQuery(scope);
  const signOffsQuery = trpcReact.compliance.listSignOffs.useQuery(scope);
  const mappedQuery = trpcReact.compliance.mappedTestCases.useQuery(scope);
  const evidence = evidenceQuery.data ?? [];
  const signOffs = signOffsQuery.data ?? [];
  const mappedCases = mappedQuery.data ?? [];

  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const organizationId = projectQuery.data?.organizationId;
  const membersQuery = trpcReact.organization.listMembers.useQuery(
    { organizationId: organizationId! },
    { enabled: !!organizationId },
  );
  const members = (membersQuery.data ?? []).filter((x) =>
    ["COMPLIANCE_AUDITOR", "ADMIN", "OWNER"].includes(x.role),
  );

  const [evidenceTestCaseId, setEvidenceTestCaseId] = useState("");
  const [evidenceNote, setEvidenceNote] = useState("");

  const [signOffPeriod, setSignOffPeriod] = useState("");
  const [signOffStatement, setSignOffStatement] = useState("");
  const [signOffError, setSignOffError] = useState<string | null>(null);

  const [requestForUserId, setRequestForUserId] = useState("");
  const [requestPeriod, setRequestPeriod] = useState("");
  const [requestError, setRequestError] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  function reload() {
    void utils.compliance.listEvidence.invalidate(scope);
    void utils.compliance.listSignOffs.invalidate(scope);
    void utils.compliance.mappedTestCases.invalidate(scope);
  }

  const requestMutation = trpcReact.compliance.requestSignOff.useMutation({
    onSuccess: () => {
      setRequestForUserId("");
      setRequestSent(true);
      setRequestPeriod("");
    },
    onError: (e) => setRequestError(e.message),
  });
  const evidenceMutation = trpcReact.compliance.recordEvidence.useMutation({
    onSuccess: () => {
      setEvidenceNote("");
      reload();
    },
  });
  const signOffMutation = trpcReact.compliance.signOffControl.useMutation({
    onSuccess: () => {
      setSignOffPeriod("");
      setSignOffStatement("");
      reload();
    },
    onError: (e) => setSignOffError(e.message),
  });

  function requestSignOff() {
    if (!requestForUserId || !requestPeriod.trim()) return;
    setRequestError(null);
    setRequestSent(false);
    requestMutation.mutate({
      projectId,
      controlId: control.id,
      period: requestPeriod.trim(),
      requestedForUserId: requestForUserId,
    });
  }

  function recordEvidence() {
    if (!evidenceTestCaseId) return;
    evidenceMutation.mutate({
      projectId,
      controlId: control.id,
      testCaseId: evidenceTestCaseId,
      note: evidenceNote || undefined,
    });
  }

  function signOff() {
    if (!signOffPeriod.trim() || !signOffStatement.trim()) return;
    setSignOffError(null);
    signOffMutation.mutate({
      projectId,
      controlId: control.id,
      period: signOffPeriod.trim(),
      statement: signOffStatement.trim(),
    });
  }

  const recordingEvidence = evidenceMutation.isPending;
  const signingOff = signOffMutation.isPending;
  const requesting = requestMutation.isPending;

  return (
    <div>
      <h2 style={{ marginBottom: 2 }}>
        {control.code} {control.title}
      </h2>
      {control.description && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          {control.description}
        </p>
      )}

      <h3 style={{ marginBottom: 6 }}>Evidence</h3>
      <ul style={{ listStyle: "none", padding: 0, marginBottom: 12 }}>
        {evidence.map((e) => (
          <li
            key={e.id}
            style={{
              borderBottom: "1px solid var(--line)",
              padding: "6px 0",
              fontSize: 13,
            }}
          >
            <strong>{e.testCaseTitle}</strong>{" "}
            <span className="text-muted">
              — recorded {new Date(e.recordedAt).toLocaleDateString()} by{" "}
              {e.recordedByEmail}
            </span>
            {e.note && <div className="text-muted">{e.note}</div>}
          </li>
        ))}
        {evidence.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13 }}>
            No evidence recorded yet.
          </p>
        )}
      </ul>
      {!readOnly && (
        <>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              marginBottom: 24,
            }}
          >
            <select
              value={evidenceTestCaseId}
              onChange={(e) => setEvidenceTestCaseId(e.target.value)}
              style={{ fontSize: 12 }}
            >
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
            <button
              className="btn-secondary"
              style={{ fontSize: 12 }}
              onClick={recordEvidence}
              disabled={recordingEvidence || !evidenceTestCaseId}
            >
              Record evidence
            </button>
          </div>
          {mappedCases.length === 0 && (
            <p
              className="text-muted"
              style={{ fontSize: 12, marginTop: -16, marginBottom: 24 }}
            >
              Map a test case to this control first before recording evidence
              against it.
            </p>
          )}
        </>
      )}

      <h3 style={{ marginBottom: 6 }}>Sign-offs</h3>
      <ul style={{ listStyle: "none", padding: 0, marginBottom: 12 }}>
        {signOffs.map((s) => (
          <li
            key={s.id}
            style={{
              borderBottom: "1px solid var(--line)",
              padding: "6px 0",
              fontSize: 13,
            }}
          >
            <strong>{s.period}</strong>{" "}
            <span className="text-muted">
              — signed {new Date(s.signedAt).toLocaleDateString()} by{" "}
              {s.signedByEmail}
            </span>
            <div>{s.statement}</div>
          </li>
        ))}
        {signOffs.length === 0 && (
          <p className="text-muted" style={{ fontSize: 13 }}>
            No sign-offs yet.
          </p>
        )}
      </ul>
      {canSignOff && (
        <div style={{ display: "grid", gap: 8, maxWidth: 420 }}>
          <input
            value={signOffPeriod}
            onChange={(e) => setSignOffPeriod(e.target.value)}
            placeholder="Period (e.g. 2026-Q3)"
            style={{ fontSize: 12 }}
          />
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
            disabled={
              signingOff || !signOffPeriod.trim() || !signOffStatement.trim()
            }
          >
            Sign off
          </button>
          <p className="text-muted" style={{ fontSize: 11, margin: 0 }}>
            Requires the Compliance Auditor role (or an org Admin/Owner).
          </p>
          {signOffError && (
            <p style={{ color: "var(--ember)", fontSize: 12 }}>
              {signOffError}
            </p>
          )}
        </div>
      )}

      {!readOnly && (
        <>
          <h3 style={{ marginTop: 24, marginBottom: 6 }}>Request a sign-off</h3>
          <details>
            <summary>Details</summary>
            <p className="text-muted" style={{ fontSize: 12, marginTop: -4 }}>
              Ask another Compliance Auditor (or Admin/Owner) to sign off - they
              get a push notification on the mobile app, and it's automatically
              marked done the moment they actually sign off for this same
              period.
            </p>
          </details>
          <div
            style={{
              display: "flex",
              gap: 8,
              alignItems: "center",
              maxWidth: 480,
            }}
          >
            <select
              value={requestForUserId}
              onChange={(e) => setRequestForUserId(e.target.value)}
              style={{ fontSize: 12, flex: 1 }}
            >
              <option value="">Request from…</option>
              {members.map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.userName ?? m.userEmail} ({roleLabel(m.role)})
                </option>
              ))}
            </select>
            <input
              value={requestPeriod}
              onChange={(e) => setRequestPeriod(e.target.value)}
              placeholder="Period (e.g. 2026-Q3)"
              style={{ fontSize: 12, width: 140 }}
            />
            <button
              className="btn-secondary"
              style={{ fontSize: 12 }}
              onClick={requestSignOff}
              disabled={
                requesting || !requestForUserId || !requestPeriod.trim()
              }
            >
              {requesting ? "Sending…" : "Request"}
            </button>
          </div>
          {requestSent && (
            <p style={{ color: "var(--frost)", fontSize: 12 }}>Request sent.</p>
          )}
          {requestError && (
            <p style={{ color: "var(--ember)", fontSize: 12 }}>
              {requestError}
            </p>
          )}
        </>
      )}
    </div>
  );
}

function ControlRow({
  frameworkKey,
  projectId,
  control,
  onChanged,
  readOnly = false,
  canSignOff = false,
}: {
  frameworkKey: string;
  projectId: string;
  control: RouterOutputs["compliance"]["controlCoverage"][number];
  onChanged: () => void;
  readOnly?: boolean;
  canSignOff?: boolean;
}) {
  const [picking, setPicking] = useState(false);
  const candidatesQuery = trpcReact.compliance.unmappedTestCases.useQuery(
    { projectId, controlId: control.id },
    { enabled: picking },
  );
  const candidates = candidatesQuery.data ?? [];
  const rankedCandidates = rankComplianceCandidates(control, candidates);
  const [selected, setSelected] = useState("");
  const [drawerOpen, setDrawerOpen] = useState(false);

  const mapMutation = trpcReact.compliance.mapTestCase.useMutation({
    onSuccess: () => {
      setPicking(false);
      setSelected("");
      onChanged();
    },
  });

  function map() {
    if (!selected) return;
    mapMutation.mutate({ testCaseId: selected, controlId: control.id });
  }

  const busy = mapMutation.isPending;

  return (
    <li
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 12,
        flexWrap: "wrap",
        borderBottom: "1px solid var(--line)",
        padding: "8px 0",
      }}
    >
      <div style={{ flex: "1 1 300px", minWidth: 0 }}>
        <strong>{control.code}</strong> {control.title}
        {control.description && (
          <div className="text-muted" style={{ fontSize: 12 }}>
            {control.description}
          </div>
        )}
        <ComplianceMappingGuidance
          frameworkKey={frameworkKey}
          control={control}
        />
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
          maxWidth: "100%",
        }}
      >
        {control.mappedTestCaseCount === 0 ? (
          <span
            style={{ color: "var(--ember)", fontSize: 12, fontWeight: 600 }}
          >
            0 mapped
          </span>
        ) : (
          <span className="text-muted" style={{ fontSize: 12 }}>
            {control.mappedTestCaseCount} mapped
          </span>
        )}
        {!readOnly &&
          (picking ? (
            <>
              <div style={{ flexBasis: "100%", fontSize: 12 }}>
                {candidatesQuery.isPending ? (
                  <p role="status">Loading candidate cases…</p>
                ) : candidatesQuery.error ? (
                  <p role="alert">
                    Could not load cases. Close and reopen the picker to retry.
                  </p>
                ) : (
                  <>
                    <p>
                      Title matches first. This preview checks{" "}
                      {candidates.length} loaded case titles, not their steps or
                      expected results. Review the case before mapping.
                    </p>
                    {candidates.length >= 200 && (
                      <p role="status">
                        More cases may exist. This list is limited to 200
                        candidates and cannot establish complete project
                        coverage.
                      </p>
                    )}
                    {candidates.length === 0 && (
                      <p>
                        No unmapped cases were returned. Review the control’s
                        suggested check outline before authoring a new case.
                      </p>
                    )}
                  </>
                )}
                {selected && (
                  <p>
                    {(() => {
                      const terms =
                        rankedCandidates.find(
                          (item) => item.candidate.id === selected,
                        )?.matchedTerms ?? [];
                      return terms.length
                        ? `Shared title terms: ${terms.join(", ")}. This is a suggestion, not verified coverage.`
                        : "No shared title terms. A reviewer must assess the case’s relevance.";
                    })()}
                  </p>
                )}
              </div>
              <select
                aria-label={`Test case for ${control.code}`}
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{ fontSize: 12 }}
              >
                <option value="">Pick a test case…</option>
                {rankedCandidates.map(({ candidate: tc, matchedTerms }) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.title}
                    {matchedTerms.length > 0 ? " · title match" : ""}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary"
                style={{ fontSize: 12 }}
                onClick={map}
                disabled={
                  busy ||
                  !selected ||
                  candidatesQuery.isFetching ||
                  !!candidatesQuery.error ||
                  !candidates.some((candidate) => candidate.id === selected)
                }
              >
                Map
              </button>
              <button
                className="btn-secondary"
                style={{ fontSize: 12 }}
                onClick={() => setPicking(false)}
              >
                Cancel
              </button>
            </>
          ) : (
            <ActionButton
              className="btn-secondary"
              style={{ fontSize: 12 }}
              onClick={() => setPicking(true)}
              tooltip={<>+ Map a test case</>}
            >
              Map case{" "}
            </ActionButton>
          ))}
        <ActionButton
          className="btn-secondary"
          style={{ fontSize: 12 }}
          onClick={() => setDrawerOpen(true)}
          tooltip={<>Evidence & sign-off</>}
        >
          Sign-off{" "}
        </ActionButton>
      </div>
      <Drawer open={drawerOpen} onClose={() => setDrawerOpen(false)}>
        <ControlEvidenceDrawer
          projectId={projectId}
          control={control}
          readOnly={readOnly}
          canSignOff={canSignOff}
        />
      </Drawer>
    </li>
  );
}

// P1-15
export default function CompliancePage() {
  const { projectId } = useParams<{ projectId: string }>();
  const utils = trpcReact.useUtils();
  const { canEdit, canSignOff, canAdmin } = useProjectPermissions(projectId);
  const readOnly = !canEdit;
  const referenceAccess = useCaseFieldAccess(projectId);
  const catalogQuery = trpcReact.compliance.catalog.useQuery();
  const loadReference = trpcReact.compliance.loadReference.useMutation();

  const [includeHidden, setIncludeHidden] = useState(false);
  const frameworksQuery = trpcReact.compliance.listFrameworks.useQuery({
    projectId,
    includeHidden,
  });
  const frameworks = frameworksQuery.data ?? [];
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!frameworks.some((f) => f.id === selectedFrameworkId))
      setSelectedFrameworkId(frameworks[0]?.id ?? null);
  }, [frameworks, selectedFrameworkId]);

  const controlsQuery = trpcReact.compliance.controlCoverage.useQuery(
    { projectId, frameworkId: selectedFrameworkId! },
    { enabled: !!selectedFrameworkId },
  );
  const controls = selectedFrameworkId ? (controlsQuery.data ?? []) : [];

  // P12-09: retention is configured org-wide (Settings -> Organization),
  // but the evidence/audit views it governs live at the project level --
  // fetched here rather than assumed, since a project doesn't otherwise
  // know its own org's id.
  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const organizationId = projectQuery.data?.organizationId;
  const orgQuery = trpcReact.organization.byId.useQuery(
    { id: organizationId! },
    { enabled: !!organizationId },
  );
  const dataRetentionYears = orgQuery.data?.dataRetentionYears ?? null;

  const [error, setError] = useState<string | null>(null);

  const [frameworkModalOpen, setFrameworkModalOpen] = useState(false);
  const [starterKey, setStarterKey] = useState("nist-csf-2");
  const [frameworkMode, setFrameworkMode] = useState<"starter" | "custom">(
    "starter",
  );
  const [newKey, setNewKey] = useState("");
  const [newName, setNewName] = useState("");
  const [newVersion, setNewVersion] = useState("");

  const [controlModalOpen, setControlModalOpen] = useState(false);
  const [newCode, setNewCode] = useState("");
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");

  const [importModalOpen, setImportModalOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importResult, setImportResult] = useState<{
    createdCount: number;
    skippedCount: number;
  } | null>(null);
  const [exporting, setExporting] = useState(false);

  function reloadFrameworks() {
    void utils.compliance.listFrameworks.invalidate();
  }
  function reloadControls() {
    void utils.compliance.controlCoverage.invalidate();
  }

  const createFrameworkMutation =
    trpcReact.compliance.createFramework.useMutation();
  const createControlMutation =
    trpcReact.compliance.createControl.useMutation();
  const importControlsMutation =
    trpcReact.compliance.importControls.useMutation();
  const deleteFrameworkMutation =
    trpcReact.compliance.setFrameworkVisibility.useMutation();

  async function deleteSelectedFramework() {
    if (!selectedFramework || !canAdmin) return;
    if (
      !confirm(
        `${includeHidden ? "Restore" : "Hide"} "${selectedFramework.name}" in this project? Controls, mappings and audit evidence will be preserved.`,
      )
    )
      return;
    setError(null);
    try {
      await deleteFrameworkMutation.mutateAsync({
        projectId,
        frameworkId: selectedFramework.id,
        hidden: !includeHidden,
      });
      setSelectedFrameworkId(null);
      reloadFrameworks();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function loadStarterFramework() {
    const starter = COMPLIANCE_STARTERS.find(
      (candidate) => candidate.key === starterKey,
    );
    if (!starter) return;
    setError(null);
    try {
      const origin = referenceAccess.origin;
      if (!origin || !referenceAccess.owns(origin, "edit")) return;
      const created = await loadReference.mutateAsync({
        projectId,
        originalOrganizationId: origin.organizationId,
        expectedClerkActorId: origin.clerkActorId,
        key: starter.key,
      });
      if (!referenceAccess.owns(origin, "edit")) return;
      const frameworkId = created.id;
      setSelectedFrameworkId(frameworkId);
      setFrameworkModalOpen(false);
      reloadFrameworks();
      reloadControls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createFramework() {
    if (!newKey.trim() || !newName.trim()) return;
    setError(null);
    try {
      const fw = await createFrameworkMutation.mutateAsync({
        projectId,
        key: newKey.trim(),
        name: newName.trim(),
        version: newVersion.trim() || undefined,
      });
      setNewKey("");
      setNewName("");
      setNewVersion("");
      setFrameworkModalOpen(false);
      reloadFrameworks();
      setSelectedFrameworkId(fw.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function createControl() {
    if (!selectedFrameworkId || !newCode.trim() || !newTitle.trim()) return;
    setError(null);
    try {
      await createControlMutation.mutateAsync({
        projectId,
        frameworkId: selectedFrameworkId,
        code: newCode.trim(),
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
      });
      setNewCode("");
      setNewTitle("");
      setNewDescription("");
      setControlModalOpen(false);
      reloadFrameworks();
      reloadControls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function importControls() {
    if (!selectedFrameworkId) return;
    setError(null);
    setImportResult(null);
    try {
      const parsed = parseControlsCsv(importCsvText);
      if (parsed.length === 0) {
        setError(
          'No rows found - check the CSV has a header row with "code" and "title" columns.',
        );
        return;
      }
      const result = await importControlsMutation.mutateAsync({
        projectId,
        frameworkId: selectedFrameworkId,
        controls: parsed,
      });
      setImportResult(result);
      setImportCsvText("");
      reloadFrameworks();
      reloadControls();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function exportCsv() {
    if (!selectedFrameworkId) return;
    setExporting(true);
    setError(null);
    try {
      const report = await utils.compliance.exportReport.fetch({
        projectId,
        frameworkId: selectedFrameworkId,
      });
      const rows: string[][] = [
        ["Control", "Title", "Description", "Mapped test cases", "Gap?"],
      ];
      for (const c of report.controls) {
        const evidence = c.mappedTestCases
          .map((tc) => `${tc.title} [${tc.reviewStatus}]`)
          .join("; ");
        rows.push([
          c.code,
          c.title,
          c.description ?? "",
          evidence,
          c.mappedTestCases.length === 0 ? "YES" : "",
        ]);
      }
      const safeName = report.frameworkName
        .replace(/[^a-z0-9]+/gi, "-")
        .toLowerCase();
      downloadCsv(`${safeName}-coverage-report.csv`, rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setExporting(false);
    }
  }

  const loading = frameworksQuery.isLoading;
  const pageError = error ?? frameworksQuery.error?.message ?? null;
  const savingFramework =
    createFrameworkMutation.isPending ||
    loadReference.isPending ||
    importControlsMutation.isPending;
  const savingControl = createControlMutation.isPending;
  const importing = importControlsMutation.isPending;

  const selectedFramework = frameworks.find(
    (f) => f.id === selectedFrameworkId,
  );
  const gapCount = controls.filter((c) => c.mappedTestCaseCount === 0).length;

  return (
    <div style={{ maxWidth: 800 }}>
      {/* Keep the workflow's original access pins and private draft state mounted.
          Its own access guard hides content during revalidation. Unmounting it
          here restarts its shared stale query and repeatedly invalidates ours. */}
      <ComplianceReviewWorkflow projectId={projectId} />
      {!referenceAccess.readable ? (
        <p>
          Verifying original workspace access before showing compliance
          definitions and evidence.
        </p>
      ) : (
      <>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ margin: 0 }}>Compliance</h1>
        <label>
          <input
            type="checkbox"
            checked={includeHidden}
            onChange={(e) => {
              setIncludeHidden(e.target.checked);
              setSelectedFrameworkId(null);
            }}
          />{" "}
          Include hidden frameworks
        </label>
        {!readOnly && (
          <ActionButton
            className="btn-primary"
            onClick={() => setFrameworkModalOpen(true)}
            tooltip={<>+ New framework</>}
          >
            New framework{" "}
          </ActionButton>
        )}
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Which controls have test coverage in this project, and which don&apos;t
        yet.
        {dataRetentionYears !== null && (
          <>
            {" "}
            Evidence and audit-log data is retained for{" "}
            <a href="/settings/organization">
              {dataRetentionYears} year{dataRetentionYears === 1 ? "" : "s"}
            </a>{" "}
            per this org&apos;s configured policy.
          </>
        )}
      </p>

      {pageError && <p style={{ color: "var(--ember)" }}>{pageError}</p>}
      {loading && <p>Loading…</p>}

      {!loading && frameworks.length > 0 && (
        <CompliancePicker
          label="Saved frameworks"
          options={savedComplianceOptions(frameworks)}
          selected={selectedFrameworkId ? [selectedFrameworkId] : []}
          onSelect={setSelectedFrameworkId}
        />
      )}

      {selectedFramework && (
        <div className="panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              flexWrap: "wrap",
              gap: 8,
            }}
          >
            <h2 style={{ marginTop: 0 }}>{selectedFramework.name}</h2>
            <div
              style={{
                display: "flex",
                flexWrap: "wrap",
                maxWidth: "100%",
                gap: 8,
              }}
            >
              <button
                className="btn-secondary"
                style={{ fontSize: 13 }}
                onClick={exportCsv}
                disabled={exporting || controls.length === 0}
              >
                {exporting ? "Exporting…" : "Export CSV"}
              </button>
              {!readOnly && (
                <>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 13 }}
                    disabled={
                      !selectedFramework.workspaceOwned ||
                      !!selectedFramework.catalogKey
                    }
                    onClick={() => {
                      setImportResult(null);
                      setImportModalOpen(true);
                    }}
                  >
                    Import controls
                  </button>
                  <ActionButton
                    className="btn-secondary"
                    style={{ fontSize: 13 }}
                    disabled={
                      !selectedFramework.workspaceOwned ||
                      !!selectedFramework.catalogKey
                    }
                    onClick={() => setControlModalOpen(true)}
                    tooltip={<>+ Add control</>}
                  >
                    Add control{" "}
                  </ActionButton>
                  {canAdmin && (
                    <ActionButton
                      className="btn-secondary"
                      style={{ fontSize: 13, color: "var(--ember)" }}
                      onClick={() => void deleteSelectedFramework()}
                      disabled={deleteFrameworkMutation.isPending}
                      tooltip={
                        <>
                          {deleteFrameworkMutation.isPending
                            ? "Saving…"
                            : includeHidden
                              ? "Restore in project"
                              : "Hide from project"}
                        </>
                      }
                    >
                      {deleteFrameworkMutation.isPending
                        ? "Saving…"
                        : includeHidden
                          ? "Restore"
                          : "Hide"}
                    </ActionButton>
                  )}
                </>
              )}
            </div>
          </div>
          {(!selectedFramework.workspaceOwned ||
            selectedFramework.catalogKey) && (
            <p>
              These reference definitions are read-only. Create a workspace
              custom framework for reviewed additions. Existing links and
              evidence are preserved.
            </p>
          )}
          <ComplianceFrameworkGuidance frameworkKey={selectedFramework.key} />
          {controls.length > 0 && (
            <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
              {controls.length - gapCount}/{controls.length} controls have at
              least one mapped test case
              {gapCount > 0 && (
                <span style={{ color: "var(--ember)" }}>
                  {" "}
                  — {gapCount} gap{gapCount === 1 ? "" : "s"}
                </span>
              )}
            </p>
          )}
          <ul style={{ listStyle: "none", padding: 0 }}>
            {controls.map((c) => (
              <ControlRow
                key={c.id}
                frameworkKey={selectedFramework.key}
                projectId={projectId}
                control={c}
                onChanged={reloadControls}
                readOnly={readOnly}
                canSignOff={canSignOff}
              />
            ))}
            {controls.length === 0 && (
              <div className="compliance-empty-controls">
                <strong>This framework has no controls yet</strong>
                <p>
                  Load a curated starter, import the authoritative control list
                  as CSV, or add a control manually.
                </p>
                {!readOnly && (
                  <button
                    className="btn-primary"
                    onClick={() => {
                      setFrameworkMode("starter");
                      setFrameworkModalOpen(true);
                    }}
                  >
                    Browse starters
                  </button>
                )}
              </div>
            )}
          </ul>
        </div>
      )}

      {!loading && frameworks.length === 0 && (
        <div className="panel compliance-empty-controls">
          <strong>Start with an established framework</strong>
          <p>
            Choose a starter to load its structure and begin mapping test
            evidence. Nothing is marked compliant automatically.
          </p>
          {!readOnly && (
            <ActionButton
              className="btn-primary"
              onClick={() => {
                setFrameworkMode("starter");
                setFrameworkModalOpen(true);
              }}
              tooltip={<>Browse framework starters</>}
            >
              Browse{" "}
            </ActionButton>
          )}
        </div>
      )}

      <Modal
        open={frameworkModalOpen}
        onClose={() => setFrameworkModalOpen(false)}
        title="New compliance framework"
      >
        <div className="compliance-framework-picker">
          <div
            className="compliance-picker-tabs"
            role="tablist"
            aria-label="Framework type"
          >
            <ActionButton
              className={
                frameworkMode === "starter" ? "btn-primary" : "btn-secondary"
              }
              onClick={() => setFrameworkMode("starter")}
              tooltip={<>Use a starter</>}
            >
              Use{" "}
            </ActionButton>
            <button
              className={
                frameworkMode === "custom" ? "btn-primary" : "btn-secondary"
              }
              onClick={() => setFrameworkMode("custom")}
            >
              Create custom
            </button>
          </div>
          {frameworkMode === "starter" ? (
            <>
              <CompliancePicker
                label="Standards and rights to review"
                options={catalogQuery.data ?? []}
                selected={[starterKey]}
                onSelect={setStarterKey}
                disabled={savingFramework}
              />
              {!COMPLIANCE_STARTERS.some(
                (starter) => starter.key === starterKey,
              ) && (
                <p role="status">
                  This reference has no bundled controls. Use an existing saved
                  framework or obtain the applicable control list from its
                  authoritative source.
                </p>
              )}
              {COMPLIANCE_STARTERS.filter(
                (starter) => starter.key === starterKey,
              ).map((starter) => (
                <div key={starter.key} className="compliance-starter-preview">
                  <div>
                    <strong>{starter.name}</strong>
                    <span>{starter.version}</span>
                  </div>
                  <p>{starter.summary}</p>
                  <div className="compliance-starter-controls">
                    {starter.controls.map((control) => (
                      <span key={control.code}>
                        <strong>{control.code}</strong>
                        {control.title}
                      </span>
                    ))}
                  </div>
                  <p className="compliance-source-note">
                    Loads {starter.controls.length} starter controls. Review
                    them against the{" "}
                    <a
                      href={starter.sourceUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      authoritative source
                    </a>{" "}
                    before using them for an audit or certification.
                  </p>
                </div>
              ))}
              <div className="form-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setFrameworkModalOpen(false)}
                >
                  Cancel
                </button>
                <ActionButton
                  className="btn-primary"
                  onClick={loadStarterFramework}
                  disabled={
                    savingFramework ||
                    !COMPLIANCE_STARTERS.some(
                      (starter) => starter.key === starterKey,
                    )
                  }
                  tooltip={
                    <>
                      {savingFramework ? "Loading…" : "Load starter controls"}
                    </>
                  }
                >
                  {savingFramework ? "Loading…" : "Load"}
                </ActionButton>
              </div>
            </>
          ) : (
            <>
              <label>
                Key{" "}
                <span className="text-muted" style={{ fontSize: 12 }}>
                  (short, unique, e.g. &quot;fda-21-cfr-part-11&quot;)
                </span>
                <input
                  value={newKey}
                  onChange={(e) => setNewKey(e.target.value)}
                />
              </label>
              <label>
                Name
                <input
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                />
              </label>
              <label>
                Version{" "}
                <span className="text-muted" style={{ fontSize: 12 }}>
                  (optional)
                </span>
                <input
                  value={newVersion}
                  onChange={(e) => setNewVersion(e.target.value)}
                />
              </label>
              <div className="form-actions">
                <button
                  className="btn-secondary"
                  onClick={() => setFrameworkModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  onClick={createFramework}
                  disabled={
                    savingFramework || !newKey.trim() || !newName.trim()
                  }
                >
                  {savingFramework ? "Creating…" : "Create framework"}
                </button>
              </div>
            </>
          )}
        </div>
      </Modal>

      <Modal
        open={importModalOpen}
        onClose={() => setImportModalOpen(false)}
        title="Import controls from CSV"
      >
        <div style={{ display: "grid", gap: 10 }}>
          <details>
            <summary>Details</summary>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
              Paste a control set exported as CSV - a header row with{" "}
              <code>code</code>, <code>title</code>, and optionally{" "}
              <code>description</code> columns, then one row per control (e.g.
              the AICPA Trust Services Criteria for SOC 2, or NIST CSF
              subcategories). Existing controls with the same code on this
              framework are left untouched, so re-running an updated import is
              safe.
            </p>
          </details>
          <textarea
            value={importCsvText}
            onChange={(e) => setImportCsvText(e.target.value)}
            rows={10}
            placeholder={
              'code,title,description\nCC6.1,Logical access controls,"Restricts access to..."'
            }
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />
          {importResult && (
            <p style={{ color: "var(--frost)", fontSize: 13 }}>
              Imported {importResult.createdCount} control
              {importResult.createdCount === 1 ? "" : "s"}
              {importResult.skippedCount > 0 &&
                ` (${importResult.skippedCount} skipped - already exists on this framework)`}
              .
            </p>
          )}
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => setImportModalOpen(false)}
            >
              Close
            </button>
            <button
              className="btn-primary"
              onClick={importControls}
              disabled={importing || !importCsvText.trim()}
            >
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={controlModalOpen}
        onClose={() => setControlModalOpen(false)}
        title="New control"
      >
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Code{" "}
            <span className="text-muted" style={{ fontSize: 12 }}>
              (e.g. "CC6.1")
            </span>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Title
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              style={{ width: "100%" }}
            />
          </label>
          <label>
            Description{" "}
            <span className="text-muted" style={{ fontSize: 12 }}>
              (optional)
            </span>
            <textarea
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              rows={3}
              style={{ width: "100%" }}
            />
          </label>
          <div
            style={{
              display: "flex",
              gap: 8,
              justifyContent: "flex-end",
              marginTop: 8,
            }}
          >
            <button
              className="btn-secondary"
              onClick={() => setControlModalOpen(false)}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={createControl}
              disabled={savingControl || !newCode.trim() || !newTitle.trim()}
            >
              {savingControl ? "Creating…" : "Create"}
            </button>
          </div>
        </div>
      </Modal>
      </>
      )}
    </div>
  );
}
