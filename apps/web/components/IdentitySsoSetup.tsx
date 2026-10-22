"use client";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useLayoutEffect, useRef } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { IdentitySsoPanel } from "./IdentitySsoPanel";

export function IdentitySsoSetup({ organizationId }: { organizationId: string }) {
  const clerk = useClerk();
  const auth = useAuth();
  const scope = JSON.stringify([organizationId, auth.userId, auth.sessionId]);
  const selectedScope = useRef<string | null>(scope);
  const inspected = useRef(new WeakMap<object, number>());
  const lifecycle = useRef(0), openedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    selectedScope.current = scope; const epoch = ++lifecycle.current;
    return () => { selectedScope.current = null; lifecycle.current = epoch + 1; if (openedFor.current) clerk.closeOrganizationProfile(); openedFor.current = null; };
  }, [scope, clerk]);
  useLayoutEffect(() => {
    if (openedFor.current && openedFor.current !== auth.orgId) { clerk.closeOrganizationProfile(); openedFor.current = null; }
  }, [auth.orgId, clerk]);
  const query = trpcReact.identityAccess.providerSetup.useQuery({ organizationId }, { enabled: false, retry: false });
  return <IdentitySsoPanel key={scope} inspect={async () => {
    const generation = lifecycle.current;
    if (selectedScope.current !== scope) throw new Error("Workspace changed");
    const current = await query.refetch();
    if (selectedScope.current !== scope || lifecycle.current !== generation || current.error || !current.data) throw new Error("Setup unavailable");
    // Do not attach provenance to a shared query-cache object across scopes.
    const result = { ...current.data };
    inspected.current.set(result, generation);
    return result;
  }} openSetup={async status => {
    const generation = inspected.current.get(status);
    const owns = () => generation !== undefined && selectedScope.current === scope && lifecycle.current === generation && clerk.loaded && clerk.user?.id === status.clerkSubject &&
      !!auth.sessionId && clerk.session?.id === auth.sessionId;
    if (!owns()) throw new Error("Session changed");
    // This is an explicit user action after a fresh server-side tenant and
    // provider-permission check. Never open the currently active org by accident.
    if (clerk.organization?.id !== status.clerkOrganizationId) await clerk.setActive({ organization: status.clerkOrganizationId });
    if (!owns() || clerk.organization?.id !== status.clerkOrganizationId) throw new Error("Workspace changed");
    const latest = await query.refetch();
    if (!owns() || latest.error || latest.data?.status !== "ready" || latest.data.revision !== status.revision ||
      latest.data.clerkOrganizationId !== status.clerkOrganizationId || latest.data.clerkSubject !== status.clerkSubject ||
      clerk.organization?.id !== status.clerkOrganizationId) throw new Error("Setup changed");
    openedFor.current = status.clerkOrganizationId;
    clerk.openOrganizationProfile();
  }} />;
}
