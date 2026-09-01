import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";
import { bootstrapBetaOrganization, enrollBetaOwner, revokeBetaEnrollment } from "./privateBeta.js";
import { adjustAiCredits, chargeAiCredits, creditMonth, getAiCreditBalance, grantMonthlyCreditsIfNeeded } from "./aiCredits.js";
import { acceptInvitation, inviteMember, updateMember } from "./seatManagement.js";

const run = `beta-${randomUUID()}`;
const orgIds: string[] = [];
const userIds: string[] = [];
const enrollmentIds: string[] = [];
let owner: { id: string; email: string };
let orgId: string;

async function user(suffix: string) {
  const result = await prisma.user.create({ data: { clerkUserId: `${run}-${suffix}`, email: `${run}-${suffix}@example.com` } });
  userIds.push(result.id);
  return result;
}
async function caller(userId: string) {
  const current = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
  return appRouter.createCaller({ prisma, user: current });
}

beforeAll(async () => {
  owner = await user("owner");
  const enrollment = await enrollBetaOwner(prisma, owner.email, "test-staff", run);
  enrollmentIds.push(enrollment.id);
  const org = await bootstrapBetaOrganization(prisma, owner, run);
  orgId = org.id; orgIds.push(org.id);
});

afterAll(async () => {
  // Exact IDs only, including cleanup after a failed partial setup.
  if (orgIds.length) {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.invitation.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.aiCreditTransaction.deleteMany({ where: { organizationId: { in: orgIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: orgIds } } });
  }
  if (enrollmentIds.length) await prisma.betaEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
});

