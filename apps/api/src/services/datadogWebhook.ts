import { timingSafeEqual } from "node:crypto";
import type { PrismaClient } from "@vaettir/db";
import { refreshReleaseReadiness } from "./releaseReadiness.js";
import { dispatchWebhookEvent } from "./webhookDelivery.js";
import { notifySlackEvent } from "./slackEventNotify.js";

/**
 * P9-04 (Datadog half): closes the same incident -> coverage-gap loop
 * PagerDuty's half of this ticket already does, from a Datadog monitor
 * alert instead. Two real differences from PagerDuty's design, both
 * confirmed against Datadog's own webhook integration docs (directly
 * fetchable):
 *
 * - Datadog's webhook integration genuinely supports custom HTTP headers,
 *   so this is a plain shared secret (like Jira's, verifyDatadogWebhookSecret
 *   below) rather than a computed HMAC signature - Datadog has no built-in
 *   request signing for a generic webhook integration either.
 * - A Datadog monitor has no fixed, platform-wide-unique id to route on
 *   the way a PagerDuty Service does. The customer instead tags the
 *   monitor `vaettir_project:<value>` themselves and the webhook payload
 *   includes that tag's value via Datadog's own `$TAGS[key]` template
 *   variable - a value only unique within one org's own choices, so
 *   routing is per-org (via the URL path, see server.ts) rather than one
 *   shared global route.
 *
 * The exact payload shape is Vaettir's own definition (Datadog lets the
 * customer template the JSON body freely using its variables) - documented
 * here and on the org settings page so they can never disagree. No Datadog
 * account exists in this environment to exercise a real delivery.
 */

export function verifyDatadogWebhookSecret(headerValue: string | undefined, secret: string): boolean {
  if (!headerValue || !secret) return false;
  const expected = Buffer.from(secret);
  const actual = Buffer.from(headerValue);
  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}

export interface DatadogWebhookPayload {
  alertId?: string;
  title?: string;
  // Datadog's $ALERT_TRANSITION: "Triggered" | "Re-Triggered" | "Recovered"
  // | "No Data" | "Warn" | "Warn Recovered" | ... - only the two triggering
  // states below create a risk flag; a recovery or no-data blip isn't a
  // coverage gap to flag.
  transition?: string;
  priority?: string; // Datadog's $ALERT_PRIORITY: "P1".."P5"
  projectTag?: string;
}

export interface DatadogWebhookResult {
  handled: boolean;
  reason?: string;
  riskFlagId?: string;
}

const TRIGGERING_TRANSITIONS = new Set(["Triggered", "Re-Triggered"]);

function mapDatadogPriority(priority: string | undefined): "CRITICAL" | "HIGH" | "MEDIUM" {
  const p = (priority ?? "").trim().toUpperCase();
  if (p === "P1" || p === "P2") return "CRITICAL";
  if (p === "P3") return "HIGH";
  return "MEDIUM";
}

export async function handleDatadogWebhook(
  prisma: PrismaClient,
  organizationId: string,
  payload: DatadogWebhookPayload,
): Promise<DatadogWebhookResult> {
  const transition = payload.transition;
  if (!transition || !TRIGGERING_TRANSITIONS.has(transition)) {
    return { handled: false, reason: `ignored transition: ${transition ?? "unknown"}` };
  }

  const projectTag = payload.projectTag;
  if (!projectTag) {
    return { handled: false, reason: "payload has no projectTag to route by" };
  }

  const project = await prisma.project.findFirst({ where: { organizationId, datadogProjectTag: projectTag } });
  if (!project) {
    return { handled: false, reason: `no project in this org has datadogProjectTag ${projectTag} configured` };
  }

  const release = await prisma.release.findFirst({
    where: { projectId: project.id, status: "SHIPPED" },
    orderBy: { updatedAt: "desc" },
  });
  if (!release) {
    return { handled: false, reason: `project ${project.id} has no SHIPPED release to attach this incident to` };
  }

  const severity = mapDatadogPriority(payload.priority);
  const title = payload.title ?? "Untitled Datadog alert";
  const description = `Datadog alert: ${title}`;

  const flag = await prisma.riskFlag.create({
    data: { releaseId: release.id, severity, source: "PRODUCTION_INCIDENT", description },
  });

  refreshReleaseReadiness(prisma, release.id);

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
