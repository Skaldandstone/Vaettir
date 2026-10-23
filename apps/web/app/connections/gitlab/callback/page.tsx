"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useSearchParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";

function GitlabCallback() {
  const params = useSearchParams();
  const { isLoaded, isSignedIn } = useAuth();
  const captured = useRef<{ state: string; code?: string; denied: boolean } | null>(null);
  const started = useRef(false);
  const [outcome, setOutcome] = useState<"pending" | "verified" | "canceled" | "error">("pending");
  const finish = trpcReact.repositoryConnections.finish.useMutation();
  useEffect(() => {
    if (!captured.current) {
      captured.current = { state: params.get("state") ?? "", code: params.get("code") ?? undefined, denied: params.get("error") === "access_denied" };
      // One-use code/state remain in memory only, not history or browser storage.
      window.history.replaceState(window.history.state, "", window.location.pathname);
    }
    if (!isLoaded || !isSignedIn || started.current) return;
    started.current = true;
    const input = captured.current;
    if (!input.state || (!input.code && !input.denied)) { setOutcome("error"); return; }
    finish.mutate(input, { onSuccess: () => setOutcome("verified"), onError: () => setOutcome(input.denied ? "canceled" : "error") });
  }, [params, isLoaded, isSignedIn, finish]);
  return <main style={{ maxWidth: 520, margin: "48px auto", padding: 24 }}>
    <h1>GitLab authorization</h1>
    {!isLoaded ? <p role="status">Checking your Vaettir session…</p> : !isSignedIn ? <p role="alert">Your Vaettir session is not available. Close this window, sign in to Vaettir, and start the connection again.</p> : <p role={outcome === "error" ? "alert" : "status"}>{outcome === "verified" ? "Account verified. Return to Vaettir to choose repositories. No source files were read." : outcome === "canceled" ? "Authorization canceled. Nothing was connected." : outcome === "error" ? "This authorization could not be verified. Return to Vaettir and start again." : "Verifying your GitLab account…"}</p>}
    <button type="button" className="btn-secondary" onClick={() => window.close()}>Close this window</button>
    <p className="text-muted">If the window stays open, close this tab manually. Your original Vaettir window checks connection status independently.</p>
  </main>;
}

export default function GitlabCallbackPage() {
  return <Suspense fallback={<p role="status">Loading authorization result…</p>}><GitlabCallback/></Suspense>;
}
