"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { TestCaseTree, filterCasesByPath, collectKnownSuitePaths, UNASSIGNED } from "@/components/TestCaseTree";
import { Drawer } from "@/components/Drawer";
import { Modal } from "@/components/Modal";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";
import { isReadOnlySeat } from "@/lib/membership";

type Case = RouterOutputs["testCases"]["list"][number];

const TEST_TYPES = [
  "UNIT", "FUNCTIONAL", "CONTRACT", "INSTRUMENTATION", "SMOKE", "SANITY",
  "REGRESSION", "E2E", "PERFORMANCE", "SECURITY", "ACCESSIBILITY",
  "EXPLORATORY", "COMPLIANCE", "OTHER",
];
const REVIEW_STATUSES = ["APPROVED", "PENDING_REVIEW", "REJECTED"];
const ORIGINS = ["AUTHORED", "AI_REVERSE_ENGINEERED", "IMPORTED"];

function AssignSuiteControl({
  caseId,
  knownPaths,
  onAssigned,
}: {
  caseId: string;
  knownPaths: string[];
  onAssigned: () => void;
}) {
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);

  async function assign() {
    if (!value.trim()) return;
    setSaving(true);
    try {
      await trpc.testCases.setSuite.mutate({ id: caseId, suitePath: value.trim() });
      onAssigned();
    } finally {
      setSaving(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}>
      <input
        list="known-suite-paths"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="assign to suite…"
        style={{ fontSize: 12, padding: "3px 6px", width: 160 }}
      />
      <button className="btn-secondary" style={{ padding: "3px 8px", fontSize: 12 }} onClick={assign} disabled={saving || !value.trim()}>
        {saving ? "…" : "Assign"}
      </button>
      <datalist id="known-suite-paths">
        {knownPaths.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
    </span>
  );
}

// TestRail/Qase both let you type a title and hit Enter right in the
// list/tree to capture a test idea instantly -- no modal, no page nav. This
// mirrors that: the full "+ New test case" form is still there for anyone
// who wants to fill in given/when/then up front, but it's the secondary
// path now, not the only one.
function QuickAddRow({ projectId, suitePath, onAdded }: { projectId: string; suitePath: string | null; onAdded: () => void }) {
  const [title, setTitle] = useState("");
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await trpc.testCases.quickCreate.mutate({
        projectId,
        title: title.trim(),
        suitePath: suitePath && suitePath !== UNASSIGNED ? suitePath : undefined,
      });
      setTitle("");
      onAdded();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={suitePath && suitePath !== UNASSIGNED ? `+ Quick-add a case in ${suitePath}…` : "+ Quick-add a case, press Enter…"}
        style={{ flex: 1 }}
        disabled={saving}
      />
    </div>
  );
}

