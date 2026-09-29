"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";
import { Modal } from "@/components/Modal";
import { ReadinessBadge } from "@/components/ReadinessBadge";
import { TrendChart } from "@/components/TrendChart";
import { DistributionBar, ScoreRing } from "@/components/MetricVisuals";
import { useProjectPermissions } from "@/lib/use-project-permissions";
import { CreationWizard, WizardChoices } from "@/components/CreationWizard";

// P1-15
export default function ReleasesPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { canEdit } = useProjectPermissions(projectId);
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
  const [createError, setCreateError] = useState<string | null>(null);

  const createMutation = trpcReact.releases.create.useMutation({
    onSuccess: () => {
      setName("");
      setTargetDate("");
      setReleaseStep(0);
      setSelectedPlanIds([]);
      setReleaseGoals([]);
      setCreateOpen(false);
      void utils.releases.list.invalidate({ projectId });
      void utils.releases.trend.invalidate({ projectId });
      void utils.testPlans.list.invalidate({ projectId });
    },
    onError: (e) => setCreateError(e.message),
  });

  function submit() {
    if (!canEdit || !name.trim()) return;
    setCreateError(null);
    createMutation.mutate({
      projectId,
      name: name.trim(),
      targetDate: targetDate ? new Date(`${targetDate}T12:00:00`) : undefined,
      testPlanIds: selectedPlanIds,
      goals: releaseGoals,
    });
  }

  const loading = releasesQuery.isLoading;
  const error = createError ?? releasesQuery.error?.message ?? null;

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
              "Give the release a recognizable name and target. You can adjust status and dates later.",
              "Reuse existing plans so their acceptance criteria immediately contribute to readiness.",
              "Vaettir will create the release and link the selected quality plans.",
            ][releaseStep]
          }
          canContinue={releaseStep === 0 ? Boolean(name.trim()) : true}
          busy={createMutation.isPending}
          submitLabel="Create release workspace"
          onStepChange={setReleaseStep}
          onCancel={() => setCreateOpen(false)}
          onSubmit={submit}
        >
          {releaseStep === 0 && (
            <>
              <label>
                Release name
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="For example: Pilot build 1.2"
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
                  "Customer launch",
                  "Internal milestone",
                  "Regulatory submission",
                  "Pilot/manufacturing build",
                  "Field trial",
                  "Maintenance release",
                ]}
                selected={releaseGoals}
                onToggle={(goal) =>
                  setReleaseGoals((goals) =>
                    goals.includes(goal)
                      ? goals.filter((item) => item !== goal)
                      : [...goals, goal],
                  )
                }
              />
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
                      {plan.name} · {plan.acceptanceCriteria.length} acceptance
                      criteria
                    </label>
                  ))}
                {plansQuery.isLoading && <p>Loading plans…</p>}
                {plansQuery.error && (
                  <p role="alert">{plansQuery.error.message}</p>
                )}
                {plansQuery.data?.every((plan) => !!plan.releaseId) && (
                  <p>
                    No unassigned plans. You can create the release now and add
                    a plan later.
                  </p>
                )}
              </fieldset>
              {(plansQuery.data ?? []).length === 0 && (
                <div className="panel" style={{ padding: 14 }}>
                  <strong>No plans to link yet</strong>
                  <p
                    className="text-muted"
                    style={{ margin: "4px 0 0", fontSize: 13 }}
                  >
                    Create a Test Strategy or Test Plan first, or continue with
                    an empty release and add criteria later.
                  </p>
                </div>
              )}
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
                {selectedPlanIds.length} test plan(s) will contribute acceptance
                criteria.{" "}
                {releaseGoals.length
                  ? `Goals: ${releaseGoals.join(", ")}.`
                  : ""}
              </p>
            </div>
          )}
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </CreationWizard>
      </Modal>
    </div>
  );
}
