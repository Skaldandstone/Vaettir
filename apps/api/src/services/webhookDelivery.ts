import { createHmac, randomBytes } from "node:crypto";
import type { PrismaClient } from "@vaettir/db";
import { assertPublicHttpUrl } from "./urlGuard.js";

// P9-06: the concrete, already-real events wired up today. Deliberately a
// fixed literal list, not an open string - every emitter call site is
// grep-able from here, and a WebhookEndpoint can only subscribe to an event
// that genuinely fires somewhere.
export const WEBHOOK_EVENT_TYPES = [
  "risk_flag.created",
  "compliance.sign_off_recorded",
  "test_case.review_requested",
  // P8-04: fired by services/releaseReadiness.ts when a release's computed
  // readiness label (READY / AT_RISK / BLOCKED) changes.
  "release.readiness_changed",
] as const;
export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("hex")}`;
}

function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

// Fire-and-forget from the caller's perspective (never awaited by a
// user-facing mutation - a slow or dead receiver shouldn't slow down the
// action that triggered the event), but each attempt is still recorded as
// a WebhookDelivery row so "is this actually working" is answerable from
// the UI rather than a mystery. A 5s timeout keeps one dead endpoint from
// piling up in-flight requests indefinitely.
export async function dispatchWebhookEvent(
  prisma: PrismaClient,
  organizationId: string,
  eventType: WebhookEventType,
  payload: Record<string, unknown>,
): Promise<void> {
  const endpoints = await prisma.webhookEndpoint.findMany({
    where: { organizationId, enabled: true, eventTypes: { has: eventType } },
  });
  if (endpoints.length === 0) return;

  const body = JSON.stringify({ event: eventType, createdAt: new Date().toISOString(), data: payload });

  await Promise.all(
    endpoints.map(async (endpoint) => {
      const signature = signPayload(endpoint.secret, body);
      let success = false;
      let responseStatus: number | null = null;
      let error: string | null = null;
      try {
        // Re-checked here, not just at creation time: DNS can change (or be
        // rebound) between when an admin saved this URL and when it's
        // actually fetched.
        await assertPublicHttpUrl(endpoint.url);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch(endpoint.url, {
          method: "POST",
          headers: { "content-type": "application/json", "x-vaettir-signature": signature, "x-vaettir-event": eventType },
          body,
          signal: controller.signal,
        }).finally(() => clearTimeout(timeout));
        responseStatus = res.status;
        success = res.ok;
      } catch (err) {
        error = err instanceof Error ? err.message : String(err);
      }

      await prisma.webhookDelivery.create({
        data: {
          webhookEndpointId: endpoint.id,
          eventType,
          payload: payload as never,
          success,
          responseStatus,
          error,
        },
      });
    }),
  );
}
