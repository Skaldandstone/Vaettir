"use client";
import { useState } from "react";
import { Icon } from "./ui/Workspace";
import styles from "./IdentityAccessEditor.module.css";

export type IdentitySetupStatus = { status: "unavailable" | "provider-admin-required"; connections: never[] } | {
  status: "ready"; clerkOrganizationId: string; clerkSubject: string; revision: number;
  connections: { id: string; name: string; provider: string; active: boolean }[];
};
export function IdentitySsoPanel({ inspect, openSetup }: { inspect: () => Promise<IdentitySetupStatus>; openSetup: (status: Extract<IdentitySetupStatus, { status: "ready" }>) => Promise<void> }) {
  const [status, setStatus] = useState<IdentitySetupStatus | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  async function check(open = false) {
    setBusy(true); setError("");
    try { const current = await inspect(); setStatus(current); if (open && current.status === "ready") await openSetup(current); }
    catch { setStatus(null); setError("Could not verify identity setup. Retry; your connection has not been changed."); }
    finally { setBusy(false); }
  }
  return <section aria-label="Single sign-on" className={styles.sso}>
    <div className={styles.previewHeading}><h2><Icon name="link" size={18}/> Single sign-on</h2><span className={styles.status}>{status?.status === "ready" ? "Workspace verified" : "Setup check"}</span></div>
    <p className={styles.hint}>Connect SAML or OpenID Connect through the guided provider setup.</p>
    {status?.status === "unavailable" && <p role="status" className={styles.hint}>SSO setup has not been enabled for this workspace. Existing sign-in is unchanged.</p>}
    {status?.status === "provider-admin-required" && <p role="status" className={styles.hint}>An identity-provider organization administrator must complete setup.</p>}
    {status?.status === "ready" && <>
      {status.connections.length ? <ul>{status.connections.map(connection => <li key={connection.id}><span>{connection.name || connection.provider}</span><span className={styles.status}>{connection.active ? "Provider active" : "Not activated"}</span></li>)}</ul> : <p className={styles.hint}>No SSO connection configured yet.</p>}
      <details><summary>Setup scope</summary><p className={styles.hint}>The provider’s Security tab handles domain verification, metadata and a test sign-in. Activation changes sign-in for the verified domain. Google directory sync reads the entire Workspace directory, not just a selected group.</p></details>
      <p className={styles.hint}>Provider status is not proof of a completed Vaettir login or provisioning test.</p>
    </>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.dialogActions}><button type="button" className="btn-secondary" disabled={busy} onClick={() => check()}>{busy ? "Checking…" : status ? "Refresh status" : "Check setup"}</button>
      {status?.status === "ready" && <button type="button" className="btn-primary" disabled={busy} onClick={() => check(true)}>Open provider setup <Icon name="external" size={14}/></button>}</div>
  </section>;
}