describe.sequential("Private beta boundaries", () => {
  it("requires an enrollment and never exposes the beta tier publicly", async () => {
    const outsider = await user("outsider");
    await expect(bootstrapBetaOrganization(prisma, outsider, "Uninvited")).rejects.toMatchObject({ code: "FORBIDDEN" });
    const tiers = await (await caller(owner.id)).organization.listPlanTiers();
    expect(tiers.some((tier) => tier.key === "private-beta")).toBe(false);
    await expect((await caller(owner.id)).beta.enroll({ email: "blocked@example.com", reason: run })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect((await caller(owner.id)).organization.changePlanTier({ organizationId: orgId, planTierId: tiers[0].id })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("lets the Studio service reserve an alpha owner slot idempotently", async () => {
    const studio = appRouter.createCaller({ prisma, user: null, staff: { actor: "invitation-review" } });
    const email = `${run}-studio@example.com`;
    const requestId = randomUUID();
    const first = await studio.beta.enrollFromStudio({ email, requestId });
    enrollmentIds.push(first.id);
    const retried = await studio.beta.enrollFromStudio({ email, requestId });
    expect(retried.id).toBe(first.id);
    expect(first.email).toBe(email);
    const stored = await prisma.betaEnrollment.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored.createdBy).toBe("studio:invitation-review");
    expect(stored.reason).toBe(`Studio access request ${requestId}`);

    const anonymous = appRouter.createCaller({ prisma, user: null, staff: null });
    await expect(anonymous.beta.enrollFromStudio({ email: `${run}-denied@example.com`, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(studio.beta.revokeFromStudio({ enrollmentId: first.id, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    const revoked = await studio.beta.revokeFromStudio({ enrollmentId: first.id, requestId });
    expect(revoked.revokedAt).not.toBeNull();
    await prisma.betaEnrollment.delete({ where: { id: first.id } });
  });

  it("serializes cohort reservations at three teams", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, n) => enrollBetaOwner(prisma, `${run}-invite${n}@example.com`, "test-staff", run)));
    for (const result of outcomes) if (result.status === "fulfilled") enrollmentIds.push(result.value.id);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(3);
  });

  it("rechecks claimed enrollment after waiting for a simultaneous claim", async () => {
    const pending = await prisma.betaEnrollment.findFirstOrThrow({ where: { id: { in: enrollmentIds }, claimedAt: null } });
    const invitee = await user("claim-race");
    invitee.email = pending.email;
    await prisma.user.update({ where: { id: invitee.id }, data: { email: invitee.email } });
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${invitee.id} FOR UPDATE`;
      locked();
      await barrier;
    }, { timeout: 20000 });
    const waitForLock = async (query: string) => {
      await expect.poll(async () => (await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query LIKE ${query}
      `)[0].count > 0n, { timeout: 4000 }).toBe(true);
    };
    await ready;
    let results: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const claim = bootstrapBetaOrganization(prisma, invitee, "Claim race").then((org) => { orgIds.push(org.id); return org; });
      // Claim holds the enrollment row and is now waiting on this test's user lock.
      await waitForLock('SELECT "id" FROM "User" WHERE%');
      const revoke = revokeBetaEnrollment(prisma, pending.id);
      results = Promise.allSettled([claim, revoke]);
      await waitForLock('SELECT "id" FROM "PlanTier" WHERE%');
    } finally {
      release();
      await blocker;
    }
    const settled = await results!;
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "BAD_REQUEST" } });
    const enrollment = await prisma.betaEnrollment.findUniqueOrThrow({ where: { id: pending.id } });
    expect(enrollment.claimedAt).not.toBeNull();
    expect(enrollment.revokedAt).toBeNull();
  }, 30000);

  it("does not admit a waiting claim after revocation wins, and releases exactly one cohort slot", async () => {
    const pending = await prisma.betaEnrollment.findFirstOrThrow({ where: { id: { in: enrollmentIds }, claimedAt: null, revokedAt: null } });
    const invitee = await user("revoke-race");
    invitee.email = pending.email;
    await prisma.user.update({ where: { id: invitee.id }, data: { email: invitee.email } });
    let release!: () => void, locked!: () => void;
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const barrier = new Promise<void>((resolve) => { release = resolve; });
    const blocker = prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "BetaEnrollment" WHERE "id" = ${pending.id} FOR UPDATE`;
      locked(); await barrier;
    }, { timeout: 20000 });
    const waitForLock = async (query: string) => {
      await expect.poll(async () => (await prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*) AS count FROM pg_stat_activity WHERE datname = current_database()
        AND wait_event_type = 'Lock' AND query LIKE ${query}
      `)[0].count > 0n, { timeout: 4000 }).toBe(true);
    };
    await ready;
    let results: Promise<PromiseSettledResult<unknown>[]> | undefined;
    try {
      const revoke = revokeBetaEnrollment(prisma, pending.id);
      await waitForLock('SELECT "id" FROM "BetaEnrollment" WHERE "id"%');
      const claim = bootstrapBetaOrganization(prisma, invitee, "Must not exist").then((org) => { orgIds.push(org.id); return org; });
      results = Promise.allSettled([revoke, claim]);
      await waitForLock('SELECT "id" FROM "PlanTier" WHERE%');
    } finally { release(); await blocker; }
    const settled = await results!;
    expect(settled[0].status).toBe("fulfilled");
    expect(settled[1]).toMatchObject({ status: "rejected", reason: { code: "FORBIDDEN" } });
    expect(await prisma.membership.count({ where: { userId: invitee.id } })).toBe(0);
    const replacement = await enrollBetaOwner(prisma, `${run}-replacement@example.com`, "fixture", "replaces revoked reservation");
    enrollmentIds.push(replacement.id);
    expect(await prisma.betaEnrollment.count({ where: { revokedAt: null } })).toBe(3);
  }, 30000);

  it("never double-grants or double-charges the same operation", async () => {
    await Promise.all(Array.from({ length: 8 }, () => grantMonthlyCreditsIfNeeded(prisma, orgId)));
    expect(await getAiCreditBalance(prisma, orgId)).toBe(500);
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgId, type: "GRANT" } })).toBe(1);
    await Promise.all(Array.from({ length: 8 }, () => chargeAiCredits(prisma, orgId, "generateQaStrategyDraft", "test", "same-operation")));
    expect(await getAiCreditBalance(prisma, orgId)).toBe(490);
    await expect(chargeAiCredits(prisma, orgId, "assessTestCaseRisk", "test", "same-operation")).rejects.toThrow("different operation");
  });

  it("uses the month idempotency key even if a transaction began before the month boundary", async () => {
    const grant = await prisma.aiCreditTransaction.findFirstOrThrow({ where: { organizationId: orgId, type: "GRANT" } });
    await prisma.aiCreditTransaction.update({ where: { id: grant.id }, data: { createdAt: new Date(creditMonth().getTime() - 1) } });
    expect(await getAiCreditBalance(prisma, orgId)).toBe(490);
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgId, type: "GRANT" } })).toBe(1);
  });

  it("expires old beta allowance without modifying historical rows", async () => {
    const old = await prisma.aiCreditTransaction.findMany({ where: { organizationId: orgId } });
    const oldDate = new Date("2026-01-01T00:00:00Z");
    // Test-only time travel. Production code only appends ledger entries.
    await prisma.aiCreditTransaction.updateMany({ where: { organizationId: orgId }, data: { createdAt: oldDate, idempotencyKey: null } });
    expect(await getAiCreditBalance(prisma, orgId)).toBe(500);
    for (const row of old) expect((await prisma.aiCreditTransaction.findUniqueOrThrow({ where: { id: row.id } })).amount).toBe(row.amount);
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgId, type: "ADJUSTMENT", amount: -490 } })).toBe(1);
  });

  it("rejects competing calls at the last credits without overdrawing", async () => {
    await prisma.aiCreditTransaction.create({ data: { organizationId: orgId, type: "ADJUSTMENT", amount: -494, description: "test drain" } });
    const calls = await Promise.allSettled(Array.from({ length: 12 }, (_, n) => chargeAiCredits(prisma, orgId, "reverseEngineerTestFile", "test", `race-${n}`)));
    expect(calls.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await getAiCreditBalance(prisma, orgId)).toBe(0);
  });

  it("serializes audited staff adjustments without allowing concurrent overdrafts", async () => {
    await adjustAiCredits(prisma, orgId, 10, "[staff:fixture] ten-credit top-up");
    const results = await Promise.allSettled(Array.from({ length: 4 }, () => adjustAiCredits(prisma, orgId, -6, "[staff:fixture] bounded deduction")));
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await getAiCreditBalance(prisma, orgId)).toBe(4);
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgId, description: "[staff:fixture] bounded deduction" } })).toBe(1);
  });

  it("reserves only the remaining four full seats under concurrent invitations", async () => {
    const invitations = await Promise.allSettled(Array.from({ length: 9 }, (_, n) => inviteMember(prisma, owner.id, {
      organizationId: orgId, email: `${run}-member${n}@example.com`, role: "EDITOR", seatType: "FULL",
    })));
    expect(invitations.filter((result) => result.status === "fulfilled")).toHaveLength(4);
    const pending = await prisma.invitation.findMany({ where: { organizationId: orgId, status: "PENDING" } });
    for (const [n, invite] of pending.entries()) {
      const member = await user(`accept${n}`);
      await prisma.user.update({ where: { id: member.id }, data: { email: invite.email } });
      const outcomes = await Promise.allSettled(Array.from({ length: 2 }, () => acceptInvitation(prisma, { id: member.id, email: invite.email }, invite.token)));
      expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    }
    expect(await prisma.membership.count({ where: { organizationId: orgId, seatType: "FULL" } })).toBe(5);
  });

  it("enforces read-only capacity even when converting full members", async () => {
    const members = await prisma.membership.findMany({ where: { organizationId: orgId, role: "EDITOR" } });
    const changes = await Promise.allSettled(members.map((member) => updateMember(prisma, owner.id, { membershipId: member.id, role: "VIEWER", seatType: "READ_ONLY" })));
    expect(changes.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(await prisma.membership.count({ where: { organizationId: orgId, seatType: "READ_ONLY" } })).toBe(2);
  });

  it("rejects stale revoked admin contexts and suspended organizations", async () => {
    const member = await user("revoked-admin");
    const membership = await prisma.membership.create({ data: { organizationId: orgId, userId: member.id, role: "ADMIN" } });
    const stale = await caller(member.id);
    await prisma.membership.delete({ where: { id: membership.id } });
    await expect(stale.organization.inviteMember({ organizationId: orgId, email: `${run}-denied@example.com`, role: "VIEWER" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    await expect(chargeAiCredits(prisma, orgId, "assessTestCaseRisk")).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(inviteMember(prisma, owner.id, { organizationId: orgId, email: "no@example.com", role: "VIEWER", seatType: "FULL" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
