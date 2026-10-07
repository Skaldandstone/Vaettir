"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import {
  trpcReact,
  useReadOnlySeat,
  type RouterOutputs,
} from "@/lib/trpcReact";
import { ReadinessBadge } from "@/components/ReadinessBadge";
import { DistributionBar, ScoreRing } from "@/components/MetricVisuals";
import { ReleaseSnapshotExport } from "@/components/ReleaseSnapshotExport";
import { Modal } from "@/components/Modal";
import { releasePlanChoices } from "@/lib/release-planning-draft";
import { CriterionDescriptionEditor } from "@/components/CriterionDescriptionEditor";
import { CriterionVerdictEditor } from "@/components/CriterionVerdictEditor";
import { AttachUnassignedPlan } from "@/components/AttachUnassignedPlan";
import { PlanGovernanceHistory } from "@/components/PlanGovernanceHistory";
import { GovernedCriterionCollection } from "@/components/GovernedCriterionCollection";

const STATUSES = [
  "PLANNING",
  "IN_TESTING",
  "READY",
  "SHIPPED",
  "BLOCKED",
] as const;

// 2026-08-28: a stakeholder-readable narrative draft of this release's
// readiness, generated from the exact same live readiness/risk-flag data
// this page already shows -- review-before-share only, nothing here is
// ever posted or emailed on its own. Grounding-in-a-real-build follows the
// same pattern as GenerateStrategyModal (test-plans/page.tsx).
function GenerateSummaryModal({
  open,
  onClose,
  releaseId,
  projectRepo,
}: {
  open: boolean;
  onClose: () => void;
  releaseId: string;
  projectRepo: { repoUrl: string | null; defaultBranch: string } | null;
}) {
  const [groundInBuild, setGroundInBuild] = useState(false);
  const [baseRef, setBaseRef] = useState("");
  const [headRef, setHeadRef] = useState("");
  const [draft, setDraft] = useState<
    RouterOutputs["releases"]["generateSummaryDraft"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const generateMutation =
    trpcReact.releases.generateSummaryDraft.useMutation();

  async function generate() {
    setError(null);
    setCopied(false);
    try {
      const result = await generateMutation.mutateAsync({
        releaseId,
        ...(groundInBuild && headRef.trim()
          ? { baseRef: baseRef.trim() || undefined, headRef: headRef.trim() }
          : {}),
      });
      setDraft(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function copyToClipboard() {
    if (!draft) return;
    const text = [
      `${SECTION_LABELS.overview}\n${draft.overview}`,
      `${SECTION_LABELS.whatChanged}\n${draft.whatChanged}`,
      `${SECTION_LABELS.coverage}\n${draft.coverage}`,
      `${SECTION_LABELS.risks}\n${draft.risks}`,
      `${SECTION_LABELS.recommendation}\n${draft.recommendation}`,
    ].join("\n\n");
    navigator.clipboard.writeText(text).then(() => setCopied(true));
  }

  function close() {
    setDraft(null);
    setError(null);
    setCopied(false);
    onClose();
  }

  const generating = generateMutation.isPending;

  return (
    <Modal open={open} onClose={close} title="Generate a release summary">
      <div style={{ display: "grid", gap: 10, minWidth: 460, maxWidth: 560 }}>
        <p className="text-muted" style={{ fontSize: 13, marginTop: -4 }}>
          A stakeholder-readable draft, grounded in this release's real
          readiness score, acceptance criteria, and open risk flags. Review and
          edit before sharing -- nothing here is posted or sent automatically.
        </p>
        {projectRepo?.repoUrl && (
          <div
            style={{
              border: "1px solid var(--line)",
              borderRadius: 6,
              padding: 8,
            }}
          >
            <label style={{ fontSize: 13 }}>
              <input
                type="checkbox"
                checked={groundInBuild}
                onChange={(e) => setGroundInBuild(e.target.checked)}
              />{" "}
              Ground in a real build (the actual commits between two refs)
            </label>
            {groundInBuild && (
              <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                <input
                  value={baseRef}
                  onChange={(e) => setBaseRef(e.target.value)}
                  placeholder={`Base ref (default: ${projectRepo.defaultBranch})`}
                  style={{ flex: 1, fontSize: 13 }}
                />
                <input
                  value={headRef}
                  onChange={(e) => setHeadRef(e.target.value)}
                  placeholder="Head ref (tag, branch, or commit for this build)"
                  style={{ flex: 1, fontSize: 13 }}
                />
              </div>
            )}
          </div>
        )}
        <button
          className="btn-secondary"
          onClick={generate}
          disabled={generating || (groundInBuild && !headRef.trim())}
        >
          {generating
            ? "Generating…"
            : draft
              ? "Regenerate"
              : "Generate summary"}
        </button>

        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

        {draft?.groundedInCommits && (
          <details style={{ fontSize: 12 }}>
            <summary>
              Grounded in {draft.groundedInCommits.length} real commit(s)
            </summary>
            <ul style={{ margin: "4px 0 0 16px", padding: 0 }}>
              {draft.groundedInCommits.map((c) => (
                <li key={c.sha}>
                  <code>{c.sha}</code> {c.subject}
                </li>
              ))}
            </ul>
          </details>
        )}

        {draft && (
          <>
            {(
              [
                ["overview", SECTION_LABELS.overview],
                ["whatChanged", SECTION_LABELS.whatChanged],
                ["coverage", SECTION_LABELS.coverage],
                ["risks", SECTION_LABELS.risks],
                ["recommendation", SECTION_LABELS.recommendation],
              ] as const
            ).map(([key, label]) => (
              <label key={key}>
                {label}
                <textarea
                  value={draft[key]}
                  onChange={(e) =>
                    setDraft({ ...draft, [key]: e.target.value })
                  }
                  rows={key === "overview" ? 2 : 3}
                  style={{ width: "100%", fontSize: 13 }}
                />
              </label>
            ))}
            <div
              style={{
                display: "flex",
                gap: 8,
                justifyContent: "flex-end",
                marginTop: 8,
              }}
            >
              <button className="btn-secondary" onClick={close}>
                Close
              </button>
              <button className="btn-primary" onClick={copyToClipboard}>
                {copied ? "Copied!" : "Copy to clipboard"}
              </button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

const SECTION_LABELS = {
  overview: "Overview",
  whatChanged: "What changed",
  coverage: "Coverage",
  risks: "Risks",
  recommendation: "Recommendation",
} as const;

// P1-15
export default function ReleaseReadinessPage() {
  const { projectId, releaseId } = useParams<{
    projectId: string;
    releaseId: string;
  }>();
  const utils = trpcReact.useUtils();
  const readOnly = useReadOnlySeat(projectId);

  const projectQuery = trpcReact.project.byId.useQuery({ id: projectId });
  const releaseQuery = trpcReact.releases.byId.useQuery({ id: releaseId });
  const readinessQuery = trpcReact.releases.readiness.useQuery({ releaseId });
  const testPlansQuery = trpcReact.releases.listTestPlans.useQuery({
    releaseId,
  });
  const riskFlagsQuery = trpcReact.releases.listRiskFlags.useQuery({
    releaseId,
  });
  const historyQuery = trpcReact.releases.readinessHistory.useQuery({
    releaseId,
    limit: 20,
  });
  const allPlansQuery = trpcReact.testPlans.list.useQuery({ projectId });

  const projectRepo = projectQuery.data
    ? {
        repoUrl: projectQuery.data.repoUrl,
        defaultBranch: projectQuery.data.defaultBranch,
      }
    : null;
  const release = releaseQuery.data;
  const readiness = readinessQuery.data;
  const testPlans = testPlansQuery.data ?? [];
  const riskFlags = riskFlagsQuery.data ?? [];
  const allPlans = allPlansQuery.data ?? [];

  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);
  const [summaryModalOpen, setSummaryModalOpen] = useState(false);

  // Everything the original load() refetched: every releases.* query for this
  // release plus the attachable-plans list (attach/detach changes releaseId
  // on a plan).
  function reload() {
    void utils.releases.invalidate();
    void utils.testPlans.list.invalidate({ projectId });
  }

  const updateStatusMutation = trpcReact.releases.updateStatus.useMutation();
  const setReleaseMutation = trpcReact.testPlans.setRelease.useMutation();
  const resolveRiskFlagMutation =
    trpcReact.releases.resolveRiskFlag.useMutation();

  async function updateStatus(status: string) {
    setError(null);
    if (status === "READY") {
      try {
        const gate = await utils.releases.checkGate.fetch({ releaseId });
        if (!gate.passes && gate.policy === "HARD_BLOCK") {
          alert(
            `This release can't be marked READY yet -- your organization requires these to pass first:\n\n${gate.reasons.join("\n")}`,
          );
          return;
        }
        if (!gate.passes) {
          const proceed = confirm(
            `This release isn't fully ready:\n\n${gate.reasons.join("\n")}\n\nMark it READY anyway?`,
          );
          if (!proceed) return;
        }
      } catch {
        setError("Release gates could not be checked. Refresh the workspace and try READY again; no status change was requested.");
        return;
      }
    }
    try {
      await updateStatusMutation.mutateAsync({
        id: releaseId,
        status: status as never,
      });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function detachPlan(testPlanId: string) {
    try {
      await setReleaseMutation.mutateAsync({ testPlanId, releaseId: null });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleResolve(id: string, resolved: boolean) {
    try {
      await resolveRiskFlagMutation.mutateAsync({ id, resolved });
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const pageError =
    releaseQuery.error?.message ??
    readinessQuery.error?.message ??
    testPlansQuery.error?.message ??
    riskFlagsQuery.error?.message ??
    null;
  // An ordinary background read failure must not unmount retained wording or
  // uncertain attachment requests while the original workspace is loaded.
  if (pageError && (!release || !readiness))
    return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
  if (!release || !readiness) return <p>Loading…</p>;

  const { available: attachablePlans, assignedElsewhere } = releasePlanChoices(
    allPlans,
    releaseId,
  );
  const visibleFlags = showResolved
    ? riskFlags
    : riskFlags.filter((f) => !f.resolvedAt);

  return (
    <div style={{ maxWidth: 800 }}>
      {pageError && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          The workspace could not fully refresh: {pageError}. Existing drafts
          remain mounted; current authorization is rechecked before any save.
        </p>
      )}
      {error && (
        <p role="alert" style={{ color: "var(--ember)" }}>
          {error} Your current workspace remains open.{" "}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </p>
      )}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          marginBottom: 4,
        }}
      >
        <h1 style={{ margin: 0 }}>{release.name}</h1>
        <ReadinessBadge score={readiness.score} label={readiness.label} />
      </div>
      {release.goals.length > 0 && (
        <p>
          <strong>Release goals:</strong> {release.goals.join(" · ")}
        </p>
      )}
      <p className="text-muted" style={{ marginBottom: 12 }}>
        <a href={`/projects/${projectId}/test-strategy`}>← Test strategy</a>
        {release.targetDate &&
          ` · target ${new Date(release.targetDate).toLocaleDateString()}`}
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
        <ReleaseSnapshotExport
          projectId={projectId}
          releaseId={releaseId}
          organizationId={projectQuery.data?.organizationId}
          active={!projectQuery.error && !projectQuery.isFetching && !projectQuery.isPaused && projectQuery.data?.id === projectId &&
            !releaseQuery.error && !releaseQuery.isFetching && !releaseQuery.isPaused && release.projectId === projectId}
        />
        <button
          className="btn-secondary"
          style={{ fontSize: 13 }}
          onClick={() => setSummaryModalOpen(true)}
        >
          Generate release summary
        </button>
      </div>

      <GenerateSummaryModal
        open={summaryModalOpen}
        onClose={() => setSummaryModalOpen(false)}
        releaseId={releaseId}
        projectRepo={projectRepo}
      />

      <section
        className="panel release-health-summary"
        aria-labelledby="release-health-title"
      >
        <ScoreRing value={readiness.score} label="Release readiness" />
        <div>
          <h2 id="release-health-title">Release health</h2>
          <p className="text-muted">
            Readiness combines acceptance evidence and unresolved release risk.
            The detail below remains the source of truth.
          </p>
          <DistributionBar
            label="Acceptance criteria status"
            segments={[
              { label: "Met", value: readiness.criteria.met, tone: "success" },
              {
                label: "At risk",
                value: readiness.criteria.atRisk,
                tone: "warning",
              },
              {
                label: "Not met",
                value: readiness.criteria.notMet,
                tone: "danger",
              },
              {
                label: "Pending",
                value: readiness.criteria.pending,
                tone: "neutral",
              },
            ]}
          />
        </div>
        <div
          className={`release-health-risk ${readiness.riskFlags.openTotal > 0 ? "has-risk" : "is-clear"}`}
        >
          <span>Open risk flags</span>
          <strong>{readiness.riskFlags.openTotal}</strong>
          <small>
            {readiness.riskFlags.critical} critical · {readiness.riskFlags.high}{" "}
            high
          </small>
        </div>
      </section>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="eyebrow">Status</div>
        {readOnly ? (
          <p style={{ margin: 0 }}>{release.status}</p>
        ) : (
          <select
            value={release.status}
            onChange={(e) => updateStatus(e.target.value)}
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Acceptance criteria</h2>
        <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
          {readiness.criteria.met} met · {readiness.criteria.atRisk} at risk ·{" "}
          {readiness.criteria.notMet} not met · {readiness.criteria.pending}{" "}
          pending
        </p>

        {testPlans.map((p) => (
          <div key={p.id} style={{ marginBottom: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
              }}
            >
              <strong>
                <a href={`/projects/${projectId}/test-plans/${p.id}`}>
                  {p.name}
                </a>{" "}
                <span
                  className="text-muted"
                  style={{ fontWeight: 400, fontSize: 12 }}
                >
                  [{p.testPlanType.name}]
                </span>
              </strong>
              {!readOnly && (
                <button
                  className="btn-secondary"
                  onClick={() => detachPlan(p.id)}
                  style={{ fontSize: 12 }}
                >
                  Detach
                </button>
              )}
            </div>
            <a
              className="btn-secondary"
              style={{ fontSize: 12, marginTop: 6 }}
              href={`/projects/${projectId}/test-plans/${p.id}`}
            >
              {readOnly
                ? "View plan criteria"
                : "Open plan to add or manage criteria"}
            </a>
            <ul style={{ listStyle: "none", padding: 0, marginTop: 6 }}>
              {p.acceptanceCriteria.map((c) => (
                <li
                  key={c.id}
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 8,
                    padding: "4px 0",
                  }}
                >
                  <div style={{ minWidth: 0, overflowWrap: "anywhere" }}>
                    <span style={{ whiteSpace: "pre-wrap" }}>{c.description}</span>{" "}
                    <CriterionDescriptionEditor
                      projectId={projectId}
                      testPlanId={p.id}
                      criterionId={c.id}
                      onChanged={reload}
                    />
                  </div>
                  <CriterionVerdictEditor
                    projectId={projectId}
                    testPlanId={p.id}
                    criterionId={c.id}
                    status={c.status}
                    computed={c.autoComputed}
                    onChanged={reload}
                  />
                </li>
              ))}
              {p.acceptanceCriteria.length === 0 && (
                <li className="text-muted" style={{ fontSize: 13 }}>
                  No acceptance criteria on this plan yet.
                </li>
              )}
            </ul>
            <GovernedCriterionCollection key={`${projectId}:${p.id}`} projectId={projectId} testPlanId={p.id} readOnly={readOnly} onChanged={reload} />
            <PlanGovernanceHistory projectId={projectId} testPlanId={p.id} />
          </div>
        ))}
        {testPlans.length === 0 && (
          <p className="text-muted">
            No test plans attached to this release yet.{" "}
            {readOnly
              ? "An editor can create or attach a plan."
              : "Create a test plan, then return here to attach it. New criteria start pending, not met."}
          </p>
        )}

        <AttachUnassignedPlan
          projectId={projectId}
          releaseId={releaseId}
          releaseStatus={release.status}
          plans={
            allPlansQuery.isFetching || allPlansQuery.error
              ? []
              : attachablePlans
          }
          onChanged={reload}
        />
        {!readOnly && (
          <div
            style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 12 }}
          >
            <a
              className="btn-secondary"
              href={`/projects/${projectId}/test-plans`}
            >
              Create a test plan
            </a>
          </div>
        )}
        {!readOnly && allPlansQuery.error && (
          <p role="alert">
            The available plans could not be refreshed. No reassignment was
            requested.{" "}
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void allPlansQuery.refetch()}
            >
              Retry plans
            </button>
          </p>
        )}
        {!readOnly &&
          !allPlansQuery.isLoading &&
          !allPlansQuery.error &&
          attachablePlans.length === 0 && (
            <p className="text-muted">
              No unassigned plans are available. Create a plan or manage a
              previously assigned plan in its own release.
            </p>
          )}
        {!allPlansQuery.error && assignedElsewhere.length > 0 && (
          <details style={{ marginTop: 12 }}>
            <summary>
              Plans assigned to other releases ({assignedElsewhere.length})
            </summary>
            <p className="text-muted">
              Already assigned plans are excluded from this picker. Open their
              current release to manage its quality scope.
            </p>
            <ul>
              {assignedElsewhere.map((plan) => (
                <li key={plan.id}>
                  <a href={`/projects/${projectId}/test-plans/${plan.id}`}>
                    {plan.name}
                  </a>
                  {" · "}
                  <a href={`/projects/${projectId}/releases/${plan.releaseId}`}>
                    Open its assigned release
                  </a>
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      <div className="panel">
        <div className="panel" style={{ marginBottom: 20 }}>
          <h2 style={{ marginTop: 0 }}>Readiness history</h2>
          <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
            Checked every five minutes. A change in the READY / AT RISK /
            BLOCKED label notifies subscribed webhooks, Slack, and mobile
            devices; score-only moves are recorded here without a notification.
          </p>
          {(historyQuery.data ?? []).length === 0 ? (
            <p className="text-muted" style={{ fontSize: 13 }}>
              No snapshots yet - the first one lands within five minutes of a
              release being created.
            </p>
          ) : (
            <ul
              style={{ listStyle: "none", padding: 0, margin: 0, fontSize: 13 }}
            >
              {(historyQuery.data ?? []).map((snap) => (
                <li
                  key={snap.id}
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: "4px 0",
                    borderBottom: "1px solid var(--line)",
                  }}
                >
                  <span className="text-muted" style={{ minWidth: 160 }}>
                    {new Date(snap.computedAt).toLocaleString()}
                  </span>
                  <span style={{ minWidth: 140 }}>
                    {snap.previousLabel && snap.previousLabel !== snap.label
                      ? `${snap.previousLabel} → `
                      : ""}
                    <strong>{snap.label}</strong>
                  </span>
                  <span>score {snap.score}</span>
                  <span className="text-muted">
                    {snap.criteriaMet}/{snap.criteriaTotal} criteria met ·{" "}
                    {snap.openRiskFlags} open flag(s)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "baseline",
          }}
        >
          <h2 style={{ marginTop: 0 }}>Risk flags</h2>
          <label className="text-muted" style={{ fontSize: 12 }}>
            <input
              type="checkbox"
              checked={showResolved}
              onChange={(e) => setShowResolved(e.target.checked)}
            />{" "}
            show resolved
          </label>
        </div>
        <ul style={{ listStyle: "none", padding: 0 }}>
          {visibleFlags.map((f) => (
            <li
              key={f.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                gap: 8,
                borderBottom: "1px solid var(--line)",
                padding: "6px 0",
                opacity: f.resolvedAt ? 0.5 : 1,
              }}
            >
              <div>
                <strong
                  style={{
                    color:
                      f.severity === "CRITICAL" || f.severity === "HIGH"
                        ? "var(--ember)"
                        : "var(--fg)",
                  }}
                >
                  {f.severity}
                </strong>{" "}
                [{f.source}] {f.description}
                {f.resolvedAt && (
                  <span style={{ color: "var(--frost)" }}> — resolved</span>
                )}
              </div>
              {!readOnly && (
                <button
                  className="btn-secondary"
                  onClick={() => toggleResolve(f.id, !f.resolvedAt)}
                  style={{ fontSize: 12, whiteSpace: "nowrap" }}
                >
                  {f.resolvedAt ? "Reopen" : "Resolve"}
                </button>
              )}
            </li>
          ))}
          {visibleFlags.length === 0 && <p className="text-muted">None.</p>}
        </ul>
      </div>
    </div>
  );
}
