"use client";

import { useState } from "react";
import { trpcReact } from "../../../lib/trpcReact";
import { canAdministerOrganization } from "../../../lib/membership";
import { creditOperationLabel } from "../../../lib/credit-labels";

const money = (cents: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    cents / 100,
  );

export default function BillingPage() {
  const orgs = trpcReact.organization.mine.useQuery();
  const membership = orgs.data?.[0];
  const orgId = membership?.id;
  const canAdmin = canAdministerOrganization(membership);
  const options = { enabled: !!orgId };
  const overview = trpcReact.organization.billingOverview.useQuery(
    { organizationId: orgId! },
    options,
  );
  const seats = trpcReact.organization.seatUsage.useQuery(
    { organizationId: orgId! },
    options,
  );
  const credits = trpcReact.organization.aiCreditStatus.useQuery(
    { organizationId: orgId! },
    options,
  );
  const creditRequests = trpcReact.creditUseRequests.adminList.useQuery(
    { organizationId: orgId! }, { enabled: !!orgId && canAdmin },
  );
  const resolveCreditRequest = trpcReact.creditUseRequests.resolve.useMutation();
  const tiers = trpcReact.organization.listPlanTiers.useQuery(
    undefined,
    options,
  );
  const [error, setError] = useState<string | null>(null);
  const handlers = {
    onSuccess: (result: { url: string }) => {
      window.location.href = result.url;
    },
    onError: (e: { message: string }) => setError(e.message),
  };
  const checkout =
    trpcReact.organization.createBillingCheckout.useMutation(handlers);
  const portal =
    trpcReact.organization.createBillingPortalSession.useMutation(handlers);
  const topup = trpcReact.organization.createCreditTopup.useMutation(handlers);
  const busy = checkout.isPending || portal.isPending || topup.isPending;
  const data = overview.data;
  const availablePlans = (tiers.data ?? []).filter(
    (tier) => tier.key !== "free",
  );
  const enabled = canAdmin && data?.purchasesEnabled && !busy;
  const pageError =
    orgs.error ?? overview.error ?? seats.error ?? credits.error ?? tiers.error;
  if (orgs.isLoading) return <p>Loading billing…</p>;
  if (!orgId)
    return (
      <p>
        {orgs.error?.message ??
          "Join or create a workspace to view its billing."}
      </p>
    );
  return (
    <div style={{ maxWidth: 1120 }}>
      <h1>Billing &amp; usage</h1>
      <p className="text-muted">
        Plans, AI usage and seats for {membership.name}. Review costs before
        making a purchase.
      </p>
      {(error || pageError) && (
        <p role="alert">{error ?? pageError?.message}</p>
      )}
      {data && !data.purchasesEnabled && (
        <div className="panel" role="status">
          Payments are not enabled on this deployment. You can still review your
          plan, usage and available credit packs here. No purchase will be
          attempted.
        </div>
      )}
      {data?.billingMode === "sandbox" && (
        <p role="status">
          Test billing mode. Checkout uses Stripe sandbox, not live payments.
        </p>
      )}
      {!canAdmin && (
        <p>Only a full-seat workspace Owner or Admin can change billing.</p>
      )}
      <div className="billing-module-grid">
        <section className="panel">
          <h2>Your plan</h2>
          <h3>
            {data?.currentPlan.name ?? seats.data?.planTierName ?? "Loading…"}
          </h3>
          <p>
            {data?.currentPlan.monthlyPricePerSeatCents != null
              ? `${money(data.currentPlan.monthlyPricePerSeatCents)} per full seat / month`
              : "No published recurring price for this plan."}
          </p>
          <button
            disabled={!enabled || !data?.hasBillingAccount}
            onClick={() => portal.mutate({ organizationId: orgId })}
          >
            Manage billing
          </button>
          <h3>Available plans</h3>
          {tiers.isLoading ? (
            <p>Loading plans…</p>
          ) : availablePlans.length === 0 ? (
            <p className="text-muted">
              No self-service plan changes are currently available. Your
              existing plan and included allowances remain in effect.
            </p>
          ) : (
            availablePlans.map((t) => (
              <div className="billing-catalog-row" key={t.id}>
                <span>
                  <strong>{t.name}</strong>
                  <small>
                    {t.monthlyPricePerSeatCents == null
                      ? "Price not published"
                      : `${money(t.monthlyPricePerSeatCents)} / seat / month`}
                  </small>
                </span>
                <button
                  disabled={!enabled || t.id === seats.data?.planTierId}
                  onClick={() =>
                    checkout.mutate({
                      organizationId: orgId,
                      planTierId: t.id,
                    })
                  }
                >
                  {t.id === seats.data?.planTierId ? "Current" : "Choose plan"}
                </button>
              </div>
            ))
          )}
        </section>
        <section className="panel">
          <h2>AI credits</h2>
          <p>
            <strong>{credits.data?.balance.toLocaleString() ?? "…"}</strong>{" "}
            available · {credits.data?.includedPerMonth.toLocaleString() ?? "…"}{" "}
            included monthly
          </p>
          <p className="text-muted">
            A credit is a usage unit, not one test or one request. Each
            operation has its own cost, shown below. Pack pricing varies.
          </p>
          {data?.topupPacks.map((pack) => (
            <div className="billing-catalog-row" key={pack.key}>
              <span>
                <strong>{pack.credits.toLocaleString()} credits</strong>
                <small>
                  {money(pack.priceUsdCents)} total ·{" "}
                  {(pack.priceUsdCents / pack.credits).toFixed(2)}¢ per credit
                </small>
              </span>
              <button
                disabled={!enabled}
                onClick={() =>
                  topup.mutate({
                    organizationId: orgId,
                    packKey: pack.key as "500" | "2000" | "10000",
                  })
                }
              >
                Buy pack
              </button>
            </div>
          ))}
          <details>
            <summary>What do credits cover?</summary>
            <ul>
              {data?.operationCosts.map((cost) => (
                <li key={cost.operation}>
                  {creditOperationLabel(cost.operation)}:{" "}
                  <strong>{cost.credits} credits</strong>
                </li>
              ))}
            </ul>
          </details>
        </section>
      </div>
      {canAdmin && <section className="panel" style={{ marginTop: 20 }}>
        <h2>AI use requests</h2>
        <p className="text-muted">Review requests from members who cannot run an analysis or need more credits. Acknowledging a request does not grant a seat, top up credits, or run AI.</p>
        {creditRequests.error && <p role="alert">{creditRequests.error.message}</p>}
        {creditRequests.data?.length === 0 && <p>No requests yet.</p>}
        {(creditRequests.data ?? []).map(item => <div key={item.id} className="billing-catalog-row" style={{ alignItems: "flex-start", flexWrap: "wrap" }}>
          <span><strong>{item.requestedByEmail}</strong> · {item.projectName}<small>{item.action === "RISK" ? "Risk assessment" : "Type and design review"} · {item.caseCount} cases · up to {item.estimatedCredits} initial credits · {item.status.toLowerCase()}</small>{item.reason && <small>Reason: {item.reason}</small>}</span>
          {item.status === "PENDING" && <span style={{ display: "flex", gap: 6 }}>
            <button className="btn-secondary" disabled={resolveCreditRequest.isPending} onClick={async () => { try { await resolveCreditRequest.mutateAsync({ organizationId: orgId, id: item.id, decision: "ACKNOWLEDGED" }); await creditRequests.refetch(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review request."); } }}>Acknowledge</button>
            <button className="btn-secondary" disabled={resolveCreditRequest.isPending} onClick={async () => { try { await resolveCreditRequest.mutateAsync({ organizationId: orgId, id: item.id, decision: "DECLINED" }); await creditRequests.refetch(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review request."); } }}>Decline</button>
          </span>}
        </div>)}
        <p><a href="/settings/members">Manage member seats</a> · Credit packs above require a separate authorized purchase.</p>
      </section>}
      <section className="panel" style={{ marginTop: 20 }}>
        <h2>Current seats &amp; estimated cost</h2>
        {seats.data && (
          <div className="billing-module-grid">
            <div>
              <h3>
                {seats.data.fullSeatsUsed} full{" "}
                {seats.data.fullSeatsUsed === 1 ? "seat" : "seats"}
              </h3>
              <p>
                Plan capacity: {seats.data.fullSeatsIncluded ?? "Unlimited"}
              </p>
              <h3>
                {seats.data.readOnlySeatsUsed} read-only{" "}
                {seats.data.readOnlySeatsUsed === 1 ? "seat" : "seats"}
              </h3>
              <p>
                Plan capacity: {seats.data.readOnlySeatsIncluded ?? "Unlimited"}
              </p>
            </div>
            <div>
              <h3>
                {data?.currentPlan.monthlyPricePerSeatCents != null
                  ? `${money(data.currentPlan.monthlyPricePerSeatCents * seats.data.fullSeatsUsed)} / month`
                  : "Recurring cost not configured"}
              </h3>
              <p className="text-muted">
                Seat-price estimate only. Excludes taxes, discounts, proration
                and optional credit packs. Your billing provider’s invoice is
                authoritative.
              </p>
              <p>
                {data?.hasActiveSubscription
                  ? "A subscription is linked to this workspace."
                  : "No subscription is linked to this workspace."}
              </p>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
