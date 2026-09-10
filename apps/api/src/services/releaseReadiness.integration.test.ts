// P8-04 (release-readiness state changes): real-DB proof of the snapshot +
// notify flow against a fully isolated throwaway org. Outbound HTTP (Slack
// webhook, generic webhook endpoint, Expo push) is captured by stubbing
// global fetch, so this asserts the exact three deliveries a label change
// produces without any network.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@vaettir/db";
import { recordReadinessSnapshot } from "./releaseReadiness.js";
import { appRouter } from "../router.js";

const RUN = `readiness-change-${randomUUID()}`;
let orgId: string;
let userId: string;
let releaseId: string;
let testPlanId: string;

type CapturedCall = { url: string; body: unknown };
const calls: CapturedCall[] = [];

beforeAll(async () => {
  const tier = await prisma.planTier.findFirstOrThrow();
  const org = await prisma.organization.create({
    data: {
      name: `Readiness change test ${RUN}`,
      slug: RUN,
      planTierId: tier.id,
      slackWebhookUrl: "https://hooks.slack.com/services/T000/B000/test",
      slackEventTypes: ["release.readiness_changed"],
    },
  });
  orgId = org.id;
  const user = await prisma.user.create({ data: { clerkUserId: `${RUN}-owner`, email: `${RUN}@example.com` } });
  userId = user.id;
  await prisma.membership.create({ data: { organizationId: orgId, userId, role: "OWNER" } });
  await prisma.pushToken.create({ data: { userId, token: `ExponentPushToken[${RUN}]`, platform: "test" } });
  await prisma.webhookEndpoint.create({
    data: {
      organizationId: orgId,
      url: "https://example.com/vaettir-hook",
      secret: "whsec_test",
      eventTypes: ["release.readiness_changed"],
      createdById: userId,
    },
  });

  const project = await prisma.project.create({ data: { organizationId: orgId, name: "Readiness project", slug: RUN } });
  const release = await prisma.release.create({ data: { projectId: project.id, name: "v9.9", status: "IN_TESTING" } });
  releaseId = release.id;
  const planType = await prisma.testPlanType.findFirstOrThrow();
  const plan = await prisma.testPlan.create({
    data: { projectId: project.id, testPlanTypeId: planType.id, releaseId, name: "plan" },
  });
  testPlanId = plan.id;
  // Two MET criteria, no flags -> score 100, READY.
  await prisma.acceptanceCriterion.createMany({
    data: [
      { testPlanId, description: "a", status: "MET" },
      { testPlanId, description: "b", status: "MET" },
    ],
  });

  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const isExpo = url.startsWith("https://exp.host/");
      return new Response(JSON.stringify(isExpo ? { data: [{ status: "ok", id: "t1" }] } : { ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
});

afterAll(async () => {
  vi.unstubAllGlobals();
  await prisma.releaseReadinessSnapshot.deleteMany({ where: { releaseId } });
  await prisma.webhookDelivery.deleteMany({ where: { webhookEndpoint: { organizationId: orgId } } });
  await prisma.webhookEndpoint.deleteMany({ where: { organizationId: orgId } });
  await prisma.riskFlag.deleteMany({ where: { releaseId } });
  await prisma.acceptanceCriterion.deleteMany({ where: { testPlanId } });
  await prisma.testPlan.deleteMany({ where: { id: testPlanId } });
  await prisma.release.deleteMany({ where: { id: releaseId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.pushToken.deleteMany({ where: { userId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.organization.delete({ where: { id: orgId } });
  await prisma.user.delete({ where: { id: userId } });
});

describe("recordReadinessSnapshot (real DB)", () => {
  it("records a baseline on first sight and does not notify", async () => {
    const r = await recordReadinessSnapshot(prisma, releaseId);
    expect(r.transition).toBe("baseline");
    expect(r.readiness.label).toBe("READY");
    expect(await prisma.releaseReadinessSnapshot.count({ where: { releaseId } })).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("is idempotent while nothing changed", async () => {
    const r = await recordReadinessSnapshot(prisma, releaseId);
    expect(r.transition).toBe("unchanged");
    expect(await prisma.releaseReadinessSnapshot.count({ where: { releaseId } })).toBe(1);
    expect(calls).toHaveLength(0);
  });

  it("records a score-only move without notifying", async () => {
    // One LOW flag: -2 -> 98, still READY.
    await prisma.riskFlag.create({ data: { releaseId, severity: "LOW", source: "MANUAL_FLAG", description: "minor" } });
    const r = await recordReadinessSnapshot(prisma, releaseId);
    expect(r.transition).toBe("score_changed");
    expect(r.readiness).toMatchObject({ score: 98, label: "READY" });
    expect(await prisma.releaseReadinessSnapshot.count({ where: { releaseId } })).toBe(2);
    expect(calls).toHaveLength(0);
  });

  it("notifies webhook, Slack and push exactly once when the label changes", async () => {
    // A CRITICAL flag forces BLOCKED regardless of score.
    await prisma.riskFlag.create({ data: { releaseId, severity: "CRITICAL", source: "MANUAL_FLAG", description: "outage" } });
    const r = await recordReadinessSnapshot(prisma, releaseId);
    expect(r.transition).toBe("label_changed");
    expect(r.readiness.label).toBe("BLOCKED");

    const latest = await prisma.releaseReadinessSnapshot.findFirstOrThrow({ where: { releaseId }, orderBy: { computedAt: "desc" } });
    expect(latest).toMatchObject({ label: "BLOCKED", previousLabel: "READY", openRiskFlags: 2, criteriaMet: 2, criteriaTotal: 2 });

    const urls = calls.map((c) => c.url).sort();
    expect(urls).toEqual(["https://example.com/vaettir-hook", "https://exp.host/--/api/v2/push/send", "https://hooks.slack.com/services/T000/B000/test"]);

    const webhook = calls.find((c) => c.url === "https://example.com/vaettir-hook")!.body as { event: string; data: Record<string, unknown> };
    expect(webhook.event).toBe("release.readiness_changed");
    expect(webhook.data).toMatchObject({ releaseName: "v9.9", previousLabel: "READY", label: "BLOCKED", previousScore: 98 });

    const slack = calls.find((c) => c.url.startsWith("https://hooks.slack.com/"))!.body as { text: string };
    expect(slack.text).toContain("READY → BLOCKED");

    const push = calls.find((c) => c.url.startsWith("https://exp.host/"))!.body as Array<{ to: string; title: string; data: { type: string } }>;
    expect(push).toHaveLength(1);
    expect(push[0]!.to).toBe(`ExponentPushToken[${RUN}]`);
    expect(push[0]!.title).toBe("v9.9 is now BLOCKED");
    expect(push[0]!.data.type).toBe("release.readiness_changed");

    // The delivery is also on the books, like every other webhook event.
    const deliveries = await prisma.webhookDelivery.findMany({ where: { webhookEndpoint: { organizationId: orgId } } });
    expect(deliveries).toHaveLength(1);
    expect(deliveries[0]!.success).toBe(true);
  });

  it("fires within seconds of a mutation through the real router, not just the sweep", async () => {
    calls.length = 0;
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
    const caller = appRouter.createCaller({ prisma, user, staff: null });
    const criterion = await prisma.acceptanceCriterion.findFirstOrThrow({ where: { testPlanId } });
    // Currently BLOCKED (critical flag open). Flip one MET criterion to
    // NOT_MET: still BLOCKED (critical flag) - a score-only move, silent.
    await caller.testPlans.updateAcceptanceCriterion({ id: criterion.id, description: criterion.description, status: "NOT_MET" });
    // Then resolve the flags through the router: BLOCKED -> AT_RISK (50) fires.
    const flags = await prisma.riskFlag.findMany({ where: { releaseId, resolvedAt: null } });
    for (const f of flags) await caller.releases.resolveRiskFlag({ id: f.id, resolved: true });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !calls.some((c) => c.url.startsWith("https://exp.host/"))) {
      await new Promise((r) => setTimeout(r, 50));
    }
    const latest = await prisma.releaseReadinessSnapshot.findFirstOrThrow({ where: { releaseId }, orderBy: { computedAt: "desc" } });
    expect(latest).toMatchObject({ label: "AT_RISK", score: 50, previousLabel: "BLOCKED" });
    expect(calls.map((c) => c.url).filter((u) => u.startsWith("https://exp.host/"))).toHaveLength(1);
    // Restore for the next test: criterion back to MET (READY, fires; wait
    // for it), then re-open the flags without notifying so the next test
    // starts from BLOCKED exactly as before this one ran.
    await caller.testPlans.updateAcceptanceCriterion({ id: criterion.id, description: criterion.description, status: "MET" });
    await new Promise((r) => setTimeout(r, 750));
    await prisma.riskFlag.updateMany({ where: { releaseId }, data: { resolvedAt: null } });
    await recordReadinessSnapshot(prisma, releaseId, { notify: false });
  });

  it("notifies again on the way back up, and stays quiet once stable", async () => {
    calls.length = 0;
    await prisma.riskFlag.updateMany({ where: { releaseId }, data: { resolvedAt: new Date() } });
    const back = await recordReadinessSnapshot(prisma, releaseId);
    expect(back.transition).toBe("label_changed");
    expect(back.readiness).toMatchObject({ score: 100, label: "READY" });
    expect(calls.map((c) => c.url)).toHaveLength(3);

    calls.length = 0;
    const quiet = await recordReadinessSnapshot(prisma, releaseId);
    expect(quiet.transition).toBe("unchanged");
    expect(calls).toHaveLength(0);
  });
});
