import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";
import { BETA_TEAM_LIMIT, bootstrapBetaOrganization, enrollBetaOwner } from "./privateBeta.js";

const run = `beta-forward-port-${randomUUID()}`;
const organizationIds: string[] = [];
const userIds: string[] = [];
const enrollmentIds: string[] = [];
let ownerId: string;
let ownerEmail: string;
let ownerRequestId: string;
let ownerEnrollmentId: string;
let organizationId: string;

async function createUser(suffix: string, email = `${run}-${suffix}@example.com`) {
  const user = await prisma.user.create({
    data: { clerkUserId: `${run}-${suffix}`, email },
  });
  userIds.push(user.id);
  return user;
}

async function callerFor(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } });
  return appRouter.createCaller({ prisma, user, staff: null });
}

function studioCaller(actor = "invitation-review") {
  return appRouter.createCaller({ prisma, user: null, staff: { actor } });
}

beforeAll(async () => {
  const owner = await createUser("owner");
  ownerId = owner.id;
  ownerEmail = owner.email;
  ownerRequestId = randomUUID();
  const enrollment = await studioCaller().beta.enrollFromStudio({ email: ownerEmail, requestId: ownerRequestId });
  ownerEnrollmentId = enrollment.id;
  enrollmentIds.push(enrollment.id);

  const organization = await (await callerFor(ownerId)).organization.bootstrap({ organizationName: `Beta ${run}` });
  organizationId = organization.id;
  organizationIds.push(organization.id);
});

afterAll(async () => {
  if (organizationIds.length > 0) {
    await prisma.auditLog.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.invitation.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.aiCreditTransaction.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.membership.deleteMany({ where: { organizationId: { in: organizationIds } } });
    await prisma.organization.deleteMany({ where: { id: { in: organizationIds } } });
  }
  if (enrollmentIds.length > 0) {
    await prisma.betaEnrollment.deleteMany({ where: { id: { in: enrollmentIds } } });
  }
  if (userIds.length > 0) {
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
});

describe.sequential("private-beta and Studio enrollment boundaries", () => {
  it("requires an enrollment, hides the tier, and prevents owner plan bypass", async () => {
    const outsider = await createUser("outsider");
    await expect((await callerFor(outsider.id)).organization.bootstrap({ organizationName: "Uninvited" }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    const owner = await callerFor(ownerId);
    const publicTiers = await owner.organization.listPlanTiers();
    expect(publicTiers.some((tier) => tier.key === "private-beta")).toBe(false);
    await expect(owner.organization.changePlanTier({ organizationId, planTierId: publicTiers[0].id }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.beta.enroll({ email: `${run}-blocked@example.com`, reason: run }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });

    const usage = await owner.organization.seatUsage({ organizationId });
    expect(usage).toMatchObject({
      privateBeta: true,
      fullSeatsIncluded: 5,
      readOnlySeatsIncluded: 2,
      readOnlySeatsMax: 2,
    });
    const credits = await owner.organization.aiCreditStatus({ organizationId });
    expect(credits.balance).toBe(500);
    expect(credits.includedPerMonth).toBe(500);
  });

  it("binds Studio retries and revocation to the immutable request id", async () => {
    const studio = studioCaller();
    const email = `${run}-studio@example.com`;
    const requestId = randomUUID();
    const first = await studio.beta.enrollFromStudio({ email, requestId });
    enrollmentIds.push(first.id);
    const retried = await studio.beta.enrollFromStudio({ email, requestId });
    expect(retried.id).toBe(first.id);
    const stored = await prisma.betaEnrollment.findUniqueOrThrow({ where: { id: first.id } });
    expect(stored).toMatchObject({
      email,
      studioRequestId: requestId,
      createdBy: "studio:invitation-review",
      reason: `Studio access request ${requestId}`,
    });

    await expect(studio.beta.enrollFromStudio({ email: `${run}-other@example.com`, requestId }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(studio.beta.enrollFromStudio({ email, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "CONFLICT" });
    await expect(studio.beta.revokeFromStudio({ enrollmentId: first.id, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "NOT_FOUND" });

    const revoked = await studio.beta.revokeFromStudio({ enrollmentId: first.id, requestId });
    expect(revoked.revokedAt).not.toBeNull();
    const repeated = await studio.beta.revokeFromStudio({ enrollmentId: first.id, requestId });
    expect(repeated.revokedAt).toEqual(revoked.revokedAt);

    const anonymous = appRouter.createCaller({ prisma, user: null, staff: null });
    await expect(anonymous.beta.enrollFromStudio({ email: `${run}-denied@example.com`, requestId: randomUUID() }))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(studio.beta.revokeFromStudio({ enrollmentId: ownerEnrollmentId, requestId: ownerRequestId }))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("rejects a revoked enrollment at the server-side creation gate", async () => {
    const user = await createUser("revoked-owner");
    const requestId = randomUUID();
    const enrollment = await studioCaller().beta.enrollFromStudio({ email: user.email, requestId });
    enrollmentIds.push(enrollment.id);
    await studioCaller().beta.revokeFromStudio({ enrollmentId: enrollment.id, requestId });
    await expect(bootstrapBetaOrganization(prisma, user, "Must not exist"))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.membership.count({ where: { userId: user.id } })).toBe(0);
  });

  it("serializes reservations at the three-team limit", async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) =>
        enrollBetaOwner(prisma, `${run}-team-${index}@example.com`, "test-staff", run),
      ),
    );
    for (const outcome of outcomes) {
      if (outcome.status === "fulfilled") enrollmentIds.push(outcome.value.id);
    }
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(BETA_TEAM_LIMIT - 1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(3);
    expect(await prisma.betaEnrollment.count({ where: { revokedAt: null } })).toBe(BETA_TEAM_LIMIT);
  });

  it("serializes pending invitations against private-beta seat limits", async () => {
    const owner = await callerFor(ownerId);
    const fullInvitations = await Promise.allSettled(
      Array.from({ length: 9 }, (_, index) => owner.organization.inviteMember({
        organizationId,
        email: `${run}-full-${index}@example.com`,
        role: "EDITOR",
        seatType: "FULL",
      })),
    );
    expect(fullInvitations.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(4);

    const readOnlyInvitations = await Promise.allSettled(
      Array.from({ length: 5 }, (_, index) => owner.organization.inviteMember({
        organizationId,
        email: `${run}-readonly-${index}@example.com`,
        role: "VIEWER",
        seatType: "READ_ONLY",
      })),
    );
    expect(readOnlyInvitations.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(2);

    const invitation = await prisma.invitation.findFirstOrThrow({
      where: { organizationId, status: "PENDING", seatType: "FULL" },
    });
    const invitee = await createUser("invitee", invitation.email);
    const acceptances = await Promise.allSettled([
      (await callerFor(invitee.id)).organization.acceptInvitation({ token: invitation.token }),
      (await callerFor(invitee.id)).organization.acceptInvitation({ token: invitation.token }),
    ]);
    expect(acceptances.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.membership.count({ where: { organizationId, seatType: "FULL" } })).toBe(2);
    expect(await prisma.invitation.count({ where: { organizationId, status: "PENDING", seatType: "FULL" } })).toBe(3);
  });

});
