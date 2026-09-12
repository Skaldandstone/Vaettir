import { createHmac, timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@vaettir/db";
import { refreshReleaseReadiness } from "./releaseReadiness.js";
import { dispatchWebhookEvent } from "./webhookDelivery.js";
import { notifySlackEvent } from "./slackEventNotify.js";

/**
 * P9-04: closes the loop from a real production incident to a coverage
 * gap. PagerDuty's v3 webhook signature (`X-PagerDuty-Signature`, an
 * HMAC-SHA256 of the raw body prefixed "v1=") verified the same length-
 * check-then-timingSafeEqual way this codebase's own GitHub webhook
 * signature already is (services/githubApp.ts's verifyWebhookSignature) -
 * confirmed against PagerDuty's own published webhook guide and a
 * real third-party integration writeup showing the exact header shape,
 * since no PagerDuty account/webhook subscription exists in this
 * environment to capture a live example from.
 */

export function verifyPagerDutySignature(rawBody: Buffer, signatureHeader: string | undefined, secret: string): boolean {
  if (!signatureHeader) return false;
  const expected = `v1=${createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, actualBuffer);
}

export interface PagerDutyWebhookPayload {
  event?: {
    event_type?: string;
    data?: {
      id?: string;
      title?: string;
      status?: string;
      urgency?: "high" | "low" | string;
      html_url?: string;
      service?: { id?: string; summary?: string };
    };
  };
}

export interface IncidentWebhookResult {
  handled: boolean;
  reason?: string;
  riskFlagId?: string;
}

// Only incident.triggered is handled - every other v3 event_type
// (acknowledged, resolved, escalated, etc.) is acknowledged but ignored,
// same "always 200, report what happened, don't guess at unhandled shapes"
// posture as registerStripeWebhookRoute's own event-type handling.
export async function handlePagerDutyWebhook(prisma: PrismaClient, payload: PagerDutyWebhookPayload): Promise<IncidentWebhookResult> {
  const eventType = payload.event?.event_type;
  if (eventType !== "incident.triggered") {
    return { handled: false, reason: `ignored event_type: ${eventType ?? "unknown"}` };
  }

  const data = payload.event?.data;
  const serviceId = data?.service?.id;
  if (!serviceId) {
    return { handled: false, reason: "payload has no event.data.service.id to route by" };
  }

  const project = await prisma.project.findUnique({ where: { pagerdutyServiceId: serviceId } });
  if (!project) {
    return { handled: false, reason: `no project has pagerdutyServiceId ${serviceId} configured` };
  }

  // "The live release" has no first-class concept in this schema - the
  // most recently updated SHIPPED release for the project is the
  // defensible stand-in (the last one anyone actually marked as out the
  // door), not a guess at a fixed-window "latest by date" heuristic that
  // could pick a release nobody actually shipped yet.
  const release = await prisma.release.findFirst({
    where: { projectId: project.id, status: "SHIPPED" },
    orderBy: { updatedAt: "desc" },
  });
  if (!release) {
    return { handled: false, reason: `project ${project.id} has no SHIPPED release to attach this incident to` };
  }

  const severity = data?.urgency === "high" ? "CRITICAL" : "MEDIUM";
  const title = data?.title ?? "Untitled PagerDuty incident";
  const description = data?.html_url ? `PagerDuty incident: ${title} (${data.html_url})` : `PagerDuty incident: ${title}`;

  const flag = await prisma.riskFlag.create({
    data: { releaseId: release.id, severity, source: "PRODUCTION_INCIDENT", description },
  });

  refreshReleaseReadiness(prisma, release.id);

  // Fire-and-forget, matching the exact P9-06/P9-03 pattern the PR-scan
  // coverage-gap path already uses for this same risk_flag.created event -
  // a slow or dead receiver must never slow down (or fail) this webhook.
  void dispatchWebhookEvent(prisma, project.organizationId, "risk_flag.created", {
    projectId: project.id,
    releaseId: release.id,
    count: 1,
    severity: [severity],
    source: "PRODUCTION_INCIDENT",
  }).catch(() => undefined);
  void notifySlackEvent(prisma, project.organizationId, "risk_flag.created", {
    projectName: project.name,
    releaseName: release.name,
    count: 1,
    files: [],
  }).catch(() => undefined);

  return { handled: true, riskFlagId: flag.id };
}
