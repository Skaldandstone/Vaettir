"use client";

import { useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { trpcReact } from "@/lib/trpcReact";

// SSE-180: production-signal linkage. Gated server-side behind P12-07's
// tierHasFeature (Business/Corp only) AND project ADMIN - this page doesn't
// try to duplicate that check up front, it just calls the real mutations
// and turns a FORBIDDEN response into a plain-language upgrade message, the
// same "server is the real gate, the page just explains the result"
// posture the read-only-seat pages already use elsewhere. Temp UI, same as
// SSE-181's live-app-generation page - a real one is follow-up work once
// this has actual usage behind it.
export default function ProductionSignalsPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const searchParams = useSearchParams();
  const utils = trpcReact.useUtils();

  const connectionsQuery = trpcReact.productionSignals.listConnections.useQuery({ projectId });
  const signalsQuery = trpcReact.productionSignals.listSignals.useQuery({ projectId, limit: 20 });
  const connections = connectionsQuery.data ?? [];
  const googlePlayConnection = connections.find((c) => c.provider === "GOOGLE_PLAY");
  const appleConnection = connections.find((c) => c.provider === "APPLE_APP_STORE");

  const [error, setError] = useState<string | null>(null);
  const [connectingGoogle, setConnectingGoogle] = useState(false);

  const [issuerId, setIssuerId] = useState("");
  const [keyId, setKeyId] = useState("");
  const [privateKeyPem, setPrivateKeyPem] = useState("");
  const [connectingApple, setConnectingApple] = useState(false);

  const startGoogleMutation = trpcReact.productionSignals.startGooglePlayConnect.useMutation();
  const connectAppleMutation = trpcReact.productionSignals.connectAppleAppStore.useMutation();
  const disconnectMutation = trpcReact.productionSignals.disconnect.useMutation();

  function reloadConnections() {
    void utils.productionSignals.listConnections.invalidate({ projectId });
  }

  function friendlyError(e: unknown): string {
    if (e && typeof e === "object" && "data" in e) {
      const data = (e as { data?: { code?: string } }).data;
      if (data?.code === "FORBIDDEN") {
        return "This requires a Business or Corp plan, and organization Admin access.";
      }
      if (data?.code === "PRECONDITION_FAILED") {
        return `Not available on this deployment yet: ${e instanceof Error ? e.message : String(e)}`;
      }
    }
    return e instanceof Error ? e.message : String(e);
  }

  async function connectGooglePlay() {
    setConnectingGoogle(true);
    setError(null);
    try {
      const { authorizeUrl } = await startGoogleMutation.mutateAsync({ projectId });
      window.location.href = authorizeUrl;
    } catch (e) {
      setError(friendlyError(e));
      setConnectingGoogle(false);
    }
  }

  async function connectApple() {
    setConnectingApple(true);
    setError(null);
    try {
      await connectAppleMutation.mutateAsync({ projectId, issuerId, keyId, privateKeyPem });
      setIssuerId("");
      setKeyId("");
      setPrivateKeyPem("");
      reloadConnections();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setConnectingApple(false);
    }
  }

  async function disconnect(provider: "GOOGLE_PLAY" | "APPLE_APP_STORE") {
    if (!confirm("Disconnect this app-store account? Vaettir will stop pulling new crash reports and reviews.")) return;
    await disconnectMutation.mutateAsync({ projectId, provider });
    reloadConnections();
  }

  const googlePlayResult = searchParams.get("googlePlay");

  return (
    <div>
      <h1>Production signals</h1>
      <div
        style={{
          display: "inline-block",
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: 0.5,
          textTransform: "uppercase",
          color: "var(--ember)",
          border: "1px dashed var(--ember)",
          borderRadius: 999,
          padding: "2px 10px",
          marginBottom: 12,
        }}
      >
        Experimental — Business/Corp plans
      </div>
      <p>
        Connect your own app-store account so crash reports and store reviews can feed test-gap detection directly,
        instead of someone manually pasting them in. Nothing is fetched from a connected account today - this is the
        connection layer built ahead of the actual signal-ingestion sync, which needs real Apple/Google developer
        credentials to finish.
      </p>

      {googlePlayResult === "connected" && (
        <p style={{ color: "var(--frost)" }}>Google Play connected.</p>
      )}
      {googlePlayResult === "error" && (
        <p style={{ color: "var(--ember)" }}>Google Play connection failed: {searchParams.get("message") ?? "unknown error"}</p>
      )}
      {error && <p style={{ color: "var(--ember)" }}>{error}</p>}

      <div style={{ display: "grid", gap: 16, maxWidth: 720, marginTop: 16 }}>
        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Google Play</h2>
          {googlePlayConnection && googlePlayConnection.status !== "DISCONNECTED" ? (
            <>
              <p>
                Status: <strong>{googlePlayConnection.status}</strong>
                {googlePlayConnection.lastSyncError && (
                  <span style={{ color: "var(--ember)" }}> — {googlePlayConnection.lastSyncError}</span>
                )}
              </p>
              <button className="btn-secondary" onClick={() => disconnect("GOOGLE_PLAY")}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p className="text-muted" style={{ fontSize: 13 }}>
                Redirects to Google to grant read access to your Play Console app.
              </p>
              <button onClick={connectGooglePlay} disabled={connectingGoogle}>
                {connectingGoogle ? "Redirecting…" : "Connect Google Play"}
              </button>
            </>
          )}
        </div>

        <div style={{ border: "1px solid var(--line)", borderRadius: 8, padding: 16 }}>
          <h2 style={{ marginTop: 0 }}>Apple App Store Connect</h2>
          <p className="text-muted" style={{ fontSize: 13 }}>
            App Store Connect has no OAuth login for this - generate an API key yourself in App Store Connect
            (Users and Access → Integrations → App Store Connect API) and paste its Issuer ID, Key ID, and .p8
            private key content below. The key is encrypted before it&apos;s stored and is never shown again.
          </p>
          {appleConnection && appleConnection.status !== "DISCONNECTED" ? (
            <>
              <p>
                Status: <strong>{appleConnection.status}</strong> — Issuer {appleConnection.appleIssuerId}, Key{" "}
                {appleConnection.appleKeyId}
              </p>
              <button className="btn-secondary" onClick={() => disconnect("APPLE_APP_STORE")}>
                Disconnect
              </button>
            </>
          ) : (
            <div style={{ display: "grid", gap: 8 }}>
              <label>
                Issuer ID
                <input value={issuerId} onChange={(e) => setIssuerId(e.target.value)} style={{ width: "100%" }} />
              </label>
              <label>
                Key ID
                <input value={keyId} onChange={(e) => setKeyId(e.target.value)} style={{ width: "100%" }} />
              </label>
              <label>
                Private key (.p8 content)
                <textarea
                  value={privateKeyPem}
                  onChange={(e) => setPrivateKeyPem(e.target.value)}
                  rows={6}
                  style={{ width: "100%", fontFamily: "monospace", fontSize: 12 }}
                  placeholder="-----BEGIN PRIVATE KEY-----&#10;...&#10;-----END PRIVATE KEY-----"
                />
              </label>
              <button onClick={connectApple} disabled={connectingApple || !issuerId || !keyId || !privateKeyPem}>
                {connectingApple ? "Connecting…" : "Connect App Store Connect"}
              </button>
            </div>
          )}
        </div>
      </div>

      {(signalsQuery.data?.length ?? 0) > 0 && (
        <div style={{ marginTop: 24 }}>
          <h2>Recent signals</h2>
          <ul style={{ listStyle: "none", padding: 0 }}>
            {signalsQuery.data?.map((s) => (
              <li key={s.id} style={{ borderBottom: "1px solid var(--line)", padding: "8px 0" }}>
                <strong>{s.type === "CRASH_REPORT" ? "Crash" : "Review"}</strong> · {new Date(s.occurredAt).toLocaleString()}
                <p style={{ margin: "4px 0 0" }}>{s.summary}</p>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
