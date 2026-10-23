// SOURCE ONLY: run later solely against an owned migrated loopback synthetic test database.
import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { requirementCoverageRouter } from "./routers/requirementCoverage.js";
import { hardDeleteOrganization } from "./services/orgHardDelete.js";
describe("complete live direct requirement matrix export", () => {
  const prefix = `coverage-export-${randomUUID()}`, ownerClerk = `${prefix}-owner`, viewerClerk = `${prefix}-viewer`;
  const orgIds: string[] = [], userIds: string[] = [];
  let projectId: string, foreignProject: string, ownerId: string, viewerId: string, planId: string;
  let owner: ReturnType<typeof requirementCoverageRouter.createCaller>, viewer: typeof owner;
  const base = () => ({ projectId, originalOrganizationId: orgIds[0]!, expectedClerkActorId: viewerClerk,
    asOf: "2026-09-30T23:59:59.999Z", interval: { start: "2026-09-01", end: "2026-09-30" } });
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL ?? "http://invalid");
    if (!["localhost", "127.0.0.1"].includes(url.hostname) || !/test/i.test(url.pathname) || url.searchParams.has("host")) throw Error("Owned disposable loopback test database required");
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let i = 0; i < 2; i++) orgIds.push((await prisma.organization.create({ data: { name: `${prefix}-${i}`, slug: `${prefix}-${i}`, planTierId: tier.id } })).id);
    for (let i = 0; i < 2; i++) {
      const user = await prisma.user.create({ data: { email: `${prefix}-${i}@example.com`, clerkUserId: i ? viewerClerk : ownerClerk,
        memberships: { create: (i ? [orgIds[0]!] : orgIds).map(organizationId => ({ organizationId, role: i ? "VIEWER" as const : "OWNER" as const, seatType: i ? "READ_ONLY" as const : "FULL" as const })) } }, include: { memberships: true } });
      userIds.push(user.id); const caller = requirementCoverageRouter.createCaller({ prisma, user });
      if (i) { viewer = caller; viewerId = user.id; } else { owner = caller; ownerId = user.id; }
    }
    projectId = (await prisma.project.create({ data: { organizationId: orgIds[0]!, name: "Synthetic complete export", slug: `${prefix}-project`, caseKey: "cexp" } })).id;
    // Traceability leaves reference the native per-project state, not Project.
    await prisma.caseTraceabilityState.create({ data: { projectId, organizationId: orgIds[0]! } });
    foreignProject = (await prisma.project.create({ data: { organizationId: orgIds[1]!, name: "Synthetic foreign", slug: `${prefix}-foreign` } })).id;
    const type = await prisma.testPlanType.findFirstOrThrow();
    planId = (await prisma.testPlan.create({ data: { projectId, name: "Synthetic plan", testPlanTypeId: type.id } })).id;
  });
  afterAll(async () => {
    if (!ownerId) return;
    for (const id of orgIds) {
      const org = await prisma.organization.findUnique({ where: { id }, select: { slug: true } });
      if (!org?.slug.startsWith(prefix)) throw Error("Owned fixture mismatch");
      await hardDeleteOrganization(prisma, id, ownerId, "Owned synthetic complete coverage export erasure");
    }
    await prisma.organizationDeletionLog.deleteMany({ where: { organizationId: { in: orgIds }, deletedById: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  });
  async function nativeCase(title: string, archived = false, project = projectId) {
    return prisma.testCase.create({ data: { projectId: project, title, archived, given: [], when: [], then: [], tags: [], testType: "FUNCTIONAL" } });
  }
  async function link(requirementId: string, caseId: string, providerOrigin = "vaettir") {
    return prisma.caseTraceabilityLink.create({ data: { id: randomUUID(), projectId, caseId, provider: "requirement", providerOrigin,
      kind: "requirement", requirementId, nativeId: requirementId, title: "Synthetic relation", createdById: ownerId, updatedById: ownerId } });
  }
  async function req(title: string) { return prisma.requirement.create({ data: { projectId, title, description: "Synthetic excluded private description" } }); }
  async function run(date: string, ids: string[], platform = "PC") { return prisma.testRun.create({ data: { projectId, startedAt: new Date(date), ciProvider: "manual",
    commitSha: "manual", branch: "manual", manualTestCaseIds: ids, executionContext: { version: 1, plan: { testPlanId: planId }, configuration: { platform, environment: "Synthetic", build: "b1" } } } }); }
  it("includes complete unlinked, no-result, blocked/skipped, archived and repeated-case rows without duplicated population", async () => {
    const tag = "Matrix states", a = await req(`${tag} repeated title`), b = await req(`${tag} repeated title`), unlinked = await req(`${tag} unlinked`);
    const blocked = await nativeCase("Synthetic archived blocked", true), none = await nativeCase("Synthetic planned no result");
    await link(a.id, blocked.id); await link(b.id, blocked.id); await link(a.id, none.id);
    const r = await run("2026-09-20T00:00:00.000Z", [blocked.id, none.id]);
    for (const status of ["BLOCKED", "SKIP"] as const) await prisma.testResult.create({ data: { testRunId: r.id, testCaseId: blocked.id, status,
      note: "Synthetic excluded private result note", observations: { private: "Synthetic excluded measure" } } });
    const output = await viewer.exportMatrix({ ...base(), search: tag });
    expect(output.population).toMatchObject({ requirements: 3, unlinkedRequirements: 1, directPairs: 3, distinctCases: 2, archivedCases: 1, distinctCaseResultRecords: 2,
      distinctCaseOutcomes: { BLOCKED: 1, SKIP: 1, PASS: 0, total: 2 } });
    expect(output.rows).toHaveLength(4); expect(output.rows.filter(row => row.case?.displayId === blocked.displayId)).toHaveLength(2);
    expect(output.rows.find(row => row.requirementTitle === unlinked.title)).toMatchObject({ case: null, outcomes: { total: 0, PASS: 0 }, plannedWithoutResult: 0 });
    expect(output.rows.find(row => row.case?.displayId === none.displayId)).toMatchObject({ plannedWithoutResult: 1, outcomes: { state: "NO_RECORDED_RESULT", total: 0 } });
    expect(JSON.stringify(output.rows)).not.toContain(blocked.id); expect(JSON.stringify(output.rows)).not.toContain(a.id);
    expect(JSON.stringify(output)).not.toMatch(/Synthetic excluded private|Synthetic excluded measure/);
  });
  it("uses exact recorded configuration/plan/build and inclusive run-start boundaries", async () => {
    const requirement = await req("Exact scoped export"), c = await nativeCase("Synthetic scoped case"); await link(requirement.id, c.id);
    for (const date of ["2026-09-01T00:00:00.000Z", base().asOf, "2026-08-31T23:59:59.999Z"]) {
      const r = await run(date, [c.id]); await prisma.testResult.create({ data: { testRunId: r.id, testCaseId: c.id, status: "PASS" } });
    }
    const scope = { planId, platform: "PC", environment: "Synthetic", build: "b1" };
    const output = await viewer.exportMatrix({ ...base(), search: requirement.title, scope });
    expect(output.appliedScope).toEqual(scope); expect(output.rows[0]!.outcomes.PASS).toBe(2);
    expect((await viewer.exportMatrix({ ...base(), search: requirement.title, scope: { ...scope, platform: "Mobile" } })).rows[0]!.outcomes.total).toBe(0);
  });
  it("refuses malformed or foreign direct edges as a whole before returning a file", async () => {
    const requirement = await req("Synthetic malformed edge"), c = await nativeCase("Synthetic foreign", false, foreignProject);
    // Same-project composite FK rejects foreign case edges before export exists.
    await expect(link(requirement.id, c.id)).rejects.toMatchObject({ code: "P2003" });
    const local = await nativeCase("Synthetic malformed local relation");
    const edge = await link(requirement.id, local.id, "unsupported-synthetic-origin");
    try { await expect(viewer.exportMatrix(base())).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); }
    finally { await prisma.caseTraceabilityLink.delete({ where: { id: edge.id } }); }
  });
  it("fresh actor/current membership and original organization gate legacy and scoped responses", async () => {
    await expect(owner.exportMatrix(base())).rejects.toMatchObject({ code: "FORBIDDEN" });
    const { expectedClerkActorId: omitted, ...legacy } = base(); void omitted;
    expect((await viewer.exportMatrix({ ...legacy, search: "No such synthetic requirement" })).actorClerkUserId).toBe(viewerClerk);
    await prisma.membership.delete({ where: { organizationId_userId: { organizationId: orgIds[0]!, userId: viewerId } } });
    try { await expect(viewer.exportMatrix(base())).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.create({ data: { organizationId: orgIds[0]!, userId: viewerId, role: "VIEWER", seatType: "READ_ONLY" } }); }
    await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgIds[1]! } });
    try { await expect(owner.exportMatrix({ ...legacy, expectedClerkActorId: ownerClerk })).rejects.toMatchObject({ code: "NOT_FOUND" }); }
    finally { await prisma.project.update({ where: { id: projectId }, data: { organizationId: orgIds[0]! } }); }
  });
  it("refuses the complete 1001-row population rather than returning the first page", async () => {
    await prisma.requirement.createMany({ data: Array.from({ length: 1001 }, (_, index) => ({ projectId, title: `Synthetic overbound export ${index}` })) });
    await expect(viewer.exportMatrix({ ...base(), search: "Synthetic overbound export" })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});
