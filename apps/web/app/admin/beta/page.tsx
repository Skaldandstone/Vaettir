"use client";

import { useCallback, useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../../lib/trpc";

export default function BetaEnrollmentPage() {
  const [data, setData] = useState<RouterOutputs["beta"]["list"] | null>(null);
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try { setData(await trpc.beta.list.query()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  async function enroll() {
    setBusy(true); setError(null);
    try { await trpc.beta.enroll.mutate({ email, reason }); setEmail(""); setReason(""); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    setBusy(true); setError(null);
    try { await trpc.beta.revoke.mutate({ id }); await load(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusy(false); }
  }
  return <main style={{ maxWidth: 800 }}>
    <h1>Private beta enrollment</h1>
    <p>Staff only. Enrolling reserves one of three external-team slots. No email is sent automatically.</p>
    <p>Share the onboarding link only after James approves that team: https://vaettir.skaldandstone.com/onboarding</p>
    {error && <p role="alert">{error}</p>}
    {data && <>
      <p>{data.enrollments.filter((e) => !e.revokedAt).length} / {data.limit} slots reserved</p>
      <form onSubmit={(e) => { e.preventDefault(); void enroll(); }} style={{ display: "grid", gap: 12 }}>
        <label>Owner email<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label>Approval reference / reason<input required maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} /></label>
        <button disabled={busy}>Reserve beta invitation</button>
      </form>
      <ul>{data.enrollments.map((entry) => <li key={entry.id} style={{ marginTop: 16 }}>
        {entry.email}: {entry.claimedAt ? "Accepted" : entry.revokedAt ? "Revoked" : "Invited"}
        {!entry.claimedAt && !entry.revokedAt && <button disabled={busy} onClick={() => void revoke(entry.id)}>Revoke unused invitation</button>}
      </li>)}</ul>
    </>}
  </main>;
}
