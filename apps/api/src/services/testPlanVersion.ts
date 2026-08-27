import type { PrismaClient, TestPlanStatus } from "@vaettir/db";

// P4-05: called after every create/update so a strategy that evolves
// release to release has a real history to look back at, not just the
// AuditLog's one-line summary. versionNumber is sequential per plan (1 at
// creation); computed from the max existing version rather than counting
// rows, so a version is never reused if one were ever deleted.
export async function snapshotTestPlanVersion(
  prisma: PrismaClient,
  args: {
    testPlanId: string;
    name: string;
    description: string | null;
    status: TestPlanStatus;
    customFields: unknown;
    actorId: string;
  },
) {
  const last = await prisma.testPlanVersion.findFirst({
    where: { testPlanId: args.testPlanId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  await prisma.testPlanVersion.create({
    data: {
      testPlanId: args.testPlanId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      name: args.name,
      description: args.description,
      status: args.status,
      customFields: args.customFields as never,
      createdById: args.actorId,
    },
  });
}
