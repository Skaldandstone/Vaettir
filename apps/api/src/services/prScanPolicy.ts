import type { PrismaClient, RiskSeverity } from "@vaettir/db";
import { compilePathGlob, matchCompiledPathGlob, PATH_GLOB_LIMITS } from "./boundedPathGlob.js";

export interface PathSeverityRule {
  pattern: string;
  severity: RiskSeverity;
}

const VALID_SEVERITIES = new Set<RiskSeverity>(["CRITICAL", "HIGH", "MEDIUM", "LOW"]);
const unsafeParsedPolicies = new WeakMap<PathSeverityRule[], RiskSeverity>();

// Defensive parse rather than trusting the stored JSON blindly -- a
// malformed or hand-edited row must not crash gap detection. Recognized
// unsupported rules remain visible and evaluate conservatively, not as LOW.
export function parsePathSeverityRules(raw: unknown): PathSeverityRule[] {
  if (!Array.isArray(raw)) return [];
  const rules: PathSeverityRule[] = [];
  // An unknown suffix must not conceal a CRITICAL rule. Bound parsing and use
  // a conservative evaluation marker, not an invented/mutated stored JSON rule.
  if (raw.length > PATH_GLOB_LIMITS.rules) unsafeParsedPolicies.set(rules, "CRITICAL");
  for (const entry of raw.slice(0, PATH_GLOB_LIMITS.rules)) {
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

// Used by input validation as well as persisted-policy validation. No recursive
// expansion or regular-expression execution is needed to validate a pattern.
export function validatePathSeverityPattern(pattern: string): boolean {
  return compilePathGlob(pattern) !== undefined;
}

// P6-06: a gap in a payments/auth path isn't the same risk as one in a
// docs folder -- matched in array order, first match wins, so a project
// can layer a narrow override ahead of a broad catch-all. Falls back to
// the pre-P6-06 flat HIGH when no project policy exists or nothing matches,
// so a project that's never configured this gets identical behavior to
// before this ticket.
const DEFAULT_GAP_SEVERITY: RiskSeverity = "HIGH";

function unsafePolicySeverity(rules: PathSeverityRule[]): RiskSeverity {
  if (rules.length > PATH_GLOB_LIMITS.rules || unsafeParsedPolicies.get(rules) === "CRITICAL") return "CRITICAL";
  return rules.some(rule => rule.severity === "CRITICAL") ? "CRITICAL" : DEFAULT_GAP_SEVERITY;
}

export function severityForPath(filePath: string, rules: PathSeverityRule[]): RiskSeverity {
  if (rules.length > PATH_GLOB_LIMITS.rules || unsafeParsedPolicies.has(rules)) return unsafePolicySeverity(rules);
  // Validate the complete policy before applying any lower-risk override. An
  // invalid rule cannot be skipped into a later permissive catch-all.
  const compiled = rules.map(rule => compilePathGlob(rule.pattern));
  if (compiled.some(glob => !glob) || rules.some(rule => !VALID_SEVERITIES.has(rule.severity))) return unsafePolicySeverity(rules);
  const budget = { remaining: PATH_GLOB_LIMITS.operations };
  for (let index = 0; index < rules.length; index++) {
    const matches = matchCompiledPathGlob(filePath, compiled[index]!, budget);
    if (matches === undefined) return unsafePolicySeverity(rules);
    if (matches) return rules[index]!.severity;
  }
  return DEFAULT_GAP_SEVERITY;
}

export async function getPathSeverityRules(prisma: PrismaClient, projectId: string): Promise<PathSeverityRule[]> {
  const policy = await prisma.prScanPolicy.findUnique({ where: { projectId }, select: { pathSeverityRules: true } });
  if (!policy) return [];
  return parsePathSeverityRules(policy.pathSeverityRules);
}
