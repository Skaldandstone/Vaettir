// Synthetic SDK/query boundaries only. No credentials or provider requests.
import { useSyncExternalStore } from "react";
const listeners = new Set(), waiting = [];
let state = { workspace: "alpha", subject: "synthetic-actor", session: "synthetic-session", activeOrg: "provider-other", mounted: true, mode: "ready", calls: 0, opens: [], switches: [], closes: 0 };
const notify = patch => { state = { ...state, ...patch }; listeners.forEach(fn => fn()); };
export const useFixture = () => useSyncExternalStore(fn => { listeners.add(fn); return () => listeners.delete(fn); }, () => state);
window.identityFixture = {
  configure: notify,
  state: () => ({ ...state, waiting: waiting.length }),
  settle: () => waiting.shift()?.(),
};
const clerk = {
  loaded: true,
  get user() { return { id: state.subject }; },
  get session() { return { id: state.session }; },
  get organization() { return { id: state.activeOrg }; },
  setActive: async ({ organization }) => { notify({ activeOrg: organization, switches: [...state.switches, organization] }); },
  openOrganizationProfile: () => notify({ opens: [...state.opens, state.activeOrg] }),
  closeOrganizationProfile: () => notify({ closes: state.closes + 1 }),
};
export function useAuth() {
  const current = useFixture();
  return { userId: current.subject, sessionId: current.session, orgId: current.activeOrg };
}
export const useClerk = () => clerk;
export const trpcReact = { identityAccess: { providerSetup: { useQuery: ({ organizationId }) => ({
  refetch: async () => {
    const subject = state.subject, mode = state.mode;
    notify({ calls: state.calls + 1 });
    if (mode === "deferred") await new Promise(resolve => waiting.push(resolve));
    if (mode === "error") throw Error("Synthetic setup outage");
    return { data: { status: "ready", clerkOrganizationId: `provider-${organizationId}`, clerkSubject: subject, revision: 1,
      connections: [{ id: `connection-${organizationId}`, name: `Synthetic ${organizationId} SAML connection`, provider: "saml", active: false }] }, error: null };
  },
}) } } };