export default function TestCasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [project, setProject] = useState<RouterOutputs["project"]["byId"] | null>(null);
  const [readOnly, setReadOnly] = useState(false);
  const [cases, setCases] = useState<RouterOutputs["testCases"]["list"]>([]);
  const [plans, setPlans] = useState<RouterOutputs["testPlans"]["list"]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMovePlanId, setBulkMovePlanId] = useState("");
  const [bulkTag, setBulkTag] = useState("");

  const [importOpen, setImportOpen] = useState(false);
  const [importCsvText, setImportCsvText] = useState("");
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importResult, setImportResult] = useState<{ createdCount: number; skipped: { rowNumber: number; reason: string }[] } | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([
      trpc.project.byId.query({ id: projectId }),
      trpc.testCases.list.query({ projectId, includeArchived: true }),
      trpc.testPlans.list.query({ projectId }),
      trpc.organization.mine.query(),
    ])
      .then(([proj, list, planList, orgs]) => {
        setProject(proj);
        setCases(list);
        setPlans(planList);
        const org = orgs.find((o) => o.id === proj.organizationId);
        setReadOnly(isReadOnlySeat(org?.seatType));
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);
  useEffect(() => setSelected(new Set()), [selectedPath, search, typeFilter, reviewFilter, originFilter, showArchived]);

  async function importCsv() {
    if (!importCsvText.trim()) return;
    setImporting(true);
    setImportError(null);
    setImportResult(null);
    try {
      const result = await trpc.testCases.importCsv.mutate({ projectId, csvText: importCsvText });
      setImportResult(result);
      setImportCsvText("");
      load();
    } catch (e) {
      setImportError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(false);
    }
  }

  const pathFiltered = filterCasesByPath(cases, selectedPath);
  const visibleCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    return pathFiltered.filter(
      (tc) =>
        (showArchived || !tc.archived) &&
        (!q || tc.title.toLowerCase().includes(q) || tc.tags.some((t) => t.toLowerCase().includes(q))) &&
        (!typeFilter || tc.testType === typeFilter) &&
        (!reviewFilter || tc.reviewStatus === reviewFilter) &&
        (!originFilter || tc.origin === originFilter),
    );
  }, [pathFiltered, search, typeFilter, reviewFilter, originFilter, showArchived]);

  const knownPaths = collectKnownSuitePaths(cases);

  function toggle(id: string) {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAllVisible() {
    setSelected((s) => (s.size === visibleCases.length ? new Set() : new Set(visibleCases.map((tc) => tc.id))));
  }

  async function bulkReview(decision: "approve" | "reject") {
    setBulkBusy(true);
    try {
      await trpc.testCases.bulkReview.mutate({ projectId, ids: [...selected], decision });
      setSelected(new Set());
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} test case(s)? This can't be undone.`)) return;
    setBulkBusy(true);
    try {
      const res = await trpc.testCases.bulkDelete.mutate({ projectId, ids: [...selected] });
      setSelected(new Set());
      load();
      if (res.blockedCount > 0) {
        alert(`${res.deletedCount} deleted, ${res.blockedCount} couldn't be deleted (linked to compliance controls or risk analysis results).`);
      }
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkArchive(archived: boolean) {
    setBulkBusy(true);
    try {
      await trpc.testCases.bulkArchive.mutate({ projectId, ids: [...selected], archived });
      setSelected(new Set());
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkMove() {
    setBulkBusy(true);
    try {
      await trpc.testCases.bulkSetTestPlan.mutate({ projectId, ids: [...selected], testPlanId: bulkMovePlanId || null });
      setBulkMovePlanId("");
      setSelected(new Set());
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkAddTag() {
    if (!bulkTag.trim()) return;
    setBulkBusy(true);
    try {
      await trpc.testCases.bulkAddTags.mutate({ projectId, ids: [...selected], tags: [bulkTag.trim()] });
      setBulkTag("");
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div>
          <h1 style={{ marginBottom: 2 }}>{project ? `${project.name} — Test Cases` : "Test Cases"}</h1>
          {project && (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              {project.repoUrl ?? "No repo connected"}
            </p>
          )}
        </div>
        <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
          <a href={`/projects/${projectId}/test-cases/review`}>Review queue</a>
          {!readOnly && <a href={`/projects/${projectId}/test-cases/new`}>Full editor</a>}
          {!readOnly && (
            <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setImportOpen(true)}>
              Import CSV
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — editing, creating, and bulk actions are hidden.
        </p>
      )}

      <Modal open={importOpen} onClose={() => setImportOpen(false)} title="Import test cases from CSV">
        <div style={{ display: "grid", gap: 10 }}>
          <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
            Header row with <code>title</code>, <code>given</code>, <code>when</code>, <code>then</code>, and optionally{" "}
            <code>priority</code>/<code>tags</code>. For multiple steps in one cell, separate them with <code>|</code>.
          </p>
          <textarea
            value={importCsvText}
            onChange={(e) => setImportCsvText(e.target.value)}
            placeholder={'title,given,when,then,priority,tags\n"Login succeeds","a registered user","valid credentials submitted","dashboard is shown",HIGH,"auth|smoke"'}
            rows={8}
            style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
          />
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button className="btn-secondary" onClick={() => setImportOpen(false)}>
              Close
            </button>
            <button className="btn-primary" onClick={importCsv} disabled={importing || !importCsvText.trim()}>
              {importing ? "Importing…" : "Import"}
            </button>
          </div>
          {importError && <p style={{ color: "var(--ember)" }}>{importError}</p>}
          {importResult && (
            <div className="panel">
              <p style={{ margin: 0 }}>Imported {importResult.createdCount} test case(s).</p>
              {importResult.skipped.length > 0 && (
                <>
                  <p className="text-muted" style={{ marginBottom: 4 }}>
                    Skipped {importResult.skipped.length} row(s):
                  </p>
                  <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12 }}>
                    {importResult.skipped.map((s) => (
                      <li key={s.rowNumber}>
                        Row {s.rowNumber}: {s.reason}
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          )}
        </div>
      </Modal>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {!loading && !error && cases.length === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project?.repoUrl ? 12 : 0 }}>No test cases tracked for this project yet.</p>
          {project?.repoUrl ? (
            <>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Connecting a repo doesn&apos;t scan it automatically — reverse-engineer its test files to populate this
                list.
              </p>
              {!readOnly && (
                <a className="btn-primary" href={`/projects/${projectId}/reverse-engineer`}>
                  Scan {project.repoUrl}
                </a>
              )}
            </>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Connect a repo on the <a href="/projects">project settings</a> page and scan it, or type a title below.
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <QuickAddRow projectId={projectId} suitePath={null} onAdded={load} />
          </div>
        </div>
      )}

      {!loading && !error && cases.length > 0 && (
        <div className="test-case-layout">
          <TestCaseTree cases={cases} selectedPath={selectedPath} onSelect={setSelectedPath} />
          <div className="test-case-list">
            <QuickAddRow projectId={projectId} suitePath={selectedPath} onAdded={load} />

            <div style={{ display: "flex", gap: 8, marginBottom: 10, flexWrap: "wrap" }}>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search title or tags…"
                style={{ flex: 1, minWidth: 160 }}
              />
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="">All types</option>
                {TEST_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <select value={reviewFilter} onChange={(e) => setReviewFilter(e.target.value)}>
                <option value="">All review statuses</option>
                {REVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>{s}</option>
                ))}
              </select>
              <select value={originFilter} onChange={(e) => setOriginFilter(e.target.value)}>
                <option value="">All origins</option>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>{o}</option>
                ))}
              </select>
              <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 13, color: "var(--muted)" }}>
                <input type="checkbox" checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
                Show archived
              </label>
            </div>

            {!readOnly && selected.size > 0 && (
              <div className="panel" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10, padding: 10 }}>
                <strong>{selected.size} selected</strong>
                <button className="btn-secondary" onClick={() => bulkReview("approve")} disabled={bulkBusy}>
                  Approve
                </button>
                <button className="btn-secondary" onClick={() => bulkReview("reject")} disabled={bulkBusy}>
                  Reject
                </button>
                <button className="btn-secondary" onClick={() => bulkArchive(true)} disabled={bulkBusy}>
                  Archive
                </button>
                <button className="btn-secondary" onClick={() => bulkArchive(false)} disabled={bulkBusy}>
                  Restore
                </button>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <select value={bulkMovePlanId} onChange={(e) => setBulkMovePlanId(e.target.value)} style={{ fontSize: 13 }}>
                    <option value="">Move to plan…</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                  <button className="btn-secondary" onClick={bulkMove} disabled={bulkBusy || !bulkMovePlanId} style={{ fontSize: 13 }}>
                    Move
                  </button>
                </span>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <input
                    value={bulkTag}
                    onChange={(e) => setBulkTag(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && bulkAddTag()}
                    placeholder="add tag…"
                    style={{ fontSize: 13, width: 100 }}
                  />
                  <button className="btn-secondary" onClick={bulkAddTag} disabled={bulkBusy || !bulkTag.trim()} style={{ fontSize: 13 }}>
                    Tag
                  </button>
                </span>
                <button className="btn-secondary" onClick={bulkDelete} disabled={bulkBusy} style={{ color: "var(--ember)" }}>
                  Delete
                </button>
                <button className="btn-secondary" onClick={() => setSelected(new Set())} disabled={bulkBusy} style={{ marginLeft: "auto" }}>
                  Clear
                </button>
              </div>
            )}

            {selectedPath === UNASSIGNED && (
              <p className="text-muted" style={{ fontSize: 13 }}>
                These cases have no suite yet — assign one below, or leave them here.
              </p>
            )}

            {visibleCases.length > 0 && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--muted)", marginBottom: 6 }}>
                <input type="checkbox" checked={selected.size === visibleCases.length} onChange={toggleAllVisible} />
                Select all ({visibleCases.length})
              </label>
            )}
            <ul style={{ listStyle: "none", padding: 0 }}>
              {visibleCases.map((tc) => (
                <li key={tc.id} style={{ display: "flex", alignItems: "flex-start", gap: 8, padding: "3px 0" }}>
                  <input type="checkbox" checked={selected.has(tc.id)} onChange={() => toggle(tc.id)} style={{ marginTop: 4 }} />
                  <div>
                    <a
                      href={`/projects/${projectId}/test-cases/${tc.id}`}
                      onClick={(e) => {
                        e.preventDefault();
                        setOpenCaseId(tc.id);
                      }}
                    >
                      {tc.title}
                    </a>{" "}
                    <small>
                      [{tc.testType}] {tc.origin === "AI_REVERSE_ENGINEERED" ? "🤖 AI-reversed" : ""}
                      {tc.reviewStatus === "PENDING_REVIEW" && " ⏳ pending review"}
                      {tc.reviewStatus === "REJECTED" && " ❌ rejected"}
                      {tc.isFlaky && " 🎲 flaky"}
                      {tc.archived && " · archived"}
                    </small>
                    {selectedPath === UNASSIGNED && (
                      <AssignSuiteControl caseId={tc.id} knownPaths={knownPaths} onAssigned={load} />
                    )}
                  </div>
                </li>
              ))}
              {visibleCases.length === 0 && <p className="text-muted">No test cases match.</p>}
            </ul>
          </div>
        </div>
      )}

      <Drawer open={openCaseId !== null} onClose={() => setOpenCaseId(null)}>
        {openCaseId && <TestCaseDetailContent id={openCaseId} projectId={projectId} onChanged={load} readOnly={readOnly} />}
      </Drawer>
    </div>
  );
}
