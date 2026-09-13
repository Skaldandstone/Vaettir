import type { PrismaClient } from "@vaettir/db";

/**
 * P9-00: the "connection-health view" half of the integration-config
 * framework ticket - last successful sync, auth expiry-shaped signal, per
 * integration. Deliberately NOT the other half of that ticket (a shared
 * generic config-storage layer/table every integration writes into): six
 * real integrations already ship with their own bespoke, already-tested
 * per-org config shape (Slack, generic webhooks, Jira, Linear, PagerDuty,
 * Datadog) - retrofitting all of them onto a new generic table now would
 * be a real, invasive, working-code-touching refactor for a benefit this
 * pass has no concrete evidence it needs (no second differently-shaped
 * integration is waiting to prove the abstraction right). This is the
 * purely additive, zero-risk slice: a read-only aggregation across what
 * already exists, not a rewrite of how any of it is stored.
 */

export interface IntegrationHealth {
  slack: { configured: boolean; digestEnabled: boolean; eventTypesSubscribed: number; lastDigestSentAt: string | null };
  webhooks: { endpointCount: number; enabledCount: number; lastDeliveryAt: string | null; lastDeliverySuccess: boolean | null };
  jira: { configured: boolean; webhookConfigured: boolean; linkedRequirementCount: number; lastSyncedAt: string | null };
  linear: { configured: boolean; webhookConfigured: boolean; linkedRequirementCount: number; lastSyncedAt: string | null };
  pagerduty: { projectsConfigured: number };
  datadog: { projectsConfigured: number; webhookConfigured: boolean };
}

function latestIso(dates: (Date | null)[]): string | null {
  const real = dates.filter((d): d is Date => d !== null);
  if (real.length === 0) return null;
  return real.reduce((latest, d) => (d > latest ? d : latest)).toISOString();
}

export async function computeIntegrationsHealth(prisma: PrismaClient, organizationId: string): Promise<IntegrationHealth> {
  const org = await prisma.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: {
      slackWebhookUrl: true,
      digestEnabled: true,
      slackEventTypes: true,
      lastDigestSentAt: true,
      linearEncryptedApiKey: true,
      linearWebhookSecret: true,
      jiraEncryptedApiToken: true,
      jiraWebhookSecret: true,
      datadogWebhookSecret: true,
    },
  });

  const [endpoints, lastDelivery, linearRequirements, jiraRequirements, pagerdutyProjectCount, datadogProjectCount] = await Promise.all([
    prisma.webhookEndpoint.findMany({ where: { organizationId }, select: { enabled: true } }),
    prisma.webhookDelivery.findFirst({
      where: { webhookEndpoint: { organizationId } },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true, success: true },
    }),
    prisma.requirement.findMany({
      where: { project: { organizationId }, linearIssueId: { not: null } },
      select: { linearSyncedAt: true },
    }),
    prisma.requirement.findMany({
      where: { project: { organizationId }, jiraIssueKey: { not: null } },
      select: { jiraSyncedAt: true },
    }),
    prisma.project.count({ where: { organizationId, pagerdutyServiceId: { not: null } } }),
    prisma.project.count({ where: { organizationId, datadogProjectTag: { not: null } } }),
  ]);

  return {
    slack: {
      configured: org.slackWebhookUrl !== null,
      digestEnabled: org.digestEnabled,
      eventTypesSubscribed: org.slackEventTypes.length,
      lastDigestSentAt: org.lastDigestSentAt?.toISOString() ?? null,
    },
    webhooks: {
      endpointCount: endpoints.length,
      enabledCount: endpoints.filter((e) => e.enabled).length,
      lastDeliveryAt: lastDelivery?.createdAt.toISOString() ?? null,
      lastDeliverySuccess: lastDelivery?.success ?? null,
    },
    jira: {
      configured: org.jiraEncryptedApiToken !== null,
      webhookConfigured: org.jiraWebhookSecret !== null,
      linkedRequirementCount: jiraRequirements.length,
      lastSyncedAt: latestIso(jiraRequirements.map((r) => r.jiraSyncedAt)),
    },
    linear: {
      configured: org.linearEncryptedApiKey !== null,
      webhookConfigured: org.linearWebhookSecret !== null,
      linkedRequirementCount: linearRequirements.length,
      lastSyncedAt: latestIso(linearRequirements.map((r) => r.linearSyncedAt)),
    },
    pagerduty: { projectsConfigured: pagerdutyProjectCount },
    datadog: { projectsConfigured: datadogProjectCount, webhookConfigured: org.datadogWebhookSecret !== null },
  };
}
