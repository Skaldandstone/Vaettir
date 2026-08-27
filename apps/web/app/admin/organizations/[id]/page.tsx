"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "../../../../lib/trpc";

type OrgDetail = RouterOutputs["admin"]["getOrganization"];

export default function AdminOrganizationDetailPage() {
  const params = useParams<{ id: string }>();
  const organizationId = params.id;

  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [planTiers, setPlanTiers] = useState<RouterOutputs["admin"]["listPlanTiers"]>([]);
  const [logEntries, setLogEntries] = useState<RouterOutputs["admin"]["staffActionLog"]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [newPlanTierId, setNewPlanTierId] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [lastInviteLink, setLastInviteLink] = useState<string | null>(null);

  async function loadAll() {
    setLoading(true);
    setError(null);
    try {
      const [orgResult, tiers, log] = await Promise.all([
        trpc.admin.getOrganization.query({ organizationId }),
        trpc.admin.listPlanTiers.query(),
        trpc.admin.staffActionLog.query({ organizationId }),
      ]);
      setOrg(orgResult);
      setPlanTiers(tiers);
      setLogEntries(log);
      setNewPlanTierId(orgResult.planTierId);
    } catch (e) {
      if (e instanceof Error && e.message.includes("Staff access required")) {
        setForbidden(true);
      } else {
        setError(e instanceof Error ? e.message : String(e));
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [organizationId]);

  function requireReason(): string | null {
    if (!reason.trim()) {
      setError("A reason is required for staff actions - it's written to the audit trail.");
      return null;
    }
    return reason.trim();
  }

  async function changePlanTier() {
    const r = requireReason();
    if (!r || !org || newPlanTierId === org.planTierId) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.admin.adjustPlanTier.mutate({ organizationId, planTierId: newPlanTierId, reason: r });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function resendInvite(invitationId: string) {
    const r = requireReason();
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      const result = await trpc.admin.resendInvite.mutate({ invitationId, reason: r });
      setLastInviteLink(`${window.location.origin}/invite/${result.token}`);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function deactivateMember(membershipId: string) {
    const r = requireReason();
    if (!r) return;
    if (!confirm("Remove this member? This can't be undone from here.")) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.admin.deactivateMember.mutate({ membershipId, reason: r });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (forbidden) return <p>Staff access required. This account isn&apos;t recognized as Skald &amp; Stone staff.</p>;
  if (loading) return <p>Loading…</p>;
  if (!org) return <p style={{ color: "var(--ember)" }}>{error}</p>;

  return (
    <div style={{ maxWidth: 800 }}>
      <h1>{org.name}</h1>
      <p style={{ color: "var(--muted, #999)" }}>
        {org.slug} · created {new Date(org.createdAt).toLocaleDateString()} · retention {org.dataRetentionYears}y
      </p>

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      <div style={{ margin: "16px 0" }}>
        <label>
          Reason for the next staff action (required, goes on the audit trail)
          <input value={reason} onChange={(e) => setReason(e.target.value)} style={{ width: "100%" }} />
        </label>
      </div>

      <section style={{ margin: "20px 0" }}>
        <h2>Plan tier</h2>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={newPlanTierId} onChange={(e) => setNewPlanTierId(e.target.value)}>
            {planTiers.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <button onClick={changePlanTier} disabled={busy || newPlanTierId === org.planTierId}>
            Switch plan
          </button>
          <span>currently {org.planTierName}</span>
        </div>
      </section>

      <section style={{ margin: "20px 0" }}>
        <h2>Members</h2>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left" }}>
              <th>Email</th>
              <th>Name</th>
              <th>Role</th>
              <th>Seat</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {org.members.map((m) => (
              <tr key={m.membershipId} style={{ borderTop: "1px solid var(--border, #333)" }}>
                <td>{m.email}</td>
                <td>{m.name ?? "—"}</td>
                <td>{m.role}</td>
                <td>{m.seatType}</td>
                <td>
                  <button onClick={() => deactivateMember(m.membershipId)} disabled={busy}>
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section style={{ margin: "20px 0" }}>
        <h2>Pending invitations</h2>
        {org.invitations.length === 0 && <p>None.</p>}
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <tbody>
            {org.invitations.map((inv) => (
              <tr key={inv.id} style={{ borderTop: "1px solid var(--border, #333)" }}>
                <td>{inv.email}</td>
                <td>
                  {inv.role} / {inv.seatType}
                </td>
                <td>expires {new Date(inv.expiresAt).toLocaleDateString()}</td>
                <td>
                  <button onClick={() => resendInvite(inv.id)} disabled={busy}>
                    Refresh link
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {lastInviteLink && (
          <p>
            Refreshed link: <code>{lastInviteLink}</code>
          </p>
        )}
      </section>

      <section style={{ margin: "20px 0" }}>
        <h2>Staff action log</h2>
        {logEntries.length === 0 && <p>No staff actions recorded on this org yet.</p>}
        <ul>
          {logEntries.map((e) => (
            <li key={e.id}>
              <strong>{new Date(e.createdAt).toLocaleString()}</strong> — {e.actorEmail}: {e.summary}
              {e.reason && <em> ({e.reason})</em>}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
