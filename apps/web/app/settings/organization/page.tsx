"use client";

import { useEffect, useState } from "react";
import { trpcReact, type RouterOutputs } from "@/lib/trpcReact";

type Labels = { action: string; expectedActionOrData: string; expectedResult: string; expectedResponse: string };
const API_KEY_ROLES = ["VIEWER", "COMPLIANCE_AUDITOR", "EDITOR", "ADMIN"];

function ApiKeysSection({ organizationId }: { organizationId: string }) {
  const utils = trpcReact.useUtils();
  const keysQuery = trpcReact.apiKeys.list.useQuery({ organizationId });
  const keys = keysQuery.data ?? [];
  const loading = keysQuery.isPending;
  const loadError = keysQuery.error?.message ?? null;
  const createMutation = trpcReact.apiKeys.create.useMutation();
  const revokeMutation = trpcReact.apiKeys.revoke.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [role, setRole] = useState("EDITOR");
  const [creating, setCreating] = useState(false);
  const [freshKey, setFreshKey] = useState<string | null>(null);

  function load() {
    void utils.apiKeys.list.invalidate({ organizationId });
  }

  async function create() {
    if (!name.trim()) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createMutation.mutateAsync({ organizationId, name: name.trim(), role: role as never });
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
    await revokeMutation.mutateAsync({ id });
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

      {(error ?? loadError) && <p style={{ color: "var(--ember)" }}>{error ?? loadError}</p>}
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

// P9-06: outbound webhooks. Deliberately separate from ApiKeysSection above
// (inbound auth for CI callers) - this is the opposite direction, the
// platform pushing events OUT to a URL the org controls.
// P9-03: which real-time events also post to the same Slack webhook the
// digest section above configures. A second, independent subscriber of
// the exact events WebhooksSection's generic webhooks already fire from -
// not a replacement for it, and no separate "channel" concept, since a
// Slack incoming webhook is already bound to one channel on Slack's side.
function SlackEventNotificationsSection({ organizationId }: { organizationId: string }) {
  const eventTypesQuery = trpcReact.webhooks.eventTypes.useQuery();
  const orgQuery = trpcReact.organization.byId.useQuery({ id: organizationId });
  const updateMutation = trpcReact.organization.updateSlackEventTypes.useMutation();
  const eventTypes = eventTypesQuery.data ?? [];
  const webhookConfigured = orgQuery.data?.slackWebhookConfigured ?? false;
  const [selected, setSelected] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed the editable selection once from the org row; later refetches must
  // not clobber unsaved checkbox changes.
  const orgSlackEventTypes = orgQuery.data?.slackEventTypes;
  useEffect(() => {
    if (loaded || !orgSlackEventTypes || eventTypesQuery.data === undefined) return;
    setSelected(orgSlackEventTypes);
    setLoaded(true);
  }, [loaded, orgSlackEventTypes, eventTypesQuery.data]);

  const loadError = eventTypesQuery.error?.message ?? orgQuery.error?.message ?? null;

  function toggle(evt: string) {
    setSelected((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  }

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await updateMutation.mutateAsync({ organizationId, eventTypes: selected as never });
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (loadError) return <p style={{ color: "var(--ember)" }}>{loadError}</p>;
  if (!loaded) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2>Slack event notifications</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Post real-time events to the same Slack webhook the readiness digest above uses, as they happen -
        separate from the once-a-day digest.
        {!webhookConfigured && " Configure a Slack webhook URL above first; nothing sends until one is set."}
      </p>
      <div style={{ display: "grid", gap: 6, maxWidth: 480 }}>
        {eventTypes.map((evt) => (
          <label key={evt} style={{ fontSize: 13 }}>
            <input type="checkbox" checked={selected.includes(evt)} onChange={() => toggle(evt)} /> {evt}
          </label>
        ))}
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
          <button className="btn-primary" onClick={save} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>
          {saved && <span style={{ color: "var(--frost)" }}>Saved.</span>}
        </div>
        {error && <p style={{ color: "var(--ember)" }}>{error}</p>}
      </div>
    </div>
  );
}

function WebhooksSection({ organizationId }: { organizationId: string }) {
  const utils = trpcReact.useUtils();
  const eventTypesQuery = trpcReact.webhooks.eventTypes.useQuery();
  const listQuery = trpcReact.webhooks.list.useQuery({ organizationId });
  const eventTypes = eventTypesQuery.data ?? [];
  const endpoints = listQuery.data ?? [];
  const loading = eventTypesQuery.isPending || listQuery.isPending;
  const loadError = eventTypesQuery.error?.message ?? listQuery.error?.message ?? null;
  const createMutation = trpcReact.webhooks.create.useMutation();
  const deleteMutation = trpcReact.webhooks.delete.useMutation();
  const sendTestMutation = trpcReact.webhooks.sendTest.useMutation();
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [creating, setCreating] = useState(false);
  const [freshSecret, setFreshSecret] = useState<string | null>(null);
  const [deliveriesFor, setDeliveriesFor] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<RouterOutputs["webhooks"]["listDeliveries"]>([]);
  const [testingId, setTestingId] = useState<string | null>(null);

  function load() {
    void utils.webhooks.list.invalidate({ organizationId });
  }

  function toggleEvent(evt: string) {
    setSelectedEvents((prev) => (prev.includes(evt) ? prev.filter((e) => e !== evt) : [...prev, evt]));
  }

  async function create() {
    if (!url.trim() || selectedEvents.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createMutation.mutateAsync({ organizationId, url: url.trim(), eventTypes: selectedEvents as never });
      setFreshSecret(res.secret);
      setUrl("");
      setSelectedEvents([]);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this webhook? It will stop receiving events immediately.")) return;
    await deleteMutation.mutateAsync({ id });
    load();
  }

  async function sendTest(id: string) {
    setTestingId(id);
    setError(null);
    try {
      await sendTestMutation.mutateAsync({ id });
      await viewDeliveries(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setTestingId(null);
    }
  }

  async function viewDeliveries(id: string) {
    setDeliveriesFor(id);
    const result = await utils.webhooks.listDeliveries.fetch({ webhookEndpointId: id });
    setDeliveries(result);
  }

  return (
    <div style={{ marginTop: 32 }}>
      <h2>Webhooks</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Push real platform events (new risk flag, compliance sign-off, AI review-queue item) to a URL you control,
        without polling. Each delivery is signed with the endpoint&apos;s secret via an <code>X-Vaettir-Signature</code>{" "}
        header (<code>sha256=&lt;hmac hex&gt;</code>).
      </p>

      {freshSecret && (
        <div className="panel" style={{ borderColor: "var(--frost)", marginBottom: 12 }}>
          <p style={{ margin: 0 }}>
            <strong>Copy this secret now — it won&apos;t be shown again:</strong>
          </p>
          <code style={{ display: "block", marginTop: 6, wordBreak: "break-all" }}>{freshSecret}</code>
          <button className="btn-secondary" style={{ marginTop: 8 }} onClick={() => setFreshSecret(null)}>
            Done
          </button>
        </div>
      )}

      {(error ?? loadError) && <p style={{ color: "var(--ember)" }}>{error ?? loadError}</p>}
      {loading && <p>Loading…</p>}

      {!loading && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={cellStyle}>URL</th>
              <th style={cellStyle}>Events</th>
              <th style={cellStyle}>Status</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {endpoints.map((ep) => (
              <tr key={ep.id} style={{ opacity: ep.enabled ? 1 : 0.5 }}>
                <td style={cellStyle}>
                  <code>{ep.url}</code>
                </td>
                <td style={cellStyle}>{ep.eventTypes.join(", ")}</td>
                <td style={cellStyle}>{ep.enabled ? "enabled" : "disabled"}</td>
                <td style={cellStyle}>
                  <button onClick={() => sendTest(ep.id)} disabled={testingId === ep.id} style={{ marginRight: 6 }}>
                    {testingId === ep.id ? "Sending…" : "Send test"}
                  </button>
                  <button onClick={() => viewDeliveries(ep.id)} style={{ marginRight: 6 }}>
                    Deliveries
                  </button>
                  <button onClick={() => remove(ep.id)}>Delete</button>
                </td>
              </tr>
            ))}
            {endpoints.length === 0 && (
              <tr>
                <td colSpan={4} style={cellStyle} className="text-muted">
                  No webhooks yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      {deliveriesFor && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <h3 style={{ marginTop: 0 }}>Recent deliveries</h3>
          {deliveries.length === 0 && <p>No deliveries yet.</p>}
          <ul>
            {deliveries.map((d) => (
              <li key={d.id}>
                {new Date(d.createdAt).toLocaleString()} — {d.eventType} —{" "}
                {d.success ? `OK (${d.responseStatus})` : `FAILED${d.responseStatus ? ` (${d.responseStatus})` : ""}${d.error ? `: ${d.error}` : ""}`}
              </li>
            ))}
          </ul>
          <button className="btn-secondary" onClick={() => setDeliveriesFor(null)}>
            Close
          </button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 480 }}>
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://your-endpoint.example.com/webhook" />
        <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
          {eventTypes.map((evt) => (
            <label key={evt} style={{ fontSize: 13 }}>
              <input type="checkbox" checked={selectedEvents.includes(evt)} onChange={() => toggleEvent(evt)} /> {evt}
            </label>
          ))}
        </div>
        <button className="btn-primary" onClick={create} disabled={creating || !url.trim() || selectedEvents.length === 0}>
          {creating ? "Creating…" : "+ New webhook"}
        </button>
      </div>
    </div>
  );
}

const cellStyle = { border: "1px solid var(--line)", padding: "6px 10px", textAlign: "left" as const };

const PLAN_CATEGORIES = ["COMPLIANCE", "FUNCTIONAL", "QUALITY_STRATEGY", "RELEASE_READINESS", "CUSTOM"];
const FIELD_TYPES = ["string", "number", "array"] as const;
type BuilderField = { key: string; type: (typeof FIELD_TYPES)[number] };

// P3-10: starter field lists for the most common compliance/audit plan
// shapes, so "custom" doesn't mean starting from a blank field builder.
// Picking one just pre-fills the form below -- it's still editable before
// creating, and still goes through the same createType mutation as a
// from-scratch plan type.
const PLAN_TYPE_TEMPLATES: {
  label: string;
  key: string;
  name: string;
  category: string;
  description: string;
  fields: BuilderField[];
}[] = [
  {
    label: "Vendor security questionnaire",
    key: "vendor-security-questionnaire",
    name: "Vendor Security Questionnaire",
    category: "COMPLIANCE",
    description: "Risk assessment for a new third-party vendor before onboarding",
    fields: [
      { key: "vendorName", type: "string" },
      { key: "dataAccessed", type: "array" },
      { key: "riskScore", type: "number" },
      { key: "reviewedBy", type: "string" },
      { key: "followUpItems", type: "array" },
    ],
  },
  {
    label: "Internal audit checklist",
    key: "internal-audit-checklist",
    name: "Internal Audit Checklist",
    category: "COMPLIANCE",
    description: "Structured findings and remediation tracking for an internal control audit",
    fields: [
      { key: "auditArea", type: "string" },
      { key: "findings", type: "array" },
      { key: "severity", type: "string" },
      { key: "remediationOwner", type: "string" },
      { key: "dueDate", type: "string" },
    ],
  },
  {
    label: "Change management review",
    key: "change-management-review",
    name: "Change Management Review",
    category: "COMPLIANCE",
    description: "Sign-off record for a production change, required by most change-control controls",
    fields: [
      { key: "changeDescription", type: "string" },
      { key: "approvedBy", type: "string" },
      { key: "rollbackPlan", type: "string" },
      { key: "riskLevel", type: "string" },
    ],
  },
];

// P3-09: the "no shoehorn" proof point -- an org admin builds a brand new
// compliance (or any other) plan shape here, and it's immediately available
// in the "New test plan" dropdown on every project with no code change.
// The field list below compiles into the same JSON Schema shape the
// existing CustomFieldsForm renderer already reads for built-in types.
function PlanTypesSection() {
  const utils = trpcReact.useUtils();
  const typesQuery = trpcReact.testPlans.types.useQuery();
  const types = typesQuery.data ?? [];
  const loading = typesQuery.isPending;
  const loadError = typesQuery.error?.message ?? null;
  const createTypeMutation = trpcReact.testPlans.createType.useMutation();
  const [error, setError] = useState<string | null>(null);

  const [formOpen, setFormOpen] = useState(false);
  const [key, setKey] = useState("");
  const [name, setName] = useState("");
  const [category, setCategory] = useState("COMPLIANCE");
  const [description, setDescription] = useState("");
  const [fields, setFields] = useState<BuilderField[]>([{ key: "", type: "string" }]);
  const [creating, setCreating] = useState(false);

  function load() {
    void utils.testPlans.types.invalidate();
  }

  function resetForm() {
    setKey("");
    setName("");
    setCategory("COMPLIANCE");
    setDescription("");
    setFields([{ key: "", type: "string" }]);
  }

  function applyTemplate(templateKey: string) {
    const template = PLAN_TYPE_TEMPLATES.find((t) => t.key === templateKey);
    if (!template) return;
    // Suffix the key if that template's already been created, since keys
    // must be unique -- still editable before submitting either way.
    const keyTaken = types.some((t) => t.key === template.key);
    setKey(keyTaken ? `${template.key}-2` : template.key);
    setName(template.name);
    setCategory(template.category);
    setDescription(template.description);
    setFields(template.fields.map((f) => ({ ...f })));
  }

  async function create() {
    const cleanFields = fields.filter((f) => f.key.trim().length > 0);
    if (!key.trim() || !name.trim() || cleanFields.length === 0) return;
    setCreating(true);
    setError(null);
    try {
      await createTypeMutation.mutateAsync({
        key: key.trim(),
        name: name.trim(),
        category: category as never,
        description: description.trim() || undefined,
        fields: cleanFields.map((f) => ({ key: f.key.trim(), type: f.type })),
      });
      resetForm();
      setFormOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }

  return (
    <div style={{ marginTop: 32 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <h2 style={{ marginBottom: 4 }}>Custom plan types</h2>
        <button className="btn-secondary" onClick={() => setFormOpen((v) => !v)}>
          {formOpen ? "Cancel" : "+ New plan type"}
        </button>
      </div>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Define a new test plan shape - a compliance acceptance form, an internal audit checklist, whatever your team
        needs - by listing its fields below. It's usable from every project's "New test plan" picker immediately, no
        code change or migration required.
      </p>

      {(error ?? loadError) && <p style={{ color: "var(--ember)" }}>{error ?? loadError}</p>}
      {loading && <p>Loading…</p>}

      {!loading && (
        <table style={{ borderCollapse: "collapse", width: "100%", marginBottom: 16 }}>
          <thead>
            <tr>
              <th style={cellStyle}>Name</th>
              <th style={cellStyle}>Key</th>
              <th style={cellStyle}>Category</th>
              <th style={cellStyle}>Fields</th>
              <th style={cellStyle}></th>
            </tr>
          </thead>
          <tbody>
            {types.map((t) => {
              const schema = t.fieldSchema as { properties?: Record<string, unknown> } | null;
              const fieldCount = schema?.properties ? Object.keys(schema.properties).length : 0;
              return (
                <tr key={t.id}>
                  <td style={cellStyle}>{t.name}</td>
                  <td style={cellStyle}>
                    <code>{t.key}</code>
                  </td>
                  <td style={cellStyle}>{t.category}</td>
                  <td style={cellStyle}>{fieldCount}</td>
                  <td style={cellStyle}>{t.isBuiltIn && <span className="text-muted">built-in</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      {formOpen && (
        <div className="panel" style={{ display: "grid", gap: 10, maxWidth: 480 }}>
          <label>
            Start from a template <span style={{ color: "var(--muted-dim)" }}>(optional - still editable below)</span>
            <select defaultValue="" onChange={(e) => e.target.value && applyTemplate(e.target.value)} style={{ width: "100%" }}>
              <option value="">Blank</option>
              {PLAN_TYPE_TEMPLATES.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Key <span style={{ color: "var(--muted-dim)" }}>(unique, e.g. "vendor-security-review")</span>
            <input value={key} onChange={(e) => setKey(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Name
            <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: "100%" }} />
          </label>
          <label>
            Category
            <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ width: "100%" }}>
              {PLAN_CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label>
            Description <span style={{ color: "var(--muted-dim)" }}>(optional)</span>
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={{ width: "100%" }} />
          </label>

          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Fields</div>
            {fields.map((f, i) => (
              <div key={i} style={{ display: "flex", gap: 8, marginBottom: 6 }}>
                <input
                  value={f.key}
                  onChange={(e) => setFields(fields.map((ff, j) => (j === i ? { ...ff, key: e.target.value } : ff)))}
                  placeholder="field name"
                  style={{ flex: 1 }}
                />
                <select
                  value={f.type}
                  onChange={(e) =>
                    setFields(fields.map((ff, j) => (j === i ? { ...ff, type: e.target.value as BuilderField["type"] } : ff)))
                  }
                >
                  {FIELD_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
                <button className="btn-secondary" onClick={() => setFields(fields.filter((_, j) => j !== i))} disabled={fields.length === 1}>
                  Remove
                </button>
              </div>
            ))}
            <button className="btn-secondary" style={{ fontSize: 13 }} onClick={() => setFields([...fields, { key: "", type: "string" }])}>
              + Add field
            </button>
          </div>

          <button className="btn-primary" onClick={create} disabled={creating || !key.trim() || !name.trim()}>
            {creating ? "Creating…" : "Create plan type"}
          </button>
        </div>
      )}
    </div>
  );
}

function AiCreditsSection({ organizationId }: { organizationId: string }) {
  const statusQuery = trpcReact.organization.aiCreditStatus.useQuery({ organizationId });
  const status = statusQuery.data ?? null;
  const error = statusQuery.error?.message ?? null;

  if (error) return <p style={{ color: "var(--ember)" }}>{error}</p>;
  if (!status) return null;

  return (
    <div style={{ marginTop: 32 }}>
      <h2>AI credits</h2>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>
        Covers the real cost of AI-powered features (reverse-engineering, PR-scan recommendations, risk assessment,
        strategy generation). Resets monthly per your plan tier; top-off purchases aren't available yet.
      </p>
      <div className="panel" style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 28, fontWeight: 700 }}>{status.balance}</div>
        <div className="text-muted" style={{ fontSize: 12 }}>
          credits remaining · {status.includedPerMonth}/month included on the {status.planTierName} plan
        </div>
      </div>
      {status.recent.length > 0 && (
        <table style={{ borderCollapse: "collapse", width: "100%" }}>
          <thead>
            <tr>
              <th style={cellStyle}>When</th>
              <th style={cellStyle}>Type</th>
              <th style={cellStyle}>Operation</th>
              <th style={cellStyle}>Amount</th>
              <th style={cellStyle}>Actual tokens</th>
            </tr>
          </thead>
          <tbody>
            {status.recent.map((t) => (
              <tr key={t.id}>
                <td style={cellStyle}>{new Date(t.createdAt).toLocaleString()}</td>
                <td style={cellStyle}>{t.type}</td>
                <td style={cellStyle}>{t.operation ?? t.description ?? "—"}</td>
                <td style={{ ...cellStyle, color: t.amount < 0 ? "var(--ember)" : "var(--frost)" }}>
                  {t.amount > 0 ? "+" : ""}
                  {t.amount}
                </td>
                <td style={cellStyle} className="text-muted" title={t.model ?? undefined}>
                  {t.inputTokens !== null && t.outputTokens !== null
                    ? `${t.inputTokens.toLocaleString()} in / ${t.outputTokens.toLocaleString()} out`
                    : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RetentionDryRunSection({ organizationId }: { organizationId: string }) {
  const dryRunQuery = trpcReact.organization.retentionDryRun.useQuery({ organizationId }, { retry: false });
  const result = dryRunQuery.data ?? null;
  const error = dryRunQuery.error;

  if (error) return null; // non-admins can't call this -- fail silently rather than showing an error on a page they can still use
  if (!result) return null;

  const totalEligible = result.auditLogRowsEligible + result.testRunRowsEligible + result.testResultArtifactRowsEligible;

  return (
    <p className="text-muted" style={{ fontSize: 12, marginTop: 10 }}>
      {totalEligible === 0
        ? `Nothing is currently older than your ${result.retentionYears}-year policy.`
        : `${result.auditLogRowsEligible} audit log entries, ${result.testRunRowsEligible} test runs, and ${result.testResultArtifactRowsEligible} evidence artifacts are currently older than your ${result.retentionYears}-year policy. Nothing is deleted automatically yet -- this is a report only.`}
    </p>
  );
}

// P1-15: organization.mine + byId are react-query hooks; the many editable
// fields are seeded from the detail row exactly once (guarded by
// digestLoaded) so background refetches never overwrite unsaved edits.
export default function OrganizationSettingsPage() {
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const firstOrg = orgsQuery.data?.[0] ?? null;
  const orgId = firstOrg?.id ?? null;
  const orgName = firstOrg?.name ?? "";
  const detailQuery = trpcReact.organization.byId.useQuery({ id: orgId ?? "" }, { enabled: orgId !== null });
  const detail = detailQuery.data;
  const updateDataRetentionMutation = trpcReact.organization.updateDataRetention.useMutation();
  const updateReleaseGatePolicyMutation = trpcReact.organization.updateReleaseGatePolicy.useMutation();
  const updateDigestSettingsMutation = trpcReact.organization.updateDigestSettings.useMutation();
  const sendTestDigestMutation = trpcReact.organization.sendTestDigest.useMutation();
  const updateStepFieldLabelsMutation = trpcReact.organization.updateStepFieldLabels.useMutation();
  const [labels, setLabels] = useState<Labels | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [dataRetentionYears, setDataRetentionYears] = useState<number | null>(null);
  const [savingRetention, setSavingRetention] = useState(false);
  const [retentionSaved, setRetentionSaved] = useState(false);

  const [releaseGatePolicy, setReleaseGatePolicy] = useState<string | null>(null);
  const [savingGatePolicy, setSavingGatePolicy] = useState(false);
  const [gatePolicySaved, setGatePolicySaved] = useState(false);

  const [digestLoaded, setDigestLoaded] = useState(false);
  const [slackWebhookConfigured, setSlackWebhookConfigured] = useState(false);
  const [slackWebhookInput, setSlackWebhookInput] = useState("");
  const [digestEnabled, setDigestEnabled] = useState(false);
  const [digestHourUtc, setDigestHourUtc] = useState<number>(13);
  const [lastDigestSentAt, setLastDigestSentAt] = useState<string | Date | null>(null);
  const [savingDigest, setSavingDigest] = useState(false);
  const [digestSaved, setDigestSaved] = useState(false);
  const [sendingTestDigest, setSendingTestDigest] = useState(false);
  const [testDigestResult, setTestDigestResult] = useState<string | null>(null);

  useEffect(() => {
    if (digestLoaded || !detail) return;
    setLabels(detail.stepFieldLabels as Labels);
    setDataRetentionYears(detail.dataRetentionYears);
    setReleaseGatePolicy(detail.releaseGatePolicy);
    setSlackWebhookConfigured(detail.slackWebhookConfigured);
    setDigestEnabled(detail.digestEnabled);
    if (detail.digestHourUtc !== null) setDigestHourUtc(detail.digestHourUtc);
    setLastDigestSentAt(detail.lastDigestSentAt);
    setDigestLoaded(true);
  }, [digestLoaded, detail]);

  const loadError = orgsQuery.error?.message ?? detailQuery.error?.message ?? null;

  async function submitRetention() {
    if (!orgId || dataRetentionYears === null) return;
    setSavingRetention(true);
    setError(null);
    setRetentionSaved(false);
    try {
      const updated = await updateDataRetentionMutation.mutateAsync({ organizationId: orgId, dataRetentionYears });
      setDataRetentionYears(updated.dataRetentionYears);
      setRetentionSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingRetention(false);
    }
  }

  async function submitGatePolicy() {
    if (!orgId || !releaseGatePolicy) return;
    setSavingGatePolicy(true);
    setError(null);
    setGatePolicySaved(false);
    try {
      const updated = await updateReleaseGatePolicyMutation.mutateAsync({
        organizationId: orgId,
        releaseGatePolicy: releaseGatePolicy as never,
      });
      setReleaseGatePolicy(updated.releaseGatePolicy);
      setGatePolicySaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingGatePolicy(false);
    }
  }

  async function submitDigest() {
    if (!orgId) return;
    setSavingDigest(true);
    setError(null);
    setDigestSaved(false);
    try {
      await updateDigestSettingsMutation.mutateAsync({
        organizationId: orgId,
        slackWebhookUrl: slackWebhookInput.trim().length > 0 ? slackWebhookInput.trim() : undefined,
        digestEnabled,
        digestHourUtc,
      });
      if (slackWebhookInput.trim().length > 0) {
        setSlackWebhookConfigured(true);
        setSlackWebhookInput("");
      }
      setDigestSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDigest(false);
    }
  }

  async function clearSlackWebhook() {
    if (!orgId) return;
    setSavingDigest(true);
    setError(null);
    try {
      await updateDigestSettingsMutation.mutateAsync({
        organizationId: orgId,
        slackWebhookUrl: "",
        digestEnabled: false,
        digestHourUtc,
      });
      setSlackWebhookConfigured(false);
      setDigestEnabled(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingDigest(false);
    }
  }

  async function sendTestDigest() {
    if (!orgId) return;
    setSendingTestDigest(true);
    setTestDigestResult(null);
    try {
      await sendTestDigestMutation.mutateAsync({ organizationId: orgId });
      setTestDigestResult("Sent.");
      setLastDigestSentAt(new Date());
    } catch (e) {
      setTestDigestResult(e instanceof Error ? e.message : String(e));
    } finally {
      setSendingTestDigest(false);
    }
  }

  async function submit() {
    if (!orgId || !labels) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const resolved = await updateStepFieldLabelsMutation.mutateAsync({ organizationId: orgId, labels });
      setLabels(resolved as Labels);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  if (error ?? loadError) return <p style={{ color: "var(--ember)" }}>{error ?? loadError}</p>;
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

      {dataRetentionYears !== null && (
        <div style={{ marginTop: 32 }}>
          <h2>Data retention</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            How long evidence, audit-log, and test-result data is kept before it's eligible for deletion. Different
            compliance frameworks mandate different minimums - check what your framework requires before lowering
            this. This sets the org's configured policy; there's no automated purge job yet, so nothing is actually
            deleted as a result of this setting today.
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input
              type="number"
              min={1}
              max={20}
              value={dataRetentionYears}
              onChange={(e) => setDataRetentionYears(Number(e.target.value))}
              style={{ width: 80 }}
            />
            <span className="text-muted">years</span>
            <button className="btn-primary" onClick={submitRetention} disabled={savingRetention}>
              {savingRetention ? "Saving…" : "Save"}
            </button>
            {retentionSaved && <span style={{ color: "var(--frost)" }}>Saved.</span>}
          </div>
          {orgId && <RetentionDryRunSection organizationId={orgId} />}
        </div>
      )}

      {releaseGatePolicy !== null && (
        <div style={{ marginTop: 32 }}>
          <h2>Release gates</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            What happens when someone tries to mark a release READY while an acceptance criterion is unmet or a
            CRITICAL risk flag is still open. Soft warning surfaces the gap but lets them proceed; hard block refuses
            the status change until it's resolved (enforced by the API, not just the UI).
          </p>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <select value={releaseGatePolicy} onChange={(e) => setReleaseGatePolicy(e.target.value)}>
              <option value="SOFT_WARNING">Soft warning</option>
              <option value="HARD_BLOCK">Hard block</option>
            </select>
            <button className="btn-primary" onClick={submitGatePolicy} disabled={savingGatePolicy}>
              {savingGatePolicy ? "Saving…" : "Save"}
            </button>
            {gatePolicySaved && <span style={{ color: "var(--frost)" }}>Saved.</span>}
          </div>
        </div>
      )}

      {digestLoaded && (
        <div style={{ marginTop: 32 }}>
          <h2>Release readiness digest</h2>
          <p style={{ color: "var(--muted)", fontSize: 13 }}>
            A daily summary of every project's release readiness, posted to a Slack channel via an{" "}
            <a href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">
              incoming webhook
            </a>
            . Also usable on demand as a pre-release summary via "Send now" below.
          </p>
          <div style={{ display: "grid", gap: 10, maxWidth: 480 }}>
            <label>
              Slack webhook URL{" "}
              <span style={{ color: "var(--muted-dim)" }}>
                {slackWebhookConfigured ? "(configured — enter a new URL to replace it)" : "(not configured)"}
              </span>
              <input
                value={slackWebhookInput}
                onChange={(e) => setSlackWebhookInput(e.target.value)}
                placeholder="https://hooks.slack.com/services/…"
                style={{ width: "100%" }}
              />
            </label>
            {slackWebhookConfigured && (
              <button className="btn-secondary" style={{ width: "fit-content", fontSize: 12 }} onClick={clearSlackWebhook} disabled={savingDigest}>
                Remove webhook
              </button>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={digestEnabled}
                onChange={(e) => setDigestEnabled(e.target.checked)}
                disabled={!slackWebhookConfigured && slackWebhookInput.trim().length === 0}
              />
              Send automatically every day
            </label>
            <label>
              Send hour (UTC)
              <input
                type="number"
                min={0}
                max={23}
                value={digestHourUtc}
                onChange={(e) => setDigestHourUtc(Number(e.target.value))}
                style={{ width: 80, marginLeft: 8 }}
              />
            </label>
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <button className="btn-primary" onClick={submitDigest} disabled={savingDigest}>
                {savingDigest ? "Saving…" : "Save"}
              </button>
              {digestSaved && <span style={{ color: "var(--frost)" }}>Saved.</span>}
            </div>
            {slackWebhookConfigured && (
              <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
                <button className="btn-secondary" onClick={sendTestDigest} disabled={sendingTestDigest}>
                  {sendingTestDigest ? "Sending…" : "Send now"}
                </button>
                {testDigestResult && <span className="text-muted" style={{ fontSize: 12 }}>{testDigestResult}</span>}
              </div>
            )}
            {lastDigestSentAt && (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                Last sent {new Date(lastDigestSentAt).toLocaleString()}
              </p>
            )}
          </div>
        </div>
      )}

      {orgId && <SlackEventNotificationsSection organizationId={orgId} />}
      {orgId && <AiCreditsSection organizationId={orgId} />}
      {orgId && <ApiKeysSection organizationId={orgId} />}
      {orgId && <WebhooksSection organizationId={orgId} />}
      <PlanTypesSection />
    </div>
  );
}
