"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { trpcReact, useReadOnlySeat } from "@/lib/trpcReact";
import {
  TestCaseTree,
  filterCasesByPath,
  collectKnownSuitePaths,
  UNASSIGNED,
} from "@/components/TestCaseTree";
import { Drawer } from "@/components/Drawer";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";
import { BulkCaseAnalysis } from "@/components/BulkCaseAnalysis";
import { downloadCsv } from "@/lib/csv";
import { caseExportIds, scopeCaseExport, spreadsheetText } from "@/lib/test-case-export";
import { runCaseActionBatches } from "@/lib/case-action-batches";

const TEST_TYPES = [
  "UNIT",
  "FUNCTIONAL",
  "CONTRACT",
  "INSTRUMENTATION",
  "SMOKE",
  "SANITY",
  "REGRESSION",
  "E2E",
  "PERFORMANCE",
  "SECURITY",
  "ACCESSIBILITY",
  "EXPLORATORY",
  "COMPLIANCE",
  "OTHER",
];
const REVIEW_STATUSES = ["APPROVED", "PENDING_REVIEW", "REJECTED"];
const ORIGINS = ["AUTHORED", "AI_REVERSE_ENGINEERED", "IMPORTED"];
const AUTOMATION_STATUSES = [
  "MANUAL",
  "AUTOMATED",
  "PARTIALLY_AUTOMATED",
  "NEEDS_AUTOMATION",
];
const PRIORITIES = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
type CaseSort =
  | "updated"
  | "title"
  | "type"
  | "automation"
  | "risk"
  | "priority"
  | "origin"
  | "review"
  | "suite"
  | "manual";
const PRIORITY_RANK: Record<string, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
};

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
  const setSuiteMutation = trpcReact.testCases.setSuite.useMutation({
    onSuccess: onAssigned,
  });

  function assign() {
    if (!value.trim()) return;
    setSuiteMutation.mutate({ id: caseId, suitePath: value.trim(), expectedSuitePath: null });
  }

  const saving = setSuiteMutation.isPending;

  return (
    <span style={{ display: "inline-flex", gap: 4, marginLeft: 8 }}>
      <input
        list="known-suite-paths"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="assign to suite…"
        style={{ fontSize: 12, padding: "3px 6px", width: 160 }}
      />
      <button
        className="btn-secondary"
        style={{ padding: "3px 8px", fontSize: 12 }}
        onClick={assign}
        disabled={saving || !value.trim()}
      >
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
function QuickAddRow({
  projectId,
  suitePath,
  onAdded,
}: {
  projectId: string;
  suitePath: string | null;
  onAdded: () => void;
}) {
  const [title, setTitle] = useState("");
  const quickCreateMutation = trpcReact.testCases.quickCreate.useMutation({
    onSuccess: () => {
      setTitle("");
      onAdded();
    },
  });

  function submit() {
    if (!title.trim()) return;
    quickCreateMutation.mutate({
      projectId,
      title: title.trim(),
      suitePath: suitePath && suitePath !== UNASSIGNED ? suitePath : undefined,
    });
  }

  const saving = quickCreateMutation.isPending;

  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={
          suitePath && suitePath !== UNASSIGNED
            ? `+ Quick-add a case in ${suitePath}…`
            : "+ Quick-add a case, press Enter…"
        }
        style={{ flex: 1 }}
        disabled={saving}
      />
    </div>
  );
}

