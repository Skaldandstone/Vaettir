"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact, type RouterInputs } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";
import { ReadinessBadge } from "@/components/ReadinessBadge";
import { TrendChart } from "@/components/TrendChart";
import { DistributionBar, ScoreRing } from "@/components/MetricVisuals";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { CreationWizard, WizardChoices } from "@/components/CreationWizard";
import { ReleaseDraftEvidenceReview } from "@/components/ReleaseDraftEvidenceReview";
import { useManualExecutionAccess } from "@/lib/use-manual-execution-access";
import { retainAnalysisRequest } from "@/lib/analysis-request-recovery";
import {
  releaseCriteriaDraftProblem,
  saveReleaseCriterionDraft,
  addReleaseGoal,
  releaseGoalDraftProblem,
  releaseGoalPresets,
  specializedReleaseGoalPresets,
} from "@/lib/release-planning-draft";

// P1-15
export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
  const access = useManualExecutionAccess(projectId);
  const utils = trpcReact.useUtils();

  const releasesQuery = trpcReact.releases.list.useQuery({ projectId });
  const trendQuery = trpcReact.releases.trend.useQuery({ projectId });
  const releases = releasesQuery.data ?? [];
  const trend = trendQuery.data ?? [];
  const plansQuery = trpcReact.testPlans.list.useQuery({ projectId });

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [targetDate, setTargetDate] = useState("");
  const [releaseStep, setReleaseStep] = useState(0);
  const [selectedPlanIds, setSelectedPlanIds] = useState<string[]>([]);
  const [releaseGoals, setReleaseGoals] = useState<string[]>([]);
  const [goalDraft, setGoalDraft] = useState("");
  const [goalError, setGoalError] = useState<string | null>(null);
  const [showSpecializedGoals, setShowSpecializedGoals] = useState(false);
  const [newPlanName, setNewPlanName] = useState("");
  const [newCriteria, setNewCriteria] = useState<string[]>([]);
  const [criterionDraft, setCriterionDraft] = useState("");
  const [editingCriterion, setEditingCriterion] = useState<number | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [createRequest, setCreateRequest] = useState<
    RouterInputs["releases"]["create"] | null
  >(null);
  const createUnknown = useRef(false);
  const submitBusy = useRef(false);
  const accessNow = useRef(access);
  useLayoutEffect(() => {
    accessNow.current = access;
  }, [access]);
  const createMutation = trpcReact.releases.create.useMutation();

  async function submit() {
    if (
      !canEdit ||
      !access.canWrite ||
      !access.origin ||
      submitBusy.current ||
      (!createRequest && !name.trim())
    )
      return;
    if (!createRequest && releaseGoalDraftProblem(goalDraft)) {
      setCreateError(releaseGoalDraftProblem(goalDraft));
      return;
    }
    if (
      createRequest &&
      (createRequest.originalOrganizationId !== access.origin.organizationId ||
        createRequest.expectedClerkActorId !== access.origin.clerkActorId ||
        createRequest.projectId !== projectId)
    )
      return;
    setCreateError(null);
    const request = createRequest ?? {
      requestId: crypto.randomUUID(),
      originalOrganizationId: access.origin.organizationId,
      expectedClerkActorId: access.origin.clerkActorId,
      projectId,
      name: name.trim(),
      targetDate: targetDate ? new Date(`${targetDate}T12:00:00`) : undefined,
      testPlanIds: [...selectedPlanIds],
      goals: [...releaseGoals],
      newPlan: newCriteria.length
        ? {
            name:
              newPlanName.trim() || `${name.trim()} quality plan`.slice(0, 200),
            criteria: [...newCriteria],
            wordingMode: "EXACT" as const,
          }
        : undefined,
    };
    setCreateRequest(request);
    submitBusy.current = true;
    try {
      const result = await createMutation.mutateAsync(request);
      if (
        result.requestId !== request.requestId ||
        result.projectId !== request.projectId ||
        result.originalOrganizationId !== request.originalOrganizationId ||
        result.expectedClerkActorId !== request.expectedClerkActorId
      )
        throw Error(
          "The release acknowledgement did not match the retained original request. Restore original access and retry it.",
        );
      if (
        !accessNow.current.canWrite ||
        accessNow.current.origin?.organizationId !==
          request.originalOrganizationId ||
        accessNow.current.origin?.clerkActorId !== request.expectedClerkActorId
      ) {
        createUnknown.current = true;
        setCreateError(
          "The original request was acknowledged, but current account or workspace access changed. Restore original access to confirm it; no new request was created.",
        );
        return;
      }
      setName("");
      setTargetDate("");
      setReleaseStep(0);
      setSelectedPlanIds([]);
      setReleaseGoals([]);
      setGoalDraft("");
      setGoalError(null);
      setNewPlanName("");
      setNewCriteria([]);
      setCriterionDraft("");
      setEditingCriterion(null);
      setCreateOpen(false);
      setCreateRequest(null);
      createUnknown.current = false;
      void utils.releases.list.invalidate({ projectId });
      void utils.releases.trend.invalidate({ projectId });
      void utils.testPlans.list.invalidate({ projectId });
    } catch (cause) {
      const retain = retainAnalysisRequest(createUnknown.current, cause);
      createUnknown.current = retain;
      if (!retain) setCreateRequest(null);
      setCreateError(
        cause instanceof Error
          ? cause.message
          : "Release creation was not acknowledged. Retained scope was not changed.",
      );
    } finally {
      submitBusy.current = false;
    }
  }

  const loading = releasesQuery.isLoading;
  const error = createError ?? releasesQuery.error?.message ?? null;
  const draftProblem = releaseCriteriaDraftProblem({
    planName: newPlanName,
    criteria: newCriteria,
    criterionDraft,
    editingIndex: editingCriterion,
  });

  function saveCriterionDraft() {
    try {
      setNewCriteria(
        saveReleaseCriterionDraft(
          newCriteria,
          criterionDraft,
          editingCriterion,
        ),
      );
      setCriterionDraft("");
      setEditingCriterion(null);
      setCreateError(null);
    } catch (cause) {
      setCreateError(
        cause instanceof Error
          ? cause.message
          : "This criterion draft could not be saved.",
      );
    }
  }

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
        <h1 style={{ margin: 0 }}>Release readiness</h1>
        {canEdit && (
          <button className="btn-primary" onClick={() => setCreateOpen(true)}>
            + New release
          </button>
        )}
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        How well each release held up against its{" "}
        <a href={`/projects/${projectId}/test-strategy`}>test strategy</a>:
        acceptance criteria met, open risk flags, and overall readiness.
      </p>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      {trend.length > 1 && (
        <div
          className="panel"
          style={{
            marginBottom: 20,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 20,
          }}
        >
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Pass rate
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.passRate === null ? null : t.passRate * 100,
              }))}
              formatValue={(v) => `${v.toFixed(0)}%`}
              color="var(--frost)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Coverage
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.coveragePct,
              }))}
              formatValue={(v) => `${v.toFixed(0)}%`}
              color="var(--frost)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Flaky results
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value: t.flakyCount,
              }))}
              formatValue={(v) => `${v}`}
              color="var(--ember)"
            />
          </div>
          <div>
            <div className="eyebrow" style={{ marginBottom: 6 }}>
              Mean time-to-green
            </div>
            <TrendChart
              points={trend.map((t) => ({
                label: t.name,
                value:
                  t.meanTimeToGreenMs === null
                    ? null
                    : t.meanTimeToGreenMs / 60000,
              }))}
              formatValue={(v) => `${v.toFixed(0)} min`}
              color="var(--ember)"
            />
          </div>
        </div>
      )}

      <ul style={{ listStyle: "none", padding: 0 }}>
        {releases.map((r) => (
          <li key={r.id} className="panel release-readiness-card">
            <a
              href={`/projects/${projectId}/releases/${r.id}`}
              className="release-readiness-link"
            >
              <ScoreRing
                value={r.readiness.score}
                label={`${r.name} readiness`}
                size="compact"
              />
              <div className="release-readiness-copy">
                <strong>{r.name}</strong>{" "}
                <span className="text-muted" style={{ fontSize: 13 }}>
                  [{r.status}]
                  {r.targetDate &&
                    ` · target ${new Date(r.targetDate).toLocaleDateString()}`}
                </span>
                <div className="release-readiness-visuals">
                  <div>
                    <span>Acceptance criteria</span>
                    <DistributionBar
                      compact
                      label={`${r.name} acceptance criteria`}
                      segments={[
                        {
                          label: "Met",
                          value: r.readiness.criteria.met,
                          tone: "success",
                        },
                        {
                          label: "At risk",
                          value: r.readiness.criteria.atRisk,
                          tone: "warning",
                        },
                        {
                          label: "Not met",
                          value: r.readiness.criteria.notMet,
                          tone: "danger",
                        },
                        {
                          label: "Pending",
                          value: r.readiness.criteria.pending,
                          tone: "neutral",
                        },
                      ]}
                    />
                    <small>
                      {r.readiness.criteria.met}/{r.readiness.criteria.total}{" "}
                      met
                    </small>
                  </div>
                  <div
                    className={
                      r.readiness.riskFlags.openTotal > 0
                        ? "release-risk-open"
                        : "release-risk-clear"
                    }
                  >
                    <span>Open risk flags</span>
                    <strong>{r.readiness.riskFlags.openTotal}</strong>
                    <small>
                      {r.readiness.riskFlags.critical} critical ·{" "}
                      {r.readiness.riskFlags.high} high
                    </small>
                  </div>
                </div>
              </div>
              <ReadinessBadge
                score={r.readiness.score}
                label={r.readiness.label}
              />
            </a>
          </li>
        ))}
        {!loading && releases.length === 0 && (
          <p className="text-muted">
            No releases yet — create one here, or from{" "}
            <a href={`/projects/${projectId}/test-strategy`}>Test Strategy</a>{" "}
            when analyzing a change.
          </p>
        )}
      </ul>

      <Modal
        open={canEdit && createOpen}
        onClose={() => setCreateOpen(false)}
        title="Plan a release"
      >
        <CreationWizard
          step={releaseStep}
          steps={["Identity", "Quality scope", "Review"]}
          title={
            [
              "What is shipping?",
              "What evidence should gate it?",
              "Review the release setup",
            ][releaseStep]!
          }
          description={
            [
              "Give the release a recognizable name and optional target date. You can adjust its status in the workspace.",
              "Link existing plans or add a quality plan and acceptance criteria without leaving this wizard.",
              "Vaettir will create the release and link the selected quality plans.",
            ][releaseStep]
          }
          canContinue={
            access.canWrite &&
            (releaseStep === 0
              ? Boolean(name.trim()) && !releaseGoalDraftProblem(goalDraft)
              : !draftProblem)
          }
          validationMessage={
            releaseStep === 0
              ? !name.trim()
                ? "Enter a release name to continue."
                : (releaseGoalDraftProblem(goalDraft) ?? undefined)
              : (draftProblem ?? undefined)
          }
          onInvalid={() =>
            setCreateError(
              releaseStep === 0
                ? !name.trim()
                  ? "Enter a release name to continue."
                  : releaseGoalDraftProblem(goalDraft)
                : (draftProblem ??
                    "Review the current release draft before continuing."),
            )
          }
          busy={createMutation.isPending}
          submitLabel={
            createRequest
              ? "Retry retained release request"
              : "Create release workspace"
          }
          onStepChange={setReleaseStep}
          onCancel={() => setCreateOpen(false)}
          onSubmit={submit}
        >
          {!access.ready && (
            <p role="status">
              Verify the original signed-in account, workspace and full editor
              seat before creating or retrying. Drafts are retained.{" "}
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void access.refresh()}
              >
                Recheck original access
              </button>
            </p>
          )}
          {createRequest && (
            <p role="status">
              This request retains its original release, plans and criteria.
              Retry confirms that same request without creating another
              workspace.
            </p>
          )}
          <fieldset
            disabled={
              createMutation.isPending || !!createRequest || !access.canWrite
            }
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            {releaseStep === 0 && (
              <>
                <label>
                  Release name
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="For example: Release 1.2"
                    maxLength={200}
                  />
                </label>
                <label>
                  Target date <span className="text-muted">(optional)</span>
                  <input
                    type="date"
                    value={targetDate}
                    onChange={(e) => setTargetDate(e.target.value)}
                  />
                </label>
                <WizardChoices
                  title="Primary goals"
                  options={[
                    ...releaseGoalPresets,
                    ...(showSpecializedGoals
                      ? specializedReleaseGoalPresets
                      : []),
                  ]}
                  selected={releaseGoals}
                  onToggle={(goal) => {
                    setGoalError(null);
                    try {
                      setReleaseGoals(
                        releaseGoals.includes(goal)
                          ? releaseGoals.filter((item) => item !== goal)
                          : addReleaseGoal(releaseGoals, goal),
                      );
                    } catch (error) {
                      setGoalError(
                        error instanceof Error
                          ? error.message
                          : "This goal could not be added.",
                      );
                    }
                  }}
                />
                <label>
                  Custom release goal{" "}
                  <span className="text-muted">(optional)</span>
                  <input
                    value={goalDraft}
                    maxLength={200}
                    onChange={(event) => {
                      setGoalDraft(event.target.value);
                      setGoalError(null);
                    }}
                    placeholder="For example: Improve checkout reliability"
                  />
                </label>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={!goalDraft.trim()}
                    onClick={() => {
                      try {
                        setReleaseGoals(
                          addReleaseGoal(releaseGoals, goalDraft),
                        );
                        setGoalDraft("");
                        setGoalError(null);
                      } catch (error) {
                        setGoalError(
                          error instanceof Error
                            ? error.message
                            : "This goal could not be added.",
                        );
                      }
                    }}
                  >
                    Add goal
                  </button>
                  {goalDraft.length > 0 && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setGoalDraft("");
                        setGoalError(null);
                      }}
                    >
                      Clear goal draft
                    </button>
                  )}
                </div>
                {goalError && <p role="alert">{goalError}</p>}
                {releaseGoals.length > 0 && (
                  <div
                    aria-label="Selected release goals"
                    style={{
                      display: "flex",
                      flexWrap: "wrap",
                      gap: 8,
                      marginTop: 12,
                    }}
                  >
                    {releaseGoals.map((goal) => (
                      <button
                        key={goal}
                        type="button"
                        className="btn-secondary"
                        style={{
                          maxWidth: "100%",
                          whiteSpace: "normal",
                          overflowWrap: "anywhere",
                        }}
                        aria-label={`Remove release goal ${goal}`}
                        onClick={() => {
                          setReleaseGoals(
                            releaseGoals.filter((item) => item !== goal),
                          );
                          setGoalError(null);
                        }}
                      >
                        {goal} ×
                      </button>
                    ))}
                  </div>
                )}
                <label>
                  <input
                    type="checkbox"
                    checked={showSpecializedGoals}
                    onChange={(e) => setShowSpecializedGoals(e.target.checked)}
                  />{" "}
                  Show specialized regulatory, hardware and field goals
                </label>
                <p className="text-muted">
                  Goals are optional. Choose only what applies; a normal release
                  does not require a launch or regulatory milestone.
                </p>
              </>
            )}
            {releaseStep === 1 && (
              <>
                <fieldset>
                  <legend>Link unassigned test plans</legend>
                  {(plansQuery.data ?? [])
                    .filter((plan) => !plan.releaseId)
                    .map((plan) => (
                      <label
                        key={plan.id}
                        style={{ display: "block", margin: "10px 0" }}
                      >
                        <input
                          type="checkbox"
                          checked={selectedPlanIds.includes(plan.id)}
                          onChange={(e) =>
                            setSelectedPlanIds((ids) =>
                              e.target.checked
                                ? [...ids, plan.id]
                                : ids.filter((id) => id !== plan.id),
                            )
                          }
                        />{" "}
                        {plan.name} · {plan.acceptanceCriteria.length}{" "}
                        acceptance criteria
                      </label>
                    ))}
                  {plansQuery.isLoading && <p>Loading plans…</p>}
                  {plansQuery.error && (
                    <p role="alert">{plansQuery.error.message}</p>
                  )}
                  {plansQuery.data?.every((plan) => !!plan.releaseId) && (
                    <p>
                      No unassigned plans. Add a quality plan below, or continue
                      without one.
                    </p>
                  )}
                </fieldset>
                <fieldset>
                  <legend>Add a quality plan</legend>
                  <p className="text-muted">
                    The plan and release are saved together. New criteria remain
                    pending until evidence or review satisfies them. Edits here
                    change this unsaved release draft, not an existing plan.
                  </p>
                  <label>
                    Plan name
                    <input
                      value={newPlanName}
                      onChange={(e) => setNewPlanName(e.target.value)}
                      placeholder={`${name.trim() || "Release"} quality plan`}
                      maxLength={200}
                    />
                  </label>
                  <label>
                    {editingCriterion === null
                      ? "Acceptance criterion"
                      : `Edit draft criterion ${editingCriterion + 1}`}
                    <textarea
                      value={criterionDraft}
                      onChange={(e) => setCriterionDraft(e.target.value)}
                      placeholder="For example: All critical regression cases pass on supported platforms"
                      maxLength={2000}
                    />
                  </label>
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={
                      !criterionDraft.trim() ||
                      (editingCriterion === null && newCriteria.length >= 50)
                    }
                    onClick={saveCriterionDraft}
                  >
                    {editingCriterion === null
                      ? "Add criterion"
                      : "Save draft edit"}
                  </button>
                  {(criterionDraft.length > 0 || editingCriterion !== null) && (
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => {
                        setCriterionDraft("");
                        setEditingCriterion(null);
                      }}
                    >
                      {editingCriterion === null
                        ? "Clear draft"
                        : "Cancel edit"}
                    </button>
                  )}
                  <ul>
                    {newCriteria.map((criterion, index) => (
                      <li key={index}>
                        <span
                          style={{
                            whiteSpace: "pre-wrap",
                            overflowWrap: "anywhere",
                          }}
                        >
                          {criterion}
                        </span>{" "}
                        <button
                          type="button"
                          className="btn-secondary"
                          disabled={
                            editingCriterion !== null ||
                            criterionDraft.length > 0
                          }
                          aria-label={`Edit draft criterion ${index + 1}`}
                          onClick={() => {
                            setEditingCriterion(index);
                            setCriterionDraft(criterion);
                          }}
                        >
                          Edit
                        </button>{" "}
                        <button
                          type="button"
                          className="btn-secondary"
                          aria-label={`Remove criterion ${index + 1}`}
                          disabled={editingCriterion !== null}
                          onClick={() =>
                            setNewCriteria((values) =>
                              values.filter((_, i) => i !== index),
                            )
                          }
                        >
                          Remove
                        </button>
                      </li>
                    ))}
                  </ul>
                  {draftProblem && <p role="status">{draftProblem}</p>}
                </fieldset>
              </>
            )}
            {releaseStep === 2 && (
              <div className="panel" style={{ padding: 14 }}>
                <strong>{name}</strong>
                <p className="text-muted" style={{ margin: "4px 0" }}>
                  {targetDate
                    ? `Target ${new Date(`${targetDate}T12:00:00`).toLocaleDateString()}`
                    : "No target date"}
                </p>
                <p style={{ margin: 0, fontSize: 13 }}>
                  {selectedPlanIds.length} test plan(s) will contribute
                  acceptance criteria.{" "}
                  {newCriteria.length > 0 && (
                    <>
                      A new quality plan with {newCriteria.length} pending
                      criteria will also be created.{" "}
                    </>
                  )}
                  {releaseGoals.length
                    ? `Goals: ${releaseGoals.join(", ")}.`
                    : ""}
                </p>
                <ReleaseDraftEvidenceReview
                  retainedRequest={createRequest}
                  releaseName={name}
                  planName={newPlanName}
                  criteria={newCriteria}
                />
              </div>
            )}
          </fieldset>
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </CreationWizard>
      </Modal>
    </div>
  );
}
