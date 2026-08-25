"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { TestCaseTree, filterCasesByPath, collectKnownSuitePaths, UNASSIGNED } from "@/components/TestCaseTree";
import { Drawer } from "@/components/Drawer";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";

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
  const [cases, setCases] = useState<RouterOutputs["testCases"]["list"]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  function load() {
    setLoading(true);
    setError(null);
    Promise.all([trpc.project.byId.query({ id: projectId }), trpc.testCases.list.query({ projectId })])
      .then(([proj, list]) => {
        setProject(proj);
        setCases(list);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId]);

  const visibleCases = filterCasesByPath(cases, selectedPath);
  const knownPaths = collectKnownSuitePaths(cases);

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
        <div style={{ display: "flex", gap: 16 }}>
          <a href={`/projects/${projectId}/test-cases/review`}>Review queue</a>
          <a href={`/projects/${projectId}/test-cases/new`}>Full editor</a>
        </div>
      </div>

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
              <a className="btn-primary" href={`/projects/${projectId}/reverse-engineer`}>
                Scan {project.repoUrl}
              </a>
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
            {selectedPath === UNASSIGNED && (
              <p className="text-muted" style={{ fontSize: 13 }}>
                These cases have no suite yet — assign one below, or leave them here.
              </p>
            )}
            <ul>
              {visibleCases.map((tc) => (
                <li key={tc.id}>
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
                  </small>
                  {selectedPath === UNASSIGNED && (
                    <AssignSuiteControl caseId={tc.id} knownPaths={knownPaths} onAssigned={load} />
                  )}
                </li>
              ))}
              {visibleCases.length === 0 && <p className="text-muted">No test cases in this folder.</p>}
            </ul>
          </div>
        </div>
      )}

      <Drawer open={openCaseId !== null} onClose={() => setOpenCaseId(null)}>
        {openCaseId && <TestCaseDetailContent id={openCaseId} projectId={projectId} onChanged={load} />}
      </Drawer>
    </div>
  );
}
