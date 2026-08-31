"use client";

import { useEffect, useState } from "react";
import { trpc, type RouterOutputs } from "../../../lib/trpc";
import { canAdministerOrganization } from "../../../lib/membership";

export default function BillingPage() {
  const [organizations, setOrganizations] = useState<RouterOutputs["organization"]["mine"]>([]);
  const [organizationId, setOrganizationId] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null); setOrganizations([]); setOrganizationId("");
    trpc.organization.mine.query().then(rows => {
      if (active) { setOrganizations(rows); setOrganizationId(rows[0]?.id ?? ""); }
    }).catch(() => { if (active) setError("Could not load organizations. Check your connection and sign in again if your session expired."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [retry]);
  const organization = organizations.find(org => org.id === organizationId);
  return <section>
    <h1>Billing</h1>
    <p>Private beta is free and invitation-only. There are no automatic charges or overages.</p>
    <p>This billing preview is restricted to staff-enrolled, isolated test organizations. Commercial plans are not available.</p>
    {loading && <p role="status">Loading organizations...</p>}
    {error && <div role="alert"><p>{error}</p><button onClick={() => setRetry(n => n + 1)}>Retry</button></div>}
    {!loading && !error && !organizations.length && <p>No organizations yet. Accept your team invitation to continue.</p>}
    {!!organizations.length && <label>Organization <select value={organizationId} disabled={busy} onChange={event => setOrganizationId(event.target.value)}>
      {organizations.map(org => <option key={org.id} value={org.id}>{org.name}</option>)}
    </select></label>}
    {organization && (canAdministerOrganization(organization)
      ? <BillingControls key={organizationId} organizationId={organizationId} onBusy={setBusy} />
      : <p>Only a full-seat organization administrator can access billing.</p>)}
  </section>;
}

function BillingControls({ organizationId, onBusy }: { organizationId: string; onBusy: (busy: boolean) => void }) {
  const [status, setStatus] = useState<RouterOutputs["billing"]["status"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [retry, setRetry] = useState(0);
  const [planKey, setPlanKey] = useState<"team" | "business" | "corp">("team");
  const [seats, setSeats] = useState(4);
  useEffect(() => {
    let active = true;
    setStatus(null); setLoading(true); setError(null);
    trpc.billing.status.query({ organizationId }).then(result => {
      if (active) { setStatus(result); setPlanKey(result.offers[0]?.planKey ?? "team"); }
    }).catch(error => { if (active) setError(error instanceof Error ? error.message : "Billing unavailable. Retry later."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [organizationId, retry]);
  async function open(kind: "checkout" | "portal") {
    if (busy || !status?.enabled) return;
    setBusy(true); onBusy(true); setError(null);
    try {
      const result = kind === "checkout" ? await trpc.billing.checkout.mutate({ organizationId, planKey, fullSeats: seats }) : await trpc.billing.portal.mutate({ organizationId });
      const url = new URL(result.url);
      if (url.protocol !== "https:" || url.hostname !== (kind === "checkout" ? "checkout.stripe.com" : "billing.stripe.com")) throw new Error("Unexpected billing redirect. Contact support.");
      window.location.assign(url.href);
    } catch (error) { setError(error instanceof Error ? error.message : "Billing unavailable. Retry later."); }
    finally { setBusy(false); onBusy(false); }
  }
  return <div className="panel" style={{ marginTop: 24 }}>
    {loading && <p role="status">Checking billing access...</p>}
    {error && <div role="alert"><p>{error}</p><button disabled={busy} onClick={() => setRetry(n => n + 1)}>Refresh billing status</button></div>}
    {status && <>
      <p>{status.enabled ? "Test mode only. Use test payment details, never a real payment card." : "Billing is disabled or this organization is not enrolled for billing tests."}</p>
      <p>Subscription: {status.status}. Verified test full seats: {status.purchasedFullSeats}.</p>
      <p>Returning from Checkout does not activate a plan. Only a verified provider event can update these test entitlements.</p>
      {status.enabled && <>
        {status.offers.length > 0 && <>
          <label>Test plan <select value={planKey} disabled={busy} onChange={event => setPlanKey(event.target.value as typeof planKey)}>
            {status.offers.map(offer => <option key={offer.planKey} value={offer.planKey}>{offer.planKey}</option>)}
          </select></label>{" "}
          <label>Full seats <input type="number" min={1} max={10000} value={seats} disabled={busy} onChange={event => setSeats(Number(event.target.value))} /></label>{" "}
          <button disabled={busy || !Number.isInteger(seats) || seats < 1} onClick={() => void open("checkout")}>Open hosted test Checkout</button>
        </>}
        {!status.offers.length && <p>No test prices are configured. Contact the test coordinator.</p>}
        <p><button disabled={busy} onClick={() => void open("portal")}>Open test customer portal</button></p>
        <button disabled={busy} onClick={() => setRetry(n => n + 1)}>Refresh billing status</button>
      </>}
    </>}
  </div>;
}
