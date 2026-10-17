"use client";
import { useEffect, useSyncExternalStore } from "react";
import { useAuth } from "@clerk/nextjs";
import { usePathname, useSearchParams } from "next/navigation";
import { trpcReact } from "../lib/trpcReact";

export function LegacyWorkspaceRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  const pathname = usePathname();
  const search = useSearchParams();
  const legacy = useSyncExternalStore(
    () => () => undefined,
    () => window.location.hostname === "vaettir.skaldandstone.com",
    () => false,
  );
  const path = pathname + (search.toString() ? "?" + search.toString() : "");
  const destination = trpcReact.organization.resolveLegacyLink.useQuery(
    { path }, { enabled: Boolean(legacy && isLoaded && isSignedIn && /^\/projects\/[a-zA-Z0-9_-]+/.test(pathname)), retry: false },
  );
  useEffect(() => {
    const next = destination.data?.url;
    if (!legacy || !next) return;
    const url = new URL(next);
    if (url.protocol === "https:" && /^[a-z][a-z0-9-]{1,61}[a-z0-9]\.vaettir\.app$/.test(url.hostname)
        && !url.username && !url.password && !url.port) window.location.replace(url.toString());
  }, [destination.data, legacy]);
  return null;
}
