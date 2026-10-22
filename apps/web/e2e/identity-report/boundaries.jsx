import { useState } from "react";
export const useAuth = () => ({ isLoaded: true, isSignedIn: true, userId: "synthetic-actor", sessionId: "synthetic-session" });
// Catalog/definition-manager are separate workflows, deliberately outside this fixture.
export const ReportSnapshotCatalog = () => null;
export const ReportDefinitionManager = () => null;
const query = get => ({ useQuery: input => {
  const [, redraw] = useState(0);
  return { data: get(input), isSuccess: true, isError: false, isFetching: false, isPaused: false, error: null,
    refetch: async () => { redraw(n => n + 1); return { data: get(input) }; } };
} });
const stored = key => JSON.parse(localStorage.getItem(key) ?? "null");
const mutation = action => ({ useMutation: () => ({ isPending: false, mutateAsync: async input => action(input) }) });
const project = { id: "synthetic-project", organizationId: "synthetic-org", name: "Synthetic identity verification" };
const payload = input => ({ state: "preview", projectName: project.name, title: input.title,
  asOf: "2026-10-22T06:00:00Z", windowStart: "2026-09-22T06:00:00Z", definition: input.definition,
  inventory: { active: 4, riskAssessed: 2, flaky: 0, priority: [], automation: [{ key: "MANUAL", count: 4 }] },
  execution: { runs: 1, results: 3, outcomes: [{ key: "PASS", count: 2 }, { key: "FAIL", count: 1 }], distinctCases: 3, highPriorityCases: 2, highPriorityExecuted: 1 },
  traceability: { requirements: 2, coveredRequirements: 1, casesWithLinks: 2, links: 2 },
  defects: null, cohort: [], automationChange: null, limitations: ["Synthetic component verification, not release evidence."] });
export const trpcReact = {
  useUtils: () => ({ reportSnapshots: { definitions: { invalidate: async () => {} }, catalog: { invalidate: async () => {} } } }),
  project: { byId: query(() => project) },
  organization: { mine: query(() => [{ id: project.organizationId, role: "VIEWER", seatType: "FULL" }]) },
  identityAccess: { projectActions: query(() => ({ projectId: project.id, organizationId: project.organizationId, clerkSubject: "synthetic-actor",
    permissions: stored("revoked") ? [] : ["reports.create"], policyRevision: 1 })) },
  reportSnapshots: {
    definitions: query(() => []), drafts: query(() => stored("preview") ? [stored("preview")] : []),
    scopeOptions: query(() => ({ projectId: project.id, organizationId: project.organizationId, plans: [], releases: [], runs: [], platforms: [], environments: [], builds: [] })),
    get: query(() => stored("preview")),
    saveDefinition: mutation(input => { localStorage.setItem("definition", JSON.stringify(input)); return { id: "synthetic-definition", version: 1 }; }),
    preview: mutation(input => {
      const prior = stored("capture-input");
      if (prior && JSON.stringify(prior) !== JSON.stringify(input)) throw Error("Changed uncertain request");
      localStorage.setItem("capture-input", JSON.stringify(input));
      if (stored("offline")) throw Error("Synthetic unavailable response");
      const value = { id: "synthetic-preview", projectId: project.id, organizationId: project.organizationId,
        title: input.title, asOf: "2026-10-22T06:00:00Z", payload: payload(input) };
      localStorage.setItem("preview", JSON.stringify(value)); return value;
    }),
    approve: mutation(() => { throw Error("Custom author must never attempt sharing"); }),
  },
};
