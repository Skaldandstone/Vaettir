// P9-04 (Datadog half): real-DB proof of the same properties already
// verified for the PagerDuty half - routing to the right project, landing
// on the most recently updated SHIPPED release, correct severity mapping -
// plus the one genuinely new property this half needs: two different orgs
// that happen to pick the same project tag value never cross-contaminate,
// since a Datadog tag (unlike PagerDuty's real service id) is only unique
// within one org's own choices.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { handleDatadogWebhook } from "./datadogWebhook.js";

const RUN = `datadog-${randomUUID()}`;
let orgAId: string;
let orgBId: string;
let projectAId: string;
let projectBId: string;
let shippedReleaseId: string;

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const [orgA, orgB] = await Promise.all([
    prisma.organization.create({ data: { name: `Datadog test A ${RUN}`, slug: `${RUN}-a`, planTierId: tier.id } }),
    prisma.organization.create({ data: { name: `Datadog test B ${RUN}`, slug: `${RUN}-b`, planTierId: tier.id } }),
  ]);
  orgAId = orgA.id;
  orgBId = orgB.id;
  const [projectA, projectB] = await Promise.all([
    prisma.project.create({ data: { organizationId: orgAId, name: "Project A", slug: "project-a", datadogProjectTag: "myapp" } }),
    prisma.project.create({ data: { organizationId: orgBId, name: "Project B", slug: "project-b", datadogProjectTag: "myapp" } }),
  ]);
  projectAId = projectA.id;
  projectBId = projectB.id;
  const shipped = await prisma.release.create({ data: { projectId: projectAId, name: "v1.0", status: "SHIPPED" } });
  shippedReleaseId = shipped.id;
  const older = await prisma.release.create({ data: { projectId: projectAId, name: "v0.9", status: "SHIPPED" } });
  await prisma.release.update({ where: { id: older.id }, data: { updatedAt: new Date(Date.now() - 60_000) } });
});

afterAll(async () => {
  if (!orgAId) return;
  await prisma.riskFlag.deleteMany({ where: { release: { projectId: { in: [projectAId, projectBId] } } } });
  await prisma.release.deleteMany({ where: { projectId: { in: [projectAId, projectBId] } } });
  await prisma.project.deleteMany({ where: { organizationId: { in: [orgAId, orgBId] } } });
  await prisma.organization.deleteMany({ where: { id: { in: [orgAId, orgBId] } } });
});

describe("handleDatadogWebhook (real DB)", () => {
  it("ignores a Recovered transition - nothing to flag", async () => {
    const result = await handleDatadogWebhook(prisma, orgAId, { transition: "Recovered", projectTag: "myapp", priority: "P1" });
    expect(result).toEqual({ handled: false, reason: "ignored transition: Recovered" });
  });

  it("reports no project when the tag doesn't match anything in this org", async () => {
    const result = await handleDatadogWebhook(prisma, orgAId, { transition: "Triggered", projectTag: "unknown-tag" });
    expect(result.handled).toBe(false);
    expect(result.reason).toMatch(/no project in this org/);
  });

  it("never cross-contaminates org B even though both orgs use the same tag value", async () => {
    const result = await handleDatadogWebhook(prisma, orgAId, {
      transition: "Triggered",
      projectTag: "myapp",
      priority: "P1",
      title: "High CPU on checkout service",
    });
    expect(result.handled).toBe(true);

    const flag = await prisma.riskFlag.findUniqueOrThrow({ where: { id: result.riskFlagId! } });
    expect(flag.releaseId).toBe(shippedReleaseId);
    expect(flag.severity).toBe("CRITICAL");
    expect(flag.source).toBe("PRODUCTION_INCIDENT");
    expect(flag.description).toContain("High CPU on checkout service");

    const flagsForB = await prisma.riskFlag.findMany({ where: { release: { projectId: projectBId } } });
    expect(flagsForB).toHaveLength(0);
  });

  it("maps P3 to HIGH and P4/P5 to MEDIUM", async () => {
    const p3 = await handleDatadogWebhook(prisma, orgAId, { transition: "Re-Triggered", projectTag: "myapp", priority: "P3" });
    const p5 = await handleDatadogWebhook(prisma, orgAId, { transition: "Triggered", projectTag: "myapp", priority: "P5" });
    const flagP3 = await prisma.riskFlag.findUniqueOrThrow({ where: { id: p3.riskFlagId! } });
    const flagP5 = await prisma.riskFlag.findUniqueOrThrow({ where: { id: p5.riskFlagId! } });
    expect(flagP3.severity).toBe("HIGH");
    expect(flagP5.severity).toBe("MEDIUM");
  });
});
