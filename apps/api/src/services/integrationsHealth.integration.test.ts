// P9-00: real-DB proof the health aggregation actually reads each
// integration's real, already-shipped storage correctly - a Slack digest
// timestamp, a webhook delivery outcome, Jira/Linear-linked requirement
// sync timestamps, and PagerDuty/Datadog project counts, all in one
// query, none of it guessed or duplicated storage.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { computeIntegrationsHealth } from "./integrationsHealth.js";

const RUN = `int-health-${randomUUID()}`;
let orgId: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const org = await prisma.organization.create({
    data: {
      name: `Integrations health test ${RUN}`,
      slug: RUN,
      planTierId: tier.id,
      slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/test",
      digestEnabled: true,
      slackEventTypes: ["risk_flag.created", "compliance.sign_off_recorded"],
      lastDigestSentAt: new Date("2026-09-10T12:00:00Z"),
      linearEncryptedApiKey: "ciphertext",
      linearApiKeyIv: "iv",
      linearApiKeyAuthTag: "tag",
      linearWebhookSecret: "shh",
      jiraWebhookSecret: "shh",
      datadogWebhookSecret: "shh",
    },
  });
  orgId = org.id;
  const user = await prisma.user.create({ data: { clerkUserId: `${RUN}-owner`, email: `${RUN}@example.com` } });
  userId = user.id;

  const project = await prisma.project.create({
    data: { organizationId: orgId, name: "Health project", slug: "health-project", pagerdutyServiceId: `PD-${RUN}`, datadogProjectTag: "tag" },
  });
  projectId = project.id;

  const endpoint = await prisma.webhookEndpoint.create({
    data: { organizationId: orgId, url: "https://example.com/hook", secret: "whsec", eventTypes: ["risk_flag.created"], createdById: userId },
  });
  await prisma.webhookDelivery.create({
    data: { webhookEndpointId: endpoint.id, eventType: "risk_flag.created", payload: {}, success: true, responseStatus: 200 },
  });

  await prisma.requirement.create({
    data: { projectId, title: "Linear-linked req", linearIssueId: "ENG-1", linearSyncedAt: new Date("2026-09-11T00:00:00Z") },
  });
  await prisma.requirement.create({
    data: { projectId, title: "Jira-linked req", jiraIssueKey: "PROJ-1", jiraSyncedAt: new Date("2026-09-11T06:00:00Z") },
  });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.webhookDelivery.deleteMany({ where: { webhookEndpoint: { organizationId: orgId } } });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId: orgId } });
  await prisma.requirement.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("computeIntegrationsHealth (real DB)", () => {
  it("aggregates every integration's real configured/linked/delivered state", async () => {
    const health = await computeIntegrationsHealth(prisma, orgId);

    expect(health.slack).toEqual({
      configured: true,
      digestEnabled: true,
      eventTypesSubscribed: 2,
      lastDigestSentAt: "2026-09-10T12:00:00.000Z",
    });

    expect(health.webhooks.endpointCount).toBe(1);
    expect(health.webhooks.enabledCount).toBe(1);
    expect(health.webhooks.lastDeliverySuccess).toBe(true);
    expect(health.webhooks.lastDeliveryAt).not.toBeNull();

    expect(health.linear.configured).toBe(true);
    expect(health.linear.webhookConfigured).toBe(true);
    expect(health.linear.linkedRequirementCount).toBe(1);
    expect(health.linear.lastSyncedAt).toBe("2026-09-11T00:00:00.000Z");

    expect(health.jira.configured).toBe(false); // no API token configured, only the webhook secret
    expect(health.jira.webhookConfigured).toBe(true);
    expect(health.jira.linkedRequirementCount).toBe(1);
    expect(health.jira.lastSyncedAt).toBe("2026-09-11T06:00:00.000Z");

    expect(health.pagerduty.projectsConfigured).toBe(1);
    expect(health.datadog).toEqual({ projectsConfigured: 1, webhookConfigured: true });
  });

  it("reports all-zero/unconfigured state for an org with nothing set up", async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    const bareOrg = await prisma.organization.create({ data: { name: `Bare ${RUN}`, slug: `bare-${RUN}`, planTierId: tier.id } });
    const health = await computeIntegrationsHealth(prisma, bareOrg.id);
    expect(health.slack.configured).toBe(false);
    expect(health.webhooks.endpointCount).toBe(0);
    expect(health.webhooks.lastDeliverySuccess).toBeNull();
    expect(health.jira.configured).toBe(false);
    expect(health.linear.configured).toBe(false);
    expect(health.pagerduty.projectsConfigured).toBe(0);
    expect(health.datadog.projectsConfigured).toBe(0);
    await prisma.organization.delete({ where: { id: bareOrg.id } });
  });
});
