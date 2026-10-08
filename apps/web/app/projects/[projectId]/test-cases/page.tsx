"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useAuth } from "@clerk/nextjs";
import { useParams, useRouter } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import {
  TestCaseTree,
  filterCasesByPath,
  collectKnownSuitePaths,
  UNASSIGNED,
} from "@/components/TestCaseTree";
import { Drawer } from "@/components/Drawer";
import { TestCaseDetailContent } from "@/components/TestCaseDetailContent";
import { BulkCaseAnalysis } from "@/components/BulkCaseAnalysis";
import { DurableCaseAnalysis } from "@/components/DurableCaseAnalysis";
import { CaseQueryExplorer } from "@/components/CaseQueryExplorer";
import { TestCaseFolders } from "@/components/TestCaseFolders";
import { TestCaseProcedureReimport } from "@/components/TestCaseProcedureReimport";
import { ProjectCaseFields } from "@/components/ProjectCaseFields";
import {
  CaseAuthoringPresets,
  NewCaseFromAuthoringPreset,
} from "@/components/CaseAuthoringPresets";
import { downloadCsv } from "@/lib/csv";
import { downloadFile } from "@/lib/download";
import { projectTagHref, projectTagLabel, matchesExactTag } from "@/lib/project-tag-navigation";
import { encodeCaseProcedureExport } from "@vaettir/core";
import {
  caseExportIds,
  scopeCaseExport,
  spreadsheetText,
} from "@/lib/test-case-export";
import { runCaseActionBatches } from "@/lib/case-action-batches";
import {
  RunConfigurationModal,
} from "@/components/RunConfigurationModal";
import type { ReviewedRunStartEnvelope } from "@/lib/run-start-reviewed-write";
import { Modal } from "@/components/Modal";
import { PageHeading } from "@/components/ui/Workspace";
import { caseLabel, suiteChoices } from "@/lib/case-workbench";
import {
  repositoryReviewStatus,
  rowDropTarget,
  sameSuiteAfterAnchor,
  unmodifiedCaseClick,
} from "@/lib/case-repository";
import styles from "@/components/CaseWorkbench.module.css";
import { supportedCaseFolderPath, type CaseFolderCatalog, type FolderReviewIntent } from "@/lib/case-folder-tree";

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
const ignoreFolderPaths = () => undefined;

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
    setSuiteMutation.mutate({
      id: caseId,
      suitePath: value.trim(),
      expectedSuitePath: null,
    });
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
    if (quickCreateMutation.isPending || !title.trim()) return;
    quickCreateMutation.mutate({
      projectId,
      title: title.trim(),
      suitePath: suitePath && suitePath !== UNASSIGNED ? suitePath : undefined,
    });
  }

  const saving = quickCreateMutation.isPending;

  return (
    <div
      style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}
    >
      <input
        value={title}
        aria-label="New test case title"
        maxLength={500}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder={
          suitePath && suitePath !== UNASSIGNED
            ? `+ Quick-add a case in ${suitePath}…`
            : "+ Quick-add a case, press Enter…"
        }
        style={{ flex: 1, minWidth: 0 }}
        disabled={saving}
      />
      <button
        className="btn-primary"
        disabled={saving || !title.trim()}
        onClick={submit}
      >
        {saving ? "Adding…" : "Add"}
      </button>
      {quickCreateMutation.error && (
        <p role="alert" style={{ width: "100%", overflowWrap: "anywhere" }}>
          {quickCreateMutation.error.message}
        </p>
      )}
    </div>
  );
}

