import type { PrismaClient, ReleaseGatePolicy } from "@vaettir/db";
import { computeStatusesByTestPlan } from "./acceptanceCriteria.js";

export interface ReleaseGateResult {
  policy: ReleaseGatePolicy;
  passes: boolean;
  reasons: string[];
}

// P7-08: "unmet" is deliberately narrow -- only a criterion whose (live,
// P7-02-computed where possible) status is NOT_MET blocks the gate.
// PENDING/AT_RISK are incompleteness or uncertainty, not failure, and
// already show up in the readiness score without forcing a hard stop here.
// An open CRITICAL risk flag blocks too, matching computeReadiness's own
// BLOCKED trigger in releases.ts -- the two shouldn't disagree about what
// "critical" means for the same release.
export async function evaluateReleaseGate(prisma: PrismaClient, releaseId: string): Promise<ReleaseGateResult> {
  const release = await prisma.release.findUniqueOrThrow({
    where: { id: releaseId },
    include: { project: { select: { organization: { select: { releaseGatePolicy: true } } } } },
  });
  const policy = release.project.organization.releaseGatePolicy;

  const criteria = await prisma.acceptanceCriterion.findMany({
    where: { testPlan: { releaseId } },
    select: { testPlanId: true, status: true, description: true },
  });
  const computedByPlan = await computeStatusesByTestPlan(
    prisma,
    criteria.map((c) => c.testPlanId),
  );

  const reasons: string[] = [];
  for (const c of criteria) {
    const status = computedByPlan.get(c.testPlanId) ?? c.status;
    if (status === "NOT_MET") reasons.push(`Acceptance criterion not met: "${c.description}"`);
  }

  const openCritical = await prisma.riskFlag.count({ where: { releaseId, resolvedAt: null, severity: "CRITICAL" } });
  if (openCritical > 0) {
    reasons.push(`${openCritical} open CRITICAL risk flag${openCritical === 1 ? "" : "s"}`);
  }

  return { policy, passes: reasons.length === 0, reasons };
}
