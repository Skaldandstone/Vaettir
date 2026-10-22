// Synthetic transport and native read boundary. The custom-action hook is real.
import { useMemo, useSyncExternalStore } from "react";
const listeners = new Set(); let finish;
let state = { projectId: "project", organizationId: "org", subject: "synthetic-subject", sessionId: "synthetic-session", allowed: true,
  mode: "ready", queryError: false, version: "a".repeat(64), expired: false, writes: [], attached: [], reads: 0 };
const notify = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const useFixture = () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
const origin = () => ({ organizationId: state.organizationId, clerkActorId: state.subject, actorId: "native", projectId: state.projectId });
window.Clerk = { loaded: true, get session() { return { id: state.sessionId, user: { id: state.subject } }; } };
window.identityFixture = { configure: notify, state: () => state, settle: () => { const done = finish; finish = null; done?.(); } };
export const useAuth = () => { const current = useFixture(); return { isLoaded: true, isSignedIn: true, userId: current.subject, sessionId: current.sessionId }; };
export const useCaseFieldAccess = () => {
  useFixture(); const selected = origin();
  return { origin: selected, readable: true, fresh: { readScope: { actorId: "native" } }, owns: original => JSON.stringify(original) === JSON.stringify(origin()) };
};
const reviewedAt = new Date(Date.now() - 120000).toISOString(), expiresAt = new Date(Date.now() + 480000).toISOString();
const repositories = [{ id: "repo-a", name: "Synthetic mobile API regression and release-validation repository with a long title", url: "https://gitlab.example.invalid/synthetic/mobile-api", defaultBranch: "main" },
  { id: "repo-b", name: "Synthetic architecture repository", url: "https://gitlab.example.invalid/synthetic/architecture", defaultBranch: "main" }];
const query = (data, error = null) => ({ data, error, isSuccess: !error, isError: !!error, isFetching: false, isPaused: false });
export const trpcReact = {
  identityAccess: { projectActions: { useQuery: () => { const current = useFixture();
    // Match a query cache: unrelated mutation/render notifications do not replace its data object.
    const data = useMemo(() => ({ projectId: current.projectId, organizationId: current.organizationId,
      clerkSubject: current.subject, permissions: current.allowed ? ["integrations.manage"] : [], policyRevision: 1 }),
      [current.projectId, current.organizationId, current.subject, current.allowed]);
    return { ...query(data), refetch: async () => ({}) }; } } },
  repositoryConnections: {
    reviewedCatalogue: { useQuery: () => { const current = useFixture();
      return { ...query({ projectId: current.projectId, organizationId: current.organizationId, nativeActorId: "native", clerkSubject: current.subject, checkedAt: new Date().toISOString(),
        connections: [{ id: "connection", provider: "gitlab", origin: "https://gitlab.example.invalid", reviewedAt, expiresAt: current.expired ? new Date(0).toISOString() : expiresAt,
          catalogVersion: current.version, repositories }] }, current.queryError ? { message: "Synthetic read failure" } : null),
      refetch: async () => { notify({ queryError: false, reads: state.reads + 1 }); return {}; } };
    } },
    connectSelected: { useMutation: () => ({ mutateAsync: async input => {
      const mode = state.mode;
      notify({ writes: [...state.writes, structuredClone(input)] });
      if (mode.startsWith("deferred")) await new Promise(resolve => { finish = resolve; });
      if (!state.allowed) throw Error("Synthetic revoked permission");
      notify({ attached: [...new Set([...state.attached, ...input.repositoryIds])] });
      if (mode === "after" || mode === "deferred-after") throw Error("Synthetic lost acknowledgement");
      if (state.cleanupFailure) {
        Storage.prototype.removeItem = () => { throw Error("Synthetic post-ack cleanup failure"); };
        if (state.cleanupFailure === "all") Storage.prototype.setItem = () => { throw Error("Synthetic post-dispatch write failure"); };
      }
      return { connected: input.repositoryIds.length };
    } }) },
  },
};
