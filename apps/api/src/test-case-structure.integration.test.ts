import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { prerequisiteRequestHash } from "./services/casePrerequisiteSchema.js";
import { manualCaseReviewedReadKey, type ManualCaseReviewedExactWrite } from "./services/manualCaseResultSchema.js";
import { manualCaseReviewedRequestHash } from "./services/manualCaseResultsReviewed.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname)
  && /test/i.test(url.pathname) && !url.searchParams.has("host");

describe.skipIf(!isolated)("case placement and prerequisite execution", () => {
  let owner: ReturnType<typeof appRouter.createCaller>;
  let viewer: ReturnType<typeof appRouter.createCaller>;
  let outsider: ReturnType<typeof appRouter.createCaller>;
  let projectId: string;
  let otherProjectId: string;
  let loginId: string;
  let premiumId: string;
  let checkoutId: string;
  let organizationId: string;
  let actorId: string;
  let viewerActorId: string;
  const key = `case-structure-${Date.now()}`;
  const ownerSubject = key, viewerSubject = `${key}-viewer`, outsiderSubject = `${key}-outside`;

  async function prerequisiteIntent(caseId: string, prerequisiteIds: string[]) {
    const readRequestId = randomUUID();
    const access = await owner.testCaseStructure.prerequisiteAccess({ projectId, caseId, readRequestId });
    expect(access).toMatchObject({ projectId, caseId, readRequestId, canEdit: true, readScope: { projectId, organizationId, actorId, actorClerkUserId: ownerSubject } });
    const pins = { projectId, caseId, originalOrganizationId: access.readScope.organizationId, expectedClerkActorId: access.readScope.actorClerkUserId, expectedActorId: access.readScope.actorId };
    const pageRequestId = randomUUID(), page = await owner.testCaseStructure.prerequisitePage({ ...pins, readRequestId: pageRequestId, search: "", sort: "case-id" });
    expect(page).toMatchObject({ projectId, caseId, readRequestId: pageRequestId, readScope: access.readScope });
    return { ...pins, requestId: randomUUID(), expectedGraphHash: page.graphHash, expectedPrerequisiteIds: page.prerequisiteIds, prerequisiteIds, confirmed: true as const };
  }
  async function savePrerequisites(input: Awaited<ReturnType<typeof prerequisiteIntent>>) {
    const saved = await owner.testCaseStructure.reviewedSetPrerequisites(input);
    expect(saved).toEqual({ projectId: input.projectId, caseId: input.caseId, organizationId, actorId, actorClerkUserId: ownerSubject, requestId: input.requestId, requestHash: prerequisiteRequestHash(input), prerequisiteIds: input.prerequisiteIds, replayed: false });
    return saved;
  }
  async function caseObservation(testRunId: string, testCaseId: string, status: ManualCaseReviewedExactWrite["status"]) {
    const original = { projectId, testRunId, testCaseId, expectedScope: { projectId, organizationId, clerkActorId: ownerSubject }, expectedNativeActorId: actorId };
    const accessInput = { ...original, readRequestId: randomUUID() }, access = await owner.manualCaseResults.accessReviewed(accessInput);
    expect(access.readContext).toMatchObject({ requestId: accessInput.readRequestId, requested: manualCaseReviewedReadKey(accessInput), projection: "ACCESS", scope: { ...original.expectedScope, actorId }, canRecover: true });
    const previewInput = { ...original, readRequestId: randomUUID() }, preview = await owner.manualCaseResults.previewReviewed(previewInput);
    expect(preview.readContext).toMatchObject({ requestId: previewInput.readRequestId, requested: manualCaseReviewedReadKey(previewInput), projection: "PREVIEW", scope: access.readContext.scope });
    return { ...original, mode: "EXACT" as const, expectedFrozenEvidenceHash: preview.frozenEvidenceHash, expectedRevisionId: preview.currentRevisionId, expectedCurrentFingerprint: preview.currentFingerprint, status, note: null, observations: {}, correctionReason: preview.current ? "Explicit synthetic correction of the original observation" : null, idempotencyKey: randomUUID() };
  }
  async function recordObservation(input: ManualCaseReviewedExactWrite) {
    const saved = await owner.manualCaseResults.recordReviewed(input);
    expect(saved).toMatchObject({ scope: { ...input.expectedScope, actorId }, testRunId: input.testRunId, testCaseId: input.testCaseId, idempotencyKey: input.idempotencyKey, requestHash: manualCaseReviewedRequestHash(input), mode: "EXACT", recovered: false });
    expect(saved.resultId).toBeTruthy(); expect(saved.revisionId).toBeTruthy(); expect(saved.revisionNumber).toBeGreaterThan(0);
    return saved;
  }

  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
    const otherOrg = await prisma.organization.create({ data: { name: `${key}-other`, slug: `${key}-other`, planTierId: tier.id } });
    const [ownerUser, viewerUser, outsiderUser] = await Promise.all([
      prisma.user.create({ data: { email: `${key}@example.com`, clerkUserId: key, memberships: { create: { organizationId: org.id, role: "OWNER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { email: `${key}-viewer@example.com`, clerkUserId: `${key}-viewer`, memberships: { create: { organizationId: org.id, role: "VIEWER" } } }, include: { memberships: true } }),
      prisma.user.create({ data: { email: `${key}-outside@example.com`, clerkUserId: `${key}-outside`, memberships: { create: { organizationId: otherOrg.id, role: "OWNER" } } }, include: { memberships: true } }),
    ]);
    organizationId = org.id; actorId = ownerUser.id; viewerActorId = viewerUser.id;
    owner = appRouter.createCaller({ prisma, user: ownerUser, authenticatedClerkSubject: ownerSubject });
    viewer = appRouter.createCaller({ prisma, user: viewerUser, authenticatedClerkSubject: viewerSubject });
    outsider = appRouter.createCaller({ prisma, user: outsiderUser, authenticatedClerkSubject: outsiderSubject });
    const project = await owner.project.create({ organizationId: org.id, name: "Premium flow" });
    projectId = project.id;
    otherProjectId = (await prisma.project.create({ data: { organizationId: otherOrg.id, name: "Other", slug: `${key}-project` } })).id;
    loginId = (await owner.testCases.create({ projectId, title: "Login", testType: "FUNCTIONAL", steps: [{ action: "Sign in" }] })).id;
    premiumId = (await owner.testCases.create({ projectId, title: "Premium action", testType: "FUNCTIONAL", steps: [{ action: "Open premium" }] })).id;
    checkoutId = (await owner.testCases.create({ projectId, title: "Checkout", testType: "FUNCTIONAL", steps: [{ action: "Pay" }] })).id;
  });

  it("moves between suites, persists order, and rejects stale or unauthorized moves", async () => {
    await expect(viewer.testCaseStructure.move({ projectId, caseId: loginId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: null })).rejects.toThrow();
    await expect(outsider.testCaseStructure.list({ projectId })).rejects.toThrow();
    await owner.testCaseStructure.move({ projectId, caseId: loginId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: null });
    await owner.testCaseStructure.move({ projectId, caseId: premiumId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: loginId });
    const list = await owner.testCaseStructure.list({ projectId });
    expect(list.cases.filter(c => c.suitePath === "auth").map(c => c.id)).toEqual([premiumId, loginId]);
    await expect(owner.testCaseStructure.move({ projectId, caseId: loginId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "other", beforeCaseId: null })).rejects.toThrow("Refresh");
    await expect(owner.testCases.setSuite({ id: loginId, suitePath: "other", expectedSuitePath: null })).rejects.toThrow("Refresh");
    await expect(owner.testCaseStructure.move({ projectId, caseId: checkoutId, expectedSuitePath: null, expectedSortPosition: 0, targetSuitePath: "auth", beforeCaseId: "not-a-case" })).rejects.toThrow("Refresh");
    expect((await owner.testCaseStructure.list({ projectId })).cases.find(c => c.id === checkoutId)?.suitePath).toBeNull();
  });

  it("enforces project isolation and an acyclic prerequisite graph", async () => {
    const external = (await prisma.testCase.create({ data: { projectId: otherProjectId, title: "External", testType: "FUNCTIONAL" } })).id;
    const input = await prerequisiteIntent(premiumId, [loginId]);
    await expect(viewer.testCaseStructure.reviewedSetPrerequisites({ ...input, expectedClerkActorId: viewerSubject, expectedActorId: viewerActorId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(owner.testCaseStructure.reviewedSetPrerequisites({ ...input, requestId: randomUUID(), prerequisiteIds: [external] })).rejects.toThrow("same project");
    await expect(prisma.testCasePrerequisite.create({ data: { projectId, dependentId: premiumId, prerequisiteId: external, createdById: "fixture" } })).rejects.toThrow();
    const first = await savePrerequisites(input);
    expect(await owner.testCaseStructure.reviewedSetPrerequisites(input)).toEqual({ ...first, replayed: true });
    expect(await prisma.auditLog.count({ where: { projectId, actorId, entityType: "CasePrerequisiteWrite", entityId: input.requestId } })).toBe(1);
    await expect(owner.testCaseStructure.reviewedSetPrerequisites({ ...input, requestId: randomUUID(), prerequisiteIds: [] })).rejects.toMatchObject({ code: "CONFLICT", message: expect.stringContaining("Saved prerequisites changed") });
    await expect(owner.testCaseStructure.reviewedSetPrerequisites(await prerequisiteIntent(loginId, [premiumId]))).rejects.toThrow("cycle");
    expect((await owner.testCaseStructure.list({ projectId })).prerequisites).toContainEqual({ dependentId: premiumId, prerequisiteId: loginId });
    await expect(owner.testCases.delete({ id: loginId })).rejects.toThrow("prerequisite");
    await expect(owner.testCaseStructure.setPrerequisites({ projectId, dependentId: premiumId, prerequisiteIds: [], expectedPrerequisiteIds: [loginId] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining("legacy request") });
    expect((await owner.testCaseStructure.list({ projectId })).prerequisites).toContainEqual({ dependentId: premiumId, prerequisiteId: loginId });
  });

  it("auto-includes prerequisites and gates execution against the frozen run graph", async () => {
    const { testRunId } = await owner.manualExecution.start({ projectId, testCaseIds: [premiumId] });
    const run = await owner.manualExecution.getForExecution({ testRunId });
    expect(run.cases.map(c => c.testCaseId)).toEqual([loginId, premiumId]);
    expect(run.cases[1]?.prerequisiteIds).toEqual([loginId]);
    await expect(owner.manualCaseResults.recordReviewed(await caseObservation(testRunId, premiumId, "PASS"))).rejects.toThrow("prerequisite");
    const loginInput = await caseObservation(testRunId, loginId, "PASS"), loginAck = await recordObservation(loginInput);
    expect(await owner.manualCaseResults.recordReviewed(loginInput)).toEqual({ ...loginAck, recovered: true });
    await recordObservation(await caseObservation(testRunId, premiumId, "PASS"));
    await expect(owner.manualCaseResults.recordReviewed(await caseObservation(testRunId, loginId, "FAIL"))).rejects.toThrow("dependent");
    // Later graph edits affect only new runs, not this run's frozen rules.
    await savePrerequisites(await prerequisiteIntent(premiumId, []));
    expect((await owner.manualExecution.getForExecution({ testRunId })).cases[1]?.prerequisiteIds).toEqual([loginId]);
    const next = await owner.manualExecution.start({ projectId, testCaseIds: [premiumId] });
    expect((await owner.manualExecution.getForExecution({ testRunId: next.testRunId })).cases.map(c => c.testCaseId)).toEqual([premiumId]);
  });
});
