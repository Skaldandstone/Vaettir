"use client";

import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const cellStyle: CSSProperties = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" };

function arraysEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

// A field-by-field comparison, not a line-level text diff -- the point is
// "did the human change this since the AI wrote it", not a patch-style
// rendering. Only fields that actually differ are worth showing; a case a
// reviewer approved verbatim has nothing here to look at.
function DiffField({ label, before, after }: { label: string; before: string; after: string }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div className="eyebrow" style={{ fontSize: 11 }}>
        {label}
      </div>
      <div style={{ color: "var(--ember)", textDecoration: "line-through", opacity: 0.75, fontSize: 13 }}>{before || "(empty)"}</div>
      <div style={{ color: "var(--frost)", fontSize: 13 }}>{after || "(empty)"}</div>
    </div>
  );
}

// Shared between the full detail page (/test-cases/[id], for deep links and
// bookmarking) and the drawer opened from the list -- see
// STYLE_GUIDE-adjacent decision in TestCaseTree.tsx's commit: don't force a
// page navigation for the common "look at / triage a case" action when a
// pop-out view will do, matching how TestRail/Qase's own case repository
// works (a side panel, not a page hop, for viewing/light editing).
export function TestCaseDetailContent({
  id,
  projectId,
  onEditHref,
  onChanged,
}: {
  id: string;
  projectId: string;
  onEditHref?: string;
  onChanged?: () => void;
}) {
  const [tc, setTc] = useState<RouterOutputs["testCases"]["byId"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewing, setReviewing] = useState(false);
  const [assessingRisk, setAssessingRisk] = useState(false);
  const [showDiff, setShowDiff] = useState(false);

  function load() {
    trpc.testCases.byId
      .query({ id })
      .then(setTc)
      .catch((e) => setError(String(e)));
  }

  useEffect(load, [id]);

  async function review(decision: "approve" | "reject") {
    setReviewing(true);
    setError(null);
    try {
      await trpc.testCases[decision].mutate({ id, note: reviewNote || undefined });
      setReviewNote("");
      load();
      onChanged?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReviewing(false);
    }
  }

  async function assessRisk() {
    setAssessingRisk(true);
    setError(null);
    try {
      await trpc.testCases.assessRisk.mutate({ id });
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setAssessingRisk(false);
    }
  }

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!tc) return <p>Loading…</p>;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1 style={{ margin: 0 }}>{tc.title}</h1>
        <a href={onEditHref ?? `/projects/${projectId}/test-cases/${tc.id}/edit`}>Edit</a>
      </div>
      <p>
        <strong>Type:</strong> {tc.testType} &nbsp; <strong>Priority:</strong> {tc.priority} &nbsp;
        <strong>Origin:</strong> {tc.origin}
        {tc.confidence != null && ` (confidence ${(tc.confidence * 100).toFixed(0)}%)`}
      </p>

      <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <strong>Risk assessment:</strong>{" "}
        {tc.riskScore != null ? (
          <>
            {tc.riskScore}/100 ({tc.riskSeverity})
            {tc.riskRationale && <p style={{ color: "var(--muted)", margin: "6px 0 0" }}>{tc.riskRationale}</p>}
            {tc.riskAssessedAt && (
              <p style={{ color: "var(--muted-dim)", fontSize: 12, margin: "4px 0 0" }}>
                Assessed {new Date(tc.riskAssessedAt).toLocaleDateString()}
              </p>
            )}
          </>
        ) : (
          <span style={{ color: "var(--muted-dim)" }}>Not yet assessed</span>
        )}
        <div style={{ marginTop: 8 }}>
          <button onClick={assessRisk} disabled={assessingRisk}>
            {assessingRisk ? "Assessing…" : tc.riskScore != null ? "Re-assess risk" : "Assess risk"}
          </button>
        </div>
      </div>

      {tc.suitePath && (
        <p>
          <strong>Suite:</strong> {tc.suitePath}
        </p>
      )}

      {tc.source && (
        <p>
          <strong>Source:</strong> {tc.source.filePath}
          {tc.source.functionName && ` :: ${tc.source.functionName}`} ({tc.source.framework})
        </p>
      )}

      {tc.origin === "AI_REVERSE_ENGINEERED" && (
        <div
          style={{
            border: "1px solid var(--line)",
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            background: tc.reviewStatus === "PENDING_REVIEW" ? "var(--ember-dim)" : tc.reviewStatus === "REJECTED" ? "var(--ember-dim)" : "var(--frost-dim)",
          }}
        >
          <strong>Review status:</strong> {tc.reviewStatus}
          {tc.reviewedByName && (
            <span style={{ color: "var(--muted)" }}>
              {" "}
              — {tc.reviewStatus === "REJECTED" ? "rejected" : "reviewed"} by {tc.reviewedByName}
              {tc.reviewedAt && ` on ${new Date(tc.reviewedAt).toLocaleDateString()}`}
            </span>
          )}
          {tc.reviewNote && <p style={{ fontStyle: "italic", margin: "6px 0" }}>&ldquo;{tc.reviewNote}&rdquo;</p>}

          {tc.reviewStatus === "PENDING_REVIEW" && (
            <div style={{ marginTop: 8 }}>
              <input
                value={reviewNote}
                onChange={(e) => setReviewNote(e.target.value)}
                placeholder="Optional note"
                style={{ width: "50%", marginRight: 8 }}
              />
              <button onClick={() => review("approve")} disabled={reviewing} style={{ marginRight: 8 }}>
                Approve
              </button>
              <button onClick={() => review("reject")} disabled={reviewing}>
                Reject
              </button>
            </div>
          )}

          {tc.aiSnapshot && (() => {
            const snap = tc.aiSnapshot;
            const changed =
              snap.title !== tc.title ||
              (snap.background ?? "") !== (tc.background ?? "") ||
              !arraysEqual(snap.given, tc.given) ||
              !arraysEqual(snap.when, tc.when) ||
              !arraysEqual(snap.then, tc.then) ||
              !arraysEqual(snap.tags, tc.tags);
            if (!changed) {
              return (
                <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
                  Matches what the AI originally generated — no human edits since.
                </p>
              );
            }
            return (
              <div style={{ marginTop: 10 }}>
                <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => setShowDiff((v) => !v)}>
                  {showDiff ? "Hide" : "Show"} changes since AI generated this
                </button>
                {showDiff && (
                  <div style={{ marginTop: 10, borderTop: "1px solid var(--line)", paddingTop: 10 }}>
                    <p className="text-muted" style={{ fontSize: 11, margin: "0 0 8px" }}>
                      <span style={{ color: "var(--ember)" }}>AI original</span> vs{" "}
                      <span style={{ color: "var(--frost)" }}>current</span>
                    </p>
                    {snap.title !== tc.title && <DiffField label="Title" before={snap.title} after={tc.title} />}
                    {(snap.background ?? "") !== (tc.background ?? "") && (
                      <DiffField label="Background" before={snap.background ?? ""} after={tc.background ?? ""} />
                    )}
                    {!arraysEqual(snap.given, tc.given) && (
                      <DiffField label="Given" before={snap.given.join(" / ")} after={tc.given.join(" / ")} />
                    )}
                    {!arraysEqual(snap.when, tc.when) && (
                      <DiffField label="When" before={snap.when.join(" / ")} after={tc.when.join(" / ")} />
                    )}
                    {!arraysEqual(snap.then, tc.then) && (
                      <DiffField label="Then" before={snap.then.join(" / ")} after={tc.then.join(" / ")} />
                    )}
                    {!arraysEqual(snap.tags, tc.tags) && (
                      <DiffField label="Tags" before={snap.tags.join(", ")} after={tc.tags.join(", ")} />
                    )}
                  </div>
                )}
              </div>
            );
          })()}
        </div>
      )}
      {tc.background && <p><strong>Background:</strong> {tc.background}</p>}

      {(tc.given.length > 0 || tc.when.length > 0 || tc.then.length > 0) && (
        <>
          <h3>Given</h3>
          <ul>{tc.given.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>When</h3>
          <ul>{tc.when.map((s, i) => <li key={i}>{s}</li>)}</ul>
          <h3>Then</h3>
          <ul>{tc.then.map((s, i) => <li key={i}>{s}</li>)}</ul>
        </>
      )}

      {tc.steps.length > 0 && (
        <>
          <h3>Steps</h3>
          <table style={{ borderCollapse: "collapse", width: "100%" }}>
            <thead>
              <tr>
                <th style={cellStyle}>#</th>
                <th style={cellStyle}>{tc.stepFieldLabels.action}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedActionOrData}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedResult}</th>
                <th style={cellStyle}>{tc.stepFieldLabels.expectedResponse}</th>
              </tr>
            </thead>
            <tbody>
              {tc.steps.map((s) => (
                <tr key={s.order}>
                  <td style={cellStyle}>{s.order + 1}</td>
                  <td style={cellStyle}>{s.action}</td>
                  <td style={cellStyle}>{s.expectedActionOrData ?? "—"}</td>
                  <td style={cellStyle}>{s.expectedResult ?? "—"}</td>
                  <td style={cellStyle}>{s.expectedResponse ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {tc.given.length === 0 && tc.when.length === 0 && tc.then.length === 0 && tc.steps.length === 0 && (
        <p className="text-muted">
          No content yet — this case was quick-added with just a title.{" "}
          <a href={onEditHref ?? `/projects/${projectId}/test-cases/${tc.id}/edit`}>Fill it in</a>.
        </p>
      )}

      {tc.tags.length > 0 && (
        <p>
          <strong>Tags:</strong> {tc.tags.join(", ")}
        </p>
      )}
    </div>
  );
}
