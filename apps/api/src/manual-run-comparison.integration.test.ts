// SOURCE ONLY: AUTHORED NOT RUN. Requires an explicitly owned disposable,
// seeded/migrated loopback test database. No production acceptance is implied.
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterEach, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { compareManualRuns, listManualComparisonRuns } from "./services/manualRunComparison.js";
import { qualityProfileHash, runConfigurationSchema } from "./services/qualityExperienceProfile.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";

describe.skipIf(process.env.VAETTIR_OWNED_COMPARISON_FIXTURE !== "yes")("native frozen manual comparison (AUTHORED NOT RUN)", () => {
  const tag = `manual-compare-${randomUUID()}`;
  let orgId: string, projectId: string, actorId: string, clerkId: string, caseId: string, baselineRunId: string, candidateRunId: string;
  beforeAll(() => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (process.env.VAETTIR_OWNED_COMPARISON_FIXTURE !== "yes" || !["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Explicitly owned seeded/migrated loopback test DB required");
  });
  beforeEach(async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    orgId = (await prisma.organization.create({ data: { name: tag, slug: `${tag}-${randomUUID()}`, planTierId: tier.id } })).id;
    projectId = (await prisma.project.create({ data: { organizationId: orgId, name: tag, slug: randomUUID() } })).id;
    clerkId = `${tag}-${randomUUID()}`;
    actorId = (await prisma.user.create({ data: { clerkUserId: clerkId, email: `${clerkId}@example.invalid`, memberships: { create: { organizationId: orgId, role: "VIEWER", seatType: "READ_ONLY" } } } })).id;
    caseId = (await prisma.testCase.create({ data: { projectId, title: "Current title must not be compared", testType: "FUNCTIONAL", given: ["Given"], when: ["When"], then: ["Then"] } })).id;
    const frame = { version: 1, experience: null, profileHash: qualityProfileHash({}), configuration: runConfigurationSchema.parse({ build: "Synthetic saved build" }), stepFieldLabels: { action: "Tester action" }, caseDefinitions: [{ testCaseId: caseId, title: "Frozen original title", validationDomain: "SOFTWARE", reviewStatus: "APPROVED", background: null, given: ["Saved setup"], when: ["Saved action"], then: ["Saved observation"], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps: [] }] };
    const create = () => prisma.testRun.create({ data: { projectId, ciProvider: "manual", commitSha: "manual", branch: "manual", startedAt: new Date("2026-01-01T12:00:00Z"), manualTestCaseIds: [caseId], manualPrerequisites: { [caseId]: [] }, executionContext: frame } });
    baselineRunId = (await create()).id; candidateRunId = (await create()).id;
  });
  afterEach(async () => {
    const owned = orgId ? await prisma.organization.findUnique({ where: { id: orgId }, select: { slug: true } }) : null;
    if (owned) {
      if (!owned.slug.startsWith(tag)) throw Error("Owned comparison fixture mismatch");
      await hardDeleteOrganization(prisma, orgId, actorId, "Owned synthetic manual comparison fixture cleanup");
      await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: orgId } });
    }
    if (actorId) await prisma.user.deleteMany({ where: { id: actorId, clerkUserId: { startsWith: tag } } });
  });
  const request = () => ({ projectId, originalOrganizationId: orgId, expectedClerkActorId: clerkId, requestId: randomUUID(), baselineRunId, candidateRunId });
  it("READ_ONLY native comparison reads saved titles, excludes current private bodies and binds both exact manual records", async () => {
    const response = await compareManualRuns(prisma, actorId, clerkId, request());
    expect(response.items).toHaveLength(1);
    expect(response.items[0]).toMatchObject({ baseline: { title: "Frozen original title", outcome: "NO_CASE_VERDICT" }, candidate: { title: "Frozen original title" }, definitionState: "SAME_SAVED_DEFINITION" });
    expect(JSON.stringify(response)).not.toContain("Current title must not be compared");
    expect(response.baselineSummary).toMatchObject({ total: 1, remaining: 1 });
    const { baselineRunId: _a, candidateRunId: _b, ...scope } = request();
    expect((await listManualComparisonRuns(prisma, actorId, clerkId, { ...scope, interval: { start: "2026-01-01", end: "2026-01-01" } })).items.map(run => run.id).sort()).toEqual([baselineRunId, candidateRunId].sort());
  });
  it("native current suspension refuses instead of returning previously read records", async () => {
    await prisma.organization.update({ where: { id: orgId }, data: { suspendedAt: new Date() } });
    await expect(compareManualRuns(prisma, actorId, clerkId, request())).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