// P1-15
export default function TestCasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const utils = trpcReact.useUtils();
  const readOnly = useReadOnlySeat(projectId);

  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const casesQuery = trpcReact.testCases.list.useQuery({
    projectId,
    includeArchived: true,
  });
  const structureQuery = trpcReact.testCaseStructure.list.useQuery({ projectId });
  const moveMutation = trpcReact.testCaseStructure.move.useMutation();
  const viewsQuery = trpcReact.testCaseViews.list.useQuery({ projectId });
  const plansQuery = trpcReact.testPlans.list.useQuery({ projectId });
  const project = projectQuery.data ?? null;
  const cases = casesQuery.data ?? [];
  const placements = useMemo(() => new Map(structureQuery.data?.cases.map(placement => [placement.id, placement]) ?? []), [structureQuery.data]);
  const plans = plansQuery.data ?? [];

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  useEffect(() => { setSelectedPath(new URLSearchParams(window.location.search).get("suite")); }, []);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [automationFilter, setAutomationFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [originFilter, setOriginFilter] = useState("");
  const [sortBy, setSortBy] = useState<CaseSort>("updated");
  const [sortDescending, setSortDescending] = useState(true);
  const [activeViewId, setActiveViewId] = useState("");
  const [newViewName, setNewViewName] = useState("");
  const createView = trpcReact.testCaseViews.create.useMutation();
  const updateView = trpcReact.testCaseViews.update.useMutation();
  const removeView = trpcReact.testCaseViews.remove.useMutation();
  const currentView = viewsQuery.data?.find((view) => view.id === activeViewId);
  const viewFilters = () => ({
    suitePath: selectedPath,
    search: search.trim(),
    type: typeFilter,
    automation: automationFilter,
    priority: priorityFilter,
    review: reviewFilter,
    origin: originFilter,
    sortBy,
    sortDescending,
    showArchived,
  });
  function applyView(id: string) {
    setActiveViewId(id);
    const saved = viewsQuery.data?.find((view) => view.id === id);
    if (!saved) return;
    const filters = saved.filters;
    setSelectedPath(filters.suitePath);
    setSearch(filters.search);
    setTypeFilter(filters.type);
    setAutomationFilter(filters.automation);
    setPriorityFilter(filters.priority);
    setReviewFilter(filters.review);
    setOriginFilter(filters.origin);
    setSortBy(filters.sortBy);
    setSortDescending(filters.sortDescending);
    setShowArchived(filters.showArchived);
  }
  async function saveNewView() {
    if (!newViewName.trim()) return;
    setError(null);
    try {
      const saved = await createView.mutateAsync({ projectId, name: newViewName.trim(), filters: viewFilters() });
      await utils.testCaseViews.list.invalidate({ projectId });
      setActiveViewId(saved.id);
      setNewViewName("");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save view."); }
  }
  async function saveCurrentView() {
    if (!currentView) return;
    setError(null);
    try {
      await updateView.mutateAsync({ projectId, id: currentView.id, name: currentView.name, version: currentView.version, filters: viewFilters() });
      await utils.testCaseViews.list.invalidate({ projectId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update view."); }
  }
  async function deleteCurrentView() {
    if (!currentView || !window.confirm(`Delete your saved view “${currentView.name}”?`)) return;
    setError(null);
    try {
      await removeView.mutateAsync({ projectId, id: currentView.id, version: currentView.version });
      setActiveViewId("");
      await utils.testCaseViews.list.invalidate({ projectId });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not delete view."); }
  }
  function sortColumn(column: CaseSort) {
    setSortDescending(sortBy === column ? !sortDescending : column === "risk" || column === "priority" || column === "updated");
    setSortBy(column);
  }
  const [showArchived, setShowArchived] = useState(false);
  const currentFilters = viewFilters();
  const viewHasChanges = currentView != null && (Object.keys(currentFilters) as (keyof typeof currentFilters)[])
    .some((key) => currentView.filters[key] !== currentFilters[key]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMovePlanId, setBulkMovePlanId] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [exporting, setExporting] = useState(false);

  // What the original load() refetched after every mutation.
  function reload() {
    void utils.testCases.list.invalidate({ projectId, includeArchived: true });
    void utils.testCaseStructure.list.invalidate({ projectId });
    void utils.testPlans.list.invalidate({ projectId });
  }

  useEffect(
    () => setSelected(new Set()),
    [
      selectedPath,
      search,
      typeFilter,
      automationFilter,
      priorityFilter,
      reviewFilter,
      originFilter,
      showArchived,
    ],
  );

  const bulkReviewMutation = trpcReact.testCases.bulkReview.useMutation();
  const bulkDeleteMutation = trpcReact.testCases.bulkDelete.useMutation();
  const bulkArchiveMutation = trpcReact.testCases.bulkArchive.useMutation();
  const bulkMoveMutation = trpcReact.testCases.bulkSetTestPlan.useMutation();
  const bulkTagMutation = trpcReact.testCases.bulkAddTags.useMutation();
  const startRunMutation = trpcReact.manualExecution.start.useMutation();

  const pathFiltered = filterCasesByPath(cases, selectedPath);
  const visibleCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = pathFiltered.filter(
      (tc) =>
        (showArchived || !tc.archived) &&
        (!q ||
          tc.title.toLowerCase().includes(q) ||
          tc.tags.some((t) => t.toLowerCase().includes(q))) &&
        (!typeFilter || tc.testType === typeFilter) &&
        (!automationFilter || tc.automationStatus === automationFilter) &&
        (!priorityFilter || tc.priority === priorityFilter) &&
        (!reviewFilter || tc.reviewStatus === reviewFilter) &&
        (!originFilter || tc.origin === originFilter),
    );
    if (sortBy === "updated") return sortDescending ? filtered : [...filtered].reverse();
    if (sortBy === "manual") return [...filtered].sort((a, b) => {
      const leftSuite = a.suitePath ?? a.sourceFilePath ?? "";
      const rightSuite = b.suitePath ?? b.sourceFilePath ?? "";
      const suiteOrder = leftSuite.localeCompare(rightSuite, undefined, { sensitivity: "base", numeric: true });
      if (suiteOrder) return suiteOrder;
      const positionOrder = (placements.get(a.id)?.sortPosition ?? 0) - (placements.get(b.id)?.sortPosition ?? 0);
      return positionOrder || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
    });
    return [...filtered].sort((a, b) => {
      const direction = sortDescending ? -1 : 1;
      if (sortBy === "risk") return ((a.riskScore ?? -1) - (b.riskScore ?? -1)) * direction;
      if (sortBy === "priority")
        return (
          (PRIORITY_RANK[a.priority] ?? 0) - (PRIORITY_RANK[b.priority] ?? 0)
        ) * direction;
      if (sortBy === "review") return a.reviewStatus.localeCompare(b.reviewStatus) * direction;
      const left =
        sortBy === "title"
          ? a.title
          : sortBy === "type"
            ? a.testType
            : sortBy === "automation"
              ? a.automationStatus
              : sortBy === "origin"
                ? a.origin
                : (a.suitePath ?? "");
      const right =
        sortBy === "title"
          ? b.title
          : sortBy === "type"
            ? b.testType
            : sortBy === "automation"
              ? b.automationStatus
              : sortBy === "origin"
                ? b.origin
                : (b.suitePath ?? "");
      return left.localeCompare(right, undefined, {sensitivity:"base",numeric:true}) * direction;
    });
  }, [
    pathFiltered,
    search,
    typeFilter,
    automationFilter,
    priorityFilter,
    reviewFilter,
    originFilter,
    showArchived,
    sortBy,
    sortDescending,
    placements,
  ]);

  async function moveCase(caseId: string, targetSuitePath: string | null, beforeCaseId: string | null) {
    const placement = placements.get(caseId);
    if (!placement || readOnly) return;
    setError(null);
    try {
      await moveMutation.mutateAsync({
        projectId, caseId,
        expectedSuitePath: placement.suitePath,
        expectedSortPosition: placement.sortPosition,
        targetSuitePath, beforeCaseId,
      });
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not move test case.");
      await structureQuery.refetch();
      await casesQuery.refetch();
    }
  }

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
    setSelected((s) =>
      s.size === visibleCases.length
        ? new Set()
        : new Set(visibleCases.map((tc) => tc.id)),
    );
  }

  async function runBulkAction<T>(execute: (ids: string[]) => Promise<T>) {
    if (bulkBusy || selected.size === 0) return null;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const outcome = await runCaseActionBatches([...selected], execute);
      const completedIds = new Set(outcome.completedIds);
      setSelected(current => new Set([...current].filter(id => !completedIds.has(id))));
      reload();
      if (outcome.error) {
        setBulkError(`${outcome.completedIds.length} cases completed. ${outcome.remainingIds.length} were not confirmed and remain selected. Check their refreshed status before retrying; later batches were not sent.`);
      }
      return outcome;
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkReview(decision: "approve" | "reject") {
    await runBulkAction(ids => bulkReviewMutation.mutateAsync({
      projectId,
      ids,
      decision,
    }));
  }

  async function bulkDelete() {
    if (!confirm(`Delete ${selected.size} test case(s)? This can't be undone.`))
      return;
    const outcome = await runBulkAction(ids => bulkDeleteMutation.mutateAsync({ projectId, ids }));
    if (outcome) {
      const totals = outcome.results.reduce((sum, result) => ({
        deletedCount: sum.deletedCount + result.deletedCount,
        blockedCount: sum.blockedCount + result.blockedCount,
      }), { deletedCount: 0, blockedCount: 0 });
      if (totals.blockedCount > 0) {
        alert(`${totals.deletedCount} deleted, ${totals.blockedCount} couldn't be deleted (linked to compliance controls or risk analysis results).`);
      }
    }
  }

  async function bulkArchive(archived: boolean) {
    await runBulkAction(ids => bulkArchiveMutation.mutateAsync({ projectId, ids, archived }));
  }

  async function bulkMove() {
    const outcome = await runBulkAction(ids => bulkMoveMutation.mutateAsync({
      projectId,
      ids,
      testPlanId: bulkMovePlanId || null,
    }));
    if (outcome && !outcome.error) setBulkMovePlanId("");
  }

  async function bulkAddTag() {
    if (!bulkTag.trim()) return;
    const outcome = await runBulkAction(ids => bulkTagMutation.mutateAsync({
      projectId,
      ids,
      tags: [bulkTag.trim()],
    }));
    if (outcome && !outcome.error) setBulkTag("");
  }

  const selectedExportCount = caseExportIds(visibleCases, selected, "selected").length;
  async function exportCsv(scope: "filtered" | "selected") {
    const ids = caseExportIds(visibleCases, selected, scope);
    if (exporting || ids.length === 0) return;
    setExporting(true);
    setError(null);
    try {
    const available = await utils.testCases.exportCsv.fetch({ projectId, includeArchived: showArchived });
    const rows = scopeCaseExport(available, ids);
    const header = [
      "title",
      "given",
      "when",
      "then",
      "testType",
      "automationStatus",
      "priority",
      "riskScore",
      "riskSeverity",
      "origin",
      "suite",
      "tags",
    ];
    const body = rows.map((r) => [
      r.title,
      r.given.join("|"),
      r.when.join("|"),
      r.then.join("|"),
      r.testType,
      r.automationStatus,
      r.priority,
      r.riskScore == null ? "" : String(r.riskScore),
      r.riskSeverity ?? "",
      r.origin,
      r.suitePath ?? "",
      r.tags.join("|"),
    ]);
    downloadCsv(`${project?.name ?? "test-cases"}-${scope}-${rows.length}.csv`, [header, ...body.map(row => row.map(spreadsheetText))]);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed. Please try again.");
    } finally {
      setExporting(false);
    }
  }

  async function startManualRun() {
    if (selected.size === 0) return;
    try {
      const { testRunId } = await startRunMutation.mutateAsync({
        projectId,
        testCaseIds: [...selected],
      });
      router.push(`/projects/${projectId}/test-runs/manual/${testRunId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const startingRun = startRunMutation.isPending;
  const loading =
    projectQuery.isLoading || casesQuery.isLoading || plansQuery.isLoading;
  const pageError =
    error ??
    projectQuery.error?.message ??
    casesQuery.error?.message ??
    plansQuery.error?.message ??
    null;

  return (
    <div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div>
          <h1 style={{ marginBottom: 2 }}>
            {project ? `${project.name} — Test Cases` : "Test Cases"}
          </h1>
          {project && (
            <p className="text-muted" style={{ margin: 0, fontSize: 13 }}>
              {project.repoUrl ?? "No repo connected"}
            </p>
          )}
        </div>
        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <a
            className="btn-secondary"
            style={{ fontSize: 13 }}
            href={`/projects/${projectId}/test-cases/review`}
          >
            Review queue
          </a>
          <a
            className="btn-secondary"
            style={{ fontSize: 13 }}
            href={`/projects/${projectId}/shared-steps`}
          >
            Shared step libraries
          </a>
          <a
            className="btn-secondary"
            style={{ fontSize: 13 }}
            href={`/projects/${projectId}/exploratory`}
          >
            Exploratory testing
          </a>
          <button
            className="btn-secondary"
            style={{ fontSize: 13 }}
            onClick={() => void exportCsv("filtered")}
            disabled={loading || exporting || visibleCases.length === 0}
          >
            {exporting ? "Exporting…" : `Export filtered CSV (${visibleCases.length})`}
          </button>
          {selectedExportCount > 0 && <button
            className="btn-secondary"
            style={{ fontSize: 13 }}
            onClick={() => void exportCsv("selected")}
            disabled={loading || exporting}
          >Export selected CSV ({selectedExportCount})</button>}
          {!readOnly && (
            <a
              className="btn-secondary"
              style={{ fontSize: 13 }}
              href={`/projects/${projectId}/test-cases/new`}
            >
              Full editor
            </a>
          )}
          {!readOnly && (
            <Link
              className="btn-primary"
              style={{ fontSize: 13 }}
              href={`/projects/${projectId}/import`}
            >
              Smart import
            </Link>
          )}
        </div>
      </div>

      {readOnly && (
        <p className="text-muted" style={{ fontSize: 13 }}>
          You have read-only access to this organization — editing, creating,
          and bulk actions are hidden.
        </p>
      )}

      {loading && <p>Loading…</p>}
      {pageError && <p style={{ color: "var(--ember)" }}>{pageError}</p>}

      {!loading && !pageError && cases.length === 0 && (
        <div className="panel">
          <p style={{ marginBottom: project?.repoUrl ? 12 : 0 }}>
            No test cases tracked for this project yet.
          </p>
          {project?.repoUrl ? (
            <>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Connecting a repo doesn&apos;t scan it automatically —
                reverse-engineer its test files to populate this list.
              </p>
              {!readOnly && (
                <a
                  className="btn-primary"
                  href={`/projects/${projectId}/reverse-engineer`}
                >
                  Scan {project.repoUrl}
                </a>
              )}
            </>
          ) : (
            <p className="text-muted" style={{ fontSize: 13 }}>
              Connect a repo on the{" "}
              <Link href="/projects">project settings</Link> page and scan it,
              or type a title below.
            </p>
          )}
          <div style={{ marginTop: 12 }}>
            <QuickAddRow
              projectId={projectId}
              suitePath={null}
              onAdded={reload}
            />
          </div>
        </div>
      )}

      {!loading && !pageError && cases.length > 0 && (
        <div className="test-case-layout">
          <TestCaseTree
            cases={cases}
            selectedPath={selectedPath}
            onSelect={setSelectedPath}
            onDropCase={readOnly ? undefined : (caseId, suitePath) => void moveCase(caseId, suitePath, null)}
          />
          <div className="test-case-list">
            <QuickAddRow
              projectId={projectId}
              suitePath={selectedPath}
              onAdded={reload}
            />

            <details className="panel" style={{ marginBottom: 12, padding: "10px 12px" }}>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>Saved views {viewsQuery.data?.length ? `(${viewsQuery.data.length})` : ""}</summary>
              <p className="text-muted" style={{ fontSize: 12, margin: "8px 0" }}>Private to you. Save the current suite, filters and sort order for this project.</p>
              {viewsQuery.error && <p role="alert" style={{ color: "var(--ember)" }}>Saved views could not be loaded: {viewsQuery.error.message}</p>}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                <label htmlFor="case-saved-view">View</label>
                <select id="case-saved-view" value={activeViewId} onChange={(event) => applyView(event.target.value)} disabled={viewsQuery.isLoading}>
                  <option value="">Current filters</option>
                  {viewsQuery.data?.map((view) => <option key={view.id} value={view.id}>{view.name}</option>)}
                </select>
                {currentView && <>
                  <span role="status" aria-live="polite" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {viewHasChanges ? "Unsaved filter changes" : "Saved view is up to date"}
                  </span>
                  <button type="button" className="btn-secondary" onClick={() => void saveCurrentView()} disabled={!viewHasChanges || updateView.isPending}>Save changes to {currentView.name}</button>
                  <button type="button" className="btn-secondary" onClick={() => void deleteCurrentView()} disabled={removeView.isPending}>Delete view</button>
                </>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 8 }}>
                <label htmlFor="case-new-view-name">New view</label>
                <input id="case-new-view-name" value={newViewName} onChange={(event) => setNewViewName(event.target.value)} maxLength={80} placeholder="e.g. High-risk regression" />
                <button type="button" className="btn-secondary" onClick={() => void saveNewView()} disabled={!newViewName.trim() || createView.isPending || (viewsQuery.data?.length ?? 0) >= 50}>Save current filters</button>
              </div>
            </details>

            <div
              style={{
                display: "flex",
                gap: 8,
                marginBottom: 10,
                flexWrap: "wrap",
              }}
            >
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                maxLength={160}
                placeholder="Search title or tags…"
                style={{ flex: 1, minWidth: 160 }}
              />
              <select
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              >
                <option value="">All types</option>
                {TEST_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
              <select
                value={automationFilter}
                onChange={(e) => setAutomationFilter(e.target.value)}
              >
                <option value="">All automation</option>
                {AUTOMATION_STATUSES.map((status) => (
                  <option key={status} value={status}>
                    {status.replaceAll("_", " ")}
                  </option>
                ))}
              </select>
              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
              >
                <option value="">All priorities</option>
                {PRIORITIES.map((priority) => (
                  <option key={priority} value={priority}>
                    {priority}
                  </option>
                ))}
              </select>
              <select
                value={reviewFilter}
                onChange={(e) => setReviewFilter(e.target.value)}
              >
                <option value="">All review statuses</option>
                {REVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
              <select
                value={originFilter}
                onChange={(e) => setOriginFilter(e.target.value)}
              >
                <option value="">All origins</option>
                {ORIGINS.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
              <select
                aria-label="Sort test cases"
                value={sortBy}
                onChange={(e) => {const value=e.target.value as CaseSort;setSortBy(value);setSortDescending(["updated","risk","priority"].includes(value));}}
              >
                <option value="updated">Newest activity</option>
                <option value="title">Title A-Z</option>
                <option value="type">Type</option>
                <option value="automation">Automation</option>
                <option value="risk">Risk high-low</option>
                <option value="priority">Priority high-low</option>
                <option value="origin">Origin</option>
                <option value="suite">Suite</option>
                <option value="manual">Manual suite order</option>
                <option value="review">Review</option>
              </select>
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 4,
                  fontSize: 13,
                  color: "var(--muted)",
                }}
              >
                <input
                  type="checkbox"
                  checked={showArchived}
                  onChange={(e) => setShowArchived(e.target.checked)}
                />
                Show archived
              </label>
            </div>

            {readOnly && selected.size > 0 && project && <div className="panel" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginBottom: 10, padding: 10 }}>
              <strong>{selected.size} selected</strong>
              <BulkCaseAnalysis projectId={projectId} organizationId={project.organizationId} selectedIds={[...selected]} onCompleted={reload} />
              <span className="text-muted">You can preview costs and request administrator access, but cannot run AI with this seat.</span>
            </div>}

            {bulkError && <p role="alert" style={{ color: "var(--ember)" }}>{bulkError}</p>}

            {!readOnly && selected.size > 0 && (
              <div
                className="panel"
                style={{
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 10,
                  marginBottom: 10,
                  padding: 10,
                }}
              >
                <strong>{selected.size} selected</strong>
                {project && <BulkCaseAnalysis projectId={projectId} organizationId={project.organizationId} selectedIds={[...selected]} onCompleted={reload} />}
                <button
                  className="btn-primary"
                  onClick={startManualRun}
                  disabled={startingRun}
                >
                  {startingRun ? "Starting…" : "Run manually"}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => bulkReview("approve")}
                  disabled={bulkBusy}
                >
                  Approve
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => bulkReview("reject")}
                  disabled={bulkBusy}
                >
                  Reject
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => bulkArchive(true)}
                  disabled={bulkBusy}
                >
                  Archive
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => bulkArchive(false)}
                  disabled={bulkBusy}
                >
                  Restore
                </button>
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <select
                    value={bulkMovePlanId}
                    onChange={(e) => setBulkMovePlanId(e.target.value)}
                    style={{ fontSize: 13 }}
                  >
                    <option value="">Move to plan…</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <button
                    className="btn-secondary"
                    onClick={bulkMove}
                    disabled={bulkBusy || !bulkMovePlanId}
                    style={{ fontSize: 13 }}
                  >
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
                  <button
                    className="btn-secondary"
                    onClick={bulkAddTag}
                    disabled={bulkBusy || !bulkTag.trim()}
                    style={{ fontSize: 13 }}
                  >
                    Tag
                  </button>
                </span>
                <button
                  className="btn-secondary"
                  onClick={bulkDelete}
                  disabled={bulkBusy}
                  style={{ color: "var(--ember)" }}
                >
                  Delete
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => setSelected(new Set())}
                  disabled={bulkBusy}
                  style={{ marginLeft: "auto" }}
                >
                  Clear
                </button>
              </div>
            )}

            {selectedPath === UNASSIGNED && (
              <p className="text-muted" style={{ fontSize: 13 }}>
                These cases have no suite yet — assign one below, or leave them
                here.
              </p>
            )}

            {visibleCases.length > 0 && (
              <label
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: 12,
                  color: "var(--muted)",
                  marginBottom: 6,
                }}
              >
                <input
                  type="checkbox"
                  checked={selected.size === visibleCases.length}
                  onChange={toggleAllVisible}
                />
                Select all ({visibleCases.length})
              </label>
            )}
            {visibleCases.length > 0 ? (
              <div className="table-scroll test-case-inventory">
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th aria-label="Select" />
                      {([["title","Test case"],["type","Type"],["automation","Automation"],["risk","Risk"],["priority","Priority"],["origin","Origin"],["review","Review"]] as const).map(([key,label]) => <th key={key} scope="col" aria-sort={sortBy === key ? sortDescending ? "descending" : "ascending" : "none"}><button className="member-sort" onClick={() => sortColumn(key)}>{label} {sortBy === key ? sortDescending ? "↓" : "↑" : "↕"}</button></th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleCases.map((tc) => {
                      const riskTone =
                        tc.riskScore == null
                          ? "unscored"
                          : tc.riskScore >= 70
                            ? "high"
                            : tc.riskScore >= 40
                              ? "medium"
                              : "low";
                      return (
                        <tr key={tc.id}
                          onDragOver={(event) => {
                            if (sortBy === "manual" && !readOnly && event.dataTransfer.types.includes("application/x-vaettir-test-case")) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }
                          }}
                          onDrop={(event) => {
                            if (sortBy !== "manual" || readOnly) return;
                            const caseId = event.dataTransfer.getData("application/x-vaettir-test-case");
                            if (!caseId || caseId === tc.id) return;
                            event.preventDefault();
                            // A source-derived group has not been explicitly
                            // curated yet. Assign into it first; row ordering
                            // becomes available once cases have suite paths.
                            void moveCase(caseId, tc.suitePath ?? tc.sourceFilePath ?? null, tc.suitePath ? tc.id : null);
                          }}
                        >
                          <td>
                            {!readOnly && placements.has(tc.id) && <button type="button" draggable aria-label={`Drag ${tc.title} to reorder or move to a suite`}
                              title="Drag to reorder or move to a suite"
                              onDragStart={(event) => { event.dataTransfer.setData("application/x-vaettir-test-case", tc.id); event.dataTransfer.effectAllowed = "move"; }}
                              style={{ marginRight: 6, cursor: "grab" }}>⠿</button>}
                            <input
                              type="checkbox"
                              checked={selected.has(tc.id)}
                              onChange={() => toggle(tc.id)}
                              aria-label={`Select ${tc.title}`}
                            />
                          </td>
                          <td className="test-case-title-cell">
                            <a
                              href={`/projects/${projectId}/test-cases/${tc.id}`}
                              onClick={(e) => {
                                e.preventDefault();
                                setOpenCaseId(tc.id);
                              }}
                            >
                              {tc.title}
                            </a>
                            {!readOnly && sortBy === "manual" && selectedPath !== null && tc.suitePath === selectedPath && <span style={{ display: "inline-flex", gap: 2, marginLeft: 6 }}>
                              <button type="button" aria-label={`Move ${tc.title} up`} disabled={visibleCases.findIndex(item => item.id === tc.id) === 0 || visibleCases[visibleCases.findIndex(item => item.id === tc.id) - 1]?.suitePath !== tc.suitePath || moveMutation.isPending}
                                onClick={() => {
                                  const index = visibleCases.findIndex(item => item.id === tc.id);
                                  const before = visibleCases[index - 1];
                                  if (before) void moveCase(tc.id, before.suitePath ?? before.sourceFilePath ?? null, before.id);
                                }}>↑</button>
                              <button type="button" aria-label={`Move ${tc.title} down`} disabled={visibleCases.findIndex(item => item.id === tc.id) === visibleCases.length - 1 || visibleCases[visibleCases.findIndex(item => item.id === tc.id) + 1]?.suitePath !== tc.suitePath || moveMutation.isPending}
                                onClick={() => {
                                  const index = visibleCases.findIndex(item => item.id === tc.id);
                                  const after = visibleCases[index + 2];
                                  const target = visibleCases[index + 1];
                                  if (target) void moveCase(tc.id, target.suitePath ?? target.sourceFilePath ?? null, after?.id ?? null);
                                }}>↓</button>
                            </span>}
                            {tc.tags.length > 0 && (
                              <small>{tc.tags.slice(0, 3).join(" · ")}</small>
                            )}
                            {selectedPath === UNASSIGNED && (
                              <AssignSuiteControl
                                caseId={tc.id}
                                knownPaths={knownPaths}
                                onAssigned={reload}
                              />
                            )}
                          </td>
                          <td>
                            <span className="status-pill status-info">
                              {tc.testType}
                            </span>
                          </td>
                          <td>{tc.automationStatus.replaceAll("_", " ")}</td>
                          <td>
                            <div
                              className={`case-risk case-risk-${riskTone}`}
                              title={
                                tc.riskScore == null
                                  ? "Risk has not been assessed"
                                  : `${tc.riskSeverity ?? "Risk"}: ${tc.riskScore}/100`
                              }
                            >
                              <span>
                                {tc.riskScore == null
                                  ? "Not assessed"
                                  : `${tc.riskScore}/100`}
                              </span>
                              <i>
                                <b
                                  style={{
                                    width: `${Math.max(tc.riskScore ?? 0, 4)}%`,
                                  }}
                                />
                              </i>
                            </div>
                          </td>
                          <td>{tc.priority}</td>
                          <td>{tc.origin.replaceAll("_", " ")}</td>
                          <td>
                            {tc.reviewStatus.replaceAll("_", " ")}
                            {tc.isFlaky && " · Flaky"}
                            {tc.archived && " · Archived"}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-muted">No test cases match.</p>
            )}
          </div>
        </div>
      )}

      <Drawer open={openCaseId !== null} onClose={() => setOpenCaseId(null)}>
        {openCaseId && (
          <TestCaseDetailContent
            id={openCaseId}
            projectId={projectId}
            onChanged={reload}
            onSuiteSelect={(path) => { setSelectedPath(path); setOpenCaseId(null); }}
            readOnly={readOnly}
          />
        )}
      </Drawer>
    </div>
  );
}
