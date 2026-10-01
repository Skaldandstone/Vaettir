import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { handleDatadogWebhook } from "./datadogWebhook.js";
import { handlePagerDutyWebhook } from "./pagerdutyWebhook.js";
import { productionIncidentKey, recordProductionIncident } from "./productionIncidentReceipt.js";
import { dispatchWebhookEvent } from "./webhookDelivery.js";
import { notifySlackEvent } from "./slackEventNotify.js";

vi.mock("./releaseReadiness.js", () => ({ refreshReleaseReadiness: vi.fn() }));
vi.mock("./webhookDelivery.js", () => ({ dispatchWebhookEvent: vi.fn().mockResolvedValue(undefined) }));
vi.mock("./slackEventNotify.js", () => ({ notifySlackEvent: vi.fn().mockResolvedValue(undefined) }));

const database = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = database && ["localhost", "127.0.0.1"].includes(database.hostname) && /test/i.test(database.pathname) && !database.searchParams.has("host");

describe.skipIf(!isolated)("durable production incident receipts (synthetic local DB)", () => {
  const run = randomUUID();
  const organizations: string[] = [];
  const projects: string[] = [];
  const releases: string[] = [];

  beforeAll(async () => {
    const tier = await prisma.planTier.findFirstOrThrow();
    for (let index = 0; index < 2; index++) {
      const org = await prisma.organization.create({ data: { name: `Receipt ${run}-${index}`, slug: `receipt-${run}-${index}`, planTierId: tier.id } });
      organizations.push(org.id);
      const project = await prisma.project.create({ data: { organizationId: org.id, name: "Synthetic receipt project", slug: "receipt", datadogProjectTag: "shared-tag", pagerdutyServiceId: `PD-${run}-${index}` } });
      projects.push(project.id);
      const release = await prisma.release.create({ data: { projectId: project.id, name: "Initial shipped release", status: "SHIPPED" } });
      releases.push(release.id);
    }
  });
  beforeEach(() => vi.clearAllMocks());
  afterAll(async () => {
    await prisma.productionIncidentReceipt.deleteMany({ where: { organizationId: { in: organizations } } });
    await prisma.riskFlag.deleteMany({ where: { release: { projectId: { in: projects } } } });
    await prisma.release.deleteMany({ where: { projectId: { in: projects } } });
    await prisma.project.deleteMany({ where: { id: { in: projects } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizations } } });
  });

  it("deduplicates concurrent Datadog retries and sends notifications only once", async () => {
    const payload = { eventId: `dd-${run}`, transition: "Triggered", projectTag: "shared-tag", priority: "P1", title: "Synthetic concurrent incident" };
    const results = await Promise.all(Array.from({ length: 8 }, () => handleDatadogWebhook(prisma, organizations[0]!, payload)));
    expect(new Set(results.map(result => result.riskFlagId)).size).toBe(1);
    expect(results.filter(result => !result.duplicate)).toHaveLength(1);
    expect(vi.mocked(dispatchWebhookEvent)).toHaveBeenCalledOnce();
    expect(vi.mocked(notifySlackEvent)).toHaveBeenCalledOnce();
    expect(await prisma.riskFlag.count({ where: { description: "Datadog alert: Synthetic concurrent incident", release: { projectId: projects[0] } } })).toBe(1);
  });

  it("retains a receipt across newer releases, changed replay metadata and flag removal", async () => {
    const payload = { eventId: `retained-${run}`, transition: "Triggered", projectTag: "shared-tag", title: "Original event" };
    const first = await handleDatadogWebhook(prisma, organizations[0]!, payload);
    const later = await prisma.release.create({ data: { projectId: projects[0]!, name: "Later shipped release", status: "SHIPPED", updatedAt: new Date(Date.now() + 1000) } });
    const replay = await handleDatadogWebhook(prisma, organizations[0]!, { ...payload, title: "Changed retry metadata" });
    expect(replay).toMatchObject({ riskFlagId: first.riskFlagId, duplicate: true });
    expect(await prisma.riskFlag.count({ where: { releaseId: later.id } })).toBe(0);
    await prisma.riskFlag.delete({ where: { id: first.riskFlagId! } });
    expect(await handleDatadogWebhook(prisma, organizations[0]!, payload)).toMatchObject({ riskFlagId: first.riskFlagId, duplicate: true });
    expect(await prisma.riskFlag.findUnique({ where: { id: first.riskFlagId! } })).toBeNull();
    expect(vi.mocked(dispatchWebhookEvent)).toHaveBeenCalledOnce();
  });

  it("scopes identical native Datadog identities to their authenticated organization", async () => {
    const payload = { eventId: `tenant-${run}`, transition: "Triggered", projectTag: "shared-tag", title: "Tenant-scoped event" };
    const [first, second] = await Promise.all(organizations.map(id => handleDatadogWebhook(prisma, id, payload)));
    expect(first!.riskFlagId).not.toBe(second!.riskFlagId);
    expect((await prisma.riskFlag.findUniqueOrThrow({ where: { id: second!.riskFlagId! }, include: { release: true } })).release.projectId).toBe(projects[1]);
    expect(vi.mocked(dispatchWebhookEvent)).toHaveBeenCalledTimes(2);
  });

  it("uses PagerDuty delivery event identity, not the incident's reusable identity", async () => {
    const payload = { event: { id: `pd-event-${run}`, event_type: "incident.triggered", data: { id: "same-incident", title: "Synthetic PagerDuty incident", urgency: "high", service: { id: `PD-${run}-0` } } } };
    const retries = await Promise.all(Array.from({ length: 5 }, () => handlePagerDutyWebhook(prisma, payload)));
    expect(new Set(retries.map(result => result.riskFlagId)).size).toBe(1);
    expect(vi.mocked(dispatchWebhookEvent)).toHaveBeenCalledOnce();
    const distinct = await handlePagerDutyWebhook(prisma, { event: { ...payload.event, id: `pd-next-event-${run}` } });
    expect(distinct.riskFlagId).not.toBe(retries[0]!.riskFlagId);
    expect(vi.mocked(dispatchWebhookEvent)).toHaveBeenCalledTimes(2);
  });

  it("deduplicates exact legacy payload retries without hashing truncated strings", async () => {
    const payload = { transition: "Triggered", projectTag: "shared-tag", title: `Legacy ${run}` };
    const first = await handleDatadogWebhook(prisma, organizations[0]!, payload);
    const retry = await handleDatadogWebhook(prisma, organizations[0]!, { title: payload.title, projectTag: payload.projectTag, transition: payload.transition });
    expect(retry).toMatchObject({ riskFlagId: first.riskFlagId, duplicate: true });
    expect(productionIncidentKey("datadog", organizations[0]!, null, ["x".repeat(20000) + "first"]))
      .not.toBe(productionIncidentKey("datadog", organizations[0]!, null, ["x".repeat(20000) + "second"]));
    expect(vi.mocked(dispatchWebhookEvent)).toHaveBeenCalledOnce();
  });

  it("rolls back an incomplete flag write so the same receipt key can recover", async () => {
    const input = { key: productionIncidentKey("datadog", organizations[0]!, `rollback-${run}`, []), provider: "datadog" as const,
      organizationId: organizations[0]!, projectId: projects[0]!, releaseId: "missing-synthetic-release", severity: "MEDIUM" as const, description: "Synthetic recovered incident" };
    await expect(recordProductionIncident(prisma, input)).rejects.toMatchObject({ code: "P2003" });
    expect(await prisma.productionIncidentReceipt.findUnique({ where: { key: input.key } })).toBeNull();
    expect(await recordProductionIncident(prisma, { ...input, releaseId: releases[0]! })).toMatchObject({ created: true });
    expect(await recordProductionIncident(prisma, { ...input, releaseId: releases[1]! })).toMatchObject({ created: false });
  });
});
