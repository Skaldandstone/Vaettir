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
      { path: "/releases", label: "Release Readiness" },
    ],
  },
  {
    label: "Evidence & analysis",
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
    ],
  },
  {
    label: "Advanced tools & activity",
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

/** Presentation preferences only: every existing destination remains reachable.
 * Unknown/missing choices keep the generic workspace; never infer capability,
 * permission, connection health or regulatory applicability from a category.
 */
export function projectNavigationForExperience(
  offerings: readonly string[] | null | undefined,
  enabledTools?: readonly string[] | null,
) {
  const known = [
    "SOFTWARE",
    "GAME",
    "HARDWARE",
    "HIL",
    "SYSTEM_INTEGRATION",
    "FOOD_SAFETY",
    "CLINICAL",
    "LABORATORY",
    "MANUFACTURING",
  ];
  const selected = new Set(
    offerings &&
      offerings.length <= known.length &&
      new Set(offerings).size === offerings.length &&
      offerings.every((choice) => known.includes(choice))
      ? offerings
      : [],
  );
  const process = [
    "FOOD_SAFETY",
    "CLINICAL",
    "LABORATORY",
    "MANUFACTURING",
  ].some((choice) => selected.has(choice));
  const physical = process || selected.has("HARDWARE") || selected.has("HIL");
  const toolChoices = [
    "Compliance",
    "ProductionSignals",
    "LiveAppGeneration",
    "ReverseEngineer",
    "AdvancedAnalytics",
    "TestStrategy",
  ];
  const explicit =
    Array.isArray(enabledTools) &&
    enabledTools.length <= toolChoices.length &&
    new Set(enabledTools).size === enabledTools.length &&
    enabledTools.every((id) => toolChoices.includes(id));
  return PROJECT_NAVIGATION.map((group, index) => ({
    ...group,
    links: group.links.filter(
      (link) =>
        !explicit ||
        !optionalToolForPath(link.path) ||
        enabledTools.includes(optionalToolForPath(link.path)!),
    ),
    label: index === 1 && process ? "Protocols & evidence" : group.label,
    // Procedures and review evidence are routine work in physical/process
    // projects, not optional advanced tooling. Mixed projects retain both.
    collapsible: index === 1 && physical ? false : group.collapsible,
  }));
}

export function optionalToolForPath(path: string): string | null {
  const tools: Record<string, string> = {
    "/compliance": "Compliance",
    "/production-signals": "ProductionSignals",
    "/live-app-generation": "LiveAppGeneration",
    "/reverse-engineer": "ReverseEngineer",
    "/recorded-run-comparison": "AdvancedAnalytics",
    "/execution-trends": "AdvancedAnalytics",
    "/defect-map": "AdvancedAnalytics",
    "/test-strategy": "TestStrategy",
  };
  return Object.hasOwn(tools, path) ? tools[path]! : null;
}

/** A hidden tool's current route stays discoverable without blocking its evidence. */
export function hiddenActiveProjectLinks(
  pathname: string,
  projectId: string,
  visible: ReturnType<typeof projectNavigationForExperience>,
) {
  const paths = new Set<string>(
    visible.flatMap((group) => group.links.map((link) => link.path)),
  );
  return PROJECT_NAVIGATION.flatMap((group) => [...group.links] as Array<{ readonly path: string; readonly label: string }>).filter(
    (link) =>
      !paths.has(link.path) &&
      navigationGroupIsActive(pathname, projectId, [link]),
  );
}

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
