// P10-11: the first real router-level integration test in this codebase --
// everything else under *.test.ts is pure logic (no DB). This exercises
// the actual RBAC gate (requireOrgRole/requireProjectAccess/staffProcedure
// in trpc.ts) through a real tRPC router call against a real Postgres
// connection, the same DB CI's postgres service container provides (see
// .github/workflows/ci.yml). Everything this suite creates is scoped under
// a distinctly-named throwaway org and deleted in afterAll, so it's safe
// to run against a shared dev database too.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import { TRPCError } from "@trpc/server";

const RUN_ID = `p10-11-${Date.now()}`;

let orgId: string;
let projectId: string;
let ownerUserId: string;
let viewerUserId: string;
let editorUserId: string;
let outsiderUserId: string;
let staffUserId: string;

function callerFor(userId: string) {
  return prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { memberships: true } }).then((user) =>
    appRouter.createCaller({ prisma, user }),
  );
}

beforeAll(async () => {
  const freeTier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({
    data: { name: `RBAC test org ${RUN_ID}`, slug: `rbac-test-${RUN_ID}`, planTier: { connect: { id: freeTier.id } } },
  });
  orgId = org.id;
  const project = await prisma.project.create({ data: { organizationId: orgId, name: "RBAC test project", slug: "rbac-test-project" } });
  projectId = project.id;

  const [owner, viewer, editor, outsider, staff] = await Promise.all([
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-owner`, email: `${RUN_ID}-owner@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-viewer`, email: `${RUN_ID}-viewer@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-editor`, email: `${RUN_ID}-editor@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-outsider`, email: `${RUN_ID}-outsider@example.com` } }),
    prisma.user.create({ data: { clerkUserId: `${RUN_ID}-staff`, email: `${RUN_ID}-staff@skaldandstone.com` } }),
  ]);
  ownerUserId = owner.id;
  viewerUserId = viewer.id;
  editorUserId = editor.id;
  outsiderUserId = outsider.id;
  staffUserId = staff.id;

  await Promise.all([
    prisma.membership.create({ data: { organizationId: orgId, userId: ownerUserId, role: "OWNER" } }),
    prisma.membership.create({ data: { organizationId: orgId, userId: viewerUserId, role: "VIEWER" } }),
    prisma.membership.create({ data: { organizationId: orgId, userId: editorUserId, role: "EDITOR" } }),
    // outsiderUserId and staffUserId deliberately get NO membership here --
    // the whole point is proving they're rejected despite a valid session.
  ]);
});

afterAll(async () => {
  // Every filter below is keyed on a real id captured during a successful
  // beforeAll -- if beforeAll threw before setting orgId, there is nothing
  // to clean up, and an unscoped `where: { projectId: undefined }` would
  // otherwise mean "no filter" to Prisma, matching every row in the table.
  // Guarding on `orgId` (set exactly once, first thing in beforeAll after
  // the org itself is created) makes that failure mode impossible.
  if (!orgId) return;
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  if (projectId) await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({
    where: { id: { in: [ownerUserId, viewerUserId, editorUserId, outsiderUserId, staffUserId].filter(Boolean) } },
  });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("requireProjectAccess (real DB, real router)", () => {
  it("preview-only AI calls cannot bypass project permissions or spend another tenant's credits", async () => {
    for (const userId of [outsiderUserId, viewerUserId]) {
      const caller = await callerFor(userId);
      await expect(caller.agent.reverseEngineerFile({ projectId, filePath: "fixture.test.ts", content: "test('example', () => {})", persist: false })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    expect(await prisma.aiCreditTransaction.count({ where: { organizationId: orgId } })).toBe(0);
  });
  it("a user with no membership in the org is rejected with FORBIDDEN", async () => {
    const caller = await callerFor(outsiderUserId);
    await expect(caller.testCases.list({ projectId })).rejects.toMatchObject({ code: "FORBIDDEN" } satisfies Partial<TRPCError>);
  });

  it("a VIEWER can read but cannot create (EDITOR-gated)", async () => {
    const caller = await callerFor(viewerUserId);
    await expect(caller.testCases.list({ projectId })).resolves.toBeDefined();
    await expect(
      caller.testCases.create({ projectId, title: "should be rejected", testType: "FUNCTIONAL", given: ["g"], when: ["w"], then: ["t"] }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("an EDITOR can create, and the real row is persisted", async () => {
    const caller = await callerFor(editorUserId);
    const created = await caller.testCases.create({
      projectId,
      title: "RBAC-created case",
      testType: "FUNCTIONAL",
      given: ["a precondition"],
      when: ["an action"],
      then: ["a result"],
    });
    expect(created.title).toBe("RBAC-created case");

    const real = await prisma.testCase.findUnique({ where: { id: created.id } });
    expect(real).not.toBeNull();
    expect(real?.projectId).toBe(projectId);
  });

  it("an unknown projectId is NOT_FOUND, not a silent empty result", async () => {
    const caller = await callerFor(ownerUserId);
    await expect(caller.testCases.list({ projectId: "does-not-exist" })).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("staffProcedure (real DB, real router)", () => {
  it("rejects a non-staff email even with a valid session", async () => {
    const caller = await callerFor(outsiderUserId);
    await expect(caller.admin.listOrganizations({ query: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admits a real @skaldandstone.com staff email", async () => {
    const caller = await callerFor(staffUserId);
    await expect(caller.admin.listOrganizations({ query: "" })).resolves.toBeDefined();
  });

  it("a customer OWNER role does NOT grant staff access", async () => {
    const caller = await callerFor(ownerUserId);
    await expect(caller.admin.listOrganizations({ query: "" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
