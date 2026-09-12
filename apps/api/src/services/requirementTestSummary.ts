import type { PrismaClient } from "@vaettir/db";
import { getLatestResultByTestCase } from "./acceptanceCriteria.js";

/**
 * Direct request: make the Jira/Linear side of this integration genuinely
 * informative about test status - Zephyr's and TestRail's own ticket
 * panels were named as the bar to clear (typically a bare "N test cases
 * linked" count with a link, no pass/fail breakdown, no risk context).
 * This is the data half of that - a real Jira/Linear app panel is real,
 * separate work needing its own developer-account registration to ever
 * run live (same category of gap as EAS/Apple/Google elsewhere), but the
 * genuinely deployable-today version is a rich Open Graph link preview
 * (see /share/requirements/[token] in apps/web) - both Jira Smart Links
 * and Linear's own link previews render one for any URL pasted into an
 * issue, with zero app installation required.
 */

const RISK_SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

export interface RequirementTestSummary {
  requirementId: string;
  requirementTitle: string;
  requirementDescription: string | null;
  acceptanceCriteria: { total: number; met: number; pending: number; notMet: number; atRisk: number };
  testCases: {
    total: number;
    passing: number;
    failing: number;
    neverRun: number;
    other: number; // FLAKY/SKIP/BLOCKED - not a clean pass, not a clean fail
    pendingReview: number;
  };
  failingTestCases: { id: string; title: string; lastRunAt: string | null }[];
  openRiskFlags: { id: string; severity: string; description: string }[];
}

export async function computeRequirementTestSummary(prisma: PrismaClient, requirementId: string): Promise<RequirementTestSummary> {
  const requirement = await prisma.requirement.findUniqueOrThrow({
    where: { id: requirementId },
    include: { acceptanceCriteria: { select: { id: true, status: true, testPlanId: true } } },
  });

  const acceptanceCriteria = {
    total: requirement.acceptanceCriteria.length,
    met: requirement.acceptanceCriteria.filter((c) => c.status === "MET").length,
    pending: requirement.acceptanceCriteria.filter((c) => c.status === "PENDING").length,
    notMet: requirement.acceptanceCriteria.filter((c) => c.status === "NOT_MET").length,
    atRisk: requirement.acceptanceCriteria.filter((c) => c.status === "AT_RISK").length,
  };

  // A requirement's relevant test cases are every case in every TestPlan
  // its acceptance criteria belong to - the same scope P7-02's own
  // acceptance-status rollup already uses, just aggregated across every
  // criterion's plan instead of one plan at a time.
  const testPlanIds = [...new Set(requirement.acceptanceCriteria.map((c) => c.testPlanId))];
  const testCases =
    testPlanIds.length > 0
      ? await prisma.testCase.findMany({
          where: { testPlanId: { in: testPlanIds } },
          select: { id: true, title: true, reviewStatus: true },
        })
      : [];

  const latestByCase = await getLatestResultByTestCase(
    prisma,
    testCases.map((c) => c.id),
  );

  let passing = 0;
  let failing = 0;
  let neverRun = 0;
  let other = 0;
  const failingTestCases: RequirementTestSummary["failingTestCases"] = [];
  for (const tc of testCases) {
    const latest = latestByCase.get(tc.id);
    if (!latest) {
      neverRun += 1;
    } else if (latest.status === "PASS") {
      passing += 1;
    } else if (latest.status === "FAIL") {
      failing += 1;
      failingTestCases.push({ id: tc.id, title: tc.title, lastRunAt: latest.startedAt.toISOString() });
    } else {
      other += 1;
    }
  }
  failingTestCases.sort((a, b) => (b.lastRunAt ?? "").localeCompare(a.lastRunAt ?? ""));

  const pendingReview = testCases.filter((c) => c.reviewStatus === "PENDING_REVIEW").length;

  const openRiskFlagRows = await prisma.riskFlag.findMany({
    where: { resolvedAt: null, release: { projectId: requirement.projectId } },
    select: { id: true, severity: true, description: true, createdAt: true },
  });
  const openRiskFlags = openRiskFlagRows
    .sort((a, b) => RISK_SEVERITY_RANK[a.severity]! - RISK_SEVERITY_RANK[b.severity]! || b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, 5)
    .map((f) => ({ id: f.id, severity: f.severity, description: f.description }));

  return {
    requirementId: requirement.id,
    requirementTitle: requirement.title,
    requirementDescription: requirement.description,
    acceptanceCriteria,
    testCases: { total: testCases.length, passing, failing, neverRun, other, pendingReview },
    failingTestCases: failingTestCases.slice(0, 10),
    openRiskFlags,
  };
}
