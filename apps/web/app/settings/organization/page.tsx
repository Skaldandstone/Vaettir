"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

type Labels = { action: string; expectedActionOrData: string; expectedResult: string; expectedResponse: string };
const API_KEY_ROLES = ["VIEWER", "COMPLIANCE_AUDITOR", "EDITOR", "ADMIN"];

function ApiKeysSection({ organizationId }: { organizationId: string }) {
  const [keys, setKeys] = useState<RouterOutputs["apiKeys"]["list"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  function load() {
    setLoading(true);
    trpc.apiKeys.list
      .query({ organizationId })
      .then(setKeys)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [organizationId]);

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await trpc.apiKeys.create.mutate({ organizationId, name: name.trim(), role: role as never });
      setFreshKey(res.key);
      setName("");
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm("Revoke this key? Anything using it will stop working immediately.")) return;
    await trpc.apiKeys.revoke.mutate({ id });
    load();
  }

  return (
    <div style={{ marginTop: 32 }}>
      <h2>API keys</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Service tokens for CI integrations (test result ingestion, PR scanning) that don&apos;t go through a human
        session. Each key acts with the role you grant it.
      </p>

      {freshKey && (
        <div className="panel" style={{ borderColor: "var(--frost)", marginBottom: 12 }}>
          <p style={{ margin: 0 }}>
            <strong>Copy this now — it won&apos;t be shown again:</strong>
          </p>
          <code style={{ display: "block", marginTop: 6, wordBreak: "break-all" }}>{freshKey}</code>
          <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setFreshKey(null)}>
            Done
          </button>
        </div>
      )}

      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      {loading && <p>Loading…</p>}

      {!loading && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={cellStyle}>Name</th>
              <th style={cellStyle}>Key</th>
              <th style={cellStyle}>Role</th>
              <th style={cellStyle}>Last used</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {keys.map((k) => (
              <tr key={k.id} style={{ opacity: k.revokedAt ? 0.5 : 1 }}>
                <td style={cellStyle}>{k.name}</td>
                <td style={cellStyle}>
                  <code>{k.keyPrefix}…</code>
                </td>
                <td style={cellStyle}>{k.role}</td>
                <td style={cellStyle}>{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "never"}</td>
                <td style={cellStyle}>
                  {k.revokedAt ? "revoked" : <button onClick={() => revoke(k.id)}>Revoke</button>}
                </td>
              </tr>
            ))}
            {keys.length === 0 && (
              <tr>
                <td colSpan={5} style={cellStyle} className="text-muted">
                  No API keys yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Key name, e.g. GitHub Actions" style={{ flex: 1 }} />
        <select value={role} onChange={(e) => setRole(e.target.value)}>
          {API_KEY_ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
        <button className="btn-primary" onClick={create} disabled={creating || !name.trim()}>
          {creating ? "Creating…" : "+ New key"}
        </button>
      </div>
    </div>
  );
}

const cellStyle = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" as const };

export default function OrganizationSettingsPage() {
  const [orgId, setOrgId] = useState<string | null>(null);
  const [orgName, setOrgName] = useState("");
  const [labels, setLabels] = useState<Labels | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    trpc.organization.mine
      .query()
      .then(async (orgs) => {
        const org = orgs[0];
        if (!org) return;
        setOrgId(org.id);
        setOrgName(org.name);
        const detail = await trpc.organization.byId.query({ id: org.id });
        setLabels(detail.stepFieldLabels as Labels);
      })
      .catch((e) => setError(String(e)));
  }, []);

  async function submit() {
    if (!orgId || !labels) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const resolved = await trpc.organization.updateStepFieldLabels.mutate({ organizationId: orgId, labels });
      setLabels(resolved as Labels);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!labels) return <p>Loading…</p>;

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>{orgName} settings</h1>

      <h2>Test case step field labels</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        These are the column headers shown on the structured step table when authoring a test case. Rename them to
        whatever fits your team.
      </p>

      <div style={{ display: "grid", gap: 10 }}>
        <label>
          Action / trigger
          <input
            value={labels.action}
            onChange={(e) => setLabels({ ...labels, action: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Internal/API expectation
          <input
            value={labels.expectedActionOrData}
            onChange={(e) => setLabels({ ...labels, expectedActionOrData: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          User-facing result
          <input
            value={labels.expectedResult}
            onChange={(e) => setLabels({ ...labels, expectedResult: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>
        <label>
          Technical response
          <input
            value={labels.expectedResponse}
            onChange={(e) => setLabels({ ...labels, expectedResponse: e.target.value })}
            style={{ width: "100%" }}
          />
        </label>
        <button onClick={submit} disabled={saving}>
          {saving ? "Saving…" : "Save labels"}
        </button>
        {saved && <p style={{ color: "var(--frost)" }}>Saved.</p>}
      </div>

      {orgId && <ApiKeysSection organizationId={orgId} />}
    </div>
  );
}
