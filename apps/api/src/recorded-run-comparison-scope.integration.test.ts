// Synthetic integration coverage; requires an owned migrated loopback test DB.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, it, expect } from "vitest";
import { prisma } from "@vaettir/db";
import { recordedRunComparisonRouter } from "./routers/recordedRunComparison.js";
import { withRecordedRunAccess, listRecordedRuns } from "./services/recordedRunComparison.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe("recorded comparison original-scope continuation", () => {
  const tag = `comparison-scope-${randomUUID()}`;
  let actorId: string, clerkActorId: string, organizationId: string, otherOrganizationId: string;
  let caller: ReturnType<typeof recordedRunComparisonRouter.createCaller>;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host"))
      throw Error("Owned disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    const a = await prisma.organization.create({ data: { slug: tag, name: tag, planTierId: tier.id } });
    const b = await prisma.organization.create({ data: { slug: `${tag}-other`, name: `${tag}-other`, planTierId: tier.id } });
    organizationId = a.id; otherOrganizationId = b.id;
    const user = await prisma.user.create({ data: { email: `${tag}@example.com`, clerkUserId: tag,
      memberships: { create: [{ organizationId: a.id, role: "OWNER", seatType: "FULL" }, { organizationId: b.id, role: "OWNER", seatType: "FULL" }] } }, include: { memberships: true } });
    actorId = user.id; clerkActorId = user.clerkUserId;
    caller = recordedRunComparisonRouter.createCaller({ prisma, user });
  });
  afterAll(async () => {
    if (!organizationId) return;
    for (const id of [organizationId, otherOrganizationId]) {
      const org = await prisma.organization.findUniqueOrThrow({ where: { id } });
      if (!org.slug.startsWith(tag)) throw Error("Scoped synthetic ownership mismatch");
      const receipt = await hardDeleteOrganization(prisma, id, actorId, "Owned comparison scope fixtures");
      const removed = await prisma.organizationDeletionLog.deleteMany({ where: {
        id: receipt.deletionLogId, organizationId: id, organizationSlug: org.slug, deletedById: actorId,
      } });
      expect(removed.count).toBe(1);
    }
    await prisma.user.delete({ where: { id: actorId } });
  });
  async function fixture() {
    const project = await prisma.project.create({ data: { organizationId, name: tag, slug: randomUUID(), caseKey: `s${randomUUID().replaceAll("-", "").slice(0, 15)}` } });
    const baseline = await prisma.testRun.create({ data: { projectId: project.id, ciProvider: "synthetic-ci", commitSha: "a", branch: "main", startedAt: new Date("2026-10-04T01:00:00Z"), status: "FAILED" } });
    const candidate = await prisma.testRun.create({ data: { projectId: project.id, ciProvider: "synthetic-ci", commitSha: "b", branch: "main", startedAt: new Date("2026-10-04T02:00:00Z"), status: "PASSED" } });
    await prisma.testResult.create({ data: { testRunId: baseline.id, status: "FAIL", errorMessage: "Private fixture detail must not be projected" } });
    return { project, baseline, candidate, input: { projectId: project.id, baselineRunId: baseline.id, candidateRunId: candidate.id, requestId: randomUUID() } };
  }
  it("echoes current original scope/server actor while retaining byte-equivalent legacy pair fingerprints and counts", async () => {
    const f = await fixture();
    const legacy = await caller.compare(f.input);
    const bound = await caller.compare({ ...f.input, originalOrganizationId: organizationId, expectedClerkActorId: clerkActorId });
    expect(bound).toMatchObject({ projectId: f.project.id, organizationId, clerkActorId, requestId: f.input.requestId, pairHash: legacy.pairHash, comparableConfiguration: false, comparisonScope: "RECORDED_COUNTS_ONLY" });
    expect(bound.baselineSummary).toEqual(legacy.baselineSummary);
    expect(bound.items).toEqual(legacy.items);
    const catalog = await caller.runs({ projectId: f.project.id, requestId: randomUUID(), originalOrganizationId: organizationId, expectedClerkActorId: clerkActorId });
    expect(catalog).toMatchObject({ projectId: f.project.id, organizationId, clerkActorId });
    expect(JSON.stringify(bound)).not.toContain("Private fixture detail");
  });
  it("refuses wrong current actor/original organization and old-origin reads after a dual-owner reparent", async () => {
    const f = await fixture();
    await expect(caller.compare({ ...f.input, originalOrganizationId: otherOrganizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.compare({ ...f.input, expectedClerkActorId: "another-clerk-actor" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.project.update({ where: { id: f.project.id }, data: { organizationId: otherOrganizationId } });
    await expect(caller.runs({ projectId: f.project.id, requestId: randomUUID(), originalOrganizationId: organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(caller.compare({ ...f.input, originalOrganizationId: organizationId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await caller.compare(f.input)).organizationId).toBe(otherOrganizationId);
  });
  it("verifies the server Clerk identity inside the locked helper before invoking any run body work", async () => {
    const f = await fixture();
    let invoked = false;
    await expect(withRecordedRunAccess(prisma, actorId, f.project.id, organizationId, async () => { invoked = true; return {}; }, { verifiedClerkActorId: "wrong-verified-session" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(invoked).toBe(false);
  });
  it("sets SQL timeout before lock acquisition and holds the scoped project read lock throughout population projection", async () => {
    const f = await fixture();
    let contested = false;
    const result = await withRecordedRunAccess(prisma, actorId, f.project.id, organizationId, async tx => {
      const setting = await tx.$queryRaw<Array<{ value: string }>>`SELECT current_setting('statement_timeout') AS value`;
      expect(setting[0]?.value).toBe("8s");
      await expect(prisma.$transaction(async writer => {
        await writer.$executeRaw`SET LOCAL lock_timeout = '100ms'`;
        await writer.$executeRaw`UPDATE "Project" SET "organizationId"=${otherOrganizationId} WHERE id=${f.project.id}`;
      }, { timeout: 5000 })).rejects.toMatchObject({ code: "P2010", meta: expect.objectContaining({ code: "55P03" }) });
      contested = true;
      return listRecordedRuns(tx, { projectId: f.project.id, requestId: randomUUID() });
    }, { originalOrganizationId: organizationId, expectedClerkActorId: clerkActorId, verifiedClerkActorId: clerkActorId });
    expect(contested).toBe(true);
    expect(result.organizationId).toBe(organizationId);
    expect(result.items).toHaveLength(2);
  });
});
