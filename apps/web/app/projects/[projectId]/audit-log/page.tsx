"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { trpc, type RouterOutputs } from "@/lib/trpc";

const ENTITY_TYPES = ["TestCase", "TestPlan", "TestCaseComplianceControl"];

const ACTION_COLORS: Record<string, string> = {
  CREATE: "#1a7f37",
  UPDATE: "#9a6700",
  DELETE: "#cf222e",
  MAP: "#0969da",
  UNMAP: "#57606a",
};

function formatTimestamp(d: Date | string): string {
  return new Date(d).toLocaleString();
}

export default function AuditLogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [entries, setEntries] = useState<RouterOutputs["auditLog"]["list"]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [entityType, setEntityType] = useState<string | undefined>(undefined);

  function load() {
    setLoading(true);
    setError(null);
    trpc.auditLog.list
      .query({ projectId, entityType })
      .then(setEntries)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }

  useEffect(load, [projectId, entityType]);

  return (
    <div style={{ maxWidth: 900 }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
        <h1 style={{ margin: 0 }}>Audit log</h1>
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Who changed what, and when - test case and test plan edits, and compliance control mappings. Most recent
        first.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        <button
          className={entityType === undefined ? "btn-primary" : "btn-secondary"}
          style={{ fontSize: 13 }}
          onClick={() => setEntityType(undefined)}
        >
          All
        </button>
        {ENTITY_TYPES.map((t) => (
          <button
            key={t}
            className={entityType === t ? "btn-primary" : "btn-secondary"}
            style={{ fontSize: 13 }}
            onClick={() => setEntityType(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--danger, #cf222e)" }}>{error}</p>}

      {!loading && !error && entries.length === 0 && <p className="text-muted">No activity recorded yet.</p>}

      {!loading && !error && entries.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ textAlign: "left", borderBottom: "1px solid var(--border, #d0d7de)" }}>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>When</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Who</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Action</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} style={{ borderBottom: "1px solid var(--border, #eaeef2)" }}>
                <td style={{ padding: "6px 8px", fontSize: 13, whiteSpace: "nowrap", color: "var(--text-muted, #57606a)" }}>
                  {formatTimestamp(e.createdAt)}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{e.actor.name ?? e.actor.email}</td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  <span
                    style={{
                      color: ACTION_COLORS[e.action] ?? "inherit",
                      fontWeight: 600,
                      fontSize: 12,
                      textTransform: "uppercase",
                    }}
                  >
                    {e.action}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>{e.summary}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
