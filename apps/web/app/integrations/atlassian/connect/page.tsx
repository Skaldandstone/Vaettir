import { Suspense } from "react";
import type { Metadata } from "next";
import { AtlassianConnectWorkflow } from "@/components/AtlassianConnectWorkflow";

export const metadata: Metadata = { title: "Connect a Vaettir project", referrer: "no-referrer", robots: { index: false, follow: false } };

export default function AtlassianConnectPage() {
  // The existing protected-first Clerk middleware preserves this specific
  // setup route through sign-in. Never redirect this handoff to /projects.
  return <Suspense fallback={<p role="status">Loading project connection…</p>}><AtlassianConnectWorkflow /></Suspense>;
}
