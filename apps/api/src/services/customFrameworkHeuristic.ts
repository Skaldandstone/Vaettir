import type { PrismaClient } from "@vaettir/db";

// P5-12: a project can in principle have more than one custom-framework
// heuristic (rare, but possible if a codebase mixes two bespoke test
// styles), so this picks the most recently created one as a pragmatic
// default rather than trying to disambiguate which heuristic applies to
// which specific file -- reverseEngineerTestFile only ever uses the hint
// text when the detected family is CUSTOM anyway, so a mismatched hint for
// an unusual second framework just reads as unhelpful context, not a wrong
// extraction.
export async function getMostRecentHeuristic(
  prisma: PrismaClient,
  projectId: string,
): Promise<{ id: string; description: string } | null> {
  return prisma.customFrameworkHeuristic.findFirst({
    where: { projectId },
    orderBy: { createdAt: "desc" },
    select: { id: true, description: true },
  });
}

export async function recordHeuristicUsage(prisma: PrismaClient, heuristicId: string): Promise<void> {
  await prisma.customFrameworkHeuristic.update({
    where: { id: heuristicId },
    data: { usageCount: { increment: 1 } },
  });
}
