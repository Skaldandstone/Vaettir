"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { defectBatchSchema, defectRecordKey } from "@vaettir/core";
import {
  trpcReact,
  type RouterInputs,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { PageHeading } from "@/components/ui/Workspace";
import { Modal } from "@/components/Modal";
import EvidenceLinkChip from "./EvidenceLinkChip";
import { CoveredTestCasesPanel } from "./CaseTraceabilityPanel";
import styles from "./DefectMap.module.css";

type Snapshot = RouterOutputs["defectMap"]["get"];
type Cluster = Snapshot["map"]["clusters"][number];
type Task = Snapshot["document"]["tasks"][number];
type Preview = RouterOutputs["defectMap"]["previewImport"];
type ImportInput = RouterInputs["defectMap"]["approveImport"];
type LinkInput = RouterInputs["defectMap"]["decideLink"];
type Receipt =
  | {
      kind: "import";
      input: ImportInput;
      ambiguous: boolean;
      rejected: boolean;
    }
  | { kind: "link"; input: LinkInput; ambiguous: boolean; rejected: boolean };
function label(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/^./, (first) => first.toUpperCase());
}
function date(value: string) {
  return new Date(value).toLocaleString();
}
function message(cause: unknown) {
  if (
    cause &&
    typeof cause === "object" &&
    "issues" in cause &&
    Array.isArray(cause.issues)
  ) {
    const issues = cause.issues.slice(0, 3).map((issue: unknown) => {
      if (!issue || typeof issue !== "object" || !("message" in issue))
        return "Invalid metadata field";
      return String(issue.message);
    });
    return `Check the normalized metadata schema: ${issues.join("; ")}. Your input is retained.`;
  }
  return cause instanceof Error ? cause.message : String(cause);
}
function rejectionCode(cause: unknown) {
  if (!cause || typeof cause !== "object" || !("data" in cause)) return null;
  const data = cause.data;
  if (
    !data ||
    typeof data !== "object" ||
    !("code" in data) ||
    typeof data.code !== "string"
  )
    return null;
  return [
    "CONFLICT",
    "BAD_REQUEST",
    "FORBIDDEN",
    "UNAUTHORIZED",
    "NOT_FOUND",
    "PRECONDITION_FAILED",
  ].includes(data.code)
    ? data.code
    : null;
}

