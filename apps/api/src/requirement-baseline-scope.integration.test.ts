// SOURCE-ONLY authored scenarios; no execution claimed. Run on a fresh seeded,
// migrated loopback test database during the separately authorized morning gate.
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { requirementBaselinesRouter } from "./routers/requirementBaselines.js";
import { withRequirementBaselineAccess } from "./services/requirementBaselines.js";
import { requirementBaselineCaptureInput, requirementBaselineAcknowledgementKey } from "./services/requirementBaselineSchema.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("requirement baseline original organization and current actor (authored)", () => {
  const tag = `baseline-scope-${randomUUID()}`;
  const orgs: string[] = [], users: string[] = [];
  let organizationId: string, foreignOrganizationId: string, projectId: string, caseId: string;
  let ownerId: string, viewerId: string, clerkActorId: string, viewerClerkActorId: string;
  let owner: ReturnType<typeof requirementBaselinesRouter.createCaller>, viewer: typeof owner;
  const scope = () => ({ organizationId, clerkActorId });
  async function requirement() {
    const row = await prisma.requirement.create({ data: { projectId, title: `Synthetic scope ${randomUUID()}`, description: "Original reviewed wording" } });
    await prisma.caseTraceabilityLink.create({ data: { id: randomUUID(), projectId, caseId, provider: "requirement", providerOrigin: "vaettir", nativeId: row.id,
      kind: "requirement", title: "Synthetic declared direct link", requirementId: row.id, createdById: ownerId, updatedById: ownerId } });
    return row;
  }
  async function input(requirementId: string, bound = true) {
    const current = await owner.byId({ projectId, requirementId, expectedScope: scope() });
    return requirementBaselineCaptureInput.parse({ projectId, requirementId, requestId: randomUUID(), expectedLatestVersion: current.latestVersion,
      currentFingerprint: current.currentFingerprint, rationale: "Retain exact reviewed synthetic rationale", acknowledgeNotVerifiedCoverage: true,
      ...(bound ? { expectedScope: scope() } : {}) });
  }
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host"))
      throw Error("Unique disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let n = 0; n < 2; n++) {
      const slug = `${tag}-${n}`;
      const org = await prisma.organization.create({ data: { name: slug, slug, planTierId: tier.id } });
      orgs.push(org.id); if (!n) organizationId = org.id; else foreignOrganizationId = org.id;
    }
    projectId = (await prisma.project.create({ data: { organizationId, name: "Synthetic original baseline scope", slug: randomUUID(), caseKey: "scope" } })).id;
    for (const role of ["OWNER", "VIEWER"] as const) {
      const user = await prisma.user.create({ data: { email: `baseline-scope-${randomUUID()}@example.com`, clerkUserId: randomUUID(),
        memberships: { create: { organizationId, role, seatType: role === "OWNER" ? "FULL" : "READ_ONLY" } } }, include: { memberships: true } });
      users.push(user.id); const caller = requirementBaselinesRouter.createCaller({ prisma, user });
      if (role === "OWNER") { owner = caller; ownerId = user.id; clerkActorId = user.clerkUserId; }
      else { viewer = caller; viewerId = user.id; viewerClerkActorId = user.clerkUserId; }
    }
    caseId = (await prisma.testCase.create({ data: { projectId, title: "Synthetic direct case", given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } })).id;
    await prisma.caseTraceabilityState.create({ data: { projectId, organizationId } });
  });
  afterAll(async () => {
    for (const id of orgs) {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
      if (![`${tag}-0`, `${tag}-1`].includes(org.slug)) throw Error("Owned synthetic organization identity mismatch");
      await hardDeleteOrganization(prisma, id, ownerId, "Owned synthetic requirement baseline scope fixtures");
    }
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: orgs }, deletedById: { in: users } } });
    await prisma.user.deleteMany({ where: { id: { in: users } } });
  });
  it("echoes server-owned actor/org on reads and ACK while preserving Viewer read-only wording and direct chips", async () => {
    const req = await requirement(), request = await input(req.id), receipt = await owner.capture(request);
    expect(receipt).toMatchObject({ projectId, organizationId, clerkActorId, requirementId: req.id, capturedFingerprint: request.currentFingerprint,
      acknowledgementKey: requirementBaselineAcknowledgementKey(request) });
    const expectedScope = { organizationId, clerkActorId: viewerClerkActorId };
    expect(await viewer.access({ projectId, expectedScope })).toMatchObject({ projectId, organizationId, clerkActorId: viewerClerkActorId, canWrite: false });
    expect(await viewer.list({ projectId, expectedScope })).toMatchObject({ projectId, organizationId, clerkActorId: viewerClerkActorId });
    const detail = await viewer.byId({ projectId, requirementId: req.id, expectedScope });
    expect(detail).toMatchObject({ projectId, organizationId, clerkActorId: viewerClerkActorId, canWrite: false });
    expect(detail.current?.description).toBe(req.description);
    expect(detail.affected.items[0].caseId).toBe(caseId);
    await expect(viewer.capture({ ...request, requestId: randomUUID(), expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("refuses wrong original org or actor before reads, new capture and receipt replay without additional rows", async () => {
    const req = await requirement(), request = await input(req.id); await owner.capture(request);
    const before = await prisma.requirementBaselineWrite.count({ where: { projectId } });
    for (const expectedScope of [{ organizationId: foreignOrganizationId, clerkActorId }, { organizationId, clerkActorId: "wrong-current-clerk" }]) {
      await expect(owner.access({ projectId, expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.list({ projectId, expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.byId({ projectId, requirementId: req.id, expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.capture({ ...request, expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.capture({ ...request, requestId: randomUUID(), expectedScope })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await prisma.requirementBaselineWrite.count({ where: { projectId } })).toBe(before);
    expect(await prisma.requirementBaseline.count({ where: { projectId, requirementId: req.id } })).toBe(1);
  });
  it("retains omitted legacy request hash and four-field receipt; historical replay does not require unchanged current wording", async () => {
    const req = await requirement(), request = await input(req.id, false), first = await owner.capture(request);
    expect(Object.hasOwn(request, "expectedScope")).toBe(false);
    const stored = await prisma.requirementBaselineWrite.findFirstOrThrow({ where: { projectId, actorId: ownerId, requestId: request.requestId } });
    expect(stored.requestHash).toBe(createHash("sha256").update(JSON.stringify(request)).digest("hex"));
    expect(stored.receipt).toEqual({ requestId: request.requestId, baselineId: first.baselineId, displayId: first.displayId, version: first.version });
    await prisma.requirement.update({ where: { id: req.id }, data: { description: "Newer human requirement wording" } });
    await prisma.testCase.update({ where: { id: caseId }, data: { title: "Newer current case label" } });
    expect(await owner.capture(request)).toEqual(first);
    await expect(owner.capture({ ...request, expectedScope: scope() })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.byId({ projectId, requirementId: req.id })).comparison.status).toBe("CHANGED_REVIEW_REQUIRED");
  });
  it("checks DB actor mapping against server context before baseline body or callback work", async () => {
    let read = false;
    await expect(withRequirementBaselineAccess(prisma, projectId, ownerId, organizationId, async () => { read = true; return { body: "never read" }; },
      { expectedScope: scope(), verifiedClerkActorId: "wrong-server-clerk" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(read).toBe(false);
    await prisma.user.update({ where: { id: ownerId }, data: { clerkUserId: "changed-synthetic-clerk" } });
    try { await expect(owner.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.user.update({ where: { id: ownerId }, data: { clerkUserId: clerkActorId } }); }
  });
  it("refuses incompatible direct origin/native identity as a whole while historical replay remains exact", async () => {
    for (const wrong of [{ providerOrigin: "synthetic-incompatible-origin" }, { nativeId: "synthetic-other-native-requirement" }]) {
      const req = await requirement(), request = await input(req.id), receipt = await owner.capture(request);
      const newRequest = await input(req.id);
      const link = await prisma.caseTraceabilityLink.findFirstOrThrow({ where: { projectId, requirementId: req.id, removedAt: null } });
      // Valid FK scope stays intact; no constraints/triggers are disabled and no
      // missing/foreign case is manufactured to bypass the composite native FK.
      await prisma.caseTraceabilityLink.update({ where: { id: link.id }, data: wrong });
      try {
        await expect(owner.byId({ projectId, requirementId: req.id, expectedScope: scope() })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        await expect(owner.list({ projectId, search: req.title, expectedScope: scope() })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        await expect(owner.capture(newRequest)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
        expect(await owner.capture(request)).toEqual(receipt);
        expect(await prisma.requirementBaseline.count({ where: { projectId, requirementId: req.id } })).toBe(1);
        expect(await prisma.requirementBaselineWrite.count({ where: { projectId, requestId: newRequest.requestId } })).toBe(0);
      } finally { await prisma.caseTraceabilityLink.update({ where: { id: link.id }, data: { providerOrigin: "vaettir", nativeId: req.id } }); }
      expect((await owner.byId({ projectId, requirementId: req.id, expectedScope: scope() })).currentDirectCases).toBe(1);
    }
  });
  it("does not replay a capture after current membership loss and does not erase the original receipt", async () => {
    const req = await requirement(), request = await input(req.id), first = await owner.capture(request);
    await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "VIEWER", seatType: "READ_ONLY" } });
    try {
      expect(await owner.access({ projectId, expectedScope: scope() })).toMatchObject({ canWrite: false });
      await expect(owner.capture(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(await prisma.requirementBaselineWrite.count({ where: { projectId, requestId: request.requestId } })).toBe(1);
    } finally { await prisma.membership.update({ where: { organizationId_userId: { organizationId, userId: ownerId } }, data: { role: "OWNER", seatType: "FULL" } }); }
    expect(await owner.capture(request)).toEqual(first);
    expect((await viewer.access({ projectId })).clerkActorId).toBe(viewerClerkActorId);
    expect(viewerId).not.toBe(ownerId);
  });
  it("refuses a reparented project even for a current foreign-org member rather than moving historical scope", async () => {
    const req = await requirement(), request = await input(req.id), first = await owner.capture(request);
    await prisma.membership.create({ data: { organizationId: foreignOrganizationId, userId: ownerId, role: "OWNER", seatType: "FULL" } });
    const currentActor = await prisma.user.findUniqueOrThrow({ where: { id: ownerId }, include: { memberships: true } });
    const dualMember = requirementBaselinesRouter.createCaller({ prisma, user: currentActor });
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: foreignOrganizationId } });
    try {
      await expect(dualMember.list({ projectId, expectedScope: scope() })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(dualMember.list({ projectId })).rejects.toMatchObject({ code: "NOT_FOUND" });
      await expect(dualMember.capture(request)).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect((await prisma.projectRequirementBaselineState.findUniqueOrThrow({ where: { projectId } })).organizationId).toBe(organizationId);
    } finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId } }); }
    expect(await owner.capture(request)).toEqual(first);
  });
});
