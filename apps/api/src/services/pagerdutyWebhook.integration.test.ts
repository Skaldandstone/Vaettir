// P9-04: real-DB proof that an inbound PagerDuty incident.triggered event
// routes to the right project (via Project.pagerdutyServiceId), attaches to
// the right release (the most recently updated SHIPPED one), and creates a
// real, visible RiskFlag - closing incident -> coverage gap for real, not
// just typechecked. No PagerDuty account exists in this environment, so
// this drives handlePagerDutyWebhook directly with a payload shaped like
// PagerDuty's own documented incident.triggered event.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { handlePagerDutyWebhook } from "./pagerdutyWebhook.js";

const RUN = `pagerduty-${randomUUID()}`;
let orgId: string;
let projectId: string;
let shippedReleaseId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const org = await prisma.organization.create({ data: { name: `PagerDuty test ${RUN}`, slug: RUN, planTierId: tier.id } });
  orgId = org.id;
  const project = await prisma.project.create({
    data: { organizationId: orgId, name: "PD test project", slug: "pd-project", pagerdutyServiceId: `PDSVC-${RUN}` },
  });
  projectId = project.id;
  const shipped = await prisma.release.create({ data: { projectId, name: "v1.0", status: "SHIPPED" } });
  shippedReleaseId = shipped.id;
  // An older SHIPPED release too, to prove "most recently updated" wins,
  // not just "any SHIPPED release."
  const older = await prisma.release.create({ data: { projectId, name: "v0.9", status: "SHIPPED" } });
  await prisma.release.update({ where: { id: older.id }, data: { updatedAt: new Date(Date.now() - 60_000) } });
});

afterAll(async () => {
  if (!orgId) return;
  await prisma.riskFlag.deleteMany({ where: { release: { projectId } } });
  await prisma.release.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("handlePagerDutyWebhook (real DB)", () => {
  it("ignores non-incident.triggered event types", async () => {
    const result = await handlePagerDutyWebhook(prisma, { event: { event_type: "incident.resolved" } });
    expect(result).toEqual({ handled: false, reason: "ignored event_type: incident.resolved" });
  });

  it("reports no project configured when the service id doesn't match any project", async () => {
    const result = await handlePagerDutyWebhook(prisma, {
      event: { event_type: "incident.triggered", data: { title: "x", urgency: "high", service: { id: "PDSVC-unknown" } } },
    });
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no project has pagerdutyServiceId/);
  });

  it("creates a real CRITICAL RiskFlag on the most recently updated SHIPPED release for a high-urgency incident", async () => {
    const result = await handlePagerDutyWebhook(prisma, {
      event: {
        event_type: "incident.triggered",
        data: {
          id: "Q123",
          title: "Checkout endpoint returning 500s",
          status: "triggered",
          urgency: "high",
          html_url: "https://example.pagerduty.com/incidents/Q123",
          service: { id: `PDSVC-${RUN}` },
        },
      },
    });
    expect(result.handled).toBe(true);
    expect(result.riskFlagId).toBeTruthy();

    const flag = await prisma.riskFlag.findUniqueOrThrow({ where: { id: result.riskFlagId! } });
    expect(flag.releaseId).toBe(shippedReleaseId);
    expect(flag.severity).toBe("CRITICAL");
    expect(flag.source).toBe("PRODUCTION_INCIDENT");
    expect(flag.description).toContain("Checkout endpoint returning 500s");
    expect(flag.description).toContain("https://example.pagerduty.com/incidents/Q123");
  });

  it("maps a low-urgency incident to MEDIUM severity", async () => {
    const result = await handlePagerDutyWebhook(prisma, {
      event: {
        event_type: "incident.triggered",
        data: { id: "Q124", title: "Minor latency spike", urgency: "low", service: { id: `PDSVC-${RUN}` } },
      },
    });
    const flag = await prisma.riskFlag.findUniqueOrThrow({ where: { id: result.riskFlagId! } });
    expect(flag.severity).toBe("MEDIUM");
  });

  it("reports no SHIPPED release rather than attaching to the wrong one when a project has none", async () => {
    const noReleaseProject = await prisma.project.create({
      data: { organizationId: orgId, name: "No release yet", slug: "no-release", pagerdutyServiceId: `PDSVC-none-${RUN}` },
    });
    const result = await handlePagerDutyWebhook(prisma, {
      event: {
        event_type: "incident.triggered",
        data: { title: "x", urgency: "high", service: { id: `PDSVC-none-${RUN}` } },
      },
    });
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no SHIPPED release/);
    await prisma.project.delete({ where: { id: noReleaseProject.id } });
  });
});
