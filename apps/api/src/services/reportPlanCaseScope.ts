import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { testPlanExecutionTemplateSchema } from "./qualityExperienceProfile.js";

const MAX_PLANS = 200,
  MAX_TEMPLATE_BYTES = 4 * 1024 * 1024,
  MAX_PAIRS = 100000,
  MAX_CASES = 20000,
  MAX_ID_UNITS = 200,
  MAX_CASE_ID_BYTES = 4 * 1024 * 1024;
const refusal = (detail: string) =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `The complete selected plan cohort cannot be reported: ${detail}. No foreign, unavailable or overbound cases were silently omitted.`,
  });
const nativeId = (value: unknown): value is string => {
  if (typeof value !== "string" || !value.length || value.length > MAX_ID_UNITS)
    return false;
  for (let n = 0; n < value.length; n++) {
    const unit = value.charCodeAt(n);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++n);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) return false;
  }
  return true;
};

export const reportPlanCaseScopeLimitations = [
  "This cohort is the distinct union of current same-project directly plan-linked cases and cases named in each supported saved execution template. Archived cases are retained for the report's explicit inventory filters.",
  "Current plan membership and saved scope are not historical reconstruction, requirement coverage, recorded execution, verified mitigation or release readiness.",
  "At most 200 plans, 4 MiB saved-template metadata, 100,000 declared linked/saved relationships, 20,000 distinct case identities and 4 MiB serialized case identities. Missing, foreign, unsupported or overbound scope refuses rather than becoming a partial cohort.",
];

export function reportPlanCaseScopeIds(
  projectId: unknown,
  planIds: unknown,
): string[] {
  if (
    !nativeId(projectId) ||
    !Array.isArray(planIds) ||
    planIds.length > MAX_PLANS ||
    planIds.some((id) => !nativeId(id)) ||
    new Set(planIds).size !== planIds.length
  )
    throw refusal("unsupported project or plan identities");
  return [...planIds] as string[];
}

export function readReportPlanTemplateCaseIds(value: unknown): string[] {
  if (
    value &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(value).length === 0
  )
    return [];
  const parsed = testPlanExecutionTemplateSchema.safeParse(value);
  if (!parsed.success)
    throw refusal("a saved execution template is unsupported or invalid");
  return parsed.data.testCaseIds;
}

export function mergeReportPlanCaseIds(
  linked: string[],
  saved: string[],
): string[] {
  if (linked.some((id) => !nativeId(id)) || saved.some((id) => !nativeId(id)))
    throw refusal("case identity metadata exceeds supported bounds");
  const ids = [...new Set([...linked, ...saved])].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  if (
    ids.length > MAX_CASES ||
    Buffer.byteLength(JSON.stringify(ids), "utf8") > MAX_CASE_ID_BYTES
  )
    throw refusal("the distinct case identity population exceeds its bounds");
  return ids;
}

/** Caller must first verify current tenant access, hold selected same-project
 * plan locks, and use the report's repeatable-read transaction. This helper is
 * a cohort reader, not an authorization endpoint or a release-plan resolver. */
