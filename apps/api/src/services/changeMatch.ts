import type { PrismaClient } from "@vaettir/db";
import { fallbackRiskScoreFromPriority } from "@vaettir/core";


export interface ChangeMatchRecommendation {
  testCaseId: string;
  title: string;
  matchReason: string;
  riskScore: number | null;
  riskSeverity: string | null;
  sourceFilePath: string | null;
}

export interface ChangeMatchResult {
  mustRun: ChangeMatchRecommendation[];
  coverageGaps: string[];
}

// Shared by riskAnalysis.recommendForChange (human-triggered, from the Test
// Strategy page) and the GitHub webhook handler (P6-01) -- both need the
// exact same "which known test cases does this diff touch, and which
// changed files have no coverage at all" logic, extracted here so a PR
// scan and a manual pre-release check never quietly drift apart.
export async function matchChangedFilesToTestCases(
  prisma: PrismaClient,
  projectId: string,
  changedFiles: string[],
): Promise<ChangeMatchResult> {
  const candidates = await prisma.testCase.findMany({
    where: { projectId, source: { filePath: { in: changedFiles } } },
    include: { source: { select: { filePath: true } } },
  });

  const matchedFiles = new Set(candidates.map((c) => c.source?.filePath).filter((f): f is string => !!f));
  const coverageGaps = changedFiles.filter((f) => !matchedFiles.has(f));

  const mustRun = candidates
    .map((tc) => ({
      testCaseId: tc.id,
      title: tc.title,
      matchReason: `Source file changed: ${tc.source?.filePath}`,
      riskScore: tc.riskScore ?? fallbackRiskScoreFromPriority(tc.priority),
      riskSeverity: tc.riskSeverity,
      sourceFilePath: tc.source?.filePath ?? null,
    }))
    .sort((a, b) => b.riskScore - a.riskScore);

  return { mustRun, coverageGaps };
}
