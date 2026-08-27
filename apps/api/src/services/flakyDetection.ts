import type { PrismaClient } from "@vaettir/db";

const LOOKBACK = 10;
const TRANSITION_THRESHOLD = 2;

// P5-05: a PASS/FAIL alternation on the SAME branch across recent runs, not
// just "this test has ever failed" -- a test that failed once and then
// consistently passes isn't flaky, it was just broken and got fixed. Grouped
// per-branch since a legitimate code change on one branch flipping a result
// isn't the same signal as the same test bouncing on repeated runs of the
// same branch with no clear cause.
export async function recomputeFlaky(prisma: PrismaClient, testCaseId: string): Promise<boolean> {
  const results = await prisma.testResult.findMany({
    where: { testCaseId },
    include: { testRun: { select: { startedAt: true, branch: true } } },
    orderBy: { testRun: { startedAt: "desc" } },
    take: LOOKBACK,
  });

  const byBranch = new Map<string, ("PASS" | "FAIL")[]>();
  for (const r of results) {
    if (r.status !== "PASS" && r.status !== "FAIL") continue;
    const branch = r.testRun.branch;
    const list = byBranch.get(branch) ?? [];
    list.push(r.status);
    byBranch.set(branch, list);
  }

  let isFlaky = false;
  for (const statuses of byBranch.values()) {
    let transitions = 0;
    for (let i = 1; i < statuses.length; i++) {
      if (statuses[i] !== statuses[i - 1]) transitions++;
    }
    if (transitions >= TRANSITION_THRESHOLD) {
      isFlaky = true;
      break;
    }
  }

  await prisma.testCase.update({
    where: { id: testCaseId },
    data: { isFlaky, flakyDetectedAt: isFlaky ? new Date() : null },
  });
  return isFlaky;
}
