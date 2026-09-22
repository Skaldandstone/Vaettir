"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpcReact } from "../../../lib/trpcReact";
import { Modal } from "../../../components/Modal";
import { canAdministerOrganization } from "../../../lib/membership";

const ROLES = ["ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"];
const EDIT_ROLES = ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"];

// P1-15: the first page migrated off the manual useState/useEffect fetch
// pattern every other page still uses, onto @trpc/react-query hooks - real
// caching/invalidation instead of each mutation hand-calling a loadOrgData()
// refetch-everything function. Kept deliberately close to the original
// page's exact behavior (same loading/error UX, same "refetch org data
// broadly after any mutation" approach) so this is a faithful proof of the
// pattern, not a redesign - see ROADMAP.md's P1-15 entry for what's left.
export default function MembersPage() {
  const router = useRouter();
  const utils = trpcReact.useUtils();

  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;
  const orgName = orgsQuery.data?.[0]?.name ?? "";
  const canManage = canAdministerOrganization(orgsQuery.data?.[0]);

  const membersQuery = trpcReact.organization.listMembers.useQuery({ organizationId: orgId! }, { enabled: !!orgId });
  // ADMIN+ only; non-admins just won't see this - same as the original's .catch(() => []).
  const invitationsQuery = trpcReact.organization.listInvitations.useQuery(
    { organizationId: orgId! },
    { enabled: !!orgId && canManage, retry: false },
  );
  const seatUsageQuery = trpcReact.organization.seatUsage.useQuery({ organizationId: orgId! }, { enabled: !!orgId });
  const planTiersQuery = trpcReact.organization.listPlanTiers.useQuery(undefined, { enabled: !!orgId });

  const members = membersQuery.data ?? [];
  const invitations = invitationsQuery.data ?? [];
  const seatUsage = seatUsageQuery.data ?? null;
  const planTiers = planTiersQuery.data ?? [];

  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [seatType, setSeatType] = useState<"FULL" | "READ_ONLY">("FULL");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  useEffect(() => {
    if (orgsQuery.data && orgsQuery.data.length === 0) router.push("/onboarding");
  }, [orgsQuery.data, router]);

  function invalidateOrgData() {
    return utils.organization.invalidate();
  }

  const changePlanMutation = trpcReact.organization.changePlanTier.useMutation({
    onSuccess: () => invalidateOrgData(),
  });
  const inviteMutation = trpcReact.organization.inviteMember.useMutation({
    onSuccess: (result) => {
      setInviteLink(`${window.location.origin}/invite/${result.token}`);
      setEmail("");
      void invalidateOrgData();
    },
    onError: (e) => setInviteError(e.message),
  });
  const revokeMutation = trpcReact.organization.revokeInvitation.useMutation({
    onSuccess: () => invalidateOrgData(),
  });
  const updateMemberMutation = trpcReact.organization.updateMember.useMutation({
    onSuccess: () => invalidateOrgData(),
    onError: (e) => setActionError(e.message),
  });
  const removeMemberMutation = trpcReact.organization.removeMember.useMutation({
    onSuccess: () => invalidateOrgData(),
    onError: (e) => setActionError(e.message),
  });

  function submitInvite() {
    if (!orgId || !canManage) return;
    setInviteError(null);
    setInviteLink(null);
    inviteMutation.mutate({ organizationId: orgId, email, role: role as never, seatType });
  }

  function updateMember(membershipId: string, newRole: string, newSeatType: "FULL" | "READ_ONLY") {
    if (!canManage) return;
    setActionError(null);
    updateMemberMutation.mutate({ membershipId, role: newRole as never, seatType: newSeatType });
  }

  const loading = orgsQuery.isLoading || (!!orgId && (membersQuery.isLoading || seatUsageQuery.isLoading));
  const pageError = orgsQuery.error?.message ?? membersQuery.error?.message ?? seatUsageQuery.error?.message ?? null;

  if (loading) return <p>Loading…</p>;
  if (pageError) return <p style={{ color: "var(--ember)" }}>{pageError}</p>;
  if (!orgId) return <p>You don't belong to an organization yet.</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>{orgName} members</h1>
        {canManage && (
          <button className="btn-primary" onClick={() => setInviteOpen(true)}>
            + Invite someone
          </button>
        )}
      </div>

      {seatUsage && (
        <div className="panel" style={{ margin: "12px 0 20px" }}>
          <div className="eyebrow">{seatUsage.planTierName} plan</div>
          <div style={{ display: "flex", gap: 24, marginTop: 4 }}>
            <div>
              <strong>
                {seatUsage.fullSeatsUsed}
                {seatUsage.fullSeatsIncluded !== null ? `/${seatUsage.fullSeatsIncluded}` : ""}
              </strong>{" "}
              <span className="text-muted" style={{ fontSize: 12 }}>
                full seats
              </span>
            </div>
            <div>
              <strong>
                {seatUsage.readOnlySeatsUsed}
                {seatUsage.readOnlySeatsMax !== null ? `/${seatUsage.readOnlySeatsMax}` : ""}
              </strong>{" "}
              <span className="text-muted" style={{ fontSize: 12 }}>
                read-only seats ({seatUsage.readOnlySeatsIncluded} included)
              </span>
            </div>
          </div>
          {seatUsage.nextTierNameForOneMoreFullSeat && (
            <p style={{ color: "var(--ember)", fontSize: 13, marginBottom: 0, marginTop: 8 }}>
              You're at your full-seat limit — adding one more requires upgrading to {seatUsage.nextTierNameForOneMoreFullSeat}.
            </p>
          )}
          {canManage && planTiers.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 13 }}>
                Plan:{" "}
                <select
                  value={seatUsage.planTierId}
                  onChange={(e) => changePlanMutation.mutate({ organizationId: orgId, planTierId: e.target.value })}
                  disabled={changePlanMutation.isPending}
                >
                  {planTiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.monthlyPricePerSeatCents !== null ? `- $${(t.monthlyPricePerSeatCents / 100).toFixed(0)}/seat/mo` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {changePlanMutation.isPending && <span className="text-muted" style={{ fontSize: 12 }}>Saving…</span>}
            </div>
          )}
          {changePlanMutation.error && (
            <p style={{ color: "var(--ember)", fontSize: 13, marginTop: 6 }}>{changePlanMutation.error.message}</p>
          )}
        </div>
      )}

      <h2>Current members</h2>
      {actionError && <p style={{ color: "var(--ember)" }}>{actionError}</p>}
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={cellStyle}>Email</th>
            <th style={cellStyle}>Role</th>
            <th style={cellStyle}>Seat</th>
            <th style={cellStyle}></th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td style={cellStyle}>{m.userName ? `${m.userName} (${m.userEmail})` : m.userEmail}</td>
              <td style={cellStyle}>
                {canManage ? (
                <select
                  value={m.role}
                  onChange={(e) => updateMember(m.id, e.target.value, m.seatType as "FULL" | "READ_ONLY")}
                >
                  {EDIT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
                ) : m.role}
              </td>
              <td style={cellStyle}>
                {canManage ? (
                <select
                  value={m.seatType}
                  onChange={(e) => updateMember(m.id, m.role, e.target.value as "FULL" | "READ_ONLY")}
                  disabled={m.role !== "VIEWER"}
                >
                  <option value="FULL">Full</option>
                  <option value="READ_ONLY">Read-only</option>
                </select>
                ) : m.seatType === "READ_ONLY" ? "Read-only" : "Full"}
              </td>
              <td style={cellStyle}>
                {canManage && <button
                  onClick={() => {
                    setActionError(null);
                    removeMemberMutation.mutate({ membershipId: m.id });
                  }}
                >
                  Remove
                </button>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={canManage && inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone">
        <div style={{ display: "grid", gap: 10 }}>
          <label>
            Email
            <input value={email} onChange={(e) => setEmail(e.target.value)} style={{ width: "100%" }} />
          </label>
          <div style={{ display: "flex", gap: 16 }}>
            <label>
              Role
              <select
                value={role}
                onChange={(e) => {
                  setRole(e.target.value);
                  if (e.target.value !== "VIEWER") setSeatType("FULL");
                }}
              >
                {ROLES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Seat type
              <select value={seatType} onChange={(e) => setSeatType(e.target.value as "FULL" | "READ_ONLY")} disabled={role !== "VIEWER"}>
                <option value="FULL">Full</option>
                <option value="READ_ONLY">Read-only</option>
              </select>
            </label>
          </div>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", marginTop: 8 }}>
            <button className="btn-secondary" onClick={() => setInviteOpen(false)}>
              Close
            </button>
            <button className="btn-primary" onClick={submitInvite} disabled={inviteMutation.isPending || !email}>
              {inviteMutation.isPending ? "Sending…" : "Send invite"}
            </button>
          </div>

          {inviteLink && (
            <p style={{ background: "var(--frost-dim)", padding: 10, borderRadius: 3 }}>
              Invite created — copy this link and send it to them: <br />
              <code>{inviteLink}</code>
            </p>
          )}
          {inviteError && <p style={{ color: "var(--ember)" }}>{inviteError}</p>}
        </div>
      </Modal>

      {canManage && invitations.length > 0 && (
        <>
          <h2>Pending invitations</h2>
          <ul>
            {invitations.map((inv) => (
              <li key={inv.id}>
                {inv.email} — {inv.role} ({inv.seatType})
                <button onClick={() => canManage && revokeMutation.mutate({ invitationId: inv.id })} style={{ marginLeft: 8 }}>
                  Revoke
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

const cellStyle = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" as const };
