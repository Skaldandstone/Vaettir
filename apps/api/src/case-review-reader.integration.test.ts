import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { caseReviewRouter } from "./routers/caseReview.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");
describe.skipIf(!isolated)("native case review reader against real PostgreSQL", () => {
  let owner: ReturnType<typeof caseReviewRouter.createCaller>, viewer: typeof owner;
  let projectId: string, caseId: string, otherProjectId: string;
  const suffix = randomUUID();
  beforeAll(async () => {
    const tier = await prisma.planTier.upsert({ where: { key: "free" }, update: {}, create: { key: "free", name: "Synthetic free tier", sortOrder: 0, minFullSeats: 0 } });
    const organization = await prisma.organization.create({ data: { name: "Synthetic case reader", slug: `reader-${suffix}`, planTierId: tier.id } });
    projectId = (await prisma.project.create({ data: { organizationId: organization.id, name: "Synthetic reader", slug: `reader-${suffix}` } })).id;
    otherProjectId = (await prisma.project.create({ data: { organizationId: organization.id, name: "Other synthetic project", slug: `other-${suffix}` } })).id;
    const current = await prisma.testCase.create({ data: { projectId, title: "Synthetic imported case", origin: "IMPORTED", reviewStatus: "PENDING_REVIEW", testType: "FUNCTIONAL", given: ["  literal setup  "], when: ["synthetic action"], then: ["synthetic result"], tags: [], steps: { create: { order: 0, action: "  literal action  ", expectedResult: "synthetic result" } } } });
    caseId = current.id;
    async function actor(role: "OWNER" | "VIEWER") {
      const subject = `${suffix}-${role}`;
      const user = await prisma.user.create({ data: { email: `${subject}@example.invalid`, clerkUserId: subject, memberships: { create: { organizationId: organization.id, role, seatType: role === "OWNER" ? "FULL" : "READ_ONLY" } } }, include: { memberships: true } });
      return caseReviewRouter.createCaller({ prisma, user, authenticatedClerkSubject: subject });
    }
    owner = await actor("OWNER"); viewer = await actor("VIEWER");
  });

  it("returns current access and a complete pending-case preview without deciding or changing the case", async () => {
    const access = await owner.access({ projectId, requestId: randomUUID() });
    expect(access.canRecover).toBe(true);
    const preview = await owner.preview({ projectId, caseId, requestId: randomUUID(), originalOrganizationId: access.readScope.organizationId, expectedClerkActorId: access.readScope.actorClerkUserId, expectedNativeActorId: access.readScope.actorId });
    expect(preview).toMatchObject({ supported: true, canDecide: true, blockedReason: null, snapshot: { kind: "CaseReviewSnapshot/v2", case: { id: caseId, given: ["  literal setup  "] }, effectiveSteps: [{ order: 0, action: "  literal action  ", expectedResult: "synthetic result" }] } });
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).toMatchObject({ reviewStatus: "PENDING_REVIEW", reviewedById: null, reviewNote: null });
    expect(await prisma.auditLog.count({ where: { projectId, entityType: "CaseReviewDecision/v1" } })).toBe(0);
  });

  it("keeps read-only decisions disabled and refuses a case from another project", async () => {
    expect(await viewer.access({ projectId, requestId: randomUUID() })).toMatchObject({ canRecover: false });
    const preview = await viewer.preview({ projectId, caseId, requestId: randomUUID() });
    expect(preview).toMatchObject({ supported: true, canDecide: false });
    await expect(viewer.decide({ projectId, caseId, originalOrganizationId: preview.readScope.organizationId, expectedClerkActorId: preview.readScope.actorClerkUserId, expectedNativeActorId: preview.readScope.actorId, expectedContentHash: preview.contentHash!, expectedReviewStateHash: preview.reviewStateHash!, decision: "APPROVED", note: { operation: "KEEP" }, requestId: randomUUID(), confirmed: true })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: caseId } })).toMatchObject({ reviewStatus: "PENDING_REVIEW", reviewedById: null });
    await expect(owner.preview({ projectId: otherProjectId, caseId, requestId: randomUUID() })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});
