// P10-11-adjacent: importJobs (P11-01/P11-02) had only an ad-hoc throwaway
// verification script during development, no permanent regression coverage -
// this closes that gap using the same real-DB, real-appRouter pattern
// trpc.integration.test.ts established. Everything created here is scoped
// under one throwaway org/project, deleted in afterAll.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { prisma } from "@vaettir/db";
import { appRouter } from "../router.js";

const RUN_ID = `importjobs-test-${Date.now()}`;

const CSV = `Test Name,Preconditions,Steps,Expected,Priority,Labels
Login succeeds,User on login page,Enter creds|Click login,Redirected to dashboard,High,auth|smoke
Login fails,User on login page,Enter wrong creds|Click login,Error shown,Medium,auth
,Should be skipped,x,y,Low,
`;
const MAPPING = {
  title: "Test Name",
  given: "Preconditions",
  when: "Steps",
  then: "Expected",
  priority: "Priority",
  tags: "Labels",
};

let orgId: string;
let projectId: string;
let userId: string;

beforeAll(async () => {
  const freeTier = await prisma.planTier.findUniqueOrThrow({
    where: { key: "free" },
  });
  const org = await prisma.organization.create({
    data: {
      name: `ImportJobs test org ${RUN_ID}`,
      slug: `importjobs-test-${RUN_ID}`,
      planTier: { connect: { id: freeTier.id } },
    },
  });
  orgId = org.id;
  const project = await prisma.project.create({
    data: {
      organizationId: orgId,
      name: "ImportJobs test project",
      slug: "importjobs-test-project",
    },
  });
  projectId = project.id;
  const user = await prisma.user.create({
    data: {
      clerkUserId: `${RUN_ID}-editor`,
      email: `${RUN_ID}-editor@example.com`,
    },
  });
  userId = user.id;
  await prisma.membership.create({
    data: { organizationId: orgId, userId, role: "EDITOR" },
  });
});

afterAll(async () => {
  if (!orgId) return;
  if (projectId) {
    await prisma.testCaseVersion.deleteMany({
      where: { testCase: { projectId } },
    });
    await prisma.testCase.deleteMany({ where: { projectId } });
    await prisma.importJob.deleteMany({ where: { projectId } });
  }
  await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
  await prisma.project.deleteMany({ where: { organizationId: orgId } });
  await prisma.membership.deleteMany({ where: { organizationId: orgId } });
  if (userId) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.organization.delete({ where: { id: orgId } });
});

async function caller() {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    include: { memberships: true },
  });
  return appRouter.createCaller({ prisma, user });
}

describe("importJobs (real DB, real router)", () => {
  it("previewCsv auto-suggests every column except title (no exact alias match)", async () => {
    const c = await caller();
    const preview = await c.importJobs.previewCsv({ projectId, csvText: CSV });
    expect(preview.suggestedMapping.title).toBeUndefined();
    expect(preview.suggestedMapping.given).toBe("Preconditions");
    expect(preview.suggestedMapping.when).toBe("Steps");
    expect(preview.suggestedMapping.then).toBe("Expected");
    expect(preview.rowCount).toBe(3);
  });

  it("previewWithMapping retains the row missing a title for repair", async () => {
    const c = await caller();
    const preview = await c.importJobs.previewWithMapping({
      projectId,
      csvText: CSV,
      mapping: MAPPING,
    });
    expect(preview.previewRows).toHaveLength(2);
    expect(preview.previewRows[0]).toMatchObject({
      title: "Login succeeds",
      given: ["User on login page"],
      when: ["Enter creds", "Click login"],
      then: ["Redirected to dashboard"],
      priority: "HIGH",
      tags: ["auth", "smoke"],
    });
    expect(preview.previewSkipped).toEqual([
      { rowNumber: 4, reason: "missing title" },
    ]);
    expect(preview.incompleteRows).toEqual([
      expect.objectContaining({
        rowNumber: 4,
        title: "",
        given: ["Should be skipped"],
        when: ["x"],
        then: ["y"],
      }),
    ]);
  });

  it("commitCsv creates repaired rows instead of silently dropping them", async () => {
    const c = await caller();
    const result = await c.importJobs.commitCsv({
      projectId,
      csvText: CSV,
      mapping: MAPPING,
      overrides: [{ rowNumber: 4, title: "Recovered title" }],
      sourceLabel: "integration-test.csv",
    });
    expect(result.createdCount).toBe(3);
    expect(result.skipped).toEqual([]);

    const job = await prisma.importJob.findUniqueOrThrow({
      where: { id: result.importJobId },
    });
    expect(job.source).toBe("CSV");
    expect(job.status).toBe("SUCCEEDED");
    expect(job.createdCount).toBe(3);
    expect(job.fieldMapping).toEqual(MAPPING);

    const cases = await prisma.testCase.findMany({
      where: { projectId, origin: "IMPORTED" },
    });
    expect(cases.map((tc) => tc.title).sort()).toEqual([
      "Login fails",
      "Login succeeds",
      "Recovered title",
    ]);

    const list = await c.importJobs.list({ projectId });
    expect(list[0]?.id).toBe(result.importJobId);
    expect(list[0]?.createdByName).toBeTruthy();
  });

  it("commitCsv rejects a mapping with no title column", async () => {
    const c = await caller();
    await expect(
      c.importJobs.commitCsv({
        projectId,
        csvText: CSV,
        mapping: { given: "Preconditions" } as never,
      }),
    ).rejects.toThrow();
  });

  // P11-11: mapping an external-id column makes an import re-runnable -
  // committing an updated CSV with the same ids should update the matching
  // TestCase in place, not create a duplicate alongside it.
  it("commitCsv with an externalId mapping updates a matching row in place on re-import", async () => {
    const c = await caller();
    const mapping = { title: "Title", then: "Then", externalId: "Id" };
    const v1 = `Id,Title,Then\nEXT-1,Original title,Original then\n`;
    const commit1 = await c.importJobs.commitCsv({
      projectId,
      csvText: v1,
      mapping,
      sourceLabel: "resync-v1.csv",
    });
    expect(commit1.createdCount).toBe(1);
    expect(commit1.updatedCount).toBe(0);

    const v2 = `Id,Title,Then\nEXT-1,Updated title,Original then\n`;
    const commit2 = await c.importJobs.commitCsv({
      projectId,
      csvText: v2,
      mapping,
      sourceLabel: "resync-v2.csv",
    });
    expect(commit2.createdCount).toBe(0);
    expect(commit2.updatedCount).toBe(1);

    const matching = await prisma.testCase.findMany({
      where: { projectId, title: { in: ["Original title", "Updated title"] } },
    });
    expect(matching).toHaveLength(1);
    expect(matching[0]?.title).toBe("Updated title");
  });
});