export async function readReportPlanCaseScope(
  tx: Prisma.TransactionClient,
  projectId: string,
  rawPlanIds: string[],
) {
  const planIds = reportPlanCaseScopeIds(projectId, rawPlanIds);
  if (!planIds.length) return { caseIds: [], limitations: [] as string[] };
  // Gate persisted JSON in SQL before loading any executionTemplate. Legacy{}
  // is valid; unsupported envelopes never become a guessed empty saved scope.
  const [gate] = await tx.$queryRaw<
    Array<{
      plans: bigint;
      foreign: bigint;
      templateBytes: bigint;
      supported: boolean;
    }>
  >(Prisma.sql`
    SELECT count(*) AS plans,count(*) FILTER (WHERE "projectId"<>${projectId}) AS "foreign",
      COALESCE(sum(octet_length("executionTemplate"::text)),0) AS "templateBytes",
      COALESCE(bool_and("executionTemplate"='{}'::jsonb OR COALESCE(
        jsonb_typeof("executionTemplate")='object'
        AND "executionTemplate" - ARRAY['version','testCaseIds','configurations']::text[]='{}'::jsonb
        AND "executionTemplate"->'version'='1'::jsonb
        AND jsonb_typeof("executionTemplate"->'testCaseIds')='array'
        AND jsonb_array_length(CASE WHEN jsonb_typeof("executionTemplate"->'testCaseIds')='array' THEN "executionTemplate"->'testCaseIds' ELSE '[]'::jsonb END)<=500
        AND jsonb_typeof("executionTemplate"->'configurations')='array'
        AND jsonb_array_length(CASE WHEN jsonb_typeof("executionTemplate"->'configurations')='array' THEN "executionTemplate"->'configurations' ELSE '[]'::jsonb END)<=20,false)),false) AS supported
    FROM "TestPlan" WHERE id IN (${Prisma.join(planIds)})`);
  if (!gate || Number(gate.plans) !== planIds.length || Number(gate.foreign))
    throw refusal("a selected native plan is missing or outside this project");
  if (!gate.supported || Number(gate.templateBytes) > MAX_TEMPLATE_BYTES)
    throw refusal(
      "saved execution-template metadata exceeds its supported bounds",
    );

  // The schema's actual relationship is TestPlan.testCases -> TestCase.testPlanId.
  // Count the complete relation first; never infer a join table or truncate it.
  const plans = await tx.testPlan.findMany({
    where: { id: { in: planIds }, projectId },
    select: { id: true, _count: { select: { testCases: true } } },
    orderBy: { id: "asc" },
  });
  if (plans.length !== planIds.length)
    throw refusal("selected plans changed during cohort review");
  const linkedPairs = plans.reduce(
    (total, plan) => total + plan._count.testCases,
    0,
  );
  if (linkedPairs > MAX_PAIRS)
    throw refusal(
      "the complete directly linked relationship population exceeds its bounds",
    );
  const templates = await tx.testPlan.findMany({
    where: { id: { in: planIds }, projectId },
    select: { id: true, executionTemplate: true },
    orderBy: { id: "asc" },
  });
  if (templates.length !== planIds.length)
    throw refusal("selected templates changed during cohort review");
  const declaredSaved = templates.flatMap((plan) =>
    readReportPlanTemplateCaseIds(plan.executionTemplate),
  );
  if (linkedPairs + declaredSaved.length > MAX_PAIRS)
    throw refusal(
      "the complete linked/saved relationship population exceeds its bounds",
    );
  const saved = [...new Set(declaredSaved)];
  if (saved.length > MAX_CASES)
    throw refusal("the saved distinct case population exceeds its bounds");

  // Check exact saved resolution and ALL linked case parents before identity
  // materialization; a project-filtered join alone would hide foreign records.
  const [population] = await tx.$queryRaw<
    Array<{
      linked: bigint;
      foreignLinked: bigint;
      saved: bigint;
      foreignSaved: bigint;
      distinct: bigint;
      identityBytes: bigint;
      maxIdLength: number | null;
    }>
  >(Prisma.sql`
    WITH linked AS (SELECT id,"projectId" FROM "TestCase" WHERE "testPlanId" IN (${Prisma.join(planIds)})),
      saved AS (SELECT id,"projectId" FROM "TestCase" WHERE ${saved.length ? Prisma.sql`id IN (${Prisma.join(saved)})` : Prisma.sql`false`}),
      identities AS (SELECT id FROM linked UNION SELECT id FROM saved)
    SELECT (SELECT count(*) FROM linked) AS linked,
      (SELECT count(*) FROM linked WHERE "projectId"<>${projectId}) AS "foreignLinked",
      (SELECT count(*) FROM saved) AS saved,(SELECT count(*) FROM saved WHERE "projectId"<>${projectId}) AS "foreignSaved",
      (SELECT count(*) FROM identities) AS "distinct",
      COALESCE((SELECT sum(octet_length(to_jsonb(id)::text))+count(*)+2 FROM identities),2) AS "identityBytes",
      (SELECT max(length(id)) FROM identities) AS "maxIdLength"`);
  if (
    !population ||
    Number(population.linked) !== linkedPairs ||
    Number(population.saved) !== saved.length ||
    Number(population.foreignLinked) ||
    Number(population.foreignSaved)
  )
    throw refusal(
      "a linked or saved case is missing, foreign or changed during cohort review",
    );
  if (
    Number(population.distinct) > MAX_CASES ||
    Number(population.identityBytes) > MAX_CASE_ID_BYTES ||
    (population.maxIdLength ?? 0) > MAX_ID_UNITS
  )
    throw refusal("the distinct case identity metadata exceeds its bounds");
  const linked = await tx.testCase.findMany({
    where: { testPlanId: { in: planIds }, projectId },
    select: { id: true },
    orderBy: { id: "asc" },
  });
  if (linked.length !== linkedPairs)
    throw refusal("direct case relationships changed during cohort review");
  const caseIds = mergeReportPlanCaseIds(
    linked.map((row) => row.id),
    saved,
  );
  if (caseIds.length !== Number(population.distinct))
    throw refusal("case identity population changed during cohort review");
  return { caseIds, limitations: reportPlanCaseScopeLimitations };
}
