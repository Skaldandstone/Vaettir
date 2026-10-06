export type RunDashboardVisibility = "UNOPENED" | "OPEN" | "COLLAPSED";

/** Closing a visited dashboard retains its mounted reader and draft scope. */
export function toggleRunDashboard(state: RunDashboardVisibility): RunDashboardVisibility {
  return state === "OPEN" ? "COLLAPSED" : "OPEN";
}
