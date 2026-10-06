import { Prisma, type PrismaClient, type TestPlanStatus } from "@vaettir/db";

// Json columns are non-nullable; native JSON null is not database NULL.
// Preserve nested values verbatim and use Prisma's explicit write sentinel
// only for a top-level JSON null. Missing legacy templates alone default {}.
const versionJson = (value: unknown) =>
  value === null ? Prisma.JsonNull : value;

// P4-05: called after every create/update so a strategy that evolves
// release to release has a real history to look back at, not just the
// AuditLog's one-line summary. versionNumber is sequential per plan (1 at
// creation); computed from the max existing version rather than counting
// rows, so a version is never reused if one were ever deleted.
export async function snapshotTestPlanVersion(
  prisma: PrismaClient | Prisma.TransactionClient,
  args: {
    testPlanId: string;
    name: string;
    description: string | null;
    status: TestPlanStatus;
    customFields: unknown;
    executionTemplate?: unknown;
    actorId: string;
  },
) {
  const last = await prisma.testPlanVersion.findFirst({
    where: { testPlanId: args.testPlanId },
    orderBy: { versionNumber: "desc" },
    select: { versionNumber: true },
  });
  return prisma.testPlanVersion.create({
    data: {
      testPlanId: args.testPlanId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      name: args.name,
      description: args.description,
      status: args.status,
      customFields: versionJson(args.customFields) as never,
      executionTemplate: versionJson(
        args.executionTemplate === undefined ? {} : args.executionTemplate,
      ) as never,
      createdById: args.actorId,
    },
  });
}
