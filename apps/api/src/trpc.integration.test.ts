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
  return prisma.user
    .findUniqueOrThrow({
      where: { id: userId },
      include: { memberships: true },
    })
    .then((user) => appRouter.createCaller({ prisma, user }));
}

beforeAll(async () => {
  const freeTier = await prisma.planTier.findUniqueOrThrow({
    where: { key: "free" },
  });
  const org = await prisma.organization.create({
    data: {
      name: `RBAC test org ${RUN_ID}`,
      slug: `rbac-test-${RUN_ID}`,
      planTier: { connect: { id: freeTier.id } },
    },
  });
  orgId = org.id;
  const project = await prisma.project.create({
    data: {
      organizationId: orgId,
      name: "RBAC test project",
      slug: "rbac-test-project",
    },
  });
  projectId = project.id;

  const [owner, viewer, editor, outsider, staff] = await Promise.all([
    prisma.user.create({
      data: {
        clerkUserId: `${RUN_ID}-owner`,
        email: `${RUN_ID}-owner@example.com`,
      },
    }),
    prisma.user.create({
      data: {
        clerkUserId: `${RUN_ID}-viewer`,
        email: `${RUN_ID}-viewer@example.com`,
      },
    }),
    prisma.user.create({
      data: {
        clerkUserId: `${RUN_ID}-editor`,
        email: `${RUN_ID}-editor@example.com`,
      },
    }),
    prisma.user.create({
      data: {
        clerkUserId: `${RUN_ID}-outsider`,
        email: `${RUN_ID}-outsider@example.com`,
      },
    }),
    prisma.user.create({
      data: {
        clerkUserId: `${RUN_ID}-staff`,
        email: `${RUN_ID}-staff@skaldandstone.com`,
      },
    }),
  ]);
  ownerUserId = owner.id;
  viewerUserId = viewer.id;
  editorUserId = editor.id;
  outsiderUserId = outsider.id;
  staffUserId = staff.id;

  await Promise.all([
    prisma.membership.create({
      data: { organizationId: orgId, userId: ownerUserId, role: "OWNER" },
    }),
    prisma.membership.create({
      data: { organizationId: orgId, userId: viewerUserId, role: "VIEWER" },
    }),
    prisma.membership.create({
      data: { organizationId: orgId, userId: editorUserId, role: "EDITOR" },
    }),
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
  if (projectId) await prisma.testRun.deleteMany({ where: { projectId } });
  if (projectId) await prisma.testCase.deleteMany({ where: { projectId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  await prisma.user.deleteMany({
    where: {
      id: {
        in: [
          ownerUserId,
          viewerUserId,
          editorUserId,
          outsiderUserId,
          staffUserId,
        ].filter(Boolean),
      },
    },
  });
  await prisma.organization.delete({ where: { id: orgId } });
});

describe("requireProjectAccess (real DB, real router)", () => {
  it("a user with no membership in the org is rejected with FORBIDDEN", async () => {
    const caller = await callerFor(outsiderUserId);
    await expect(caller.testCases.list({ projectId })).rejects.toMatchObject({
      code: "FORBIDDEN",
    } satisfies Partial<TRPCError>);
  });

  it("a VIEWER can read but cannot create (EDITOR-gated)", async () => {
    const caller = await callerFor(viewerUserId);
    await expect(caller.testCases.list({ projectId })).resolves.toBeDefined();
    await expect(
      caller.testCases.create({
        projectId,
        title: "should be rejected",
        testType: "FUNCTIONAL",
        given: ["g"],
        when: ["w"],
        then: ["t"],
      }),
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

    const real = await prisma.testCase.findUnique({
      where: { id: created.id },
    });
    expect(real).not.toBeNull();
    expect(real?.projectId).toBe(projectId);
  });

  it("an unknown projectId is NOT_FOUND, not a silent empty result", async () => {
    const caller = await callerFor(ownerUserId);
    await expect(
      caller.testCases.list({ projectId: "does-not-exist" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("run history pagination (real DB, real router)", () => {
  it("reaches every older run exactly once, including equal timestamps", async () => {
    const prefix = `${RUN_ID}-history-`;
    const startedAt = new Date("2025-01-01T12:00:00.000Z");
    const ids = Array.from(
      { length: 45 },
      (_, index) => `${prefix}${String(index).padStart(3, "0")}`,
    );
    await prisma.testRun.createMany({
      data: ids.map((id) => ({
        id,
        projectId,
        ciProvider: "synthetic",
        commitSha: "fixture",
        branch: "fixture",
        startedAt,
        status: "PASSED",
      })),
    });
    try {
      const caller = await callerFor(viewerUserId);
      const seen: string[] = [];
      let before: { startedAt: Date; id: string } | undefined;
      for (let page = 0; page < 4; page++) {
        const runs = await caller.testRuns.list({
          projectId,
          take: 20,
          before,
        });
        seen.push(...runs.map((run) => run.id));
        if (runs.length < 20) break;
        const last = runs.at(-1)!;
        before = { startedAt: last.startedAt, id: last.id };
      }
      expect(seen).toEqual([...ids].reverse());
      expect(new Set(seen).size).toBe(45);
      // Another tenant's cursor is only an ordering value, never an ID lookup.
      const outsider = await callerFor(outsiderUserId);
      await expect(
        outsider.testRuns.list({
          projectId,
          take: 20,
          before: { startedAt, id: ids[0]! },
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        caller.testRuns.list({ projectId, take: 1.5 }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    } finally {
      await prisma.testRun.deleteMany({
        where: { projectId, id: { in: ids } },
      });
    }
  });
});

describe("staffProcedure (real DB, real router)", () => {
  it("rejects a non-staff email even with a valid session", async () => {
    const caller = await callerFor(outsiderUserId);
    await expect(
      caller.admin.listOrganizations({ query: "" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects another Skald and Stone email that is not explicitly allowlisted", async () => {
    const caller = await callerFor(staffUserId);
    await expect(
      caller.admin.listOrganizations({ query: "" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("admits only an explicitly allowlisted owner email", async () => {
    const previous = process.env.FULL_ACCESS_EMAIL_ALLOWLIST;
    process.env.FULL_ACCESS_EMAIL_ALLOWLIST = `${RUN_ID}-staff@skaldandstone.com`;
    const caller = await callerFor(staffUserId);
    try {
      await expect(
        caller.admin.listOrganizations({ query: "" }),
      ).resolves.toBeDefined();
    } finally {
      if (previous === undefined)
        delete process.env.FULL_ACCESS_EMAIL_ALLOWLIST;
      else process.env.FULL_ACCESS_EMAIL_ALLOWLIST = previous;
    }
  });

  it("a customer OWNER role does NOT grant staff access", async () => {
    const caller = await callerFor(ownerUserId);
    await expect(
      caller.admin.listOrganizations({ query: "" }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
