/** Existing destinations grouped by the user's working cycle, not new routes. */
export const PROJECT_NAVIGATION = [
  {
    label: "Work",
    collapsible: false,
    links: [
      { path: "", label: "Overview" },
      { path: "/test-cases", label: "Test Cases" },
      { path: "/test-plans", label: "Test Plans" },
      { path: "/test-runs", label: "Test Runs" },
      { path: "/reports", label: "Reports" },
    ],
  },
  {
    label: "Evidence & release",
    collapsible: true,
    links: [
      { path: "/requirements", label: "Requirements" },
      { path: "/requirement-baselines", label: "Requirement baselines" },
      { path: "/requirement-coverage", label: "Requirement coverage" },
      { path: "/recorded-run-comparison", label: "Recorded run comparison" },
      { path: "/execution-trends", label: "Execution over time" },
      { path: "/defect-map", label: "Defect Map" },
      { path: "/quality-risks", label: "Quality risks" },
      { path: "/compliance", label: "Compliance" },
      { path: "/releases", label: "Release Readiness" },
    ],
  },
  {
    label: "Tools & activity",
    collapsible: true,
    links: [
      { path: "/test-strategy", label: "Test Strategy" },
      { path: "/reverse-engineer", label: "Reverse Engineer" },
      { path: "/live-app-generation", label: "Live App Generation" },
      { path: "/production-signals", label: "Production Signals" },
      { path: "/import", label: "Import" },
      { path: "/audit-log", label: "Audit Log" },
    ],
  },
] as const;

export function navigationGroupIsActive(
  pathname: string,
  projectId: string,
  links: ReadonlyArray<{ path: string }>,
) {
  const root = `/projects/${projectId}`;
  return links.some(({ path }) =>
    path === ""
      ? pathname === root
      : pathname === root + path || pathname.startsWith(root + path + "/"),
  );
}

/** Keep the rendered width and accessible slider range consistent on any viewport. */
export function detailsPanelWidth(requested: number, viewport: number) {
  const max = Math.max(1, viewport);
  const min = Math.min(360, max);
  return Math.max(min, Math.min(max, requested));
}
