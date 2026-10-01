import { afterEach, describe, expect, it, vi } from "vitest";
import { signalRoutingRouter } from "./signalRouting.js";
import type { Context } from "../trpc.js";

function fixture({ role = "OWNER", seatType = "FULL", liveMember = true, suspended = false } = {}) {
  const project = { id: "project-a", organizationId: "org-a" };
  const membership = { role, seatType, userId: "user-a", organizationId: "org-a" };
  const db = {
    project: { findUnique: vi.fn().mockResolvedValue(project), findUniqueOrThrow: vi.fn().mockResolvedValue({ pagerdutyServiceId: "SERVICE-A", datadogProjectTag: "checkout" }) },
    membership: { findUnique: vi.fn().mockResolvedValue(liveMember ? membership : null) },
    organization: { findUnique: vi.fn().mockResolvedValue({ suspendedAt: suspended ? new Date() : null }), findUniqueOrThrow: vi.fn().mockResolvedValue({ datadogWebhookSecret: "private-datadog-signing-secret" }) },
    release: { findFirst: vi.fn().mockResolvedValue({ id: "release-a", name: "Approved release" }) },
  };
  const user = { id: "user-a", memberships: [membership] };
  const caller = signalRoutingRouter.createCaller({ prisma: db, user } as unknown as Context);
  return { caller, db, user };
}

afterEach(() => vi.unstubAllEnvs());

describe("signal routing setup visibility", () => {
  it("returns only readiness booleans, exact tenant route and a shipped destination, never a secret or delivery claim", async () => {
    vi.stubEnv("PAGERDUTY_WEBHOOK_SECRET", "private-pagerduty-signing-secret");
    const { caller, db } = fixture();
    const result = await caller.readiness({ projectId: "project-a" });
    expect(result.pagerduty).toEqual({ route: "SERVICE-A", secretConfigured: true, endpointPath: "/webhooks/pagerduty" });
    expect(result.datadog).toEqual({ route: "checkout", secretConfigured: true, endpointPath: "/webhooks/datadog/org-a" });
    expect(result.deliveryVerified).toBe(false);
    expect(JSON.stringify(result)).not.toContain("private-");
    expect(db.release.findFirst).toHaveBeenCalledWith({ where: { projectId: "project-a", status: "SHIPPED" }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true } });
  });

  it("reports missing signing setup and release independently of a saved route", async () => {
    vi.stubEnv("PAGERDUTY_WEBHOOK_SECRET", "");
    const { caller, db } = fixture();
    db.organization.findUniqueOrThrow.mockResolvedValue({ datadogWebhookSecret: null });
    db.release.findFirst.mockResolvedValue(null);
    const result = await caller.readiness({ projectId: "project-a" });
    expect(result.shippedRelease).toBeNull();
    expect(result.pagerduty.secretConfigured).toBe(false);
    expect(result.datadog.secretConfigured).toBe(false);
    expect(result.deliveryVerified).toBe(false);
  });

  it.each([["VIEWER", "FULL", false, false], ["COMPLIANCE_AUDITOR", "FULL", false, false], ["EDITOR", "FULL", true, false], ["ADMIN", "READ_ONLY", false, false]])("role %s / %s exposes honest editing capabilities", async (role, seatType, canEdit, canConfigureSecret) => {
    const { caller } = fixture({ role, seatType });
    const result = await caller.readiness({ projectId: "project-a" });
    expect(result.canEdit).toBe(canEdit);
    expect(result.canConfigureSecret).toBe(canConfigureSecret);
  });

  it("checks live role even when caller retains old owner authority", async () => {
    const { caller, db } = fixture();
    db.membership.findUnique.mockResolvedValue({ role: "VIEWER", seatType: "FULL" });
    const result = await caller.readiness({ projectId: "project-a" });
    expect(result.canEdit).toBe(false);
    expect(result.canConfigureSecret).toBe(false);
  });

  it("rejects revoked membership before reading any signing configuration", async () => {
    const { caller, db } = fixture({ liveMember: false });
    await expect(caller.readiness({ projectId: "project-a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(db.organization.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it("rejects foreign tenants and suspension before readiness disclosure", async () => {
    const foreign = fixture();
    foreign.user.memberships[0]!.organizationId = "org-b";
    await expect(foreign.caller.readiness({ projectId: "project-a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(foreign.db.membership.findUnique).not.toHaveBeenCalled();
    const suspended = fixture({ suspended: true });
    await expect(suspended.caller.readiness({ projectId: "project-a" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(suspended.db.organization.findUniqueOrThrow).not.toHaveBeenCalled();
  });
});
