// SOURCE ONLY. Disposable PostgreSQL scenarios authored, NOT RUN tonight.
import { randomUUID, createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { prepareManualRetest, startManualRetest, manualRetestRequestHash } from "./services/manualRetest.js";
import { manualRetestReadRequestKey } from "./services/manualRetestScopeSchema.js";
import { boundedRunSnapshot } from "./services/qualityExperienceProfile.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = url && ["localhost", "127.0.0.1"].includes(url.hostname) && /test/i.test(url.pathname) && !url.searchParams.has("host");
describe.skipIf(!isolated)("manual retest scoped actor original tenant and retained receipt", () => {
  const prefix = `retest-scope-${Date.now()}-${randomUUID()}`;
  const ownedOrganizations: Array<{ id: string; slug: string }> = [], ownedUsers: string[] = [];
  let projectId: string, organizationId: string, otherOrganizationId: string, ownerId: string, ownerClerk: string, secondId: string, secondClerk: string, viewerId: string, viewerClerk: string;
  let owner: ReturnType<typeof appRouter.createCaller>, second: typeof owner, viewer: typeof owner;
  beforeAll(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (const suffix of ["original", "other"]) {
      const slug = `${prefix}-${suffix}`;
      const org = await prisma.organization.create({ data: { name: slug, slug, planTierId: tier.id } });
      ownedOrganizations.push({ id: org.id, slug });
      if (suffix === "original") organizationId = org.id; else otherOrganizationId = org.id;
    }
    for (const suffix of ["owner", "second", "viewer"]) {
      const clerkUserId = `${prefix}-${suffix}`;
      const user = await prisma.user.create({ data: { clerkUserId, email: `${clerkUserId}@example.com`, memberships: { create: {
        organizationId, role: suffix === "viewer" ? "VIEWER" : "OWNER", seatType: suffix === "viewer" ? "READ_ONLY" : "FULL" } } }, include: { memberships: true } });
      ownedUsers.push(user.id); const caller = appRouter.createCaller({ prisma, user });
      if (suffix === "owner") { owner = caller; ownerId = user.id; ownerClerk = clerkUserId; }
      else if (suffix === "second") { second = caller; secondId = user.id; secondClerk = clerkUserId; }
      else { viewer = caller; viewerId = user.id; viewerClerk = clerkUserId; }
    }
    await prisma.membership.create({ data: { organizationId: otherOrganizationId, userId: ownerId, role: "OWNER", seatType: "FULL" } });
    projectId = (await owner.project.create({ organizationId, name: `${prefix} project` })).id;
  });
  afterAll(async () => {
    // No broad/shared erasure: only exact initialized synthetic slug/owner identities.
    for (const fixture of ownedOrganizations) {
      if (!ownerId) continue;
      const org = await prisma.organization.findUnique({ where: { id: fixture.id }, select: { slug: true } });
      if (org && (org.slug !== fixture.slug || !org.slug.startsWith(prefix))) throw Error("Refusing non-owned fixture erasure");
      if (org) await hardDeleteOrganization(prisma, fixture.id, ownerId, "Owned synthetic manual-retest scope fixture erasure");
    }
    if (ownedUsers.length) await prisma.user.deleteMany({ where: { id: { in: ownedUsers }, clerkUserId: { startsWith: prefix } } });
  });
  const origin = () => ({ projectId, organizationId, clerkActorId: ownerClerk });
  async function fixture() {
    const c = await owner.testCases.create({ projectId, title: `${prefix} original`, testType: "FUNCTIONAL", given: ["Original Given"], when: ["Original When"], then: ["Original Then"] });
    const run = await owner.manualExecution.start({ projectId, testCaseIds: [c.id], executionContext: { platform: "Synthetic PC", environment: "Original environment", build: "original-build" }, idempotencyKey: randomUUID() });
    await owner.manualExecution.recordResult({ testRunId: run.testRunId, testCaseId: c.id, status: "FAIL", note: "Original retained failure" });
    const read = { projectId, sourceRunId: run.testRunId, testCaseId: c.id, expectedScope: origin() };
    const preview = await owner.manualRetest.preview(read);
    return { read, preview, start: { ...read, expectedReviewHash: preview.reviewHash, idempotencyKey: randomUUID() } };
  }
  it("echoes server Clerk/native actor and exact read identity while preserving legacy omitted response", async () => {
    const f = await fixture();
    expect(f.preview).toMatchObject({ scope: { ...origin(), actorId: ownerId }, requested: manualRetestReadRequestKey(f.read) });
    expect(await owner.manualRetest.links(f.read)).toMatchObject({ scope: { ...origin(), actorId: ownerId }, requested: manualRetestReadRequestKey(f.read), retests: [] });
    const { expectedScope: _scope, ...legacy } = f.read;
    const preview = await owner.manualRetest.preview(legacy), links = await owner.manualRetest.links(legacy);
    for (const value of [preview, links]) { expect(Object.hasOwn(value, "scope")).toBe(false); expect(Object.hasOwn(value, "requested")).toBe(false); }
    expect(preview.reviewHash).toBe(f.preview.reviewHash);
  });
  it("scoped review retains captured labels, literal step order and media while omitted legacy projection stays unchanged", async () => {
    const f = await fixture();
    const original = await prisma.testRun.findUniqueOrThrow({ where: { id: f.read.sourceRunId } });
    expect(original.projectId).toBe(projectId);
    expect(original.startedById).toBe(ownerId);
    const captured = boundedRunSnapshot(original.executionContext);
    captured.stepFieldLabels = {
      action: "Apply stimulus",
      expectedActionOrData: "Input / measurement",
      expectedResult: "Approved expected observation",
      expectedResponse: "Device response",
    };
    const definition = captured.caseDefinitions.find(c => c.testCaseId === f.read.testCaseId)!;
    definition.steps = [
      { order: 4, action: "Apply synthetic stimulus\nthen record", expectedActionOrData: "", expectedResult: null, expectedResponse: "  synthetic response  ", mediaAttachmentIds: ["synthetic-image", "synthetic-video"] },
      { order: 9, action: "Complete the synthetic procedure", expectedActionOrData: null, expectedResult: "Recorded expected result", expectedResponse: "", mediaAttachmentIds: [] },
    ];
    await prisma.testRun.update({ where: { id: original.id }, data: { executionContext: captured } });
    const preview = await owner.manualRetest.preview(f.read);
    expect(preview.stepFieldLabels).toEqual(captured.stepFieldLabels);
    expect(preview.caseDefinitions.find(c => c.testCaseId === f.read.testCaseId)?.steps).toEqual(definition.steps);
    const { expectedScope: _scope, ...legacy } = f.read;
    const legacyPreview = await owner.manualRetest.preview(legacy);
    expect(Object.hasOwn(legacyPreview, "stepFieldLabels")).toBe(false);
    expect(legacyPreview.reviewHash).toBe(preview.reviewHash);
    const ack = await owner.manualRetest.start({ ...f.start, expectedReviewHash: preview.reviewHash });
    const retest = await prisma.testRun.findUniqueOrThrow({ where: { id: ack.testRunId }, include: { results: true } });
    const retained = boundedRunSnapshot(retest.executionContext);
    expect(retained.stepFieldLabels).toEqual(captured.stepFieldLabels);
    expect(retained.caseDefinitions.find(c => c.testCaseId === f.read.testCaseId)?.steps).toEqual(definition.steps);
    expect(retest.results).toEqual([]);
    expect((await prisma.testRun.findUniqueOrThrow({ where: { id: original.id } })).executionContext).toEqual(captured);
  });
  it("keeps scoped request only in existing start hash and unchanged deterministic actor-run identity", async () => {
    const f = await fixture(), ack = await owner.manualRetest.start(f.start);
    expect(ack.testRunId).toBe(`retest_${createHash("sha256").update(JSON.stringify([projectId, ownerId, f.start.idempotencyKey])).digest("hex")}`);
    expect(ack).toMatchObject({ recovered: false, scope: { ...origin(), actorId: ownerId, sourceRunId: f.read.sourceRunId, testCaseId: f.read.testCaseId, idempotencyKey: f.start.idempotencyKey, reviewHash: f.preview.reviewHash } });
    const run = await prisma.testRun.findUniqueOrThrow({ where: { id: ack.testRunId }, include: { results: true } });
    const snapshot = boundedRunSnapshot(run.executionContext);
    expect(snapshot.startRequestHash).toBe(manualRetestRequestHash(f.start));
    expect(Object.hasOwn(snapshot, "expectedScope")).toBe(false); expect(Object.hasOwn(snapshot, "scope")).toBe(false);
    expect(snapshot.retest?.sourceResults[0]?.status).toBe("FAIL"); expect(run.results).toEqual([]);
    const { expectedScope: _scope, ...legacy } = { ...f.start, idempotencyKey: randomUUID() };
    expect(Object.keys(await owner.manualRetest.start(legacy)).sort()).toEqual(["recovered", "testRunId"]);
  });
  it("historical identical replay recovers before changed source/procedure validation and copies no new result", async () => {
    const f = await fixture(), original = await owner.manualRetest.start(f.start);
    await owner.manualExecution.recordResult({ testRunId: f.read.sourceRunId, testCaseId: f.read.testCaseId, status: "PASS", note: "Later correction" });
    await prisma.testCase.update({ where: { id: f.read.testCaseId }, data: { archived: true, given: ["Current changed Given"] } });
    expect(await owner.manualRetest.start(f.start)).toEqual({ ...original, recovered: true });
    const retained = boundedRunSnapshot((await prisma.testRun.findUniqueOrThrow({ where: { id: original.testRunId } })).executionContext);
    expect(retained.retest?.sourceResults[0]?.status).toBe("FAIL"); expect(retained.caseDefinitions[0]?.given).toEqual(["Original Given"]);
    expect(await prisma.testResult.count({ where: { testRunId: original.testRunId } })).toBe(0);
  });
  it("refuses asynchronous authenticated actor switch and DB/transport Clerk mismatch before reads/replay", async () => {
    const f = await fixture(); await owner.manualRetest.start(f.start);
    for (const run of [() => second.manualRetest.preview(f.read), () => second.manualRetest.links(f.read), () => second.manualRetest.start(f.start)])
      await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(startManualRetest(prisma, ownerId, f.start, secondClerk)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(prisma.$transaction(tx => prepareManualRetest(tx, ownerId, f.read, false, secondClerk), { isolationLevel: "RepeatableRead" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(secondId).not.toBe(ownerId);
  });
  it("same actor owning both organizations cannot reparent-read/replay or silently rebind a stored scoped UUID", async () => {
    const f = await fixture(), ack = await owner.manualRetest.start(f.start);
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: otherOrganizationId } });
    try {
      for (const run of [() => owner.manualRetest.preview(f.read), () => owner.manualRetest.links(f.read), () => owner.manualRetest.start(f.start)])
        await expect(run()).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(owner.manualRetest.start({ ...f.start, expectedScope: { ...origin(), organizationId: otherOrganizationId } })).rejects.toMatchObject({ code: "CONFLICT" });
    } finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId } }); }
    expect((await owner.manualRetest.start(f.start)).testRunId).toBe(ack.testRunId);
  });
  it("fresh role and full-seat gates precede receipt replay but current Viewer read links stay available", async () => {
    const f = await fixture(); await owner.manualRetest.start(f.start);
    const member = { organizationId_userId: { organizationId, userId: ownerId } };
    for (const change of [{ role: "OWNER" as const, seatType: "READ_ONLY" as const }, { role: "VIEWER" as const, seatType: "FULL" as const }]) {
      await prisma.membership.update({ where: member, data: change });
      try {
        await expect(owner.manualRetest.preview(f.read)).rejects.toMatchObject({ code: "FORBIDDEN" });
        await expect(owner.manualRetest.start(f.start)).rejects.toMatchObject({ code: "FORBIDDEN" });
        expect((await owner.manualRetest.links(f.read)).retests).toHaveLength(1);
      } finally { await prisma.membership.update({ where: member, data: { role: "OWNER", seatType: "FULL" } }); }
    }
    const read = { ...f.read, expectedScope: { ...origin(), clerkActorId: viewerClerk } };
    expect((await viewer.manualRetest.links(read)).scope?.actorId).toBe(viewerId);
    await expect(viewer.manualRetest.preview(read)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("suspension and absent fresh membership deny private links and retained successful write receipts", async () => {
    const f = await fixture(); await owner.manualRetest.start(f.start);
    await prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: new Date() } });
    try { await expect(owner.manualRetest.links(f.read)).rejects.toMatchObject({ code: "FORBIDDEN" }); await expect(owner.manualRetest.start(f.start)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.organization.update({ where: { id: organizationId }, data: { suspendedAt: null } }); }
    await prisma.membership.delete({ where: { organizationId_userId: { organizationId, userId: viewerId } } });
    try { await expect(viewer.manualRetest.links({ ...f.read, expectedScope: { ...origin(), clerkActorId: viewerClerk } })).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.create({ data: { organizationId, userId: viewerId, role: "VIEWER", seatType: "READ_ONLY" } }); }
  });
  it("same unknown request concurrent retries create one run and changed reviewed input conflicts", async () => {
    const f = await fixture(), [a, b] = await Promise.all([owner.manualRetest.start(f.start), owner.manualRetest.start(f.start)]);
    expect(a.testRunId).toBe(b.testRunId); expect([a.recovered, b.recovered].sort()).toEqual([false, true]);
    expect(await prisma.testRun.count({ where: { id: a.testRunId } })).toBe(1);
    await expect(owner.manualRetest.start({ ...f.start, expectedReviewHash: "b".repeat(64) })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await owner.manualRetest.start(f.start)).recovered).toBe(true);
  });
  it("preflights original scope and retained receipt bytes before materializing oversized private evidence", async () => {
    const f = await fixture(), ack = await owner.manualRetest.start(f.start);
    const receipt = await prisma.testRun.findUniqueOrThrow({ where: { id: ack.testRunId }, select: { executionContext: true } });
    await prisma.testRun.update({ where: { id: ack.testRunId }, data: { executionContext: { oversized: "x".repeat(2097153) } } });
    try { await expect(owner.manualRetest.start(f.start)).rejects.toThrow("bounded snapshot limit"); }
    finally { await prisma.testRun.update({ where: { id: ack.testRunId }, data: { executionContext: receipt.executionContext as Prisma.InputJsonValue } }); }
    const original = await prisma.testRun.findUniqueOrThrow({ where: { id: f.read.sourceRunId }, select: { manualTestCaseIds: true } });
    await prisma.testRun.update({ where: { id: f.read.sourceRunId }, data: { manualTestCaseIds: Array.from({ length: 501 }, (_, i) => `owned-synthetic-${i}`) } });
    try { await expect(owner.manualRetest.preview(f.read)).rejects.toThrow("bounded retest review"); }
    finally { await prisma.testRun.update({ where: { id: f.read.sourceRunId }, data: { manualTestCaseIds: original.manualTestCaseIds } }); }
  });
});
