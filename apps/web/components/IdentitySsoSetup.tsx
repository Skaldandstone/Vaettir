"use client";
import { useAuth, useClerk } from "@clerk/nextjs";
import { useLayoutEffect, useRef } from "react";
import { trpcReact } from "@/lib/trpcReact";
import { IdentitySsoPanel } from "./IdentitySsoPanel";

export function IdentitySsoSetup({ organizationId }: { organizationId: string }) {
  const clerk = useClerk();
  const auth = useAuth();
  const lifecycle = useRef(0), openedFor = useRef<string | null>(null);
  useLayoutEffect(() => {
    lifecycle.current++;
    return () => { lifecycle.current++; if (openedFor.current) clerk.closeOrganizationProfile(); openedFor.current = null; };
  }, [organizationId, auth.userId, auth.sessionId, clerk]);
  useLayoutEffect(() => {
    if (openedFor.current && openedFor.current !== auth.orgId) { clerk.closeOrganizationProfile(); openedFor.current = null; }
  }, [auth.orgId, clerk]);
  const query = trpcReact.identityAccess.providerSetup.useQuery({ organizationId }, { enabled: false, retry: false });
  return <IdentitySsoPanel inspect={async () => {
    const current = await query.refetch(); if (current.error || !current.data) throw new Error("Setup unavailable"); return current.data;
  }} openSetup={async status => {
    const generation = lifecycle.current;
    const owns = () => lifecycle.current === generation && clerk.loaded && clerk.user?.id === status.clerkSubject &&
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
