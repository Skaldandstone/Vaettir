"use client";
import { roleLabel } from "@/lib/membership";

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
  const [search, setSearch] = useState("");
  const [selectedMembers, setSelectedMembers] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkRole, setBulkRole] = useState("EDITOR");
  const [bulkSeat, setBulkSeat] = useState<"FULL" | "READ_ONLY">("FULL");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkResult, setBulkResult] = useState("");
  async function applyBulkMembers() {
    if (!canManage || bulkBusy) return;
    setBulkBusy(true);
    let completed = 0;
    const failures: string[] = [];
    for (const id of selectedMembers) {
      try {
        await updateMemberMutation.mutateAsync({ membershipId: id, role: bulkRole as never, seatType: bulkSeat });
        completed++;
        setSelectedMembers(previous => previous.filter(value => value !== id));
      } catch (error) {
        failures.push(`${members.find(m => m.id === id)?.userEmail ?? id}: ${error instanceof Error ? error.message : "Update failed"}`);
      }
    }
    setBulkResult(`${completed} updated.${failures.length ? ` Failed rows remain selected. ${failures.join("; ")}` : " All requested changes saved."}`);
    setBulkBusy(false);
  }
  const [sort, setSort] = useState<{ key: "email" | "role" | "seat"; desc: boolean }>({ key: "email", desc: false });
  const [inviteSort, setInviteSort] = useState<{ key: "email" | "role" | "seat"; desc: boolean }>({ key: "email", desc: false });
  function compare(a: string, b: string, desc: boolean) { return a.localeCompare(b, undefined, { sensitivity: "base" }) * (desc ? -1 : 1); }
  const visibleMembers = members.filter(m => `${m.userName ?? ""} ${m.userEmail} ${roleLabel(m.role)}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => compare(sort.key === "email" ? a.userEmail : sort.key === "role" ? roleLabel(a.role) : a.seatType, sort.key === "email" ? b.userEmail : sort.key === "role" ? roleLabel(b.role) : b.seatType, sort.desc));
  const visibleInvitations = invitations.filter(inv => `${inv.email} ${roleLabel(inv.role)}`.toLowerCase().includes(search.toLowerCase())).sort((a,b) => compare(inviteSort.key === "email" ? a.email : inviteSort.key === "role" ? roleLabel(a.role) : a.seatType, inviteSort.key === "email" ? b.email : inviteSort.key === "role" ? roleLabel(b.role) : b.seatType, inviteSort.desc));
  function headers(pending: boolean) {
    const current = pending ? inviteSort : sort;
    const update = pending ? setInviteSort : setSort;
    return <tr>{([ ["email", "User / email"], ["role", "Permission role"], ["seat", "Seat"] ] as const).map(([key,label]) => <th key={key} scope="col" style={cellStyle} aria-sort={current.key === key ? current.desc ? "descending" : "ascending" : "none"}><button className="member-sort" onClick={() => update({key,desc:current.key === key && !current.desc})}>{label} {current.key === key ? current.desc ? "↓" : "↑" : "↕"}</button></th>)}<th scope="col" style={cellStyle}>Actions</th></tr>;
  }

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
    <div style={{ maxWidth: 1000 }}>
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
      {canManage && <div style={{display:"flex",gap:12,alignItems:"center",marginBottom:12}}><label><input type="checkbox" disabled={bulkBusy} checked={visibleMembers.length > 0 && visibleMembers.every(m => selectedMembers.includes(m.id))} onChange={e => setSelectedMembers(e.target.checked ? [...new Set([...selectedMembers,...visibleMembers.map(m => m.id)])] : selectedMembers.filter(id => !visibleMembers.some(m => m.id === id)))} /> Select displayed members</label><button className="btn-secondary" disabled={!selectedMembers.length || bulkBusy} onClick={() => {setBulkResult("");setBulkOpen(true);}}>Edit {selectedMembers.length} selected</button></div>}
      <label>Find a member or invitation<input type="search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Name, email or role" style={{display:"block",margin:"8px 0 16px",width:"min(100%, 420px)"}} /></label>
      {actionError && <p style={{ color: "var(--ember)" }}>{actionError}</p>}
      <div className="member-table-scroll"><table aria-label="Current members" style={{ borderCollapse: "collapse", width: "100%", marginBottom: 24 }}>
        <thead>
          {headers(false)}
        </thead>
        <tbody>
          {visibleMembers.length === 0 && <tr><td colSpan={4} style={cellStyle}>No matching members.</td></tr>}
          {visibleMembers.map((m) => (
            <tr key={m.id}>
              <td style={cellStyle}>{canManage && <input type="checkbox" aria-label={`Select ${m.userEmail}`} disabled={bulkBusy} checked={selectedMembers.includes(m.id)} onChange={e => setSelectedMembers(previous => e.target.checked ? [...previous,m.id] : previous.filter(id => id !== m.id))} />} {m.userName ? `${m.userName} (${m.userEmail})` : m.userEmail}</td>
              <td style={cellStyle}>
                {canManage ? (
                <select
                  value={m.role}
                  disabled={bulkBusy || updateMemberMutation.isPending}
                  onChange={(e) => updateMember(m.id, e.target.value, m.seatType as "FULL" | "READ_ONLY")}
                >
                  {EDIT_ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
                ) : roleLabel(m.role)}
              </td>
              <td style={cellStyle}>
                {canManage ? (
                <select
                  value={m.seatType}
                  onChange={(e) => updateMember(m.id, m.role, e.target.value as "FULL" | "READ_ONLY")}
                  disabled={m.role !== "VIEWER" || bulkBusy || updateMemberMutation.isPending}
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
      </table></div>
      <Modal open={bulkOpen && canManage} title="Review member permission changes" onClose={() => setBulkOpen(false)} dismissible={!bulkBusy}>
        <p>Apply the following role and seat to {selectedMembers.length} selected members. Owner protection, seat limits and administrator permissions are checked for every member.</p>
        <fieldset disabled={bulkBusy}><label>Role<select value={bulkRole} onChange={e => {setBulkRole(e.target.value); if(e.target.value !== "VIEWER") setBulkSeat("FULL");}}>{EDIT_ROLES.map(r => <option key={r} value={r}>{roleLabel(r)}</option>)}</select></label><label>Seat<select value={bulkSeat} disabled={bulkRole !== "VIEWER"} onChange={e => setBulkSeat(e.target.value as "FULL" | "READ_ONLY")}><option value="FULL">Full</option><option value="READ_ONLY">Read-only</option></select></label><details><summary>Selected members</summary><ul>{members.filter(m => selectedMembers.includes(m.id)).map(m => <li key={m.id}>{m.userEmail}: {roleLabel(m.role)} → {roleLabel(bulkRole)}</li>)}</ul></details><button className="btn-primary" disabled={!selectedMembers.length} onClick={() => void applyBulkMembers()}>Confirm permission changes</button></fieldset>
        {bulkBusy && <p role="status">Applying changes…</p>}{bulkResult && <p role="status">{bulkResult}</p>}
      </Modal>

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
                    {roleLabel(r)}
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

      {canManage && (
        <>
          <h2>Pending invitations</h2>
          {invitationsQuery.error && <p role="alert">Could not load invitations: {invitationsQuery.error.message}</p>}
          {revokeMutation.error && <p role="alert">{revokeMutation.error.message}</p>}
          <div className="member-table-scroll"><table aria-label="Pending invitations" style={{borderCollapse:"collapse",width:"100%"}}><thead>{headers(true)}</thead><tbody>
            {invitationsQuery.isLoading ? <tr><td colSpan={4} style={cellStyle}>Loading invitations…</td></tr> : !invitationsQuery.error && visibleInvitations.length === 0 ? <tr><td colSpan={4} style={cellStyle}>{search ? "No matching invitations." : "No pending invitations."}</td></tr> : null}
            {visibleInvitations.map(inv => <tr key={inv.id}><td style={cellStyle}>{inv.email}<small style={{display:"block",color:"var(--muted)"}}>Awaiting acceptance</small></td><td style={cellStyle}>{roleLabel(inv.role)}</td><td style={cellStyle}>{inv.seatType === "READ_ONLY" ? "Read-only" : "Full"}</td><td style={cellStyle}><button className="btn-secondary" disabled={revokeMutation.isPending} aria-label={`Revoke invitation for ${inv.email}`} onClick={() => revokeMutation.mutate({invitationId:inv.id})}>Revoke</button></td></tr>)}
          </tbody></table></div>
        </>
      )}
    </div>
  );
}

const cellStyle = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" as const };
