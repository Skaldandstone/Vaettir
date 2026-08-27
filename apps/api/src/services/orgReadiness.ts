import type { PrismaClient } from "@vaettir/db";
import { computeStatusesByTestPlan } from "./acceptanceCriteria.js";

const CRITERION_WEIGHT: Record<string, number> = { MET: 1, AT_RISK: 0.5, PENDING: 0.25, NOT_MET: 0 };
const FLAG_PENALTY: Record<string, number> = { CRITICAL: 20, HIGH: 10, MEDIUM: 5, LOW: 2 };

export interface Readiness {
  score: number;
  label: "READY" | "AT_RISK" | "BLOCKED";
  criteria: { met: number; atRisk: number; notMet: number; pending: number; total: number };
  riskFlags: { critical: number; high: number; medium: number; low: number; openTotal: number };
}

// Readiness is deliberately a simple, explainable rollup for this first
// pass (P7-03), not a tuned model: acceptance criteria contribute a 0-100
// base score by how MET they are, and open risk flags subtract from it by
// severity. Any open CRITICAL flag forces BLOCKED regardless of score --
// a critical gap shouldn't be hideable behind an otherwise-good score.
export function computeReadiness(criteria: { status: string }[], openFlags: { severity: string }[]): Readiness {
  const total = criteria.length;
  const met = criteria.filter((c) => c.status === "MET").length;
  const atRisk = criteria.filter((c) => c.status === "AT_RISK").length;
  const notMet = criteria.filter((c) => c.status === "NOT_MET").length;
  const pending = criteria.filter((c) => c.status === "PENDING").length;
  const criteriaScore =
    total === 0 ? 100 : (criteria.reduce((s, c) => s + (CRITERION_WEIGHT[c.status] ?? 0), 0) / total) * 100;

  const critical = openFlags.filter((f) => f.severity === "CRITICAL").length;
  const high = openFlags.filter((f) => f.severity === "HIGH").length;
  const medium = openFlags.filter((f) => f.severity === "MEDIUM").length;
  const low = openFlags.filter((f) => f.severity === "LOW").length;
  const penalty = Math.min(100, openFlags.reduce((s, f) => s + (FLAG_PENALTY[f.severity] ?? 0), 0));

  const score = Math.max(0, Math.round(criteriaScore - penalty));
  const label: Readiness["label"] = critical > 0 || score < 50 ? "BLOCKED" : score < 85 ? "AT_RISK" : "READY";

  return {
    score,
    label,
    criteria: { met, atRisk, notMet, pending, total },
    riskFlags: { critical, high, medium, low, openTotal: openFlags.length },
  };
}

export interface OrgOverviewProject {
  projectId: string;
  projectName: string;
  release: { id: string; name: string; status: string; readiness: Readiness } | null;
}

export interface OrgOverview {
  projects: OrgOverviewProject[];
  summary: { ready: number; atRisk: number; blocked: number; noActiveRelease: number };
}

// P7-06 / P7-09: shared by the releases.orgOverview query (human viewing
// the dashboard) and the readiness digest job (P7-09, no ctx/session) so
// what a Slack digest reports and what the dashboard shows can never
// silently drift apart.
export async function getOrgOverview(prisma: PrismaClient, organizationId: string): Promise<OrgOverview> {
  const projects = await prisma.project.findMany({
    where: { organizationId },
    orderBy: { name: "asc" },
  });

  const projectResults = await Promise.all(
    projects.map(async (p): Promise<OrgOverviewProject> => {
      const release = await prisma.release.findFirst({
        where: { projectId: p.id, status: { not: "SHIPPED" } },
        orderBy: { createdAt: "desc" },
        include: {
          testPlans: { include: { acceptanceCriteria: { select: { testPlanId: true, status: true } } } },
          riskFlags: { where: { resolvedAt: null }, select: { severity: true } },
        },
      });
      if (!release) return { projectId: p.id, projectName: p.name, release: null };

      const criteria = release.testPlans.flatMap((tp) => tp.acceptanceCriteria);
      const computedByPlan = await computeStatusesByTestPlan(
        prisma,
        criteria.map((c) => c.testPlanId),
      );
      const readiness = computeReadiness(
        criteria.map((c) => ({ status: computedByPlan.get(c.testPlanId) ?? c.status })),
        release.riskFlags,
      );
      return {
        projectId: p.id,
        projectName: p.name,
        release: { id: release.id, name: release.name, status: release.status, readiness },
      };
    }),
  );

  const summary = projectResults.reduce(
    (acc, r) => {
      if (!r.release) acc.noActiveRelease++;
      else if (r.release.readiness.label === "READY") acc.ready++;
      else if (r.release.readiness.label === "AT_RISK") acc.atRisk++;
      else acc.blocked++;
      return acc;
    },
    { ready: 0, atRisk: 0, blocked: 0, noActiveRelease: 0 },
  );

  return { projects: projectResults, summary };
}
