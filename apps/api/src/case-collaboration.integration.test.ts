// Authored native regressions. Execute ONLY on a fully migrated owned disposable
// database; source/type/unit checks are not native acceptance or deployment.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import { hardDeleteOrganization, previewOrgHardDelete } from "./services/orgHardDelete.js";
const tag = `case-collaboration-${randomUUID()}`;
type User = Awaited<ReturnType<typeof prisma.user.findUniqueOrThrow>> & { memberships: Awaited<ReturnType<typeof prisma.membership.findMany>> };
describe("case collaboration native current authorization and durable receipts", () => {
  let ownerUser: User, viewerUser: User, outsiderUser: User;
  const orgs: string[] = [];
  const caller = (user: User) => appRouter.createCaller({ prisma, user });
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
    for (let i = 0; i < 2; i++) orgs.push((await prisma.organization.create({ data: { name: `${tag}-${i}`, slug: `${tag}-${i}`, planTierId: tier.id } })).id);
    async function user(suffix: string, organizationId: string, role: "OWNER" | "VIEWER") {
      return prisma.user.create({ data: { name: `Synthetic ${suffix}`, email: `${tag}-${suffix}@example.com`, clerkUserId: `${tag}-${suffix}`, memberships: { create: { organizationId, role, seatType: role === "OWNER" ? "FULL" : "READ_ONLY" } } }, include: { memberships: true } });
    }
    ownerUser = await user("owner", orgs[0]!, "OWNER");
    viewerUser = await user("viewer", orgs[0]!, "VIEWER");
    outsiderUser = await user("outsider", orgs[1]!, "OWNER");
    // Refuses before fixtures if the additive migration was not applied.
    await prisma.$queryRaw`SELECT count(*) FROM "CaseComment" WHERE false`;
  });
  afterAll(async () => {
    if (!ownerUser) return;
    for (const id of orgs) {
      const org = await prisma.organization.findUnique({ where: { id } });
      if (!org) continue;
      if (!org.slug.startsWith(tag)) throw Error("Synthetic collaboration ownership mismatch");
      await hardDeleteOrganization(prisma, id, ownerUser.id, "Owned synthetic collaboration fixture teardown");
    }
  });
  async function fixture(orgId = orgs[0]!) {
    const key = randomUUID().replaceAll("-", "").slice(0, 12);
    const project = await prisma.project.create({ data: { organizationId: orgId, name: `${tag}-${key}`, slug: `${tag}-${key}`, caseKey: `c${key}` } });
    const tc = await prisma.testCase.create({ data: { projectId: project.id, title: "Synthetic case", given: ["Setup"], when: ["Click button"], then: ["Result"], tags: ["synthetic"], testType: "FUNCTIONAL", steps: { create: { order: 0, action: "Click button", expectedActionOrData: "onClick calls GET /synthetic", expectedResult: "Details appear", expectedResponse: "200 synthetic JSON" } } } });
    return { project, tc };
  }
  function request(f: Awaited<ReturnType<typeof fixture>>, user = viewerUser) {
    return { projectId: f.project.id, caseId: f.tc.id, originalOrganizationId: f.project.organizationId, expectedClerkActorId: user.clerkUserId, requestId: randomUUID(), body: "Literal <script>not executable</script>\nSynthetic observation" };
  }
  it("allows READ_ONLY comments, preserves procedure/review/version and prohibits priority edits", async () => {
    const f = await fixture(), input = request(f), viewer = caller(viewerUser);
    const before = await prisma.testCase.findUniqueOrThrow({ where: { id: f.tc.id }, include: { steps: true } });
    const posted = await viewer.caseComments.create(input);
    expect(posted.body).toBe(input.body); expect(posted.authorName).toBe("Synthetic viewer");
    expect(await prisma.testCase.findUniqueOrThrow({ where: { id: f.tc.id }, include: { steps: true } })).toEqual(before);
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: f.tc.id } })).toBe(0);
    const revision = (await viewer.testCases.byId({ id: f.tc.id })).caseRevision;
    await expect(viewer.casePriority.set({ ...input, body: undefined, priority: "HIGH", expectedCaseRevision: revision } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { body: _body, ...priorityScope } = input;
    await expect(viewer.casePriority.set({ ...priorityScope, priority: "HIGH", expectedCaseRevision: revision })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("replays an unknown acknowledgement and concurrent same-key comment without duplicate text", async () => {
    const f = await fixture(), input = request(f), viewer = caller(viewerUser);
    const replies = await Promise.allSettled([viewer.caseComments.create(input), viewer.caseComments.create(input)]);
    expect(replies.some(reply => reply.status === "fulfilled")).toBe(true);
    const first = await viewer.caseComments.create(input), retry = await viewer.caseComments.create(input);
    expect(retry.id).toBe(first.id);
    const [count] = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*)::bigint AS count FROM "CaseComment" WHERE "caseId"=${f.tc.id}`;
    expect(count?.count).toBe(1n);
    await expect(viewer.caseComments.create({ ...input, body: "Changed retry" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects foreign cases, stale tenant access, revoked membership and remapped actor", async () => {
    const f = await fixture(), input = request(f), viewer = caller(viewerUser);
    await viewer.caseComments.create(input);
    const foreign = await fixture(orgs[1]!);
    await expect(viewer.caseComments.list({ ...input, caseId: foreign.tc.id } as never)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    const { body: _body, requestId: _request, ...scope } = input;
    await expect(viewer.caseComments.list({ ...scope, caseId: foreign.tc.id })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(caller(outsiderUser).caseComments.create({ ...input, expectedClerkActorId: outsiderUser.clerkUserId })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await prisma.user.update({ where: { id: viewerUser.id }, data: { clerkUserId: `${viewerUser.clerkUserId}-remapped` } });
    try { await expect(viewer.caseComments.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.user.update({ where: { id: viewerUser.id }, data: { clerkUserId: viewerUser.clerkUserId } }); }
    await prisma.membership.deleteMany({ where: { organizationId: orgs[0], userId: viewerUser.id } });
    try { await expect(viewer.caseComments.create(input)).rejects.toMatchObject({ code: "FORBIDDEN" }); }
    finally { await prisma.membership.create({ data: { organizationId: orgs[0]!, userId: viewerUser.id, role: "VIEWER", seatType: "READ_ONLY" } }); }
  });
  it("paginates without losing comments, using only the current tenant/case", async () => {
    const f = await fixture(), viewer = caller(viewerUser), input = request(f);
    for (let i = 0; i < 6; i++) await viewer.caseComments.create({ ...input, requestId: randomUUID(), body: `Synthetic ${i}` });
    const { body: _body, requestId: _request, ...scope } = input;
    const first = await viewer.caseComments.list({ ...scope, limit: 3 });
    const second = await viewer.caseComments.list({ ...scope, limit: 3, cursor: first.nextCursor! });
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(6);
    expect(second.nextCursor).toBeNull();
  });
  it("does not transfer original comments or erase them when a project is reparented", async () => {
    const f = await fixture(), input = request(f);
    const posted = await caller(viewerUser).caseComments.create(input);
    await prisma.project.update({ where: { id: f.project.id }, data: { organizationId: orgs[1]! } });
    try {
      const foreignRead = await caller(outsiderUser).caseComments.list({ projectId: f.project.id, caseId: f.tc.id, originalOrganizationId: orgs[1]!, expectedClerkActorId: outsiderUser.clerkUserId });
      expect(foreignRead.items).toEqual([]);
      expect((await previewOrgHardDelete(prisma, orgs[1]!)).caseCommentScope.blocked).toBe(true);
      await expect(hardDeleteOrganization(prisma, orgs[1]!, ownerUser.id, "Synthetic foreign-original scope refusal")).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      await expect(prisma.testCase.delete({ where: { id: f.tc.id } })).rejects.toBeDefined();
      await expect(prisma.project.delete({ where: { id: f.project.id } })).rejects.toBeDefined();
      const [retained] = await prisma.$queryRaw<Array<{ body: string }>>`SELECT body FROM "CaseComment" WHERE id=${posted.id}`;
      expect(retained?.body).toBe(input.body);
      expect((await previewOrgHardDelete(prisma, orgs[0]!)).rowCounts.CaseComment).toBeGreaterThan(0);
    } finally { await prisma.project.update({ where: { id: f.project.id }, data: { organizationId: orgs[0]! } }); }
  });
  it("priority dropdown snapshots/audits once, preserves per-step descriptors and rejects stale CAS", async () => {
    const f = await fixture(), owner = caller(ownerUser);
    const current = await owner.testCases.byId({ id: f.tc.id });
    const input = { projectId: f.project.id, caseId: f.tc.id, priority: "HIGH" as const, expectedCaseRevision: current.caseRevision, requestId: randomUUID(), originalOrganizationId: f.project.organizationId, expectedClerkActorId: ownerUser.clerkUserId };
    expect((await owner.casePriority.set(input)).replayed).toBe(false);
    expect((await owner.casePriority.set(input)).replayed).toBe(true);
    const after = await owner.testCases.byId({ id: f.tc.id });
    expect(after.steps).toEqual(current.steps); expect(after.given).toEqual(current.given); expect(after.priority).toBe("HIGH");
    expect(await prisma.testCaseVersion.count({ where: { testCaseId: f.tc.id } })).toBe(1);
    expect(await prisma.auditLog.count({ where: { entityType: "TestCasePriority", entityId: f.tc.id } })).toBe(1);
    await expect(owner.casePriority.set({ ...input, requestId: randomUUID(), priority: "LOW" })).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(owner.casePriority.set({ ...input, priority: "LOW" })).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("native case deletion cascades comments, and org erasure preview accounts for their exact scope", async () => {
    const f = await fixture(), input = request(f);
    await caller(viewerUser).caseComments.create(input);
    const preview = await previewOrgHardDelete(prisma, orgs[0]!);
    expect(preview.rowCounts.CaseComment).toBeGreaterThan(0);
    await prisma.testCaseStep.deleteMany({ where: { testCaseId: f.tc.id } });
    await prisma.testCase.delete({ where: { id: f.tc.id } });
    const [count] = await prisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT count(*)::bigint AS count FROM "CaseComment" WHERE "caseId"=${f.tc.id}`);
    expect(count?.count).toBe(0n);
  });
  it("priority history freezes the shared step technical descriptor without detaching the library", async () => {
    const f = await fixture(), owner = caller(ownerUser);
    const steps = [{ order: 0, action: "Click shared button", expectedActionOrData: "onClick calls GET /synthetic-shared", expectedResult: "Shared result", expectedResponse: "200" }];
    const group = await prisma.sharedStepGroup.create({ data: { projectId: f.project.id, name: "Synthetic library", steps } });
    await prisma.testCase.update({ where: { id: f.tc.id }, data: { sharedStepGroupId: group.id } });
    const current = await owner.testCases.byId({ id: f.tc.id });
    await owner.casePriority.set({ projectId: f.project.id, caseId: f.tc.id, priority: "LOW", expectedCaseRevision: current.caseRevision, requestId: randomUUID(), originalOrganizationId: f.project.organizationId, expectedClerkActorId: ownerUser.clerkUserId });
    const version = await prisma.testCaseVersion.findFirstOrThrow({ where: { testCaseId: f.tc.id } });
    expect(version.steps).toEqual(steps.map(step => ({ ...step, mediaAttachmentIds: [] })));
    expect((await prisma.testCase.findUniqueOrThrow({ where: { id: f.tc.id } })).sharedStepGroupId).toBe(group.id);
  });
});
