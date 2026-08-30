import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";
import { bootstrapBetaOrganization, enrollBetaOwner } from "./privateBeta.js";
import { chargeAiCredits, getAiCreditBalance, grantMonthlyCreditsIfNeeded } from "./aiCredits.js";
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

  it("serializes cohort reservations at three teams", async () => {
    const outcomes = await Promise.allSettled(Array.from({ length: 5 }, (_, n) => enrollBetaOwner(prisma, `${run}-invite${n}@example.com`, "test-staff", run)));
    for (const result of outcomes) if (result.status === "fulfilled") enrollmentIds.push(result.value.id);
    expect(outcomes.filter((result) => result.status === "fulfilled")).toHaveLength(2);
    expect(outcomes.filter((result) => result.status === "rejected")).toHaveLength(3);
  });

  it("never double-grants or double-charges the same operation", async () => {
    await Promise.all(Array.from({ length: 8 }, () => grantMonthlyCreditsIfNeeded(prisma, orgId)));
    expect(await getAiCreditBalance(prisma, orgId)).toBe(500);
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgId, type: "GRANT" } })).toBe(1);
    await Promise.all(Array.from({ length: 8 }, () => chargeAiCredits(prisma, orgId, "generateQaStrategyDraft", "test", "same-operation")));
    expect(await getAiCreditBalance(prisma, orgId)).toBe(490);
    await expect(chargeAiCredits(prisma, orgId, "assessTestCaseRisk", "test", "same-operation")).rejects.toThrow("different operation");
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
