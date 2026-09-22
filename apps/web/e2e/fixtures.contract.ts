import { test as browserTest, expect } from "./fixtures";
import { prisma } from "@vaettir/db";
import { bootstrapBetaOrganization } from "../../api/src/services/privateBeta";

const test = browserTest;

test("member fixture contains deterministic project, run, coverage and control data", async ({ isolatedOrg }) => {
  const project = await prisma.project.findFirstOrThrow({ where: { organizationId: isolatedOrg, slug: "beta-fixture" } });
  expect(await prisma.testCase.count({ where: { projectId: project.id } })).toBe(3);
  expect(await prisma.testResult.count({ where: { testRun: { projectId: project.id } } })).toBe(3);
  expect((await prisma.coverageReport.findFirstOrThrow({ where: { projectId: project.id } })).linesCovered).toBe(8);
  expect((await prisma.healingSuggestion.findFirstOrThrow({ where: { projectId: project.id } })).status).toBe("PENDING");
  expect(await prisma.testCaseComplianceControl.count({ where: { testCase: { projectId: project.id } } })).toBe(1);
});

test.describe("read-only fixture", () => {
  test.use({ memberRole: "VIEWER", memberSeat: "READ_ONLY" });
  test("has a separate owner and read-only invited user", async ({ isolatedOrg }) => {
    const members = await prisma.membership.findMany({ where: { organizationId: isolatedOrg } });
    expect(members.map((member) => member.role).sort()).toEqual(["OWNER", "VIEWER"]);
    expect(members.find((member) => member.role === "VIEWER")?.seatType).toBe("READ_ONLY");
  });
});

test.describe("invitation fixture", () => {
  test.use({ fixtureMode: "invitation" });
  test("recipient has no membership before accepting", async ({ isolatedOrg }) => {
    const invite = await prisma.invitation.findFirstOrThrow({ where: { organizationId: isolatedOrg } });
    expect(invite.status).toBe("PENDING");
    expect(await prisma.membership.count({ where: { user: { clerkUserId: process.env.CLERK_TEST_USER_ID } } })).toBe(0);
  });
});

test.describe("enrolled fixture", () => {
  test.use({ fixtureMode: "enrolled" });
  test("can bootstrap a new beta organization", async ({ isolatedOrg }) => {
    expect(isolatedOrg).toBe("");
    const user = await prisma.user.findUniqueOrThrow({ where: { clerkUserId: process.env.CLERK_TEST_USER_ID! } });
    const org = await bootstrapBetaOrganization(prisma, user, "Fixture contract owner onboarding");
    expect((await prisma.membership.findFirstOrThrow({ where: { organizationId: org.id } })).role).toBe("OWNER");
  });
});

test.describe("unenrolled fixture", () => {
  test.use({ fixtureMode: "unenrolled" });
  test("starts without admission or membership", async ({ isolatedOrg }) => {
    expect(isolatedOrg).toBe("");
    expect(await prisma.membership.count({ where: { user: { clerkUserId: process.env.CLERK_TEST_USER_ID } } })).toBe(0);
    expect(await prisma.betaEnrollment.findUnique({ where: { email: process.env.CLERK_TEST_EMAIL! } })).toBeNull();
  });
});

test.afterAll(async () => {
  expect(await prisma.organization.count({ where: { slug: { startsWith: "e2e-" } } })).toBe(0);
  expect(await prisma.betaEnrollment.count({ where: { email: process.env.CLERK_TEST_EMAIL } })).toBe(0);
  await prisma.$disconnect();
});
