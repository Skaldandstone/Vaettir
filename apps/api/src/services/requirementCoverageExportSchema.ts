import { z } from "zod";
import { requirementCoverageInput, requirementCoverageScope } from "./requirementCoverageSchema.js";

// Pure contract. This is a complete live response, not concatenated browse pages,
// a project backup or a retained approved snapshot.
export const requirementCoverageExportInput = requirementCoverageInput.extend({
  search: z.string().trim().max(80).default(""),
}).strict();
const count = z.number().int().min(0).max(100000);
export const requirementCoverageExportOutcomes = z.object({
  PASS: count, FAIL: count, FLAKY: count, SKIP: count, BLOCKED: count, total: count,
  state: z.enum(["NO_RECORDED_RESULT", "ONLY_SKIPPED_OR_BLOCKED", "RECORDED_OUTCOMES"]),
}).strict().superRefine((value, context) => {
  const total = value.PASS + value.FAIL + value.FLAKY + value.SKIP + value.BLOCKED;
  const state = total === 0 ? "NO_RECORDED_RESULT" : value.PASS + value.FAIL + value.FLAKY === 0 ? "ONLY_SKIPPED_OR_BLOCKED" : "RECORDED_OUTCOMES";
  if (value.total !== total || value.state !== state) context.addIssue({ code: z.ZodIssueCode.custom, message: "Recorded counts and state disagree" });
});
export const requirementCoverageExportOutput = z.object({
  version: z.literal(1), projectId: z.string().min(1).max(200), organizationId: z.string().min(1).max(200),
  actorClerkUserId: z.string().min(1).max(200), requested: z.string().min(1).max(10000), observedAt: z.string().datetime(),
  window: z.object({ start: z.string().datetime(), end: z.string().datetime() }).strict(),
  appliedScope: requirementCoverageScope.nullable(), searchPresence: z.boolean(),
  selection: z.object({ mode: z.literal("SEARCH_OR_ALL"), requirementCount: z.number().int().min(0).max(1000) }).strict(),
  population: z.object({
    requirements: z.number().int().min(0).max(1000), unlinkedRequirements: z.number().int().min(0).max(1000),
    directPairs: z.number().int().min(0).max(1000), distinctCases: z.number().int().min(0).max(1000),
    archivedCases: z.number().int().min(0).max(1000), distinctCaseResultRecords: count,
    distinctCaseOutcomes: requirementCoverageExportOutcomes,
  }).strict(),
  rows: z.array(z.object({
    requirementOrdinal: z.number().int().min(1).max(1000),
    requirementTitle: z.string().min(1).max(180), titleIsExcerpt: z.boolean(),
    case: z.object({ displayId: z.string().min(1).max(200), title: z.string().min(1).max(180), titleIsExcerpt: z.boolean(), archived: z.boolean() }).strict().nullable(),
    outcomes: requirementCoverageExportOutcomes, plannedWithoutResult: z.number().int().min(0).max(10000),
  }).strict()).max(1000),
  limits: z.array(z.string().min(1).max(2000)).max(20),
}).strict().superRefine((value, context) => {
  const invalid = () => context.addIssue({ code: z.ZodIssueCode.custom, message: "Complete matrix rows and distinct population denominators disagree" });
  const requirements = new Map<number, { title: string; excerpt: boolean; linked: boolean; unlinked: boolean }>();
  const cases = new Map<string, { metadata: string; archived: boolean; outcomes: z.infer<typeof requirementCoverageExportOutcomes> }>();
  const pairs = new Set<string>();
  for (const row of value.rows) {
    const prior = requirements.get(row.requirementOrdinal);
    if (prior && (prior.title !== row.requirementTitle || prior.excerpt !== row.titleIsExcerpt)) invalid();
    const req = prior ?? { title: row.requirementTitle, excerpt: row.titleIsExcerpt, linked: false, unlinked: false };
    if (!row.case) {
      if (req.linked || req.unlinked || row.outcomes.total !== 0 || row.plannedWithoutResult !== 0) invalid();
      req.unlinked = true;
    } else {
      if (req.unlinked) invalid(); req.linked = true;
      const pair = JSON.stringify([row.requirementOrdinal, row.case.displayId]);
      if (pairs.has(pair)) invalid(); pairs.add(pair);
      const metadata = JSON.stringify({ case: row.case, outcomes: row.outcomes, plannedWithoutResult: row.plannedWithoutResult });
      const priorCase = cases.get(row.case.displayId);
      if (priorCase && priorCase.metadata !== metadata) invalid();
      if (!priorCase) cases.set(row.case.displayId, { metadata, archived: row.case.archived, outcomes: row.outcomes });
    }
    requirements.set(row.requirementOrdinal, req);
  }
  const counts = { PASS: 0, FAIL: 0, FLAKY: 0, SKIP: 0, BLOCKED: 0 };
  for (const row of cases.values()) for (const key of ["PASS", "FAIL", "FLAKY", "SKIP", "BLOCKED"] as const) counts[key] += row.outcomes[key];
  const unlinked = [...requirements.values()].filter(req => req.unlinked).length;
  if ([...requirements.keys()].sort((a, b) => a - b).some((ordinal, index) => ordinal !== index + 1) ||
    value.selection.requirementCount !== requirements.size || value.population.requirements !== requirements.size ||
    value.population.unlinkedRequirements !== unlinked || value.population.directPairs !== pairs.size || value.population.distinctCases !== cases.size ||
    value.population.archivedCases !== [...cases.values()].filter(row => row.archived).length ||
    value.population.distinctCaseResultRecords !== value.population.distinctCaseOutcomes.total ||
    Object.entries(counts).some(([key, count]) => value.population.distinctCaseOutcomes[key as keyof typeof counts] !== count)) invalid();
});
export type RequirementCoverageExport = z.infer<typeof requirementCoverageExportOutput>;
export type RequirementCoverageExportInput = z.infer<typeof requirementCoverageExportInput>;
