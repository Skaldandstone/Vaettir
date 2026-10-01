export type IntegrationStatus = { label: string; tone: "neutral" | "success" | "warning" };

// Saved configuration and historical delivery are distinct from current
// authenticated access. This view must never manufacture a connected state.
export function integrationStatus(input: {
  configured: boolean;
  kind: "slack" | "webhook" | "tickets" | "signal";
  observedAt?: string | null;
  deliverySucceeded?: boolean | null;
  webhookRequired?: boolean;
}): IntegrationStatus {
  if (!input.configured) return { label: "Not configured", tone: "neutral" };
  if (input.webhookRequired) return { label: "Webhook setup required", tone: "warning" };
  const hasObservation = Boolean(input.observedAt && Number.isFinite(Date.parse(input.observedAt)));
  if (input.kind === "webhook" && hasObservation && input.deliverySucceeded === false)
    return { label: "Last delivery failed", tone: "warning" };
  if (input.kind === "webhook" && hasObservation && input.deliverySucceeded === true)
    return { label: "Last delivery succeeded", tone: "success" };
  if (input.kind === "tickets" && hasObservation)
    return { label: "Status sync recorded", tone: "neutral" };
  if (input.kind === "slack" && hasObservation)
    return { label: "Digest sent previously", tone: "neutral" };
  return {
    label: input.kind === "signal" ? "Routing saved · Delivery unverified" :
      input.kind === "tickets" ? "Configured · Access unverified" : "Configured · Delivery unverified",
    tone: "neutral",
  };
}
