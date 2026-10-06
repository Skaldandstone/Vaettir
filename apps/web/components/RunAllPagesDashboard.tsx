"use client";

import { useId, useReducer } from "react";
import { RecordedExecutionTrend } from "./RecordedExecutionTrend";
import { toggleRunDashboard, type RunDashboardVisibility } from "@/lib/run-dashboard-visibility";

export function RunAllPagesDashboard({ projectId }: { projectId: string }) {
  const [visibility, toggle] = useReducer(toggleRunDashboard, "UNOPENED" as RunDashboardVisibility);
  const contentId = useId();
  const opened = visibility === "OPEN";
  return (
    <section className="panel" aria-label="All-pages recorded run dashboard" style={{ marginBlock: 20, minWidth: 0 }}>
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
        <h2 style={{ margin: 0 }}>All-pages run dashboard</h2>
        <button type="button" className="btn-secondary" aria-expanded={opened} aria-controls={contentId} onClick={toggle}>
          {opened ? "Collapse dashboard" : visibility === "UNOPENED" ? "Open all-pages dashboard" : "Reopen all-pages dashboard"}
        </button>
      </div>
      <p className="text-muted">
        Compare recorded outcomes across every history page in an explicitly applied window of up to 90 inclusive UTC days.
        Days and weeks use stored run-start timestamps, not individual result observation times.
        This bounded view counts result observations, including repeated records, not global manual planned cases, work left or release readiness.
        The cards below still cover only the current history page.
      </p>
      {visibility === "UNOPENED" && <p>No aggregate is requested until you open the dashboard and choose Show recorded outcomes to apply a scope.</p>}
      <div id={contentId} hidden={!opened}>
        {visibility !== "UNOPENED" && (
          <RecordedExecutionTrend projectId={projectId} active={opened} />
        )}
      </div>
      {visibility === "COLLAPSED" && <p role="status">Your draft dates and filters are retained. Reopening verifies current access and refreshes the applied evidence; previous export approval is not retained.</p>}
    </section>
  );
}
