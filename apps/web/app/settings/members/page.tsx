"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { Modal } from "../../../components/Modal";

const ROLES = ["ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"];
const EDIT_ROLES = ["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"];

export default function MembersPage() {
  const router = useRouter();
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [members, setMembers] = useState<RouterOutputs["organization"]["listMembers"]>([]);
  const [invitations, setInvitations] = useState<RouterOutputs["organization"]["listInvitations"]>([]);
  const [seatUsage, setSeatUsage] = useState<RouterOutputs["organization"]["seatUsage"] | null>(null);
  const [planTiers, setPlanTiers] = useState<RouterOutputs["organization"]["listPlanTiers"]>([]);
  const [changingPlan, setChangingPlan] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [seatType, setSeatType] = useState<"FULL" | "READ_ONLY">("FULL");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  async function loadOrgData(organizationId: string) {
    const [memberList, invitationList, usage] = await Promise.all([
      trpc.organization.listMembers.query({ organizationId }),
      trpc.organization.listInvitations.query({ organizationId }).catch(() => []), // ADMIN+ only; non-admins just won't see this
      trpc.organization.seatUsage.query({ organizationId }),
    ]);
    setMembers(memberList);
    setInvitations(invitationList);
    setSeatUsage(usage);
  }

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        const org = orgs[0];
        if (!org) {
          router.push("/onboarding");
          return;
        }
        setOrgId(org.id);
        setOrgName(org.name);
        await loadOrgData(org.id);
        setPlanTiers(await trpc.organization.listPlanTiers.query());
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, [router]);

  async function changePlan(planTierId: string) {
    if (!orgId) return;
    setChangingPlan(true);
    setPlanError(null);
    try {
      await trpc.organization.changePlanTier.mutate({ organizationId: orgId, planTierId });
      await loadOrgData(orgId);
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : String(e));
    } finally {
      setChangingPlan(false);
    }
  }

  async function submitInvite() {
    if (!orgId) return;
    setInviting(true);
    setError(null);
    setInviteLink(null);
    try {
      const result = await trpc.organization.inviteMember.mutate({ organizationId: orgId, email, role: role as never, seatType });
      setInviteLink(`${window.location.origin}/invite/${result.token}`);
      setEmail("");
      await loadOrgData(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setInviting(false);
    }
  }

  async function revoke(invitationId: string) {
    if (!orgId) return;
    await trpc.organization.revokeInvitation.mutate({ invitationId });
    await loadOrgData(orgId);
  }

  async function updateMember(membershipId: string, newRole: string, newSeatType: "FULL" | "READ_ONLY") {
    if (!orgId) return;
    setError(null);
    try {
      await trpc.organization.updateMember.mutate({ membershipId, role: newRole as never, seatType: newSeatType });
      await loadOrgData(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function removeMember(membershipId: string) {
    if (!orgId) return;
    setError(null);
    try {
      await trpc.organization.removeMember.mutate({ membershipId });
      await loadOrgData(orgId);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!orgId) return <p>You don't belong to an organization yet.</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h1>{orgName} members</h1>
        <button className="btn-primary" onClick={() => setInviteOpen(true)}>
          + Invite someone
        </button>
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
          <p className="text-muted">Pending invitations reserve {seatUsage.fullSeatsReserved} full and {seatUsage.readOnlySeatsReserved} read-only seats.</p>
          {seatUsage.privateBeta && <p>Private beta: no charge, no self-service upgrades. Contact your beta support contact for allowance questions.</p>}
          {!seatUsage.privateBeta && planTiers.length > 0 && (
            <div style={{ marginTop: 12, display: "flex", gap: 8, alignItems: "center" }}>
              <label style={{ fontSize: 13 }}>
                Plan:{" "}
                <select value={seatUsage.planTierId} onChange={(e) => changePlan(e.target.value)} disabled={changingPlan}>
                  {planTiers.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name} {t.monthlyPricePerSeatCents !== null ? `- $${(t.monthlyPricePerSeatCents / 100).toFixed(0)}/seat/mo` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {changingPlan && <span className="text-muted" style={{ fontSize: 12 }}>Saving…</span>}
            </div>
          )}
          {planError && <p style={{ color: "var(--ember)", fontSize: 13, marginTop: 6 }}>{planError}</p>}
        </div>
      )}

      <h2>Current members</h2>
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
              </td>
              <td style={cellStyle}>
                <select
                  value={m.seatType}
                  onChange={(e) => updateMember(m.id, m.role, e.target.value as "FULL" | "READ_ONLY")}
                  disabled={m.role !== "VIEWER"}
                >
                  <option value="FULL">Full</option>
                  <option value="READ_ONLY">Read-only</option>
                </select>
              </td>
              <td style={cellStyle}>
                <button onClick={() => removeMember(m.id)}>Remove</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <Modal open={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite someone">
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
            <button className="btn-primary" onClick={submitInvite} disabled={inviting || !email}>
              {inviting ? "Sending…" : "Send invite"}
            </button>
          </div>

          {inviteLink && (
            <p style={{ background: "var(--frost-dim)", padding: 10, borderRadius: 3 }}>
              Invite created — copy this link and send it to them: <br />
              <code>{inviteLink}</code>
            </p>
          )}
          {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
        </div>
      </Modal>

      {invitations.length > 0 && (
        <>
          <h2>Pending invitations</h2>
          <ul>
            {invitations.map((inv) => (
              <li key={inv.id}>
                {inv.email} — {inv.role} ({inv.seatType})
                <button onClick={() => revoke(inv.id)} style={{ marginLeft: 8 }}>
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