const SAMPLE_EXPORT = {
  sources: [
    {
      provider: "sentry",
      scope: "example-app",
      status: "available",
      observedAt: "2026-10-02T20:00:00Z",
    },
    {
      provider: "jira",
      scope: "example-team",
      status: "available",
      observedAt: "2026-10-02T20:00:00Z",
    },
  ],
  signals: [
    {
      provider: "sentry",
      scope: "example-app",
      externalId: "APP-101",
      groupId: "session-reconnect",
      title: "Session lost after reconnect",
      component: "session",
      release: "1.2",
      environment: "production",
      platform: "web",
      occurrences: 12,
      windowStart: "2026-10-01T20:00:00Z",
      windowEnd: "2026-10-02T20:00:00Z",
      lastSeen: "2026-10-02T19:00:00Z",
      taskRefs: [
        { provider: "jira", scope: "example-team", externalId: "QA-101" },
      ],
    },
  ],
  tasks: [
    {
      provider: "jira",
      scope: "example-team",
      externalId: "QA-101",
      title: "Restore session after reconnect",
      component: "session",
      release: "1.2",
      environment: "production",
      status: "open",
      observedAt: "2026-10-02T20:00:00Z",
    },
  ],
};
function downloadSample() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(SAMPLE_EXPORT, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = "vaettir-defect-map-example.json";
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function TaskSnapshot({
  task,
  status = "reference",
  onReview,
}: {
  task: Task;
  status?: "confirmed" | "suggested" | "reference";
  onReview?: () => void;
}) {
  return (
    <div className={styles.taskSnapshot}>
      <EvidenceLinkChip
        provider={task.provider}
        label={task.externalId}
        href={task.url}
        status={status}
        onReview={onReview}
      />
      <p>{task.title}</p>
      <small className="text-muted">
        Imported task status: {label(task.status)} · observed{" "}
        {date(task.observedAt)}. Task status is not runtime resolution.
      </small>
    </div>
  );
}

export function DefectClusterWorkbench({
  projectId,
  clusters,
  canEdit,
  onReview,
  tasks,
}: {
  projectId: string;
  clusters: Cluster[];
  tasks: Task[];
  canEdit: boolean;
  onReview: (
    clusterId: string,
    taskKey: string,
    status: "confirmed" | "rejected",
  ) => void;
}) {
  const [search, setSearch] = useState("");
  const [mapping, setMapping] = useState("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [manualTaskKey, setManualTaskKey] = useState("");
  const [detail, setDetail] = useState<"tasks" | "evidence">("tasks");
  const handledAnchor = useRef<string | null>(null);
  const shown = useMemo(
    () =>
      clusters.filter(
        (cluster) =>
          `${cluster.title} ${cluster.component ?? ""} ${cluster.release ?? ""}`
            .toLowerCase()
            .includes(search.toLowerCase().trim()) &&
          (mapping === "all" ||
            mapping === cluster.tracking ||
            (mapping === "unavailable" && cluster.unavailable)),
      ),
    [clusters, search, mapping],
  );
  const selected =
    shown.find((cluster) => cluster.id === selectedId) ?? shown[0];
  useEffect(() => {
    function selectAnchor() {
      let anchor: string;
      try {
        anchor = decodeURIComponent(window.location.hash.slice(1));
      } catch {
        return;
      }
      if (handledAnchor.current === anchor) return;
      const match = clusters.find(
        (cluster) => `defect-${cluster.id}` === anchor,
      );
      if (match) {
        handledAnchor.current = anchor;
        setSelectedId(match.id);
        setSearch("");
        setMapping("all");
        setManualTaskKey("");
      }
    }
    selectAnchor();
    window.addEventListener("hashchange", selectAnchor);
    return () => window.removeEventListener("hashchange", selectAnchor);
  }, [clusters]);
  return (
    <section aria-label="Defect clusters">
      <div className={styles.toolbar}>
        <label className={styles.search}>
          <span>Find a cluster</span>
          <input
            type="search"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              setManualTaskKey("");
            }}
            placeholder="Title, component or release"
          />
        </label>
        <label>
          <span>Task mapping</span>
          <select
            value={mapping}
            onChange={(event) => {
              setMapping(event.target.value);
              setManualTaskKey("");
            }}
          >
            <option value="all">All clusters</option>
            <option value="untracked">Untracked</option>
            <option value="suggested">Suggestions only</option>
            <option value="tracked">Human-confirmed</option>
            <option value="unavailable">Unavailable source</option>
          </select>
        </label>
        {(search || mapping !== "all") && (
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              setSearch("");
              setMapping("all");
            }}
          >
            Reset filters
          </button>
        )}
      </div>
      <p role="status" className="text-muted">
        {shown.length} of {clusters.length} recorded clusters shown.
      </p>
      {shown.length === 0 ? (
        <div className="panel">
          <p>
            {clusters.length
              ? "No clusters match these filters."
              : "No signal summaries imported yet. Import a reviewed export to begin mapping defects."}
          </p>
        </div>
      ) : (
        <div className={styles.workbench}>
          <div className={styles.inventory}>
            <table className="workspace-table">
              <caption className="sr-only">
                Select a cluster to inspect its evidence and task links
              </caption>
              <thead>
                <tr>
                  <th scope="col">Cluster</th>
                  <th scope="col">Volume</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((cluster) => (
                  <tr
                    key={cluster.id}
                    className={
                      cluster.id === selected?.id ? styles.selected : undefined
                    }
                  >
                    <td>
                      <button
                        type="button"
                        className={styles.clusterButton}
                        aria-pressed={cluster.id === selected?.id}
                        onClick={() => {
                          setSelectedId(cluster.id);
                          setManualTaskKey("");
                        }}
                      >
                        <strong>{cluster.title}</strong>
                        <small>
                          {label(cluster.provider)} ·{" "}
                          {cluster.component || "Component unspecified"}
                        </small>
                        <span>
                          {cluster.tracking === "tracked"
                            ? "Human-confirmed task"
                            : cluster.tracking === "suggested"
                              ? "Suggested match"
                              : "Untracked"}
                          {cluster.unavailable ? " · source unavailable" : ""}
                        </span>
                      </button>
                    </td>
                    <td className={styles.volume}>
                      {cluster.occurrenceVolume.toLocaleString()}
                      <small>max. window</small>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selected && (
            <section
              key={selected.id}
              id={`defect-${selected.id}`}
              className={`panel ${styles.detail}`}
              aria-label="Selected cluster details"
            >
              <h2>{selected.title}</h2>
              <p className="text-muted">
                {selected.component || "Component unspecified"} ·{" "}
                {selected.release || "Release unspecified"} ·{" "}
                {selected.environment || "Environment unspecified"} ·{" "}
                {selected.platform || "Platform unspecified"}
              </p>
              <p>
                <strong>{selected.occurrenceVolume.toLocaleString()}</strong>{" "}
                maximum reported window count. Not unique users or a total
                across overlapping windows.
              </p>
              {selected.unavailable && (
                <p role="note" className="text-error">
                  Source unavailable. Retained evidence is not a fresh
                  assessment.
                </p>
              )}
              {selected.caution && <p role="note">{selected.caution}</p>}
              <div
                className={styles.detailNavigation}
                aria-label="Cluster detail sections"
              >
                <button
                  type="button"
                  className="btn-secondary"
                  aria-pressed={detail === "tasks"}
                  onClick={() => setDetail("tasks")}
                >
                  Task mapping
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  aria-pressed={detail === "evidence"}
                  onClick={() => setDetail("evidence")}
                >
                  Signal evidence
                </button>
              </div>
              {detail === "tasks" ? (
                <>
                  <h3>Human-confirmed task links</h3>
                  {!selected.links.some(
                    (link) => link.status === "confirmed",
                  ) && (
                    <p className="text-muted">
                      No human-confirmed link for this cluster.
                    </p>
                  )}
                  {selected.links
                    .filter((link) => link.status === "confirmed")
                    .map((link) => (
                      <div className={styles.task} key={link.taskKey}>
                        <TaskSnapshot
                          task={link.task}
                          status="confirmed"
                          onReview={
                            !link.task.url && canEdit
                              ? () =>
                                  onReview(
                                    selected.id,
                                    link.taskKey,
                                    "confirmed",
                                  )
                              : undefined
                          }
                        />
                        <p>
                          {link.stale
                            ? "Evidence changed since confirmation; review this retained link again."
                            : "Human-confirmed against this recorded evidence."}
                        </p>
                        {canEdit && (
                          <div className={styles.actions}>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                onReview(selected.id, link.taskKey, "confirmed")
                              }
                            >
                              Review confirmation
                            </button>
                            <button
                              type="button"
                              className="btn-secondary"
                              onClick={() =>
                                onReview(selected.id, link.taskKey, "rejected")
                              }
                            >
                              Review rejection
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  <h3>Suggested matches</h3>
                  {!selected.links.some(
                    (link) => link.status === "suggested",
                  ) && (
                    <p className="text-muted">
                      No supported match is suggested from these snapshots.
                    </p>
                  )}
                  {selected.links
                    .filter((link) => link.status === "suggested")
                    .map((link) => (
                      <div className={styles.task} key={link.taskKey}>
                        <TaskSnapshot
                          task={link.task}
                          status="suggested"
                          onReview={
                            canEdit
                              ? () =>
                                  onReview(
                                    selected.id,
                                    link.taskKey,
                                    "confirmed",
                                  )
                              : undefined
                          }
                        />
                        <ul>
                          {link.reasons.map((reason) => (
                            <li key={reason}>{reason}</li>
                          ))}
                        </ul>
                        {canEdit && (
                          <button
                            type="button"
                            className="btn-secondary"
                            onClick={() =>
                              onReview(selected.id, link.taskKey, "rejected")
                            }
                          >
                            Review rejection
                          </button>
                        )}
                      </div>
                    ))}
                  {canEdit && tasks.length > 0 && (
                    <details>
                      <summary>Choose a different imported task</summary>
                      <label className={styles.manualTask}>
                        Tracked task
                        <select
                          value={manualTaskKey}
                          onChange={(event) =>
                            setManualTaskKey(event.target.value)
                          }
                        >
                          <option value="">Choose a recorded task</option>
                          {tasks.map((task) => (
                            <option
                              value={defectRecordKey(task)}
                              key={defectRecordKey(task)}
                            >
                              {label(task.provider)} · {task.externalId} ·{" "}
                              {task.title}
                            </option>
                          ))}
                        </select>
                      </label>
                      <button
                        type="button"
                        className="btn-secondary"
                        disabled={!manualTaskKey}
                        onClick={() =>
                          onReview(selected.id, manualTaskKey, "confirmed")
                        }
                      >
                        Review selected task
                      </button>
                    </details>
                  )}
                  {!canEdit && (
                    <p className="text-muted">
                      A full-seat Editor, Admin or Owner can review and confirm
                      task links.
                    </p>
                  )}
                </>
              ) : (
                <>
                  <h3>Recorded signal summaries</h3>
                  <p className="text-muted">
                    Last recorded occurrence: {date(selected.lastSeen)}. Source
                    citations are imported references, not verification that
                    live access is available.
                  </p>
                  {selected.signals.map((signal) => (
                    <div className={styles.task} key={signal.key}>
                      <strong>
                        {label(signal.provider)} · {signal.externalId}
                      </strong>
                      <p>{signal.title}</p>
                      <p>
                        {signal.occurrences.toLocaleString()} occurrences
                        reported from {date(signal.windowStart)} to{" "}
                        {date(signal.windowEnd)}.
                      </p>
                      {signal.url && (
                        <a
                          href={signal.url}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Open signal source
                        </a>
                      )}
                    </div>
                  ))}
                </>
              )}
              <p className={styles.nextAction}>
                <strong>Next action:</strong> {selected.nextAction}
              </p>
              <CoveredTestCasesPanel
                projectId={projectId}
                target={{
                  provider: "defect",
                  providerOrigin: "vaettir",
                  nativeId: selected.id,
                  kind: "defect",
                  title: selected.title,
                }}
                canEdit={canEdit}
              />
            </section>
          )}
        </div>
      )}
    </section>
  );
}

function ImportChanges({
  preview,
  batch,
}: {
  preview: Preview;
  batch: ImportInput["batch"];
}) {
  return (
    <>
      <h3>Review the import</h3>
      <p>
        {batch.signals?.length ?? 0} signal summaries ·{" "}
        {batch.tasks?.length ?? 0} task snapshots · {batch.sources.length}{" "}
        source scopes.
      </p>
      <p>
        <strong>0 AI credits</strong>. No AI/provider calls or live
        synchronization.
      </p>
      <ul>
        {batch.sources.map((source) => (
          <li key={`${source.provider}:${source.scope}`}>
            {label(source.provider)} / {source.scope}: {source.status}
          </li>
        ))}
      </ul>
      <div className={styles.changeList}>
        <table className="workspace-table">
          <thead>
            <tr>
              <th scope="col">Change</th>
              <th scope="col">Record</th>
            </tr>
          </thead>
          <tbody>
            {preview.changes.map((change) => (
              <tr key={`${change.record}:${change.key}`}>
                <td>{label(change.kind)}</td>
                <td>
                  {change.title}
                  <small>{label(change.record)}</small>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-muted">
        Missing records are retained. Stale incoming snapshots do not replace
        newer evidence. Metadata labels may be redacted during validation. Human
        decisions are retained; affected links can become stale.
      </p>
    </>
  );
}

export default function DefectMapPanel({ projectId }: { projectId: string }) {
  const permissions = useProjectPermissions(projectId);
  const snapshot = trpcReact.defectMap.get.useQuery({ projectId });
  const previewMutation = trpcReact.defectMap.previewImport.useMutation();
  const importMutation = trpcReact.defectMap.approveImport.useMutation();
  const linkMutation = trpcReact.defectMap.decideLink.useMutation();
  const [importOpen, setImportOpen] = useState(false);
  const [importStep, setImportStep] = useState<
    "permission" | "export" | "review"
  >("permission");
  const [permission, setPermission] = useState(false);
  const [json, setJson] = useState("");
  const [draft, setDraft] = useState<{
    batch: ImportInput["batch"];
    preview: Preview;
  } | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkReview, setLinkReview] = useState<{
    cluster: Cluster;
    task: Task;
    version: number;
    status: "confirmed" | "rejected";
  } | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const screenHeading = useRef<HTMLHeadingElement>(null);
  const freshAccess =
    permissions.loaded &&
    permissions.canEdit &&
    snapshot.isSuccess &&
    !snapshot.error;
  const canEdit = freshAccess && !receipt && !busy;
  useLayoutEffect(() => {
    const heading = screenHeading.current;
    if (heading?.closest("dialog")?.open && heading.getClientRects().length)
      heading.focus();
  }, [importStep, importOpen]);
  async function refresh() {
    permissions.retryAccess();
    await snapshot.refetch();
  }
  async function previewImport() {
    if (!freshAccess || busy || !permission || receipt) return;
    setBusy(true);
    setError(null);
    try {
      if (new TextEncoder().encode(json).byteLength > 150_000)
        throw new Error("Keep the normalized JSON export below 150 KB.");
      const batch = defectBatchSchema.parse(JSON.parse(json));
      const preview = await previewMutation.mutateAsync({
        projectId,
        batch,
        approveMetadataRead: true,
      });
      setDraft({ batch, preview });
      setImportStep("review");
    } catch (cause) {
      setError(message(cause));
    } finally {
      setBusy(false);
    }
  }
  async function sendWrite(attempt: Receipt) {
    if (!freshAccess || busy) return;
    setReceipt(attempt);
    setBusy(true);
    setError(null);
    try {
      if (attempt.kind === "import")
        await importMutation.mutateAsync(attempt.input);
      else await linkMutation.mutateAsync(attempt.input);
    } catch (cause) {
      const known = rejectionCode(cause) !== null;
      setReceipt({
        ...attempt,
        ambiguous: attempt.ambiguous || !known,
        rejected: known && !attempt.ambiguous,
      });
      setError(message(cause));
      setBusy(false);
      return;
    }
    setReceipt(null);
    setBusy(false);
    setImportOpen(false);
    setLinkOpen(false);
    setLinkReview(null);
    setDraft(null);
    setImportStep("permission");
    setPermission(false);
    setJson("");
    setNotice(
      attempt.kind === "import"
        ? "Reviewed import saved. Task suggestions still need human confirmation."
        : "Reviewed task-link decision saved. This does not establish a runtime fix.",
    );
    await snapshot.refetch();
  }
  function openLink(
    clusterId: string,
    taskKey: string,
    status: "confirmed" | "rejected",
  ) {
    if (!canEdit || !snapshot.data) return;
    const cluster = snapshot.data.map.clusters.find(
      (item) => item.id === clusterId,
    );
    const task = snapshot.data.document.tasks.find(
      (item) => defectRecordKey(item) === taskKey,
    );
    if (cluster && task) {
      setError(null);
      setLinkReview({ cluster, task, version: snapshot.data.version, status });
      setLinkOpen(true);
    }
  }
  function approveImport() {
    if (!draft || !permission || !canEdit) return;
    void sendWrite({
      kind: "import",
      ambiguous: false,
      rejected: false,
      input: {
        projectId,
        batch: draft.batch,
        version: draft.preview.version,
        previewHash: draft.preview.previewHash,
        requestId: crypto.randomUUID(),
        approveMetadataRead: true,
        approveImport: true,
      },
    });
  }
  function approveLink() {
    if (!linkReview || !canEdit) return;
    void sendWrite({
      kind: "link",
      ambiguous: false,
      rejected: false,
      input: {
        projectId,
        version: linkReview.version,
        clusterId: linkReview.cluster.id,
        taskKey: defectRecordKey(linkReview.task),
        status: linkReview.status,
        requestId: crypto.randomUUID(),
      },
    });
  }
  async function discardRejected() {
    if (
      !receipt ||
      receipt.ambiguous ||
      !receipt.rejected ||
      busy ||
      !freshAccess
    )
      return;
    setBusy(true);
    const current = await snapshot.refetch();
    setBusy(false);
    if (current.error || !current.data) return;
    setReceipt(null);
    setError(null);
    if (receipt.kind === "import") {
      setDraft(null);
      setImportStep("export");
    } else {
      const task = current.data.document.tasks.find(
        (item) => defectRecordKey(item) === receipt.input.taskKey,
      );
      const cluster = current.data.map.clusters.find(
        (item) => item.id === receipt.input.clusterId,
      );
      if (task && cluster)
        setLinkReview({
          task,
          cluster,
          version: current.data.version,
          status: receipt.input.status,
        });
      else {
        setLinkReview(null);
        setLinkOpen(false);
      }
    }
  }
  const recovery = receipt && (
    <div className={styles.recovery} role="note">
      <p>
        {receipt.ambiguous
          ? "The response was not confirmed. Keep this exact reviewed request; it may already have been saved. Retrying uses the same receipt."
          : "The server rejected this reviewed request. Retry the exact receipt, or deliberately refresh and review the current map before a new write."}
      </p>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={!freshAccess || busy}
          onClick={() => void sendWrite(receipt)}
        >
          Retry exact reviewed request
        </button>
        {receipt.rejected && !receipt.ambiguous && (
          <button
            type="button"
            className="btn-secondary"
            disabled={!freshAccess || busy}
            onClick={() => void discardRejected()}
          >
            Discard rejected receipt and review current map
          </button>
        )}
      </div>
    </div>
  );
  return (
    <section className={styles.root}>
      <PageHeading
        eyebrow="Project intelligence"
        title="Defect map"
        description="Compare recorded crash and analytics summaries with Jira, Linear and Asana tasks."
        actions={
          <button
            type="button"
            disabled={!canEdit}
            onClick={() => {
              setError(null);
              setImportOpen(true);
            }}
          >
            Import normalized export
          </button>
        }
      />
      <p role="note" className="text-muted">
        Occurrence volume is not unique users. Suggested matches need human
        review. A closed task is not evidence that a runtime defect is fixed.
      </p>
      <div className={styles.statusLine}>
        <span>
          Reviewed metadata exports only · Live sync unavailable · No AI · 0
          credits
        </span>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => void refresh()}
          disabled={busy || snapshot.isFetching}
        >
          Refresh access and evidence
        </button>
      </div>
      {(permissions.accessError || snapshot.error) && (
        <p role="alert" className="text-error">
          {permissions.accessError ?? snapshot.error?.message} Cached evidence
          and reviewed drafts are retained; writes are disabled until access and
          evidence refresh successfully.
        </p>
      )}
      {!permissions.loaded && !permissions.accessError && (
        <p role="status">Checking project access…</p>
      )}
      {permissions.loaded && !permissions.canEdit && (
        <p className="text-muted">
          Read-only view. A full-seat Editor, Admin or Owner is required to
          import and confirm links.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {!snapshot.data && !snapshot.error && (
        <p role="status">Loading defect evidence…</p>
      )}
      {receipt && !importOpen && !linkOpen && (
        <div className="panel">
          <p>
            A reviewed{" "}
            {receipt.kind === "import" ? "import" : "task-link decision"} is
            awaiting confirmation.
          </p>
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if (receipt.kind === "import") setImportOpen(true);
              else setLinkOpen(true);
            }}
          >
            Resume reviewed request
          </button>
        </div>
      )}
      {snapshot.data && (
        <>
          <div className={styles.metrics} aria-label="Defect-map summary">
            <div>
              <strong>{snapshot.data.map.clusters.length}</strong>
              <span>Recorded clusters</span>
            </div>
            <div>
              <strong>{snapshot.data.map.untracked}</strong>
              <span>Untracked clusters</span>
            </div>
            <div>
              <strong>{snapshot.data.map.suggested}</strong>
              <span>Suggestions only</span>
            </div>
            <div>
              <strong>{snapshot.data.map.unavailableSources}</strong>
              <span>Unavailable sources</span>
            </div>
          </div>
          <DefectClusterWorkbench
            projectId={projectId}
            clusters={snapshot.data.map.clusters}
            tasks={snapshot.data.document.tasks}
            canEdit={canEdit}
            onReview={openLink}
          />
        </>
      )}
      <Modal
        open={importOpen}
        onClose={() => {
          if (!busy) setImportOpen(false);
        }}
        title="Import defect evidence"
        dismissible={!busy}
      >
        <h3 ref={screenHeading} tabIndex={-1}>
          {importStep === "permission"
            ? "1. Confirm processing permission"
            : importStep === "export"
              ? "2. Choose a normalized export"
              : "3. Review before saving"}
        </h3>
        {!freshAccess && (
          <p role="alert">
            Import is paused until current full-seat editor access and defect
            evidence are verified. Your draft is retained.
          </p>
        )}
        <fieldset
          disabled={!freshAccess || busy || !!receipt}
          className={styles.fieldset}
        >
          {importStep === "permission" && (
            <>
              <p>
                Import signal summaries and tracked-task snapshots only. No
                source fetch, provider connection or AI processing is performed.
              </p>
              <label className={styles.permission}>
                <input
                  type="checkbox"
                  checked={permission}
                  onChange={(event) => setPermission(event.target.checked)}
                />
                <span>
                  I have permission to import these summaries and excluded raw
                  traces, personal data and secrets.
                </span>
              </label>
              <button
                type="button"
                disabled={!permission}
                onClick={() => setImportStep("export")}
              >
                Continue
              </button>
            </>
          )}
          {importStep === "export" && (
            <>
              <p>
                Native provider exports must be normalized to Vaettir&apos;s
                metadata schema first. Up to 100 signal summaries, 100 tasks and
                20 explicit source scopes per batch; below 150 KB.
              </p>
              <button
                type="button"
                className="btn-secondary"
                onClick={downloadSample}
              >
                Download normalized example
              </button>
              <label className={styles.file}>
                JSON export file (optional, below 150 KB)
                <input
                  type="file"
                  accept=".json,application/json"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (!freshAccess || !permission || busy || receipt || !file)
                      return;
                    setError(null);
                    if (file.size > 150_000) {
                      setError("Keep the normalized JSON export below 150 KB.");
                      return;
                    }
                    setBusy(true);
                    try {
                      setJson(await file.text());
                    } catch (cause) {
                      setError(message(cause));
                    } finally {
                      setBusy(false);
                    }
                  }}
                />
              </label>
              <label className={styles.json}>
                Normalized JSON
                <textarea
                  rows={7}
                  value={json}
                  onChange={(event) => setJson(event.target.value)}
                  maxLength={150_000}
                  spellCheck={false}
                />
              </label>
              <p className="text-muted">
                0 AI credits. This previews metadata only and does not save it.
                Unknown fields, raw traces and credentials are rejected; labels
                may be redacted.
              </p>
              <div className={styles.actions}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setImportStep("permission")}
                >
                  Back
                </button>
                <button
                  type="button"
                  disabled={!json.trim() || !permission}
                  onClick={() => void previewImport()}
                >
                  Preview import
                </button>
              </div>
            </>
          )}
          {importStep === "review" && draft && (
            <>
              <ImportChanges preview={draft.preview} batch={draft.batch} />
              <div className={styles.actions}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setImportStep("export")}
                >
                  Back
                </button>
                <button type="button" onClick={approveImport}>
                  Approve import
                </button>
              </div>
            </>
          )}
        </fieldset>
        {busy && <p role="status">Processing this reviewed request…</p>}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {receipt?.kind === "import" && recovery}
        {!freshAccess && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Retry access and evidence
          </button>
        )}
      </Modal>
      <Modal
        open={linkOpen}
        onClose={() => {
          if (!busy) setLinkOpen(false);
        }}
        title="Review task mapping"
        dismissible={!busy}
      >
        {linkReview && (
          <>
            <h3>{linkReview.cluster.title}</h3>
            <TaskSnapshot task={linkReview.task} />
            <p>
              {linkReview.status === "confirmed"
                ? "Confirm that this imported task tracks this defect cluster."
                : "Reject this task match. Signal evidence and the task snapshot will remain."}
            </p>
            <p className="text-muted">
              Human confirmation records a relationship, not a deployed fix.
              Closed tasks still need runtime evidence.
            </p>
            <button type="button" disabled={!canEdit} onClick={approveLink}>
              {linkReview.status === "confirmed"
                ? "Confirm task link"
                : "Reject task match"}
            </button>
          </>
        )}
        {busy && <p role="status">Saving reviewed decision…</p>}
        {error && (
          <p role="alert" className="text-error">
            {error}
          </p>
        )}
        {receipt?.kind === "link" && recovery}
        {!freshAccess && (
          <button
            type="button"
            className="btn-secondary"
            disabled={busy}
            onClick={() => void refresh()}
          >
            Retry access and evidence
          </button>
        )}
      </Modal>
    </section>
  );
}
