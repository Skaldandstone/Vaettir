import { useSyncExternalStore } from "react";
const listeners = new Set();
const fixture = () => window.smartFixture;
export function useAuth() {
  const actor = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => fixture().actor);
  fixture().notify = () => listeners.forEach(listener => listener());
  return { isLoaded: true, isSignedIn: true, userId: actor, sessionId: `${actor}-session` };
}
const receipts = new Map();
const api = {
  configuration: { query: async () => ({ enabled: true, canAnalyze: true, policyVersion: 1, reason: null }) },
  mapping: { mutate: async input => {
    fixture().mappingCalls.push(input);
    return { mappings: [["title", "Scenario text"], ["given", "Initial state"], ["when", "Do this"], ["then", "Expected behavior"], ["externalId", "Reference"]].map(([field, column]) => ({ field, column, confidence: "HIGH", reason: `The supplied ${column} cells support this role.`, evidence: [column] })) };
  } },
  recommend: { mutate: async input => {
    fixture().analyses.push(input);
    const cases = input.cases ?? fixture().stored;
    return { reviewId: `00000000-0000-4000-8000-${String(fixture().analyses.length).padStart(12, "0")}`,
      knownSuites: ["Billing", "Accounts"], legacySuitePaths: ["Legacy Sheet / Unsorted"], before: cases.map(c => ({ ...c, suitePath: c.suitePath ?? null, priority: c.priority ?? null, testType: c.testType ?? null })),
      suggestions: cases.map(c => ({ id: c.id, suitePath: "Billing/Restoration", priority: "HIGH", testType: "FUNCTIONAL", confidence: "HIGH", reason: "Restoring purchased access must retain the entitlement without another charge.", evidence: ["Access retained"] })) };
  } },
  applyReviewed: { mutate: async input => {
    fixture().saves.push(input);
    const encoded = JSON.stringify(input), saved = receipts.get(input.requestId);
    if (saved) { if (saved !== encoded) throw new Error("Fixture received a different retry"); return { changed: input.selections.length, replayed: true }; }
    if (fixture().reject) { const error = new Error("Case changed after analysis"); error.data = { code: "CONFLICT" }; throw error; }
    receipts.set(input.requestId, encoded); fixture().writes++;
    if (fixture().dropAck) { fixture().dropAck = false; throw new Error("Simulated dropped acknowledgement"); }
    return { changed: input.selections.length, replayed: false };
  } },
};
const utils = { client: { caseSuggestions: api } };
export const trpcReact = { useUtils: () => utils, project: { byId: { useQuery: () => ({ data: { id: "synthetic-project", organizationId: "synthetic-org" }, isFetching: false, isPaused: false, error: null }) } } };
