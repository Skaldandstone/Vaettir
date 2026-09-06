"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact, type RouterOutputs } from "../../../lib/trpcReact";

type Decision = "CONFIRMED" | "REVOKED";

// P1-15
export default function AccessReviewPage() {
  const router = useRouter();
  const utils = trpcReact.useUtils();

  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";

  const membersQuery = trpcReact.organization.listMembers.useQuery({ organizationId: orgId! }, { enabled: !!orgId });
  const statusQuery = trpcReact.organization.accessReviewStatus.useQuery({ organizationId: orgId! }, { enabled: !!orgId });
  const reviewsQuery = trpcReact.organization.listAccessReviews.useQuery({ organizationId: orgId! }, { enabled: !!orgId });

  const members = membersQuery.data ?? [];
  const status = statusQuery.data ?? null;
  const reviews = reviewsQuery.data ?? [];

  const [expanded, setExpanded] = useState<Record<string, RouterOutputs["organization"]["getAccessReviewDetail"] | undefined>>({});
  const [period, setPeriod] = useState("");
  const [decisions, setDecisions] = useState<Record<string, { decision: Decision; note: string }>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length === 0) router.push("/onboarding");
  }, [orgsQuery.data, router]);

  useEffect(() => {
    if (membersQuery.data) {
      setDecisions(Object.fromEntries(membersQuery.data.map((m) => [m.id, { decision: "CONFIRMED" as Decision, note: "" }])));
    }
  }, [membersQuery.data]);

  function setDecision(membershipId: string, decision: Decision) {
    setDecisions((prev) => ({
      ...prev,
      [membershipId]: { decision, note: prev[membershipId]?.note ?? "" },
    }));
  }

  function setNote(membershipId: string, note: string) {
    setDecisions((prev) => ({
      ...prev,
      [membershipId]: { decision: prev[membershipId]?.decision ?? "CONFIRMED", note },
    }));
  }

  const submitMutation = trpcReact.organization.submitAccessReview.useMutation({
    onSuccess: () => {
      setSubmitted(true);
      setPeriod("");
      void utils.organization.invalidate();
    },
    onError: (e) => setSubmitError(e.message),
  });

  function submitReview() {
    if (!orgId) return;
    setSubmitError(null);
    setSubmitted(false);
    submitMutation.mutate({
      organizationId: orgId,
      period,
      decisions: members.map((m) => ({
        membershipId: m.id,
        decision: decisions[m.id]?.decision ?? "CONFIRMED",
        note: decisions[m.id]?.note?.trim() || undefined,
      })),
    });
  }

  async function toggleExpand(id: string) {
    if (expanded[id]) {
      setExpanded((prev) => ({ ...prev, [id]: undefined }));
      return;
    }
    const detail = await utils.organization.getAccessReviewDetail.fetch({ id });
    setExpanded((prev) => ({ ...prev, [id]: detail }));
  }

  const loading = orgsQuery.isLoading || (!!orgId && (membersQuery.isLoading || statusQuery.isLoading || reviewsQuery.isLoading));
  const pageError = orgsQuery.error?.message ?? membersQuery.error?.message ?? null;

  if (loading) return <p>Loading…</p>;
  if (pageError) return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
  if (!orgId) return <p>You don't belong to an organization yet.</p>;

  const revokedCount = Object.values(decisions).filter((d) => d.decision === "REVOKED").length;

  return (
    <div style={{ maxWidth: 720 }}>
      <h1>{orgName} access review</h1>
      <p className="text-muted" style={{ fontSize: 13, marginTop: -6 }}>
        A periodic record that someone with admin access actually looked at who has access to this org and confirmed
        it's still appropriate - the kind of evidence a SOC 2 auditor asks for. Every current member must get a
        decision; revoking removes their access immediately.
      </p>

      {status && (
        <div className="panel" style={{ margin: "12px 0 20px" }}>
          {status.lastReviewedAt ? (
            <p style={{ margin: 0 }}>
              Last reviewed <strong>{status.daysSinceLastReview}</strong> day{status.daysSinceLastReview === 1 ? "" : "s"} ago
              {" "}({new Date(status.lastReviewedAt).toLocaleDateString()}).
            </p>
          ) : (
            <p style={{ margin: 0, color: "var(--ember)" }}>This organization has never completed an access review.</p>
          )}
        </div>
      )}

      <h2>Review current members</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 12 }}>
        <thead>
          <tr>
            <th style={cellStyle}>Member</th>
            <th style={cellStyle}>Role</th>
            <th style={cellStyle}>Decision</th>
            <th style={cellStyle}>Note</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td style={cellStyle}>{m.userName ? `${m.userName} (${m.userEmail})` : m.userEmail}</td>
              <td style={cellStyle}>{m.role}</td>
              <td style={cellStyle}>
                <select
                  value={decisions[m.id]?.decision ?? "CONFIRMED"}
                  onChange={(e) => setDecision(m.id, e.target.value as Decision)}
                >
                  <option value="CONFIRMED">Confirm access</option>
                  <option value="REVOKED">Revoke access</option>
                </select>
              </td>
              <td style={cellStyle}>
                <input
                  value={decisions[m.id]?.note ?? ""}
                  onChange={(e) => setNote(m.id, e.target.value)}
                  placeholder="Optional note"
                  style={{ width: "100%", fontSize: 12 }}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      {revokedCount > 0 && (
        <p style={{ color: "var(--ember)", fontSize: 13 }}>
          {revokedCount} member{revokedCount === 1 ? "" : "s"} will be removed from the organization immediately on submit.
        </p>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
        <input
          value={period}
          onChange={(e) => setPeriod(e.target.value)}
          placeholder="Period (e.g. 2026-Q3)"
          style={{ fontSize: 13, width: 160 }}
        />
        <button className="btn-primary" onClick={submitReview} disabled={submitMutation.isPending || !period.trim()}>
          {submitMutation.isPending ? "Submitting…" : "Submit review"}
        </button>
      </div>
      {submitted && <p style={{ color: "var(--frost)", fontSize: 13 }}>Review recorded.</p>}
      {submitError && <p style={{ color: "var(--ember)", fontSize: 13 }}>{submitError}</p>}

      <h2 style={{ marginTop: 32 }}>Past reviews</h2>
      {reviews.length === 0 ? (
        <p className="text-muted">No reviews yet.</p>
      ) : (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>Period</th>
              <th style={cellStyle}>Date</th>
              <th style={cellStyle}>Performed by</th>
              <th style={cellStyle}>Confirmed</th>
              <th style={cellStyle}>Revoked</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {reviews.map((r) => (
              <>
                <tr key={r.id}>
                  <td style={cellStyle}>{r.period}</td>
                  <td style={cellStyle}>{new Date(r.performedAt).toLocaleDateString()}</td>
                  <td style={cellStyle}>{r.performedByEmail}</td>
                  <td style={cellStyle}>{r.confirmedCount}</td>
                  <td style={cellStyle}>{r.revokedCount}</td>
                  <td style={cellStyle}>
                    <button className="btn-secondary" style={{ fontSize: 12 }} onClick={() => toggleExpand(r.id)}>
                      {expanded[r.id] ? "Hide" : "View"}
                    </button>
                  </td>
                </tr>
                {expanded[r.id] && (
                  <tr key={`${r.id}-detail`}>
                    <td colSpan={6} style={{ ...cellStyle, background: "var(--frost-dim)" }}>
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {expanded[r.id]!.entries.map((e, i) => (
                          <li key={i}>
                            {e.userEmail} - {e.role} - <strong>{e.decision}</strong>
                            {e.note ? ` - "${e.note}"` : ""}
                          </li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

const cellStyle = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" as const };