// P1-15
export default function TestCasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const router = useRouter();
  const utils = trpcReact.useUtils();
  const permissions = useProjectPermissions(projectId);
  const folderActor = useAuth();
  const readOnly = !permissions.canEdit || Boolean(permissions.accessError);
  const [runConfigurationOpen, setRunConfigurationOpen] = useState(false);
  const [runSelection, setRunSelection] = useState<string[]>([]);

  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const casesQuery = trpcReact.testCases.list.useQuery({
    projectId,
    includeArchived: true,
  });
  const structureQuery = trpcReact.testCaseStructure.list.useQuery({
    projectId,
  });
  const moveMutation = trpcReact.testCaseStructure.move.useMutation();
  const viewsQuery = trpcReact.testCaseViews.list.useQuery({ projectId });
  const plansQuery = trpcReact.testPlans.list.useQuery({ projectId });
  const project = projectQuery.data ?? null;
  const cases = useMemo(() => casesQuery.data ?? [], [casesQuery.data]);
  const placements = useMemo(
    () =>
      new Map(
        structureQuery.data?.cases.map((placement) => [
          placement.id,
          placement,
        ]) ?? [],
      ),
    [structureQuery.data],
  );
  const plans = plansQuery.data ?? [];

  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  // Read the shared query directly rather than feeding child layout effects
  // back into parent state. Two observers can replace/refetch the same result;
  // that must not drive a circular parent/child commit loop.
  const folderCatalogQuery = trpcReact.caseFolders.list.useQuery(
    { projectId },
    { enabled: folderActor.isLoaded && folderActor.isSignedIn && permissions.loaded && !permissions.accessError, retry: false, staleTime: 0, refetchOnMount: "always" },
  );
  const folderCatalog: CaseFolderCatalog | null = folderCatalogQuery.isFetchedAfterMount && !folderCatalogQuery.isError && folderCatalogQuery.fetchStatus === "idle" ? folderCatalogQuery.data ?? null : null;
  const [folderReviewIntent, setFolderReviewIntent] = useState<FolderReviewIntent | null>(null);
  const currentFolderCatalog = folderActor.isLoaded && folderActor.isSignedIn && permissions.loaded && !permissions.accessError && folderCatalog?.projectId === projectId && folderCatalog.organizationId === permissions.organizationId && folderCatalog.clerkActorId === folderActor.userId ? folderCatalog : null;
  const folderPaths = currentFolderCatalog?.paths ?? [];
  useEffect(() => {
    setSelectedPath(new URLSearchParams(window.location.search).get("suite"));
  }, []);
  const [openCaseId, setOpenCaseId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [search, setSearch] = useState("");
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [automationFilter, setAutomationFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [reviewFilter, setReviewFilter] = useState("APPROVED");
  useEffect(() => {
    const parameters = new URLSearchParams(window.location.search);
    setTagFilter(parameters.get("tag"));
    if (parameters.get("review") === "pending")
      setReviewFilter("PENDING_REVIEW");
    else if (parameters.get("review") === "rejected")
      setReviewFilter("REJECTED");
  }, []);
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
    setReviewFilter(repositoryReviewStatus(filters.review));
    setTagFilter(null);
    setOriginFilter(filters.origin);
    setSortBy(filters.sortBy);
    setSortDescending(filters.sortDescending);
    setShowArchived(filters.showArchived);
  }
  async function saveNewView() {
    if (!newViewName.trim()) return;
    setError(null);
    try {
      const saved = await createView.mutateAsync({
        projectId,
        name: newViewName.trim(),
        filters: viewFilters(),
      });
      await utils.testCaseViews.list.invalidate({ projectId });
      setActiveViewId(saved.id);
      setNewViewName("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save view.");
    }
  }
  async function saveCurrentView() {
    if (!currentView) return;
    setError(null);
    try {
      await updateView.mutateAsync({
        projectId,
        id: currentView.id,
        name: currentView.name,
        version: currentView.version,
        filters: viewFilters(),
      });
      await utils.testCaseViews.list.invalidate({ projectId });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update view.",
      );
    }
  }
  async function deleteCurrentView() {
    if (
      !currentView ||
      !window.confirm(`Delete your saved view “${currentView.name}”?`)
    )
      return;
    setError(null);
    try {
      await removeView.mutateAsync({
        projectId,
        id: currentView.id,
        version: currentView.version,
      });
      setActiveViewId("");
      await utils.testCaseViews.list.invalidate({ projectId });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete view.",
      );
    }
  }
  function sortColumn(column: CaseSort) {
    setSortDescending(
      sortBy === column
        ? !sortDescending
        : column === "risk" || column === "priority" || column === "updated",
    );
    setSortBy(column);
  }
  const [showArchived, setShowArchived] = useState(false);
  const currentFilters = viewFilters();
  const viewHasChanges =
    currentView != null &&
    (Object.keys(currentFilters) as (keyof typeof currentFilters)[]).some(
      (key) => currentView.filters[key] !== currentFilters[key],
    );
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [bulkMovePlanId, setBulkMovePlanId] = useState("");
  const [bulkTag, setBulkTag] = useState("");
  const [exporting, setExporting] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [selectionMoreOpen, setSelectionMoreOpen] = useState(false);
  const [reviewAction, setReviewAction] = useState<{
    kind: "archive" | "restore" | "delete";
    ids: string[];
  } | null>(null);

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
      tagFilter,
      typeFilter,
      automationFilter,
      priorityFilter,
      reviewFilter,
      originFilter,
      showArchived,
    ],
  );

  const bulkDeleteMutation = trpcReact.testCases.bulkDelete.useMutation();
  const bulkArchiveMutation = trpcReact.testCases.bulkArchive.useMutation();
  const bulkMoveMutation = trpcReact.testCases.bulkSetTestPlan.useMutation();
  const bulkTagMutation = trpcReact.testCases.bulkAddTags.useMutation();
  const startRunMutation = trpcReact.manualRunStartReviewed.start.useMutation();

  const laneCases = useMemo(
    () =>
      cases.filter(
        (tc) =>
          tc.reviewStatus === repositoryReviewStatus(reviewFilter) &&
          (showArchived || !tc.archived),
      ),
    [cases, reviewFilter, showArchived],
  );
  const pathFiltered = useMemo(
    () => filterCasesByPath(laneCases, selectedPath),
    [laneCases, selectedPath],
  );
  const visibleCases = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = pathFiltered.filter(
      (tc) =>
        (showArchived || !tc.archived) &&
        matchesExactTag(tc.tags, tagFilter) &&
        (!q ||
          tc.displayId.toLowerCase().includes(q) ||
          tc.title.toLowerCase().includes(q) ||
          tc.tags.some((t) => t.toLowerCase().includes(q))) &&
        (!typeFilter || tc.testType === typeFilter) &&
        (!automationFilter || tc.automationStatus === automationFilter) &&
        (!priorityFilter || tc.priority === priorityFilter) &&
        tc.reviewStatus === repositoryReviewStatus(reviewFilter) &&
        (!originFilter || tc.origin === originFilter),
    );
    if (sortBy === "updated")
      return sortDescending ? filtered : [...filtered].reverse();
    if (sortBy === "manual")
      return [...filtered].sort((a, b) => {
        const leftSuite = a.suitePath ?? a.sourceFilePath ?? "";
        const rightSuite = b.suitePath ?? b.sourceFilePath ?? "";
        const suiteOrder = leftSuite.localeCompare(rightSuite, undefined, {
          sensitivity: "base",
          numeric: true,
        });
        if (suiteOrder) return suiteOrder;
        const positionOrder =
          (placements.get(a.id)?.sortPosition ?? 0) -
          (placements.get(b.id)?.sortPosition ?? 0);
        return (
          positionOrder ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id)
        );
      });
    return [...filtered].sort((a, b) => {
      const direction = sortDescending ? -1 : 1;
      if (sortBy === "risk")
        return ((a.riskScore ?? -1) - (b.riskScore ?? -1)) * direction;
      if (sortBy === "priority")
        return (
          ((PRIORITY_RANK[a.priority] ?? 0) -
            (PRIORITY_RANK[b.priority] ?? 0)) *
          direction
        );
      if (sortBy === "review")
        return a.reviewStatus.localeCompare(b.reviewStatus) * direction;
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
      return (
        left.localeCompare(right, undefined, {
          sensitivity: "base",
          numeric: true,
        }) * direction
      );
    });
  }, [
    pathFiltered,
    search,
    tagFilter,
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

  async function moveCase(
    caseId: string,
    targetSuitePath: string | null,
    beforeCaseId: string | null,
  ) {
    const placement = placements.get(caseId);
    if (!placement || readOnly || moveMutation.isPending) return;
    setError(null);
    try {
      await moveMutation.mutateAsync({
        projectId,
        caseId,
        expectedSuitePath: placement.suitePath,
        expectedSortPosition: placement.sortPosition,
        targetSuitePath,
        beforeCaseId,
      });
      reload();
      setSortBy("manual");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not move test case.",
      );
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
      visibleCases.every((item) => s.has(item.id))
        ? new Set()
        : new Set(visibleCases.map((tc) => tc.id)),
    );
  }

  async function runBulkAction<T>(
    execute: (ids: string[]) => Promise<T>,
    reviewedIds = [...selected],
  ) {
    if (readOnly || bulkBusy || reviewedIds.length === 0) return null;
    setBulkBusy(true);
    setBulkError(null);
    try {
      const outcome = await runCaseActionBatches(reviewedIds, execute);
      const completedIds = new Set(outcome.completedIds);
      setSelected(
        (current) =>
          new Set([...current].filter((id) => !completedIds.has(id))),
      );
      reload();
      if (outcome.error) {
        setBulkError(
          `${outcome.completedIds.length} cases completed. ${outcome.remainingIds.length} were not confirmed and remain selected. Check their refreshed status before retrying; later batches were not sent.`,
        );
      }
      return outcome;
    } finally {
      setBulkBusy(false);
    }
  }

  async function bulkDelete(reviewedIds: string[]) {
    const outcome = await runBulkAction(
      (ids) => bulkDeleteMutation.mutateAsync({ projectId, ids }),
      reviewedIds,
    );
    if (outcome) {
      const totals = outcome.results.reduce(
        (sum, result) => ({
          deletedCount: sum.deletedCount + result.deletedCount,
          blockedCount: sum.blockedCount + result.blockedCount,
        }),
        { deletedCount: 0, blockedCount: 0 },
      );
      if (totals.blockedCount > 0) {
        alert(
          `${totals.deletedCount} deleted, ${totals.blockedCount} couldn't be deleted (linked to compliance controls or risk analysis results).`,
        );
      }
    }
  }

  async function bulkArchive(archived: boolean, reviewedIds: string[]) {
    await runBulkAction(
      (ids) => bulkArchiveMutation.mutateAsync({ projectId, ids, archived }),
      reviewedIds,
    );
  }

  async function bulkMove() {
    const outcome = await runBulkAction((ids) =>
      bulkMoveMutation.mutateAsync({
        projectId,
        ids,
        testPlanId: bulkMovePlanId || null,
      }),
    );
    if (outcome && !outcome.error) setBulkMovePlanId("");
  }

  async function bulkAddTag() {
    if (!bulkTag.trim()) return;
    const outcome = await runBulkAction((ids) =>
      bulkTagMutation.mutateAsync({
        projectId,
        ids,
        tags: [bulkTag.trim()],
      }),
    );
    if (outcome && !outcome.error) setBulkTag("");
  }

  const selectedExportCount = caseExportIds(
    visibleCases,
    selected,
    "selected",
  ).length;
  async function exportCsv(scope: "filtered" | "selected") {
    const ids = caseExportIds(visibleCases, selected, scope);
    if (exporting || ids.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const available = await utils.testCases.exportCsv.fetch({
        projectId,
        includeArchived: showArchived,
      });
      const rows = scopeCaseExport(available, ids);
      const header = [
        "caseId",
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
        r.displayId,
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
      downloadCsv(
        `${project?.name ?? "test-cases"}-${scope}-${rows.length}.csv`,
        [header, ...body.map((row) => row.map(spreadsheetText))],
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Export failed. Please try again.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function exportProcedure(scope: "filtered" | "selected") {
    const ids = caseExportIds(visibleCases, selected, scope);
    if (exporting || ids.length === 0) return;
    setExporting(true);
    setError(null);
    try {
      const bundle = await utils.testCases.exportProcedure.fetch({
        projectId,
        ids,
        scope,
        includeArchived: showArchived,
      });
      downloadFile(
        `${bundle.project.caseKey}-${scope}-${bundle.cases.length}-procedures.json`,
        encodeCaseProcedureExport(bundle),
        "application/json",
      );
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Procedure export failed. No file was downloaded.",
      );
    } finally {
      setExporting(false);
    }
  }

  async function startManualRun(envelope: ReviewedRunStartEnvelope) {
    const context = envelope.request;
    if (envelope.projectId !== projectId || context.projectId !== projectId)
      throw new Error(
        "Restore the original project before retrying its retained run start.",
      );
    if (context.testCaseIds.length === 0)
      throw new Error("No cases were selected for this execution record.");
    // Mutation-only: the mounted configuration controller verifies the exact
    // acknowledgement and current original frame before any navigation.
    return startRunMutation.mutateAsync(envelope);
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

  const selectedCases = visibleCases.filter((item) => selected.has(item.id));
  const activeSelectedIds = selectedCases
    .filter((item) => !item.archived)
    .map((item) => item.id);
  const archivedSelectedIds = selectedCases
    .filter((item) => item.archived)
    .map((item) => item.id);
  const selectableSuites = [
    ...new Set([...suiteChoices(laneCases), ...folderPaths]),
  ].sort();
  const filters = [
    { name: "Type", value: typeFilter, clear: () => setTypeFilter("") },
    {
      name: "Automation",
      value: automationFilter,
      clear: () => setAutomationFilter(""),
    },
    {
      name: "Priority",
      value: priorityFilter,
      clear: () => setPriorityFilter(""),
    },
    { name: "Origin", value: originFilter, clear: () => setOriginFilter("") },
  ].filter((item) => item.value);
  function resetFilters() {
    setSearch("");
    setTagFilter(null);
    setTypeFilter("");
    setAutomationFilter("");
    setPriorityFilter("");
    setOriginFilter("");
    setShowArchived(false);
    setActiveViewId("");
  }
  function requestReview(kind: "archive" | "restore" | "delete") {
    setSelectionMoreOpen(false);
    setReviewAction({
      kind,
      ids:
        kind === "archive"
          ? activeSelectedIds
          : kind === "restore"
            ? archivedSelectedIds
            : [...selected],
    });
  }
  async function confirmReviewedAction() {
    if (!reviewAction || readOnly || bulkBusy) return;
    if (reviewAction.kind === "delete") await bulkDelete(reviewAction.ids);
    else await bulkArchive(reviewAction.kind === "archive", reviewAction.ids);
    setReviewAction(null);
  }

  return (
    <div className={styles.workbench}>
      <PageHeading
        eyebrow={project?.name ?? "Project"}
        title={reviewFilter === "APPROVED" ? "Test cases" : "Review queue"}
        description={
          loading
            ? "Loading case library…"
            : `${cases.filter((item) => !item.archived && item.reviewStatus === repositoryReviewStatus(reviewFilter)).length} active ${reviewFilter === "APPROVED" ? "approved cases" : "cases in this review lane"}`
        }
      />
      <nav
        aria-label="Case repository and review queue"
        style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}
      >
        <button
          type="button"
          className={
            reviewFilter === "APPROVED" ? "btn-primary" : "btn-secondary"
          }
          onClick={() => setReviewFilter("APPROVED")}
        >
          Approved repository
        </button>
        <Link
          href={`/projects/${projectId}/test-cases/review`}
          className={
            reviewFilter !== "APPROVED" ? "btn-primary" : "btn-secondary"
          }
        >
          Review queue (
          {
            cases.filter(
              (testCase) =>
                !testCase.archived &&
                testCase.reviewStatus === "PENDING_REVIEW",
            ).length
          }
          )
        </Link>
        {tagFilter !== null && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setTagFilter(null)}
          >
            Tag: {projectTagLabel(tagFilter)} ×
          </button>
        )}
      </nav>
      <div
        className={styles.toolbar}
        role="region"
        aria-label="Case library tools"
      >
        <input
          className={styles.search}
          aria-label="Search test cases"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          maxLength={160}
          placeholder="Search case ID, title or tags…"
        />
        <select
          aria-label="Saved view"
          value={activeViewId}
          onChange={(event) => applyView(event.target.value)}
          disabled={viewsQuery.isLoading}
        >
          <option value="">Current view</option>
          {viewsQuery.data?.map((view) => (
            <option key={view.id} value={view.id}>
              {view.name}
            </option>
          ))}
        </select>
        <button className="btn-secondary" onClick={() => setFiltersOpen(true)}>
          Filters{filters.length ? ` (${filters.length})` : ""}
        </button>
        {!readOnly && (
          <button className="btn-primary" onClick={() => setAddOpen(true)}>
            Add case
          </button>
        )}
        <button
          className="btn-secondary"
          onClick={() => setMoreOpen(true)}
          aria-label="More library actions"
        >
          More
        </button>
      </div>
      <details aria-label="Advanced case library tools">
        <summary>Advanced query, presets &amp; risk analysis</summary>
        <div className={styles.toolbar}>
          <CaseQueryExplorer projectId={projectId} />
          {project && (
            <DurableCaseAnalysis
              projectId={projectId}
              selectedIds={visibleCases.map((testCase) => testCase.id)}
              onCompleted={reload}
              buttonLabel={`Analyze filtered suite (${visibleCases.length})`}
            />
          )}
          {project && (
            <DurableCaseAnalysis
              key={`${projectId}:all-loaded-approved`}
              projectId={projectId}
              selectedIds={cases.filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED").map(testCase => testCase.id)}
              onCompleted={reload}
              buttonLabel={`Analyze all loaded approved cases (${cases.filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED").length})`}
            />
          )}
          {!readOnly && (
            <NewCaseFromAuthoringPreset
              key={projectId}
              projectId={projectId}
              organizationId={project?.organizationId ?? "unavailable"}
            />
          )}
          {project && (
            <BulkCaseAnalysis
              projectId={projectId}
              organizationId={project.organizationId}
              selectedIds={[...selected]}
              onCompleted={reload}
            />
          )}
        </div>
      </details>
      {(filters.length > 0 || showArchived || search.trim()) && (
        <div className={styles.filterSummary} aria-label="Active filters">
          {search.trim() && (
            <button
              className="btn-secondary"
              onClick={() => setSearch("")}
              aria-label="Remove search filter"
            >
              Search: {search.trim()} ×
            </button>
          )}
          {filters.map((filter) => (
            <button
              key={filter.name}
              className="btn-secondary"
              onClick={filter.clear}
              aria-label={`Remove ${filter.name.toLowerCase()} filter`}
            >
              {filter.name}: {caseLabel(filter.value)} ×
            </button>
          ))}
          {showArchived && (
            <button
              className="btn-secondary"
              onClick={() => setShowArchived(false)}
              aria-label="Remove archived filter"
            >
              Including archived ×
            </button>
          )}
          <button className="btn-secondary" onClick={resetFilters}>
            Reset filters
          </button>
        </div>
      )}
      {viewsQuery.error && (
        <p role="alert">
          Saved views could not be loaded. Current filters are retained.
        </p>
      )}
      {currentView && viewHasChanges && (
        <p className="text-muted" style={{ fontSize: 12, margin: "6px 0" }}>
          Unsaved changes to {currentView.name}. Manage views under More.
        </p>
      )}
      {readOnly && (
        <p className="text-muted" style={{ fontSize: 12 }}>
          Read-only library. Select cases to preview analysis costs or request
          administrator access.
        </p>
      )}
      {loading && <p role="status">Loading case library…</p>}
      {pageError && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          {pageError}
        </p>
      )}
      {bulkError && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          {bulkError}
        </p>
      )}
      {!loading && !pageError && cases.length === 0 && (
        <div className={styles.empty}>
          <h2>No test cases yet</h2>
          <p className="text-muted">
            Add a case or import existing procedures to start this library.
          </p>
          {!readOnly && (
            <div className={styles.dialogActions}>
              <button className="btn-primary" onClick={() => setAddOpen(true)}>
                Add first case
              </button>
              <Link
                className="btn-secondary"
                href={`/projects/${projectId}/import`}
              >
                Import cases
              </Link>
            </div>
          )}
        </div>
      )}
      <TestCaseFolders
        key={`${projectId}:folders`}
        projectId={projectId}
        selectedPath={selectedPath}
        onFolderPaths={ignoreFolderPaths}
        requestedIntent={folderReviewIntent}
        onSaved={(path) => {
          setSelectedPath(path);
          void casesQuery.refetch();
          void structureQuery.refetch();
        }}
      />
      {!loading && (cases.length > 0 || folderPaths.length > 0) && (
        <div className={styles.layout}>
          <aside className={styles.suites} aria-label="Test suites">
            <h2>Suites</h2>
            <TestCaseTree
              cases={laneCases}
              folderPaths={currentFolderCatalog ? folderPaths : []}
              folderCatalog={currentFolderCatalog}
              classificationCases={cases}
              selectedPath={selectedPath}
              onSelect={setSelectedPath}
              onFolderReview={
                readOnly
                  ? undefined
                  : (intent) =>
                      setFolderReviewIntent({
                        ...intent,
                        id: crypto.randomUUID(),
                      })
              }
              onDropRefused={(message) => setError(message)}
              onDropCase={
                readOnly || moveMutation.isPending
                  ? undefined
                  : (caseId, suitePath) =>
                      void moveCase(caseId, suitePath, null)
              }
            />
          </aside>
          <div className={styles.inventory}>
            <label className={styles.mobileSuite}>
              Suite
              <select
                aria-label="Choose suite"
                value={selectedPath ?? ""}
                onChange={(event) =>
                  setSelectedPath(event.target.value || null)
                }
              >
                <option value="">
                  All cases in this lane ({laneCases.length})
                </option>
                {selectableSuites.map((path) => (
                  <option key={path} value={path}>
                    {path} ({filterCasesByPath(laneCases, path).length})
                  </option>
                ))}
                <option value={UNASSIGNED}>
                  Unassigned ({filterCasesByPath(laneCases, UNASSIGNED).length})
                </option>
              </select>
            </label>
            {selected.size > 0 && (
              <div
                className={styles.selection}
                role="region"
                aria-label="Selected case actions"
              >
                <strong>{selected.size} selected</strong>
                {selectedCases.length !== selected.size && (
                  <span className="text-muted">
                    {selected.size - selectedCases.length} outside the current
                    view; export and Run use eligible visible cases.
                  </span>
                )}
                {!readOnly && (
                  <button
                    className="btn-primary"
                    disabled={startingRun || activeSelectedIds.length === 0}
                    onClick={() => {
                      setRunSelection(activeSelectedIds);
                      setRunConfigurationOpen(true);
                    }}
                  >
                    Run ({activeSelectedIds.length})
                  </button>
                )}
                {!readOnly && (
                  <>
                    <button
                      className="btn-secondary"
                      disabled={bulkBusy}
                      onClick={() => setOrganizeOpen(true)}
                    >
                      Organize
                    </button>
                    <button
                      className="btn-secondary"
                      disabled={bulkBusy}
                      onClick={() => setSelectionMoreOpen(true)}
                      aria-label="More selected case actions"
                    >
                      More
                    </button>
                  </>
                )}
                <button
                  className="btn-secondary"
                  disabled={bulkBusy}
                  onClick={() => setSelected(new Set())}
                >
                  Clear selection
                </button>
              </div>
            )}
            <div className={styles.scope}>
              <span>
                {visibleCases.length} shown ·{" "}
                {selectedPath === UNASSIGNED
                  ? "Unassigned"
                  : (selectedPath ?? "All suites")}{" "}
                ·{" "}
                {sortBy === "manual"
                  ? "Manual suite order"
                  : `Sorted by ${sortBy}`}
              </span>
              {!readOnly && sortBy !== "manual" && (
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setSortBy("manual")}
                >
                  View manual order
                </button>
              )}
            </div>
            {!readOnly && (
              <details>
                <summary>Help: keyboard ordering</summary>
                <p className="text-muted" style={{ fontSize: 12 }}>
                  Keyboard ordering: activate a case&apos;s drag handle to view manual order in its verified case suite, then use Up/Down. In All suites, source groups or Unassigned, select a persisted case suite first. Viewing an order does not move cases or create folders; source paths stay unchanged.
                </p>
              </details>
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
                  checked={visibleCases.every((item) => selected.has(item.id))}
                  onChange={toggleAllVisible}
                />
                Select all ({visibleCases.length})
              </label>
            )}
            {visibleCases.length > 0 ? (
              <div
                className={`table-scroll test-case-inventory ${styles.table}`}
              >
                <table className="workspace-table">
                  <thead>
                    <tr>
                      <th aria-label="Select" />
                      {(
                        [
                          ["title", "Test case"],
                          ["type", "Type"],
                          ["automation", "Automation"],
                          ["risk", "Risk"],
                          ["priority", "Priority"],
                          ["origin", "Origin"],
                        ] as const
                      ).map(([key, label]) => (
                        <th
                          key={key}
                          scope="col"
                          aria-sort={
                            sortBy === key
                              ? sortDescending
                                ? "descending"
                                : "ascending"
                              : "none"
                          }
                        >
                          <button
                            className="member-sort"
                            onClick={() => sortColumn(key)}
                          >
                            {label}{" "}
                            {sortBy === key
                              ? sortDescending
                                ? "↓"
                                : "↑"
                              : "↕"}
                          </button>
                        </th>
                      ))}
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
                        <tr
                          key={tc.id}
                          onDragOver={(event) => {
                            if (
                              !readOnly &&
                              !tc.archived &&
                              !moveMutation.isPending &&
                              event.dataTransfer.types.includes(
                                "application/x-vaettir-test-case",
                              )
                            ) {
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                            }
                          }}
                          onDrop={(event) => {
                            if (
                              readOnly ||
                              tc.archived ||
                              moveMutation.isPending
                            )
                              return;
                            const caseId = event.dataTransfer.getData(
                              "application/x-vaettir-test-case",
                            );
                            if (!caseId || caseId === tc.id) return;
                            event.preventDefault();
                            const moving = cases.find(
                              (item) => item.id === caseId,
                            );
                            const target = moving
                              ? rowDropTarget(moving, tc)
                              : null;
                            if (!target) {
                              setError(
                                "To change a source-file group, assign the case to a persisted suite or drop it on a suite in the tree. Rows can be reordered within their current unassigned group.",
                              );
                              return;
                            }
                            void moveCase(
                              caseId,
                              target.targetSuitePath,
                              target.beforeCaseId,
                            );
                          }}
                        >
                          <td>
                            {!readOnly && placements.has(tc.id) && (
                              <button
                                type="button"
                                className="btn-secondary"
                                draggable
                                disabled={moveMutation.isPending}
                                aria-label={`Drag ${tc.displayId}: ${tc.title}, or activate to view manual ordering`}
                                title="Drag to reorder or move to a suite. Click or press Enter/Space to view manual order; keyboard Up/Down requires a verified case suite."
                                onClick={() => {
                                  setSortBy("manual");
                                  if (
                                    tc.suitePath !== null &&
                                    supportedCaseFolderPath(tc.suitePath) &&
                                    currentFolderCatalog?.paths.includes(
                                      tc.suitePath,
                                    ) &&
                                    placements.get(tc.id)?.suitePath ===
                                      tc.suitePath
                                  )
                                    setSelectedPath(tc.suitePath);
                                }}
                                onDragStart={(event) => {
                                  event.dataTransfer.setData(
                                    "application/x-vaettir-test-case",
                                    tc.id,
                                  );
                                  event.dataTransfer.effectAllowed = "move";
                                }}
                                style={{
                                  marginRight: 6,
                                  cursor: "grab",
                                  padding: "2px 4px",
                                  minWidth: 24,
                                  color: "var(--muted)",
                                }}
                              >
                                ⠿
                              </button>
                            )}
                            <input
                              type="checkbox"
                              checked={selected.has(tc.id)}
                              onChange={() => toggle(tc.id)}
                              aria-label={`Select ${tc.displayId}: ${tc.title}`}
                            />
                          </td>
                          <td className="test-case-title-cell">
                            <a
                              href={`/projects/${projectId}/test-cases/${tc.id}`}
                              onClick={(e) => {
                                if (!unmodifiedCaseClick(e)) return;
                                e.preventDefault();
                                setOpenCaseId(tc.id);
                              }}
                            >
                              <code
                                style={{ marginRight: 8, whiteSpace: "nowrap" }}
                              >
                                {tc.displayId}
                              </code>
                              {tc.title}
                            </a>
                            {!readOnly &&
                              sortBy === "manual" &&
                              selectedPath !== null &&
                              tc.suitePath === selectedPath && (
                                <span
                                  style={{
                                    display: "inline-flex",
                                    gap: 2,
                                    marginLeft: 6,
                                  }}
                                >
                                  <button
                                    type="button"
                                    aria-label={`Move ${tc.title} up`}
                                    disabled={
                                      visibleCases.findIndex(
                                        (item) => item.id === tc.id,
                                      ) === 0 ||
                                      visibleCases[
                                        visibleCases.findIndex(
                                          (item) => item.id === tc.id,
                                        ) - 1
                                      ]?.suitePath !== tc.suitePath ||
                                      moveMutation.isPending
                                    }
                                    onClick={() => {
                                      const index = visibleCases.findIndex(
                                        (item) => item.id === tc.id,
                                      );
                                      const before = visibleCases[index - 1];
                                      if (before)
                                        void moveCase(
                                          tc.id,
                                          before.suitePath ??
                                            before.sourceFilePath ??
                                            null,
                                          before.id,
                                        );
                                    }}
                                  >
                                    ↑
                                  </button>
                                  <button
                                    type="button"
                                    aria-label={`Move ${tc.title} down`}
                                    disabled={
                                      visibleCases.findIndex(
                                        (item) => item.id === tc.id,
                                      ) ===
                                        visibleCases.length - 1 ||
                                      visibleCases[
                                        visibleCases.findIndex(
                                          (item) => item.id === tc.id,
                                        ) + 1
                                      ]?.suitePath !== tc.suitePath ||
                                      moveMutation.isPending
                                    }
                                    onClick={() => {
                                      const index = visibleCases.findIndex(
                                        (item) => item.id === tc.id,
                                      );
                                      const after = visibleCases[index + 2];
                                      const target = visibleCases[index + 1];
                                      if (target)
                                        void moveCase(
                                          tc.id,
                                          target.suitePath ??
                                            target.sourceFilePath ??
                                            null,
                                          sameSuiteAfterAnchor(
                                            target.suitePath,
                                            after,
                                          ),
                                        );
                                    }}
                                  >
                                    ↓
                                  </button>
                                </span>
                              )}
                            {tc.tags.length > 0 && (
                              <small
                                style={{
                                  display: "flex",
                                  flexWrap: "wrap",
                                  gap: 4,
                                }}
                              >
                                {tc.tags.map((tag, index) => (
                                  <span
                                    key={`${index}:${tag}`}
                                    style={{
                                      display: "inline-flex",
                                      alignItems: "center",
                                      gap: 4,
                                    }}
                                  >
                                    <button
                                      type="button"
                                      className="btn-secondary"
                                      style={{
                                        padding: "1px 6px",
                                        minHeight: 24,
                                        fontSize: 12,
                                      }}
                                      title={`Filter this lane by exact tag ${JSON.stringify(tag)}`}
                                      onClick={() => setTagFilter(tag)}
                                    >
                                      {projectTagLabel(tag)}
                                    </button>
                                    <a
                                      href={projectTagHref(projectId, tag)}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      title={`Open saved associations for exact tag ${JSON.stringify(tag)} (approved active cases by default)`}
                                      aria-label={`Open tag associations for ${projectTagLabel(tag)}`}
                                    >
                                      ↗
                                    </a>
                                  </span>
                                ))}
                              </small>
                            )}
                            {(tc.isFlaky || tc.archived) && (
                              <small style={{ display: "flex", gap: 6 }}>
                                {tc.isFlaky && (
                                  <span className="status-pill status-warning">
                                    Flaky
                                  </span>
                                )}
                                {tc.archived && (
                                  <span className="status-pill">Archived</span>
                                )}
                              </small>
                            )}
                            {!readOnly && selectedPath === UNASSIGNED && (
                              <AssignSuiteControl
                                caseId={tc.id}
                                knownPaths={knownPaths}
                                onAssigned={reload}
                              />
                            )}
                          </td>
                          <td data-label="Type">
                            <span className="status-pill status-info">
                              {caseLabel(tc.testType)}
                            </span>
                          </td>
                          <td data-label="Automation">
                            {caseLabel(tc.automationStatus)}
                          </td>
                          <td data-label="Risk">
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
                              {tc.riskScore != null && (
                                <i>
                                  <b
                                    style={{
                                      width: `${tc.riskScore}%`,
                                    }}
                                  />
                                </i>
                              )}
                            </div>
                          </td>
                          <td data-label="Priority">
                            <span
                              className={`case-priority case-priority-${tc.priority.toLowerCase()}`}
                              title={`Priority: ${caseLabel(tc.priority)}`}
                              aria-label={`Priority: ${caseLabel(tc.priority)}`}
                              role="img"
                            >
                              {tc.priority === "CRITICAL"
                                ? "▲▲"
                                : tc.priority === "HIGH"
                                  ? "▲"
                                  : tc.priority === "LOW"
                                    ? "▽"
                                    : "◆"}
                            </span>
                          </td>
                          <td data-label="Origin">
                            <span
                              title={`Origin: ${caseLabel(tc.origin)}`}
                              aria-label={`Origin: ${caseLabel(tc.origin)}`}
                              role="img"
                            >
                              {tc.origin === "IMPORTED"
                                ? "⇩"
                                : tc.origin === "AUTHORED"
                                  ? "✎"
                                  : "◇"}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className={styles.empty}>
                <h2>No matching cases</h2>
                <p className="text-muted">
                  Try another suite or clear the current filters.
                </p>
                <button className="btn-secondary" onClick={resetFilters}>
                  Reset filters
                </button>
                {selectedPath !== null && (
                  <button
                    className="btn-secondary"
                    onClick={() => setSelectedPath(null)}
                  >
                    Show all suites
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      <Modal
        open={filtersOpen}
        title="Filter and sort cases"
        onClose={() => setFiltersOpen(false)}
      >
        <div className={styles.filters}>
          {[
            {
              name: "Type",
              value: typeFilter,
              values: TEST_TYPES,
              set: setTypeFilter,
            },
            {
              name: "Automation",
              value: automationFilter,
              values: AUTOMATION_STATUSES,
              set: setAutomationFilter,
            },
            {
              name: "Priority",
              value: priorityFilter,
              values: PRIORITIES,
              set: setPriorityFilter,
            },
            {
              name: "Origin",
              value: originFilter,
              values: ORIGINS,
              set: setOriginFilter,
            },
          ].map((filter) => (
            <label key={filter.name}>
              {filter.name}
              <select
                value={filter.value}
                onChange={(event) => filter.set(event.target.value)}
              >
                <option value="">All {filter.name.toLowerCase()}</option>
                {filter.values.map((value) => (
                  <option key={value} value={value}>
                    {caseLabel(value)}
                  </option>
                ))}
              </select>
            </label>
          ))}
          <label>
            Case lifecycle lane
            <select
              value={reviewFilter}
              onChange={(event) =>
                setReviewFilter(repositoryReviewStatus(event.target.value))
              }
            >
              {REVIEW_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {caseLabel(status)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Sort test cases
            <select
              value={sortBy}
              onChange={(event) => {
                const value = event.target.value as CaseSort;
                setSortBy(value);
                setSortDescending(
                  ["updated", "risk", "priority"].includes(value),
                );
              }}
            >
              {(
                [
                  "updated",
                  "title",
                  "type",
                  "automation",
                  "risk",
                  "priority",
                  "origin",
                  "suite",
                  "manual",
                  "review",
                ] as const
              ).map((value) => (
                <option key={value} value={value}>
                  {value === "updated"
                    ? "Recent activity"
                    : value === "manual"
                      ? "Manual suite order"
                      : caseLabel(value)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Direction
            <select
              value={sortDescending ? "descending" : "ascending"}
              onChange={(event) =>
                setSortDescending(event.target.value === "descending")
              }
              disabled={sortBy === "manual"}
            >
              <option value="descending">Descending</option>
              <option value="ascending">Ascending</option>
            </select>
          </label>
        </div>
        <label style={{ display: "flex", gap: 8 }}>
          <input
            type="checkbox"
            checked={showArchived}
            onChange={(event) => setShowArchived(event.target.checked)}
          />
          Include archived cases
        </label>
        <div className={styles.dialogActions}>
          <button className="btn-secondary" onClick={resetFilters}>
            Reset filters
          </button>
          <button className="btn-primary" onClick={() => setFiltersOpen(false)}>
            Show {visibleCases.length} cases
          </button>
        </div>
      </Modal>
      <Modal
        open={moreOpen}
        title="Library actions"
        onClose={() => setMoreOpen(false)}
      >
        <div className={styles.menu}>
          <a
            className="btn-secondary"
            href={`/projects/${projectId}/test-cases/review`}
          >
            Review queue
          </a>
          <a
            className="btn-secondary"
            href={`/projects/${projectId}/shared-steps`}
          >
            Shared step libraries
          </a>
          <a
            className="btn-secondary"
            href={`/projects/${projectId}/exploratory`}
          >
            Exploratory testing
          </a>
          {!readOnly && (
            <Link
              className="btn-secondary"
              href={`/projects/${projectId}/import`}
            >
              Import cases
            </Link>
          )}
          <button
            className="btn-secondary"
            disabled={loading || exporting || visibleCases.length === 0}
            onClick={() => void exportCsv("filtered")}
          >
            {exporting
              ? "Exporting…"
              : `Spreadsheet CSV (${visibleCases.length} shown)`}
          </button>
          <button
            className="btn-secondary"
            disabled={loading || exporting || visibleCases.length === 0}
            onClick={() => void exportProcedure("filtered")}
          >
            Case procedures JSON ({visibleCases.length} shown)
          </button>
          <p className="text-muted">
            CSV is a spreadsheet summary, not a lossless reimport format. JSON
            preserves procedures, conditions, case IDs and reference labels. It
            excludes attachment files, datasets, paid drafts and history; it is
            not a full backup. Existing same-project procedures can be restored
            after explicit conflict review; unknown case IDs are not recreated.
          </p>
          {!readOnly && <TestCaseProcedureReimport projectId={projectId} />}
          <details>
            <summary>Manage case authoring presets</summary>
            <CaseAuthoringPresets
              key={projectId}
              projectId={projectId}
              organizationId={project?.organizationId ?? "unavailable"}
            />
          </details>
          <details>
            <summary>Manage saved views</summary>
            <p className="text-muted">
              Private to you. Saved views retain this project&apos;s suite,
              filters and sorting.
            </p>
            {currentView && (
              <div className={styles.dialogActions}>
                <button
                  className="btn-secondary"
                  onClick={() => void saveCurrentView()}
                  disabled={!viewHasChanges || updateView.isPending}
                >
                  Save changes to {currentView.name}
                </button>
                <button
                  className="btn-secondary"
                  onClick={() => void deleteCurrentView()}
                  disabled={removeView.isPending}
                >
                  Delete view
                </button>
              </div>
            )}
            <label style={{ display: "block", marginTop: 12 }}>
              New view name
              <input
                value={newViewName}
                onChange={(event) => setNewViewName(event.target.value)}
                maxLength={80}
                placeholder="High-risk regression"
                style={{ width: "100%", display: "block", marginTop: 6 }}
              />
            </label>
            <button
              className="btn-secondary"
              style={{ marginTop: 8 }}
              onClick={() => void saveNewView()}
              disabled={
                !newViewName.trim() ||
                createView.isPending ||
                (viewsQuery.data?.length ?? 0) >= 50
              }
            >
              Save current view
            </button>
          </details>
        </div>
      </Modal>
      <div hidden={!permissions.canAdmin} style={{ display: permissions.canAdmin ? "flex" : "none", flexWrap: "wrap", gap: 10, marginBlock: 16 }}>
        <ProjectCaseFields projectId={projectId} />
      </div>
      {!readOnly && (
        <Modal
          open={addOpen}
          title="Add a test case"
          onClose={() => setAddOpen(false)}
        >
          <p className="text-muted">
            {selectedPath && selectedPath !== UNASSIGNED
              ? `Add to ${selectedPath}.`
              : "Capture a case title, then fill in its procedure."}
          </p>
          <QuickAddRow
            projectId={projectId}
            suitePath={selectedPath}
            onAdded={() => {
              reload();
              setAddOpen(false);
            }}
          />
          <a
            className="btn-secondary"
            href={`/projects/${projectId}/test-cases/new`}
          >
            Open full editor
          </a>
        </Modal>
      )}
      {!readOnly && (
        <Modal
          open={organizeOpen}
          title={`Organize ${selected.size} selected cases`}
          onClose={() => setOrganizeOpen(false)}
          dismissible={!bulkBusy}
        >
          <p className="text-muted">
            Selected cases only. Changes run sequentially in batches of up to
            200; failures retain unconfirmed selections.
          </p>
          <label>
            Test plan
            <select
              value={bulkMovePlanId}
              onChange={(event) => setBulkMovePlanId(event.target.value)}
              style={{ width: "100%", display: "block", marginTop: 6 }}
            >
              <option value="">Choose a plan</option>
              {plans.map((plan) => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </label>
          <button
            className="btn-secondary"
            disabled={bulkBusy || !bulkMovePlanId}
            onClick={() => void bulkMove()}
          >
            Move selected to plan
          </button>
          <label style={{ display: "block", marginTop: 14 }}>
            Tag
            <input
              value={bulkTag}
              onChange={(event) => setBulkTag(event.target.value)}
              placeholder="regression"
              style={{ width: "100%", display: "block", marginTop: 6 }}
            />
          </label>
          <button
            className="btn-secondary"
            disabled={bulkBusy || !bulkTag.trim()}
            onClick={() => void bulkAddTag()}
          >
            Add tag to selected
          </button>
          {bulkError && <p role="alert">{bulkError}</p>}
        </Modal>
      )}
      {!readOnly && (
        <Modal
          open={selectionMoreOpen}
          title={`${selected.size} selected cases`}
          onClose={() => setSelectionMoreOpen(false)}
          dismissible={!bulkBusy}
        >
          <div className={styles.menu}>
            <a className="btn-secondary" href={`/projects/${projectId}/test-cases/review`}>
              Review pending cases in the review queue
            </a>
            <p className="text-muted">
              Review decisions require the complete supported snapshot for each
              pending case. This slice does not bulk-approve or silently omit
              selected cases.
            </p>
            <button
              className="btn-secondary"
              disabled={exporting || selectedExportCount === 0}
              onClick={() => void exportCsv("selected")}
            >
              Selected spreadsheet CSV ({selectedExportCount})
            </button>
            <button
              className="btn-secondary"
              disabled={exporting || selectedExportCount === 0}
              onClick={() => void exportProcedure("selected")}
            >
              Selected procedures JSON ({selectedExportCount})
            </button>
            {activeSelectedIds.length > 0 && (
              <button
                className="btn-secondary"
                disabled={bulkBusy}
                onClick={() => requestReview("archive")}
              >
                Review archive ({activeSelectedIds.length} active)
              </button>
            )}
            {archivedSelectedIds.length > 0 && (
              <button
                className="btn-secondary"
                disabled={bulkBusy}
                onClick={() => requestReview("restore")}
              >
                Review restore ({archivedSelectedIds.length} archived)
              </button>
            )}
            <button
              className="btn-secondary"
              disabled={bulkBusy}
              onClick={() => requestReview("delete")}
            >
              Review permanent deletion
            </button>
          </div>
          {bulkError && <p role="alert">{bulkError}</p>}
        </Modal>
      )}
      {!readOnly && (
        <Modal
          open={reviewAction !== null}
          title={`Review ${reviewAction?.kind ?? "action"}`}
          onClose={() => setReviewAction(null)}
          dismissible={!bulkBusy}
        >
          {reviewAction && (
            <>
              <p>
                {reviewAction.ids.length} cases will be{" "}
                {reviewAction.kind === "delete"
                  ? "permanently deleted where permitted. This cannot be undone"
                  : reviewAction.kind === "archive"
                    ? "archived, preserving history"
                    : "restored to the active library"}
                .
              </p>
              <ul className={styles.reviewList}>
                {reviewAction.ids.map((id) => (
                  <li key={id}>
                    {cases.find((item) => item.id === id)?.title ?? id}
                  </li>
                ))}
              </ul>
              <p className="text-muted">
                Selected scope only. Up to 200 cases per sequential batch; later
                batches stop on an unconfirmed result.
              </p>
              <div className={styles.dialogActions}>
                <button
                  className="btn-secondary"
                  disabled={bulkBusy}
                  onClick={() => setReviewAction(null)}
                >
                  Cancel
                </button>
                <button
                  className="btn-primary"
                  disabled={bulkBusy || reviewAction.ids.length === 0}
                  onClick={() => void confirmReviewedAction()}
                >
                  {bulkBusy ? "Applying…" : `Confirm ${reviewAction.kind}`}
                </button>
              </div>
            </>
          )}
        </Modal>
      )}
      <Drawer
        open={openCaseId !== null}
        onClose={() => setOpenCaseId(null)}
        title="Test case inspector"
      >
        {openCaseId && (
          <TestCaseDetailContent
            id={openCaseId}
            projectId={projectId}
            onChanged={reload}
            onSuiteSelect={(path) => {
              setSelectedPath(path);
              setOpenCaseId(null);
            }}
            readOnly={readOnly}
          />
        )}
      </Drawer>
      <RunConfigurationModal
        key={`${projectId}:run-configuration`}
        open={runConfigurationOpen}
        projectId={projectId}
        caseCount={runSelection.length}
        testCaseIds={runSelection}
        bulkScopes={[
          { key: "filtered", label: "Current filtered approved view", testCaseIds: visibleCases.filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED").map(testCase => testCase.id) },
          { key: "all", label: "All loaded approved cases", testCaseIds: cases.filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED").map(testCase => testCase.id) },
          ...(selectedPath !== null ? [{ key: "suite", label: `Current suite: ${selectedPath === UNASSIGNED ? "Unassigned" : selectedPath}`, testCaseIds: filterCasesByPath(cases.filter(testCase => !testCase.archived && testCase.reviewStatus === "APPROVED"), selectedPath).map(testCase => testCase.id) }] : []),
        ]}
        bulkScopesReady={!readOnly && casesQuery.isFetchedAfterMount && !casesQuery.isFetching && !casesQuery.isPaused && !casesQuery.error}
        onSelectionChange={ids => { if (readOnly || casesQuery.error || casesQuery.isFetching || casesQuery.isPaused || !casesQuery.isFetchedAfterMount) return; setRunSelection(ids); }}
        onClose={() => setRunConfigurationOpen(false)}
        onStart={startManualRun}
        onConfirmedStart={(acknowledgement, request) => {
          router.push(`/projects/${encodeURIComponent(request.projectId)}/test-runs/manual/${acknowledgement.testRunId}`);
        }}
      />
    </div>
  );
}
