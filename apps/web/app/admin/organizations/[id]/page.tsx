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

  const [newOwnerMembershipId, setNewOwnerMembershipId] = useState("");
  const [previousOwnerMembershipId, setPreviousOwnerMembershipId] = useState("");

  const [deletePreview, setDeletePreview] = useState<RouterOutputs["admin"]["previewOrgHardDelete"] | null>(null);
  const [previewingDelete, setPreviewingDelete] = useState(false);
  const [confirmSlug, setConfirmSlug] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState<RouterOutputs["admin"]["hardDeleteOrganization"] | null>(null);

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

  async function suspendOrg() {
    const r = requireReason();
    if (!r || !org) return;
    if (!confirm(`Suspend "${org.name}"? Members will lose access to all project data until this is lifted.`)) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.admin.suspendOrganization.mutate({ organizationId, reason: r });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function reactivateOrg() {
    const r = requireReason();
    if (!r) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.admin.reactivateOrganization.mutate({ organizationId, reason: r });
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function transferOwnership() {
    const r = requireReason();
    if (!r || !newOwnerMembershipId || !previousOwnerMembershipId) return;
    if (!confirm("Transfer ownership? The previous owner will be demoted to Admin, not removed.")) return;
    setBusy(true);
    setError(null);
    try {
      await trpc.admin.transferOwnership.mutate({
        organizationId,
        newOwnerMembershipId,
        previousOwnerMembershipId,
        reason: r,
      });
      setNewOwnerMembershipId("");
      setPreviousOwnerMembershipId("");
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function previewDelete() {
    setPreviewingDelete(true);
    setError(null);
    try {
      const preview = await trpc.admin.previewOrgHardDelete.query({ organizationId });
      setDeletePreview(preview);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPreviewingDelete(false);
    }
  }

  async function confirmHardDelete() {
    const r = requireReason();
    if (!r || !org || !deletePreview) return;
    if (confirmSlug !== org.slug) {
      setError(`Confirmation text must exactly match the organization's slug ("${org.slug}")`);
      return;
    }
    if (!confirm(`This permanently deletes "${org.name}" and everything under it. This cannot be undone. Continue?`)) return;
    setDeleting(true);
    setError(null);
    try {
      const result = await trpc.admin.hardDeleteOrganization.mutate({ organizationId, confirmSlug, reason: r });
      setDeleteResult(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
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

  if (deleteResult) {
    return (
      <div style={{ maxWidth: 800 }}>
        <h1>Organization deleted</h1>
        <p style={{ color: "var(--frost, #7cc)" }}>
          Deletion record: <code>{deleteResult.deletionLogId}</code>
        </p>
        <h2>Rows removed</h2>
        <ul>
          {Object.entries(deleteResult.rowCounts)
            .filter(([, count]) => count > 0)
            .map(([model, count]) => (
              <li key={model}>
                {model}: {count}
              </li>
            ))}
        </ul>
        <a className="btn-secondary" href="/admin">
          &larr; Back to search
        </a>
      </div>
    );
  }

  if (loading) return <p>Loading…</p>;
  if (!org) return <p style={{ color: "var(--ember)" }}>{error}</p>;

  return (
    <div style={{ maxWidth: 800 }}>
      <h1>{org.name}</h1>
      <p style={{ color: "var(--muted, #999)" }}>
        {org.slug} · created {new Date(org.createdAt).toLocaleDateString()} · retention {org.dataRetentionYears}y
      </p>

      {org.suspendedAt && (
        <p style={{ color: "var(--ember)", fontWeight: 600 }}>
          SUSPENDED since {new Date(org.suspendedAt).toLocaleString()}
          {org.suspendedReason && ` — ${org.suspendedReason}`}
        </p>
      )}

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
        <h2>Ownership transfer</h2>
        <p style={{ color: "var(--muted, #999)", fontSize: 13 }}>
          The previous owner is demoted to Admin, not removed - this is a role swap, not a member removal.
        </p>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <select value={previousOwnerMembershipId} onChange={(e) => setPreviousOwnerMembershipId(e.target.value)}>
            <option value="">Current owner…</option>
            {org.members
              .filter((m) => m.role === "OWNER")
              .map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.email}
                </option>
              ))}
          </select>
          <span>→</span>
          <select value={newOwnerMembershipId} onChange={(e) => setNewOwnerMembershipId(e.target.value)}>
            <option value="">New owner…</option>
            {org.members
              .filter((m) => m.membershipId !== previousOwnerMembershipId)
              .map((m) => (
                <option key={m.membershipId} value={m.membershipId}>
                  {m.email} ({m.role})
                </option>
              ))}
          </select>
          <button onClick={transferOwnership} disabled={busy || !newOwnerMembershipId || !previousOwnerMembershipId}>
            Transfer
          </button>
        </div>
      </section>

      <section style={{ margin: "20px 0", border: "1px solid var(--ember)", borderRadius: 8, padding: 12 }}>
        <h2 style={{ marginTop: 0, color: "var(--ember)" }}>Danger zone</h2>
        {org.suspendedAt ? (
          <button onClick={reactivateOrg} disabled={busy}>
            Reactivate organization
          </button>
        ) : (
          <button onClick={suspendOrg} disabled={busy} style={{ color: "var(--ember)" }}>
            Suspend organization
          </button>
        )}
        <p style={{ color: "var(--muted, #999)", fontSize: 13, marginTop: 8 }}>
          Suspending blocks every member from project data (test cases, plans, releases, etc.) org-wide until
          lifted. Reversible - nothing is deleted.
        </p>

        <hr style={{ margin: "16px 0", borderColor: "var(--ember)" }} />

        <h3 style={{ color: "var(--ember)" }}>Permanently delete this organization</h3>
        <p style={{ color: "var(--muted, #999)", fontSize: 13 }}>
          Deletes every project, test case, run, release, and every other record under this org. Cannot be
          undone. A permanent record of what was removed, by whom, and why is kept independently of the org
          itself.
        </p>
        {!deletePreview ? (
          <button onClick={previewDelete} disabled={previewingDelete} style={{ color: "var(--ember)" }}>
            {previewingDelete ? "Loading…" : "Preview what would be deleted"}
          </button>
        ) : (
          <div style={{ display: "grid", gap: 8 }}>
            <p>
              <strong>{deletePreview.projectCount}</strong> project(s) and everything under them would be
              permanently removed:
            </p>
            <ul style={{ fontSize: 13, columns: 2 }}>
              {Object.entries(deletePreview.rowCounts)
                .filter(([, count]) => count > 0)
                .map(([model, count]) => (
                  <li key={model}>
                    {model}: {count}
                  </li>
                ))}
            </ul>
            <label>
              Type the organization&apos;s slug (<code>{org.slug}</code>) to confirm
              <input value={confirmSlug} onChange={(e) => setConfirmSlug(e.target.value)} style={{ width: "100%" }} />
            </label>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                className="btn-secondary"
                onClick={() => {
                  setDeletePreview(null);
                  setConfirmSlug("");
                }}
              >
                Cancel
              </button>
              <button
                onClick={confirmHardDelete}
                disabled={deleting || confirmSlug !== org.slug}
                style={{ color: "var(--ember)" }}
              >
                {deleting ? "Deleting…" : "Permanently delete"}
              </button>
            </div>
          </div>
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
