"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { trpc, type RouterOutputs } from "../../lib/trpc";

// P13-01/P13-02: staff-only surface, gated server-side by the API's
// staffProcedure (Clerk email against STAFF_EMAIL_DOMAIN), not by any
// customer Membership/OrgRole. A non-staff user hitting this page just
// gets a FORBIDDEN error from the query below - there's no separate
// client-side route guard, since the server-side gate is the real one and
// duplicating it here would just be a second place to keep in sync.
export default function AdminOrgSearchPage() {
  const [query, setQuery] = useState("");
  const [orgs, setOrgs] = useState<RouterOutputs["admin"]["listOrganizations"]>([]);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load(q?: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await trpc.admin.listOrganizations.query({ query: q || undefined });
      setOrgs(result);
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
    load();
  }, []);

  if (forbidden) return <p>Staff access required. This account isn&apos;t recognized as Skald &amp; Stone staff.</p>;
  if (loading) return <p>Loading…</p>;
  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;

  return (
    <div style={{ maxWidth: 900 }}>
      <h1>Organizations</h1>
      <p style={{ color: "var(--muted, #999)" }}>Internal staff lookup - not visible to customers.</p>
      <p>
        <Link href="/admin/repo-health">Repo Health Snapshot →</Link>
      </p>
      <div style={{ display: "flex", gap: 8, margin: "12px 0" }}>
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && load(query)}
          placeholder="Search by name or slug…"
          style={{ flex: 1 }}
        />
        <button onClick={() => load(query)}>Search</button>
      </div>
      <table style={{ width: "100%", borderCollapse: "collapse" }}>
        <thead>
          <tr style={{ textAlign: "left" }}>
            <th>Name</th>
            <th>Plan</th>
            <th>Seats (full / read-only)</th>
            <th>Members</th>
            <th>Created</th>
          </tr>
        </thead>
        <tbody>
          {orgs.map((org) => (
            <tr key={org.id} style={{ borderTop: "1px solid var(--border, #333)" }}>
              <td>
                <Link href={`/admin/organizations/${org.id}`}>{org.name}</Link>
              </td>
              <td>{org.planTierName}</td>
              <td>
                {org.fullSeatsUsed} / {org.readOnlySeatsUsed}
              </td>
              <td>{org.memberCount}</td>
              <td>{new Date(org.createdAt).toLocaleDateString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {orgs.length === 0 && <p>No organizations match.</p>}
    </div>
  );
}
