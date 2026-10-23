"use client";

import { useState } from "react";
import { useParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";

const AUDIT_VIEWS = [
  {
    value: undefined,
    label: "All activity",
    description: "A chronological record of every tracked project change.",
    action:
      "Review the newest changes first, then narrow the view to investigate one control area.",
  },
  {
    value: "TestCase",
    label: "Test case changes",
    description:
      "Who created, edited, reviewed, imported, or removed test cases.",
    action:
      "Verify unexpected imports or edits, then open Test Cases to correct the current record.",
  },
  {
    value: "TestPlan",
    label: "Test plan changes",
    description:
      "Changes to plans, strategy, status, criteria, and release associations.",
    action:
      "Confirm approvals and scope changes before relying on a plan for release readiness.",
  },
  {
    value: "TestCaseComplianceControl",
    label: "Compliance mappings",
    description:
      "Evidence of controls being mapped to or removed from test cases.",
    action:
      "Investigate unmapped controls in Compliance and restore evidence links when needed.",
  },
] as const;

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

// P1-15
export default function AuditLogPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [entityType, setEntityType] = useState<string | undefined>(undefined);

  const entriesQuery = trpcReact.auditLog.list.useQuery({
    projectId,
    entityType,
  });
  const entries = entriesQuery.data ?? [];
  const loading = entriesQuery.isLoading;
  const error = entriesQuery.error?.message ?? null;
  const selectedView =
    AUDIT_VIEWS.find((view) => view.value === entityType) ?? AUDIT_VIEWS[0];

  return (
    <div style={{ maxWidth: 900 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 4,
        }}
      >
        <h1 style={{ margin: 0 }}>Audit log</h1>
      </div>
      <p className="text-muted" style={{ marginBottom: 20 }}>
        Evidence of who changed quality records, what changed, and when. Use
        these views to investigate changes or prepare audit evidence. Most
        recent first.
      </p>

      <div style={{ display: "flex", gap: 8, marginBottom: 16 }}>
        {AUDIT_VIEWS.map((view) => (
          <button
            key={view.label}
            className={
              entityType === view.value ? "btn-primary" : "btn-secondary"
            }
            style={{ fontSize: 13 }}
            onClick={() => setEntityType(view.value)}
          >
            {view.label}
          </button>
        ))}
      </div>

      <div className="panel" style={{ marginBottom: 16, padding: 14 }}>
        <strong>{selectedView.label}</strong>
        <p style={{ margin: "4px 0", fontSize: 13 }}>
          {selectedView.description}
        </p>
        <p className="text-muted" style={{ margin: 0, fontSize: 12 }}>
          <strong>Audit action:</strong> {selectedView.action}
        </p>
      </div>

      {loading && <p>Loading…</p>}
      {error && <p style={{ color: "var(--danger, #cf222e)" }}>{error}</p>}

      {!loading && !error && entries.length === 0 && (
        <p className="text-muted">No activity recorded yet.</p>
      )}

      {!loading && !error && entries.length > 0 && (
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr
              style={{
                textAlign: "left",
                borderBottom: "1px solid var(--border, #d0d7de)",
              }}
            >
              <th style={{ padding: "6px 8px", fontSize: 12 }}>When</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Who</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Action</th>
              <th style={{ padding: "6px 8px", fontSize: 12 }}>Summary</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                style={{ borderBottom: "1px solid var(--border, #eaeef2)" }}
              >
                <td
                  style={{
                    padding: "6px 8px",
                    fontSize: 13,
                    whiteSpace: "nowrap",
                    color: "var(--text-muted, #57606a)",
                  }}
                >
                  {formatTimestamp(e.createdAt)}
                </td>
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  {e.actor.name ?? e.actor.email}
                </td>
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
                <td style={{ padding: "6px 8px", fontSize: 13 }}>
                  {e.summary}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
