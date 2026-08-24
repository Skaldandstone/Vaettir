"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

const ROLES = ["ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"];

export default function MembersPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [members, setMembers] = useState<RouterOutputs["organization"]["listMembers"]>([]);
  const [invitations, setInvitations] = useState<RouterOutputs["organization"]["listInvitations"]>([]);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [seatType, setSeatType] = useState<"FULL" | "READ_ONLY">("FULL");
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadOrgData(organizationId: string) {
    const [memberList, invitationList] = await Promise.all([
      trpc.organization.listMembers.query({ organizationId }),
      trpc.organization.listInvitations.query({ organizationId }).catch(() => []), // ADMIN+ only; non-admins just won't see this
    ]);
    setMembers(memberList);
    setInvitations(invitationList);
  }

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        const org = orgs[0];
        if (!org) return;
        setOrgId(org.id);
        setOrgName(org.name);
        await loadOrgData(org.id);
      })
      .catch((e) => setError(String(e)))
      .finally(() => setLoading(false));
  }, []);

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

  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "crimson" }}>{error}</p>;
  if (!orgId) return <p>You don't belong to an organization yet.</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>{orgName} members</h1>

      <h2>Current members</h2>
      <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 24 }}>
        <thead>
          <tr>
            <th style={cellStyle}>Email</th>
            <th style={cellStyle}>Role</th>
            <th style={cellStyle}>Seat</th>
          </tr>
        </thead>
        <tbody>
          {members.map((m) => (
            <tr key={m.id}>
              <td style={cellStyle}>{m.userName ? `${m.userName} (${m.userEmail})` : m.userEmail}</td>
              <td style={cellStyle}>{m.role}</td>
              <td style={cellStyle}>{m.seatType}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Invite someone</h2>
      <div style={{ display: "grid", gap: 8, maxWidth: 360, marginBottom: 16 }}>
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
        <button onClick={submitInvite} disabled={inviting || !email}>
          {inviting ? "Sending…" : "Send invite"}
        </button>
      </div>

      {inviteLink && (
        <p style={{ background: "#f0f9f0", padding: 10, borderRadius: 6 }}>
          Invite created — copy this link and send it to them: <br />
          <code>{inviteLink}</code>
        </p>
      )}
      {error && <p style={{ color: "crimson" }}>{error}</p>}

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

const cellStyle = { border: "1px solid #e5e5e5", padding: "6px 10px", textAlign: "left" as const };
