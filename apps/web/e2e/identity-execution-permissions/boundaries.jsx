// Synthetic transport only. No Clerk/provider credentials or network requests.
import { useSyncExternalStore } from "react";
const listeners = new Set();
const project = { id: "synthetic-project", organizationId: "synthetic-org" };
let state = { mode: "error", role: "VIEWER", calls: 0, next: "allowed" };
let finish = null;
function publish(patch) { state = { ...state, ...patch }; for (const notify of listeners) notify(); }
const subscribe = notify => { listeners.add(notify); return () => listeners.delete(notify); };
const snapshot = () => state;
const useFixture = () => useSyncExternalStore(subscribe, snapshot);
window.identityFixture = {
  configure: patch => publish(patch),
  state: () => state,
  settle: () => { const done = finish; finish = null; done?.(); },
};
const query = data => ({ data, isSuccess: true, isError: false, isFetching: false, isPaused: false, error: null, refetch: async () => ({ data }) });
export const useAuth = () => ({ isLoaded: true, isSignedIn: true, userId: "synthetic-actor", sessionId: "synthetic-session" });
export const trpcReact = {
  project: { byId: { useQuery: () => query(project) } },
  organization: { mine: { useQuery: () => { const current = useFixture(); return query([{ id: project.organizationId, role: current.role, seatType: "FULL" }]); } } },
  identityAccess: { projectActions: { useQuery: () => {
    const current = useFixture(), error = current.mode === "error";
    return { ...query({ projectId: project.id, organizationId: project.organizationId, clerkSubject: "synthetic-actor",
      permissions: current.mode === "allowed" ? ["runs.execute"] : [], policyRevision: 1 }),
      isSuccess: !error, isError: error, error: error ? { message: "Synthetic permission outage" } : null,
      isFetching: current.mode === "pending", isPaused: current.mode === "paused",
      refetch: async () => {
        publish({ calls: state.calls + 1, mode: "pending" });
        await new Promise((resolve, reject) => { finish = () => {
          const next = state.next;
          publish({ mode: next === "reject" ? "error" : next });
          if (next === "reject") reject(Error("Synthetic read failure")); else resolve();
        }; });
        return {};
      },
    };
  } } },
};
