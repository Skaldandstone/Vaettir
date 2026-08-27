import type { PrismaClient, TestCasePriority, TestCaseType } from "@vaettir/db";

// Mirrors services/testPlanVersion.ts's snapshotTestPlanVersion exactly -
// same "sequential per parent, computed from the max existing version so
// a number is never reused" reasoning. Called after every create/update/
// CSV-import of a TestCase.
export async function snapshotTestCaseVersion(
  prisma: PrismaClient,
  args: {
    testCaseId: string;
    title: string;
    background: string | null;
    given: string[];
    when: string[];
    then: string[];
    steps: Array<{
      order: number;
      action: string;
      expectedActionOrData: string | null;
      expectedResult: string | null;
      expectedResponse: string | null;
    }>;
    tags: string[];
    priority: TestCasePriority;
    testType: TestCaseType;
    actorId: string | null;
  },
) {
  const last = await prisma.testCaseVersion.findFirst({
    where: { testCaseId: args.testCaseId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  await prisma.testCaseVersion.create({
    data: {
      testCaseId: args.testCaseId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      title: args.title,
      background: args.background,
      given: args.given,
      when: args.when,
      then: args.then,
      steps: args.steps as never,
      tags: args.tags,
      priority: args.priority,
      testType: args.testType,
      createdById: args.actorId ?? undefined,
    },
  });
}
