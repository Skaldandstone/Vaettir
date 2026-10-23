import { z } from "zod";
import { caseFieldReadScopeSchema } from "./caseFieldReadScope.js";

export const PROJECT_TAG_PAGE_SIZE = 50;
export const MAX_TAG_MATCHING_CASES = 20000;
export const MAX_TAG_RELATIONSHIPS = 100000;
export const MAX_TAG_IDENTITY_BYTES = 4 * 1024 * 1024;
export const MAX_TAG_RELATION_BYTES = 8 * 1024 * 1024;
export const MAX_TAG_COHORT_BYTES = 4 * 1024 * 1024;
export const MAX_TAG_PAGE_BYTES = 1024 * 1024;
const nativeText = (value: string) =>
  !value.includes("\0") &&
  Array.from(value).every((character) => {
    const point = character.codePointAt(0)!;
    return point < 0xd800 || point > 0xdfff;
  });
const id = z
  .string()
  .min(1)
  .max(200)
  .refine(nativeText, "Identity contains unsupported native Unicode.")
  .refine(
    (value) => Buffer.byteLength(value, "utf8") <= 800,
    "Identity exceeds its byte bound.",
  );
const digest = z.string().regex(/^[a-f0-9]{64}$/);
export const projectTagSection = z.enum([
  "CASES",
  "PLANS",
  "RELEASES",
  "REQUIREMENTS",
]);
export const projectTagCursor = z
  .object({
    scopeHash: digest,
    populationHash: z.string().regex(/^[a-f0-9]{32}$/),
    afterId: id,
  })
  .strict();
export const projectTagPageInput = z
  .object({
    projectId: id,
    originalOrganizationId: id,
    expectedClerkActorId: id,
    requestId: z.string().uuid(),
    // No trim, min-length or parser default. Empty/whitespace retained tags are
    // distinct exact identities, not an instruction to show every case.
    tag: z
      .string()
      .max(2000)
      .refine(nativeText, "Tag contains unsupported native Unicode.")
      .refine(
        (value) => Buffer.byteLength(value, "utf8") <= 8192,
        "Tag identity exceeds its byte bound.",
      ),
    section: projectTagSection,
    archive: z.enum(["ACTIVE", "ARCHIVED", "ALL"]),
    review: z.enum(["APPROVED", "PENDING_REVIEW", "REJECTED", "ALL"]),
    cursor: projectTagCursor.optional(),
  })
  .strict();
export const PROJECT_TAG_EDGES = {
  CASES: "DIRECT_CASE_TAG",
  PLANS: "DIRECT_CASE_PLAN",
  RELEASES: "DIRECT_CASE_PLAN_RELEASE",
  REQUIREMENTS: "ACTIVE_CASE_REQUIREMENT_REFERENCE",
} as const;
export const projectTagRow = z
  .object({
    id,
    title: z.string().max(10000),
    matchingCaseCount: z.number().int().min(1).max(MAX_TAG_MATCHING_CASES),
    edge: z.enum([
      "DIRECT_CASE_TAG",
      "DIRECT_CASE_PLAN",
      "DIRECT_CASE_PLAN_RELEASE",
      "ACTIVE_CASE_REQUIREMENT_REFERENCE",
    ]),
    displayId: z.string().max(200).optional(),
    caseNumber: z.number().int().nonnegative().optional(),
    reviewStatus: z.string().max(100).optional(),
    archived: z.boolean().optional(),
    status: z.string().max(100).optional(),
  })
  .strict();
export const projectTagPageOutput = z
  .object({
    projectId: id,
    organizationId: id,
    clerkActorId: id,
    requestId: z.string().uuid(),
    readScope: caseFieldReadScopeSchema,
    scopeHash: digest,
    tag: projectTagPageInput.shape.tag,
    section: projectTagSection,
    archive: projectTagPageInput.shape.archive,
    review: projectTagPageInput.shape.review,
    asOf: z.string().datetime(),
    total: z.number().int().min(0).max(MAX_TAG_MATCHING_CASES),
    matchingCases: z.number().int().min(0).max(MAX_TAG_MATCHING_CASES),
    items: z.array(projectTagRow).max(PROJECT_TAG_PAGE_SIZE),
    nextCursor: projectTagCursor.nullable(),
    limitations: z.array(z.string().max(2000)).max(10),
  })
  .strict();
export type ProjectTagPageInput = z.infer<typeof projectTagPageInput>;
export type ProjectTagRow = z.infer<typeof projectTagRow>;
export const projectTagLimitations = [
  "Current exact tag values belong to cases only. Other records are linked through currently tagged cases, not directly tagged entities, verified coverage or release readiness.",
  "Counts are complete only for this requested section and explicit current archive/review scope. Each page is a fresh current read, not a frozen cross-section or historical snapshot.",
  "Plans use only current TestCase.testPlanId; releases use that same direct plan's releaseId. Saved execution-template selections and strategy/child-plan expansion are not included.",
  "Requirements use only active same-project CaseTraceabilityLink.requirementId references. Requirements mentioned by a plan's acceptance criteria are a different relationship and are not included.",
  "Runs, historical TestCaseVersion tags, frozen run-time tag attribution, external provider verification, defect-document clusters, presets and arbitrary customFields tag strings are not included.",
  "At most 20,000 matching cases/entities, 100,000 direct requirement references, 4 MiB matched identities, 8 MiB reference identities, 4 MiB cohort metadata and 1 MiB projected page metadata; 50 rows per page. Unsupported, foreign or oversized scope refuses instead of silently becoming a smaller or empty cohort.",
  "Cursors are advisory current-read scope/population/anchor bindings, not authorization credentials. Every page independently rechecks current original-organization and signed-in actor access. A changed population must be restarted.",
] as const;
