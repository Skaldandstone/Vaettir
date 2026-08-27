import { minimatch } from "minimatch";
import type { PrismaClient, RiskSeverity } from "@vaettir/db";

export interface PathSeverityRule {
  pattern: string;
  severity: RiskSeverity;
}

const VALID_SEVERITIES = new Set<RiskSeverity>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);

// Defensive parse rather than trusting the stored JSON blindly -- a
// malformed or hand-edited row shouldn't crash gap detection, it should
// just fall back to no rules (every gap gets the flat default severity).
export function parsePathSeverityRules(raw: unknown): PathSeverityRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: PathSeverityRule[] = [];
  for (const entry of raw) {
    if (
      entry &&
      typeof entry === "object" &&
      typeof (entry as Record<string, unknown>).pattern === "string" &&
      VALID_SEVERITIES.has((entry as Record<string, unknown>).severity as RiskSeverity)
    ) {
      rules.push({ pattern: (entry as Record<string, unknown>).pattern as string, severity: (entry as Record<string, unknown>).severity as RiskSeverity });
    }
  }
  return rules;
}

// P6-06: a gap in a payments/auth path isn't the same risk as one in a
// docs folder -- matched in array order, first match wins, so a project
// can layer a narrow override ahead of a broad catch-all. Falls back to
// the pre-P6-06 flat HIGH when no project policy exists or nothing matches,
// so a project that's never configured this gets identical behavior to
// before this ticket.
const DEFAULT_GAP_SEVERITY: RiskSeverity = "HIGH";

export function severityForPath(filePath: string, rules: PathSeverityRule[]): RiskSeverity {
  for (const rule of rules) {
    if (minimatch(filePath, rule.pattern)) return rule.severity;
  }
  return DEFAULT_GAP_SEVERITY;
}

export async function getPathSeverityRules(prisma: PrismaClient, projectId: string): Promise<PathSeverityRule[]> {
  const policy = await prisma.prScanPolicy.findUnique({ where: { projectId }, select: { pathSeverityRules: true } });
  if (!policy) return [];
  return parsePathSeverityRules(policy.pathSeverityRules);
}
