import type { AcceptanceCriterionStatus, PrismaClient, TestResultStatus } from "@vaettir/db";

// Shared by computeTestPlanAcceptanceStatus below and
// requirementTestSummary.ts's ticket-panel summary - both need "what was
// this test case's most recent result," and both must agree on what
// "most recent" means (ordered by the run's startedAt, not the result
// row's own id/createdAt, since results can be ingested out of order).
export async function getLatestResultByTestCase(
  prisma: PrismaClient,
  testCaseIds: string[],
): Promise<Map<string, { status: TestResultStatus; startedAt: Date }>> {
  if (testCaseIds.length === 0) return new Map();
  const results = await prisma.testResult.findMany({
    where: { testCaseId: { in: testCaseIds } },
    select: { testCaseId: true, status: true, testRun: { select: { startedAt: true } } },
    orderBy: { testRun: { startedAt: "desc" } },
  });
  const latestByCase = new Map<string, { status: TestResultStatus; startedAt: Date }>();
  for (const r of results) {
    if (!r.testCaseId || latestByCase.has(r.testCaseId)) continue;
    latestByCase.set(r.testCaseId, { status: r.status, startedAt: r.testRun.startedAt });
  }
  return latestByCase;
}

// P7-02: a criterion's scope is every TestCase attached to its TestPlan --
// the same plan a QA lead builds when defining what "done" means for a
// release. Computed live on every read rather than persisted/cron'd: a
// release readiness page is exactly the place staleness would be most
// visible and most damaging to trust.
//
// Rollup rule, ordered by how bad the signal is:
//   - any test case's latest result is FAIL           -> NOT_MET
//   - any test case has never run, or is FLAKY/SKIPped -> AT_RISK
//   - every test case's latest result is PASS          -> MET
// Returns null when the plan has no test cases at all -- nothing to compute
// from, so the caller should fall back to the criterion's manually-set
// status (e.g. a compliance sign-off criterion with no automated coverage).
export async function computeTestPlanAcceptanceStatus(
  prisma: PrismaClient,
  testPlanId: string,
): Promise<AcceptanceCriterionStatus | null> {
  const testCases = await prisma.testCase.findMany({ where: { testPlanId }, select: { id: true } });
  if (testCases.length === 0) return null;

  const latestByCase = await getLatestResultByTestCase(
    prisma,
    testCases.map((c) => c.id),
  );

  const latestStatuses = testCases.map((c) => latestByCase.get(c.id)?.status ?? null);
  if (latestStatuses.some((s) => s === "FAIL")) return "NOT_MET";
  if (latestStatuses.some((s) => s === null || s === "FLAKY" || s === "SKIP")) return "AT_RISK";
  return "MET";
}

// Batches the per-plan computation for every distinct testPlanId in a set
// of criteria, so callers rolling up a whole release don't run it once per
// criterion when several criteria commonly share one plan.
export async function computeStatusesByTestPlan(
  prisma: PrismaClient,
  testPlanIds: string[],
): Promise<Map<string, AcceptanceCriterionStatus | null>> {
  const unique = [...new Set(testPlanIds)];
  const entries = await Promise.all(unique.map(async (id) => [id, await computeTestPlanAcceptanceStatus(prisma, id)] as const));
  return new Map(entries);
}
