"use client";

import { useState } from "react";
import { trpcReact } from "../../../lib/trpcReact";

// P12-05: real Stripe Checkout/portal wiring against sandbox/test mode,
// built on direct instruction to get this running now with the proposed
// pricing rather than wait for a full pricing sign-off. Deliberately
// minimal UI -- the substantive piece is the backend flow being real and
// tested (createBillingCheckoutSession/createBillingPortalSession/webhook
// handling), not a polished page. A fuller billing page (plan comparison
// cards, invoice history, etc.) is real follow-up work, not attempted here.
export default function BillingPage() {
  const orgsQuery = trpcReact.organization.mine.useQuery();
  const orgId = orgsQuery.data?.[0]?.id;

  const seatUsageQuery = trpcReact.organization.seatUsage.useQuery({ organizationId: orgId! }, { enabled: !!orgId });
  const planTiersQuery = trpcReact.organization.listPlanTiers.useQuery(undefined, { enabled: !!orgId });

  const [error, setError] = useState<string | null>(null);
  const [pendingTierId, setPendingTierId] = useState<string | null>(null);

  const checkoutMutation = trpcReact.organization.createBillingCheckout.useMutation({
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (e) => {
      setError(e.message);
      setPendingTierId(null);
    },
  });
  const portalMutation = trpcReact.organization.createBillingPortalSession.useMutation({
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (e) => setError(e.message),
  });
  const topupMutation = trpcReact.organization.createCreditTopup.useMutation({
    onSuccess: (result) => {
      window.location.href = result.url;
    },
    onError: (e) => setError(e.message),
  });

  if (!orgId) return <p>Loading...</p>;

  const seatUsage = seatUsageQuery.data;
  const planTiers = (planTiersQuery.data ?? []).filter((t) => t.key !== "free");

  return (
    <div style={{ maxWidth: 640 }}>
      <h1>Billing</h1>

      {error && (
        <p role="alert" style={{ color: "#b00020" }}>
          {error}
        </p>
      )}

      {seatUsage && (
        <p>
          Current plan: <strong>{seatUsage.planTierName}</strong> ({seatUsage.fullSeatsUsed} full seat
          {seatUsage.fullSeatsUsed === 1 ? "" : "s"} in use)
        </p>
      )}

      <button
        type="button"
        onClick={() => portalMutation.mutate({ organizationId: orgId })}
        disabled={portalMutation.isPending}
      >
        Manage billing
      </button>

      <h2 style={{ marginTop: 24 }}>Change plan</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {planTiers.map((tier) => (
          <li key={tier.id} style={{ marginBottom: 8 }}>
            <button
              type="button"
              disabled={checkoutMutation.isPending && pendingTierId === tier.id}
              onClick={() => {
                setError(null);
                setPendingTierId(tier.id);
                checkoutMutation.mutate({ organizationId: orgId, planTierId: tier.id });
              }}
            >
              Subscribe to {tier.name}
              {checkoutMutation.isPending && pendingTierId === tier.id ? "..." : ""}
            </button>
          </li>
        ))}
      </ul>

      <h2 style={{ marginTop: 24 }}>Buy AI credits</h2>
      <ul style={{ listStyle: "none", padding: 0 }}>
        {(
          [
            { key: "500", label: "500 credits - $10" },
            { key: "2000", label: "2,000 credits - $35" },
            { key: "10000", label: "10,000 credits - $150" },
          ] as const
        ).map((pack) => (
          <li key={pack.key} style={{ marginBottom: 8 }}>
            <button
              type="button"
              disabled={topupMutation.isPending}
              onClick={() => {
                setError(null);
                topupMutation.mutate({ organizationId: orgId, packKey: pack.key });
              }}
            >
              Buy {pack.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
