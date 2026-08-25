"use client";

import { useEffect, useState } from "react";
import { trpc } from "../../../lib/trpc";

type Labels = { action: string; expectedActionOrData: string; expectedResult: string; expectedResponse: string };

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
    <div style={{ maxWidth: 480 }}>
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
    </div>
  );
}
