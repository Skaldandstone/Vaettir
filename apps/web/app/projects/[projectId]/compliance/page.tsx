"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { Modal } from "@/components/Modal";
import { Drawer } from "@/components/Drawer";
import { downloadCsv } from "@/lib/csv";

type ComplianceStarter = {
  key: string;
  name: string;
  version: string;
  summary: string;
  sourceUrl: string;
  controls: { code: string; title: string; description: string }[];
};

const COMPLIANCE_STARTERS: ComplianceStarter[] = [
  {
    key: "nist-csf-2",
    name: "NIST Cybersecurity Framework",
    version: "2.0",
    summary:
      "Six-function cybersecurity risk starter, suitable for building a broad security coverage map.",
    sourceUrl: "https://www.nist.gov/cyberframework",
    controls: [
      {
        code: "GV",
        title: "Govern",
        description:
          "Establish, communicate, and monitor cybersecurity risk strategy, policy, roles, and oversight.",
      },
      {
        code: "ID",
        title: "Identify",
        description:
          "Understand assets, suppliers, vulnerabilities, and cybersecurity risks.",
      },
      {
        code: "PR",
        title: "Protect",
        description:
          "Apply safeguards for identity, data, platforms, awareness, and resilience.",
      },
      {
        code: "DE",
        title: "Detect",
        description:
          "Find and analyze anomalies, indicators, and adverse events.",
      },
      {
        code: "RS",
        title: "Respond",
        description:
          "Manage, communicate, analyze, mitigate, and report detected incidents.",
      },
      {
        code: "RC",
        title: "Recover",
        description:
          "Restore operations, communicate recovery, and incorporate lessons learned.",
      },
    ],
  },
  {
    key: "pci-dss",
    name: "PCI DSS",
    version: "4.0.1",
    summary:
      "The twelve top-level PCI DSS requirements for payment-card security coverage planning.",
    sourceUrl: "https://www.pcisecuritystandards.org/standards/pci-dss/",
    controls: [
      {
        code: "1",
        title: "Network security controls",
        description:
          "Install and maintain controls that protect cardholder data environments.",
      },
      {
        code: "2",
        title: "Secure configurations",
        description: "Apply secure configurations to all system components.",
      },
      {
        code: "3",
        title: "Protect stored account data",
        description:
          "Protect stored payment account data throughout its lifecycle.",
      },
      {
        code: "4",
        title: "Protect data in transit",
        description:
          "Use strong cryptography when transmitting cardholder data over open networks.",
      },
      {
        code: "5",
        title: "Protect against malicious software",
        description: "Protect systems and networks from malware.",
      },
      {
        code: "6",
        title: "Develop secure systems and software",
        description:
          "Maintain secure development and vulnerability-management practices.",
      },
      {
        code: "7",
        title: "Restrict access by business need",
        description: "Limit access to system components and cardholder data.",
      },
      {
        code: "8",
        title: "Identify users and authenticate access",
        description: "Use unique identities and strong authentication.",
      },
      {
        code: "9",
        title: "Restrict physical access",
        description: "Protect physical access to cardholder data.",
      },
      {
        code: "10",
        title: "Log and monitor access",
        description:
          "Record and monitor access to systems and cardholder data.",
      },
      {
        code: "11",
        title: "Test security regularly",
        description:
          "Regularly test systems, networks, and security processes.",
      },
      {
        code: "12",
        title: "Support security with policy",
        description:
          "Maintain organizational policies and programs for information security.",
      },
    ],
  },
  {
    key: "hipaa",
    name: "HIPAA Security Rule",
    version: "45 CFR Part 164",
    summary:
      "Security Rule safeguard groups for systems that handle electronic protected health information.",
    sourceUrl:
      "https://www.hhs.gov/hipaa/for-professionals/security/index.html",
    controls: [
      {
        code: "164.308",
        title: "Administrative safeguards",
        description:
          "Risk analysis, workforce security, incident procedures, contingency planning, and evaluation.",
      },
      {
        code: "164.310",
        title: "Physical safeguards",
        description:
          "Facility access, workstation use and security, and device or media controls.",
      },
      {
        code: "164.312",
        title: "Technical safeguards",
        description:
          "Access, audit, integrity, authentication, and transmission protections.",
      },
      {
        code: "164.314",
        title: "Organizational requirements",
        description:
          "Business associate and group health plan security arrangements.",
      },
      {
        code: "164.316",
        title: "Policies and documentation",
        description:
          "Maintain required security policies, procedures, and documentation.",
      },
    ],
  },
  {
    key: "gdpr",
    name: "GDPR engineering starter",
    version: "Selected articles",
    summary:
      "Selected GDPR obligations that commonly need product and engineering evidence. Not a complete legal checklist.",
    sourceUrl: "https://eur-lex.europa.eu/eli/reg/2016/679/oj",
    controls: [
      {
        code: "Art. 5",
        title: "Data-processing principles",
        description:
          "Test lawfulness, purpose limitation, minimization, accuracy, retention, and security behaviors.",
      },
      {
        code: "Art. 25",
        title: "Data protection by design and default",
        description:
          "Verify privacy-protective defaults and implementation safeguards.",
      },
      {
        code: "Art. 30",
        title: "Records of processing",
        description:
          "Maintain evidence supporting records of processing activities.",
      },
      {
        code: "Art. 32",
        title: "Security of processing",
        description:
          "Test appropriate technical and organizational security measures.",
      },
      {
        code: "Art. 33",
        title: "Breach notification readiness",
        description:
          "Exercise detection, assessment, escalation, and notification workflows.",
      },
      {
        code: "Art. 35",
        title: "Impact assessment readiness",
        description:
          "Support risk and impact assessments for high-risk processing.",
      },
    ],
  },
  {
    key: "iso27001",
    name: "ISO/IEC 27001 readiness",
    version: "2022 themes",
    summary:
      "Annex A theme-level planning prompts. Use a licensed copy of the standard for formal certification work.",
    sourceUrl: "https://www.iso.org/standard/27001",
    controls: [
      {
        code: "A.5",
        title: "Organizational controls",
        description:
          "Plan evidence for security governance, asset management, suppliers, incidents, continuity, and compliance.",
      },
      {
        code: "A.6",
        title: "People controls",
        description:
          "Plan evidence for screening, responsibilities, awareness, remote work, and event reporting.",
      },
      {
        code: "A.7",
        title: "Physical controls",
        description:
          "Plan evidence for physical perimeters, access, monitoring, equipment, media, and utilities.",
      },
      {
        code: "A.8",
        title: "Technological controls",
        description:
          "Plan evidence for identity, access, endpoints, cryptography, operations, networks, development, and monitoring.",
      },
    ],
  },
];

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
          <p className="text-muted" style={{ fontSize: 12, marginTop: -4 }}>
            Ask another Compliance Auditor (or Admin/Owner) to sign off - they
            get a push notification on the mobile app, and it's automatically
            marked done the moment they actually sign off for this same period.
          </p>
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
                  {m.userName ?? m.userEmail} ({m.role})
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
  projectId,
  control,
  onChanged,
  readOnly = false,
  canSignOff = false,
}: {
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
        borderBottom: "1px solid var(--line)",
        padding: "8px 0",
      }}
    >
      <div>
        <strong>{control.code}</strong> {control.title}
        {control.description && (
          <div className="text-muted" style={{ fontSize: 12 }}>
            {control.description}
          </div>
        )}
      </div>
      <div
        style={{ display: "flex", alignItems: "center", gap: 8, flexShrink: 0 }}
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
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                style={{ fontSize: 12 }}
              >
                <option value="">Pick a test case…</option>
                {candidates.map((tc) => (
                  <option key={tc.id} value={tc.id}>
                    {tc.title}
                  </option>
                ))}
              </select>
              <button
                className="btn-secondary"
                style={{ fontSize: 12 }}
                onClick={map}
                disabled={busy || !selected}
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
            <button
              className="btn-secondary"
              style={{ fontSize: 12 }}
              onClick={() => setPicking(true)}
            >
              + Map a test case
            </button>
          ))}
        <button
          className="btn-secondary"
          style={{ fontSize: 12 }}
          onClick={() => setDrawerOpen(true)}
        >
          Evidence & sign-off
        </button>
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
  const { canEdit, canSignOff } = useProjectPermissions(projectId);
  const readOnly = !canEdit;

  const frameworksQuery = trpcReact.compliance.listFrameworks.useQuery();
  const frameworks = frameworksQuery.data ?? [];
  const [selectedFrameworkId, setSelectedFrameworkId] = useState<string | null>(
    null,
  );
  useEffect(() => {
    if (!selectedFrameworkId && frameworks[0])
      setSelectedFrameworkId(frameworks[0].id);
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
  const [starterKey, setStarterKey] = useState(COMPLIANCE_STARTERS[0]!.key);
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

  async function loadStarterFramework() {
    const starter = COMPLIANCE_STARTERS.find(
      (candidate) => candidate.key === starterKey,
    );
    if (!starter) return;
    setError(null);
    try {
      const existingFramework = frameworks.find(
        (candidate) => candidate.key === starter.key,
      );
      let frameworkId = existingFramework?.id;
      if (!frameworkId) {
        const created = await createFrameworkMutation.mutateAsync({
          key: starter.key,
          name: starter.name,
          version: starter.version,
          description: `${starter.summary} Source: ${starter.sourceUrl}`,
        });
        frameworkId = created.id;
      }
      await importControlsMutation.mutateAsync({
        frameworkId,
        controls: starter.controls,
      });
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
    createFrameworkMutation.isPending || importControlsMutation.isPending;
  const savingControl = createControlMutation.isPending;
  const importing = importControlsMutation.isPending;

  const selectedFramework = frameworks.find(
    (f) => f.id === selectedFrameworkId,
  );
  const gapCount = controls.filter((c) => c.mappedTestCaseCount === 0).length;

  return (
    <div style={{ maxWidth: 800 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ margin: 0 }}>Compliance</h1>
        {!readOnly && (
          <button
            className="btn-primary"
            onClick={() => setFrameworkModalOpen(true)}
          >
            + New framework
          </button>
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
        <div
          style={{
            display: "flex",
            gap: 8,
            marginBottom: 16,
            flexWrap: "wrap",
          }}
        >
          {frameworks.map((f) => (
            <button
              key={f.id}
              className={
                f.id === selectedFrameworkId ? "btn-primary" : "btn-secondary"
              }
              style={{ fontSize: 13 }}
              onClick={() => setSelectedFrameworkId(f.id)}
            >
              {f.name}
              {f.version && ` (${f.version})`} — {f.controlCount} control
              {f.controlCount === 1 ? "" : "s"}
              {!f.isBuiltIn && " · custom"}
            </button>
          ))}
        </div>
      )}

      {selectedFramework && (
        <div className="panel">
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
            }}
          >
            <h2 style={{ marginTop: 0 }}>{selectedFramework.name}</h2>
            <div style={{ display: "flex", gap: 8 }}>
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
                    onClick={() => {
                      setImportResult(null);
                      setImportModalOpen(true);
                    }}
                  >
                    Import controls
                  </button>
                  <button
                    className="btn-secondary"
                    style={{ fontSize: 13 }}
                    onClick={() => setControlModalOpen(true)}
                  >
                    + Add control
                  </button>
                </>
              )}
            </div>
          </div>
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
            <button
              className="btn-primary"
              onClick={() => {
                setFrameworkMode("starter");
                setFrameworkModalOpen(true);
              }}
            >
              Browse framework starters
            </button>
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
            <button
              className={
                frameworkMode === "starter" ? "btn-primary" : "btn-secondary"
              }
              onClick={() => setFrameworkMode("starter")}
            >
              Use a starter
            </button>
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
              <label>
                Framework
                <select
                  value={starterKey}
                  onChange={(event) => setStarterKey(event.target.value)}
                >
                  {COMPLIANCE_STARTERS.map((starter) => (
                    <option key={starter.key} value={starter.key}>
                      {starter.name} · {starter.version}
                    </option>
                  ))}
                </select>
              </label>
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
                <button
                  className="btn-primary"
                  onClick={loadStarterFramework}
                  disabled={savingFramework}
                >
                  {savingFramework ? "Loading…" : "Load starter controls"}
                </button>
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
          <p className="text-muted" style={{ fontSize: 12, marginTop: 0 }}>
            Paste a control set exported as CSV - a header row with{" "}
            <code>code</code>, <code>title</code>, and optionally{" "}
            <code>description</code> columns, then one row per control (e.g. the
            AICPA Trust Services Criteria for SOC 2, or NIST CSF subcategories).
            Existing controls with the same code on this framework are left
            untouched, so re-running an updated import is safe.
          </p>
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
    </div>
  );
}
