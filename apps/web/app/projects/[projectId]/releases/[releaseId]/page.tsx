"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";
import { ReadinessBadge } from "@/components/ReadinessBadge";

const STATUSES = ["PLANNING", "IN_TESTING", "READY", "SHIPPED", "BLOCKED"] as const;
const CRITERION_STATUSES = ["PENDING", "MET", "AT_RISK", "NOT_MET"] as const;

export default function ReleaseReadinessPage() {
  const { projectId, releaseId } = useParams<{ projectId: string; releaseId: string }>();

  const [release, setRelease] = useState<RouterOutputs["releases"]["byId"] | null>(null);
  const [readiness, setReadiness] = useState<RouterOutputs["releases"]["readiness"] | null>(null);
  const [testPlans, setTestPlans] = useState<RouterOutputs["releases"]["listTestPlans"]>([]);
  const [riskFlags, setRiskFlags] = useState<RouterOutputs["releases"]["listRiskFlags"]>([]);
  const [allPlans, setAllPlans] = useState<RouterOutputs["testPlans"]["list"]>([]);
  const [attachPlanId, setAttachPlanId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [showResolved, setShowResolved] = useState(false);

  function load() {
    setError(null);
    Promise.all([
      trpc.releases.byId.query({ id: releaseId }),
      trpc.releases.readiness.query({ releaseId }),
      trpc.releases.listTestPlans.query({ releaseId }),
      trpc.releases.listRiskFlags.query({ releaseId }),
    ])
      .then(([r, rd, plans, flags]) => {
        setRelease(r);
        setReadiness(rd);
        setTestPlans(plans);
        setRiskFlags(flags);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }

  useEffect(load, [releaseId]);

  useEffect(() => {
    trpc.testPlans.list.query({ projectId }).then(setAllPlans).catch(() => undefined);
  }, [projectId]);

  async function updateStatus(status: string) {
    try {
      await trpc.releases.updateStatus.mutate({ id: releaseId, status: status as never });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function updateCriterionStatus(id: string, description: string, status: string) {
    try {
      await trpc.testPlans.updateAcceptanceCriterion.mutate({ id, description, status: status as never });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function attachPlan() {
    if (!attachPlanId) return;
    try {
      await trpc.testPlans.setRelease.mutate({ testPlanId: attachPlanId, releaseId });
      setAttachPlanId("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function detachPlan(testPlanId: string) {
    try {
      await trpc.testPlans.setRelease.mutate({ testPlanId, releaseId: null });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function toggleResolve(id: string, resolved: boolean) {
    try {
      await trpc.releases.resolveRiskFlag.mutate({ id, resolved });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!release || !readiness) return <p>Loading…</p>;

  const attachablePlans = allPlans.filter((p) => p.releaseId !== releaseId);
  const visibleFlags = showResolved ? riskFlags : riskFlags.filter((f) => !f.resolvedAt);

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>{release.name}</h1>
        <ReadinessBadge score={readiness.score} label={readiness.label} />
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        <a href={`/projects/${projectId}/test-strategy`}>← Test strategy</a>
        {release.targetDate && ` · target ${new Date(release.targetDate).toLocaleDateString()}`}
      </p>

      <div className="panel" style={{ marginBottom: 20 }}>
        <div className="eyebrow">Status</div>
        <select value={release.status} onChange={(e) => updateStatus(e.target.value)}>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </div>

      <div className="panel" style={{ marginBottom: 20 }}>
        <h2 style={{ marginTop: 0 }}>Acceptance criteria</h2>
        <p className="text-muted" style={{ fontSize: 13, marginTop: -8 }}>
          {readiness.criteria.met} met · {readiness.criteria.atRisk} at risk · {readiness.criteria.notMet} not met ·{" "}
          {readiness.criteria.pending} pending
        </p>

        {testPlans.map((p) => (
          <div key={p.id} style={{ marginBottom: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
              <strong>
                <a href={`/projects/${projectId}/test-plans/${p.id}`}>{p.name}</a>{" "}
                <span className="text-muted" style={{ fontWeight: 400, fontSize: 12 }}>
                  [{p.testPlanType.name}]
                </span>
              </strong>
              <button className="btn-secondary" onClick={() => detachPlan(p.id)} style={{ fontSize: 12 }}>
                Detach
              </button>
            </div>
            <ul style={{ listStyle: "none", padding: 0, marginTop: 6 }}>
              {p.acceptanceCriteria.map((c) => (
                <li key={c.id} style={{ display: "flex", justifyContent: "space-between", gap: 8, padding: "4px 0" }}>
                  <span>{c.description}</span>
                  <select
                    value={c.status}
                    onChange={(e) => updateCriterionStatus(c.id, c.description, e.target.value)}
                    style={{ fontSize: 12 }}
                  >
                    {CRITERION_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </li>
              ))}
              {p.acceptanceCriteria.length === 0 && (
                <li className="text-muted" style={{ fontSize: 13 }}>
                  No acceptance criteria on this plan yet.
                </li>
              )}
            </ul>
          </div>
        ))}
        {testPlans.length === 0 && <p className="text-muted">No test plans attached to this release yet.</p>}

        <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
          <select value={attachPlanId} onChange={(e) => setAttachPlanId(e.target.value)} style={{ flex: 1 }}>
            <option value="">Attach an existing test plan…</option>
            {attachablePlans.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <button onClick={attachPlan} disabled={!attachPlanId}>
            Attach
          </button>
        </div>
      </div>

      <div className="panel">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h2 style={{ marginTop: 0 }}>Risk flags</h2>
          <label className="text-muted" style={{ fontSize: 12 }}>
            <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} /> show
            resolved
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
                <strong style={{ color: f.severity === "CRITICAL" || f.severity === "HIGH" ? "var(--ember)" : "var(--fg)" }}>
                  {f.severity}
                </strong>{" "}
                [{f.source}] {f.description}
                {f.resolvedAt && <span style={{ color: "var(--frost)" }}> — resolved</span>}
              </div>
              <button className="btn-secondary" onClick={() => toggleResolve(f.id, !f.resolvedAt)} style={{ fontSize: 12, whiteSpace: "nowrap" }}>
                {f.resolvedAt ? "Reopen" : "Resolve"}
              </button>
            </li>
          ))}
          {visibleFlags.length === 0 && <p className="text-muted">None.</p>}
        </ul>
      </div>
    </div>
  );
}
