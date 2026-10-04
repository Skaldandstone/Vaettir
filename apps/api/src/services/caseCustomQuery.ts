import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { caseFieldSchema } from "./caseFieldSchema.js";
import {
  customBindingProblems,
  type CaseCustomBinding,
} from "./caseCustomQuerySchema.js";
import type { CaseQuery, CaseQueryRule } from "./caseQuerySchema.js";
export function queryCustomBindings(query: CaseQuery): CaseCustomBinding[] {
  return [
    ...(query.customColumns ?? []),
    ...query.groups.flatMap((group) =>
      group.rules.filter((rule) => rule.field === "custom"),
    ),
  ];
}
export async function assertCustomQueryCompatibility(
  tx: Prisma.TransactionClient,
  projectId: string,
  query: CaseQuery,
) {
  const bindings = queryCustomBindings(query);
  if (!bindings.length) return;
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { caseFieldSchema: true },
  });
  const parsed = caseFieldSchema.safeParse(project.caseFieldSchema);
  if (!parsed.success)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Project field definitions are unavailable. Repair definitions before querying metadata.",
    });
  const problems = customBindingProblems(parsed.data.fields, bindings);
  if (problems.length)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: problems.join(" "),
    });
}
// All expressions/identifiers are maintained allowlists. Caller strings are values.
function combine(parts: Prisma.Sql[], match: "all" | "any"): Prisma.Sql {
  return parts.length
    ? Prisma.sql`(${Prisma.join(
        parts.map((part) => Prisma.sql`(${part})`),
        match === "all" ? " AND " : " OR ",
      )})`
    : Prisma.sql`true`;
}
function jsonValue(key: string) {
  return Prisma.sql`("customFields" -> ${key})`;
}
function jsonText(key: string) {
  return Prisma.sql`("customFields" ->> ${key})`;
}
function validDate(key: string) {
  const text = jsonText(key);
  // No date casts: malformed legacy JSON cannot raise an exception.
  return Prisma.sql`CASE WHEN jsonb_typeof(${jsonValue(key)})='string' AND ${text} ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
    substring(${text},1,4)<>'0000' AND substring(${text},6,2)::int BETWEEN 1 AND 12 AND substring(${text},9,2)::int BETWEEN 1 AND
      CASE WHEN substring(${text},6,2)::int=2 THEN
        CASE WHEN mod(substring(${text},1,4)::int,400)=0 OR (mod(substring(${text},1,4)::int,4)=0 AND mod(substring(${text},1,4)::int,100)<>0) THEN 29 ELSE 28 END
      WHEN substring(${text},6,2)::int IN (4,6,9,11) THEN 30 ELSE 31 END
    ELSE false END`;
}
function typedValid(binding: CaseCustomBinding) {
  const value = jsonValue(binding.key);
  switch (binding.type) {
    case "NUMBER":
      return Prisma.sql`CASE WHEN jsonb_typeof(${value})='number' AND length(${jsonText(binding.key)})<=64 THEN abs((${jsonText(binding.key)})::numeric)<=1000000000000 ELSE false END`;
    case "BOOLEAN":
      return Prisma.sql`jsonb_typeof(${value})='boolean'`;
    case "DATE":
      return validDate(binding.key);
    case "CHOICE":
      return Prisma.sql`jsonb_typeof(${value})='string' AND ${jsonText(binding.key)} IN (${Prisma.join(binding.options)})`;
    case "TEXT":
      return Prisma.sql`jsonb_typeof(${value})='string' AND length(${jsonText(binding.key)})<=2000`;
  }
}
function ruleSql(rule: CaseQueryRule): Prisma.Sql {
  if (rule.field === "custom") {
    const value = jsonValue(rule.key),
      text = jsonText(rule.key);
    if (rule.operator === "missing")
      return Prisma.sql`NOT ("customFields" ? ${rule.key})`;
    if (rule.operator === "null")
      return Prisma.sql`("customFields" ? ${rule.key}) AND ${value}='null'::jsonb`;
    if (rule.operator === "empty") return Prisma.sql`${value}='""'::jsonb`;
    const valid = typedValid(rule);
    if (rule.operator === "equals")
      return Prisma.sql`${valid} AND ${value}=${JSON.stringify(rule.value)}::jsonb`;
    if (rule.operator === "contains")
      return Prisma.sql`${valid} AND position(${String(rule.value)} in ${text})>0`;
    if (rule.type === "NUMBER") {
      const numeric = Prisma.sql`CASE WHEN ${valid} THEN ${text}::numeric ELSE NULL END`;
      return rule.operator === "atLeast"
        ? Prisma.sql`${numeric}>=${rule.value}`
        : Prisma.sql`${numeric}<=${rule.value}`;
    }
    // DATE comparisons use only fully validated ISO date text, not SQL date casts.
    return rule.operator === "before"
      ? Prisma.sql`${valid} AND ${text}<${rule.value}`
      : Prisma.sql`${valid} AND ${text}>${rule.value}`;
  }
  switch (rule.field) {
    case "title":
      return rule.operator === "equals"
        ? Prisma.sql`lower(title)=lower(${rule.value})`
        : Prisma.sql`title ILIKE ${`%${rule.value.replace(/[\\%_]/g, "\\$&")}%`}`;
    case "displayId":
      return Prisma.sql`lower("displayId")=lower(${rule.value})`;
    case "tag":
      return Prisma.sql`${rule.value}=ANY(tags)`;
    case "suite":
      return rule.operator === "unassigned"
        ? Prisma.sql`"suitePath" IS NULL`
        : Prisma.sql`"suitePath"=${rule.value}`;
    case "priority":
      return Prisma.sql`priority::text=${rule.value}`;
    case "type":
      return Prisma.sql`"testType"::text=${rule.value}`;
    case "domain":
      return Prisma.sql`"validationDomain"::text=${rule.value}`;
    case "automation":
      return Prisma.sql`"automationStatus"::text=${rule.value}`;
    case "review":
      return Prisma.sql`"reviewStatus"::text=${rule.value}`;
    case "origin":
      return Prisma.sql`origin::text=${rule.value}`;
    case "riskScore":
      return rule.operator === "unassessed"
        ? Prisma.sql`"riskScore" IS NULL`
        : rule.operator === "atLeast"
          ? Prisma.sql`"riskScore">=${rule.value}`
          : Prisma.sql`"riskScore"<=${rule.value}`;
    case "flaky":
      return Prisma.sql`"isFlaky"=${rule.value}`;
  }
}
function boundedRuleSql(rule: CaseQueryRule): Prisma.Sql {
  const predicate = ruleSql(rule);
  return rule.field === "custom"
    ? Prisma.sql`jsonb_typeof("customFields")='object' AND (${predicate})`
    : predicate;
}
export function customQueryWhereSql(
  projectId: string,
  query: CaseQuery,
  watermark: Date,
) {
  return Prisma.sql`"projectId"=${projectId} AND "updatedAt"<=${watermark} AND ${query.archive === "all" ? Prisma.sql`true` : Prisma.sql`archived=${query.archive === "archived"}`} AND ${combine(
    query.groups.map((group) =>
      combine(group.rules.map(boundedRuleSql), group.match),
    ),
    query.match,
  )}`;
}
export const customQuerySortSql = (sort: CaseQuery["sort"]) =>
  sort === "title"
    ? Prisma.sql`title`
    : sort === "updatedAt"
      ? Prisma.sql`"updatedAt"`
      : Prisma.sql`"caseNumber"`;
export function customProjectionSql(columns: CaseCustomBinding[]) {
  if (!columns.length) return Prisma.sql`'{}'::jsonb`;
  return Prisma.sql`jsonb_build_object(${Prisma.join(
    columns.flatMap((binding) => {
      const value = jsonValue(binding.key);
      return [
        Prisma.sql`${binding.key}`,
        Prisma.sql`CASE
      WHEN jsonb_typeof("customFields") IS DISTINCT FROM 'object' THEN jsonb_build_object('state','INVALID')
      WHEN NOT ("customFields" ? ${binding.key}) THEN jsonb_build_object('state','ABSENT')
      WHEN ${value}='null'::jsonb THEN jsonb_build_object('state','NULL')
      WHEN ${typedValid(binding)} THEN jsonb_build_object('state','VALUE','value',${value})
      ELSE jsonb_build_object('state','INVALID') END`,
      ];
    }),
  )})`;
}
export type CaseCustomCell = {
  state: "ABSENT" | "NULL" | "VALUE" | "INVALID";
  value?: string | number | boolean;
};
