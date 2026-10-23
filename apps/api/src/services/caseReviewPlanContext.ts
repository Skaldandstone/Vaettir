import { Prisma } from "@vaettir/db";
import { DEFAULT_STEP_FIELD_LABELS } from "@vaettir/core";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";

type Scope = { projectId: string; caseId: string; organizationId: string };
const id = z.string().min(1).max(200),
  text = z.string().max(10000),
  label = z
    .string()
    .max(200)
    .refine(
      (value) =>
        !value.includes("\0") &&
        !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
          value,
        ),
    );
const labels = z
  .object({
    action: label,
    expectedActionOrData: label,
    expectedResult: label,
    expectedResponse: label,
  })
  .strict();
const typeSnapshot = z
  .object({
    id,
    key: id,
    name: text,
    category: id,
    description: text.nullable(),
    fieldSchema: z.unknown(),
    fieldSchemaSqlNull: z.boolean(),
    isBuiltIn: z.boolean(),
    createdAt: z.string(),
  })
  .strict();
const criterion = z
  .object({
    id,
    testPlanId: id,
    requirementId: z.null(),
    description: text,
    status: z.enum(["PENDING", "MET", "NOT_MET", "AT_RISK"]),
    createdAt: z.string(),
  })
  .strict();
const planSnapshot = z
  .object({
    id,
    projectId: id,
    testPlanTypeId: id,
    releaseId: z.null(),
    strategyId: z.null(),
    name: text,
    description: z.string().max(40000).nullable(),
    status: z.enum(["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED", "ARCHIVED"]),
    customFields: z.unknown(),
    customFieldsSqlNull: z.boolean(),
    executionTemplate: z.object({}).strict(),
    executionTemplateSqlNull: z.literal(false),
    createdById: id.nullable(),
    updatedById: id.nullable(),
    createdAt: z.string(),
    updatedAt: z.string(),
    latestVersion: z
      .object({ id, versionNumber: z.number().int().positive() })
      .strict()
      .nullable(),
    criteria: z.array(criterion).max(200),
  })
  .strict();
export const caseReviewPlanContextSchema = z
  .object({
    kind: z.literal("CaseReviewPlanContext/v1"),
    organizationLabels: z
      .object({
        organizationId: id,
        raw: z.unknown(),
        sqlNull: z.boolean(),
        resolved: labels,
      })
      .strict(),
    references: z
      .object({ caseTypeId: id.nullable(), planTypeId: id.nullable() })
      .strict(),
    types: z.array(typeSnapshot).max(2),
    plan: planSnapshot.nullable(),
  })
  .strict();
export type CaseReviewPlanContext = z.infer<typeof caseReviewPlanContextSchema>;
const refused = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "The linked review context exceeds supported complete bounds or has unsupported plan relationships, templates, labels or type definitions. No linked material was omitted or repaired.",
  });

/** Called only inside the already current-authorized case transaction. Types
 * are global references reached through verified direct FKs, NOT tenant-owned. */
export async function admitCaseReviewPlanContext(
  tx: Prisma.TransactionClient,
  scope: Scope,
) {
  const [found] = await tx.$queryRaw<
    Array<{
      linkedForeign: boolean;
      linkedMissing: boolean;
      linkedUnsupported: boolean;
    }>
  >`
    SELECT (p."organizationId"<>${scope.organizationId} OR (pl.id IS NOT NULL AND pl."projectId"<>c."projectId")) AS "linkedForeign",
      ((c."testPlanId" IS NOT NULL AND pl.id IS NULL) OR (c."testPlanTypeId" IS NOT NULL AND ct.id IS NULL) OR (pl.id IS NOT NULL AND pt.id IS NULL)) AS "linkedMissing",
      (pl.id IS NOT NULL AND (pl."releaseId" IS NOT NULL OR pl."strategyId" IS NOT NULL OR EXISTS(SELECT 1 FROM "TestPlan" child WHERE child."strategyId"=pl.id) OR EXISTS(SELECT 1 FROM "AcceptanceCriterion" a WHERE a."testPlanId"=pl.id AND a."requirementId" IS NOT NULL) OR pl."executionTemplate" IS DISTINCT FROM '{}'::jsonb)) AS "linkedUnsupported"
    FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId" LEFT JOIN "TestPlan" pl ON pl.id=c."testPlanId" LEFT JOIN "TestPlanType" ct ON ct.id=c."testPlanTypeId" LEFT JOIN "TestPlanType" pt ON pt.id=pl."testPlanTypeId"
    WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId}`;
  if (!found) throw refused();
  if (found.linkedForeign)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "The linked plan belongs outside this exact project/original organization. No foreign context bodies were loaded.",
    });
  if (found.linkedMissing || found.linkedUnsupported) throw refused();
  // The case/project/org locks held by caller precede these stable native rows.
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestPlan" pl JOIN "TestCase" c ON c."testPlanId"=pl.id WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId} AND pl."projectId"=${scope.projectId} FOR SHARE OF pl) locked`;
  const [size] = await tx.$queryRaw<
    Array<{
      labelBytes: bigint;
      typeBytes: bigint;
      planBytes: bigint;
      criteria: bigint;
      typeCount: bigint;
      labelsUnsupported: boolean;
    }>
  >`
    SELECT coalesce(octet_length(o."stepFieldLabels"::text),0)::bigint AS "labelBytes",
      coalesce((SELECT sum(octet_length(to_jsonb(t)::text)::bigint+32) FROM "TestPlanType" t WHERE t.id IN (c."testPlanTypeId",pl."testPlanTypeId")),0)::bigint AS "typeBytes",
      (coalesce(octet_length(to_jsonb(pl)::text),0)::bigint+coalesce((SELECT sum(octet_length(to_jsonb(a)::text)) FROM "AcceptanceCriterion" a WHERE a."testPlanId"=pl.id),0)+coalesce((SELECT octet_length(concat(v.id,v."versionNumber")) FROM "TestPlanVersion" v WHERE v."testPlanId"=pl.id ORDER BY v."versionNumber" DESC LIMIT 1),0))::bigint AS "planBytes",
      (SELECT count(*)::bigint FROM "AcceptanceCriterion" a WHERE a."testPlanId"=pl.id) AS criteria,(SELECT count(*)::bigint FROM "TestPlanType" t WHERE t.id IN (c."testPlanTypeId",pl."testPlanTypeId")) AS "typeCount",
      (o."stepFieldLabels" IS NOT NULL AND o."stepFieldLabels"<>'null'::jsonb AND (jsonb_typeof(o."stepFieldLabels")<>'object' OR EXISTS(SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(o."stepFieldLabels")='object' THEN o."stepFieldLabels" ELSE '{}'::jsonb END) e WHERE e.key IN ('action','expectedActionOrData','expectedResult','expectedResponse') AND (jsonb_typeof(e.value)<>'string' OR length(e.value#>>'{}')>200 OR octet_length(e.value#>>'{}')>800)))) AS "labelsUnsupported"
    FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId" JOIN "Organization" o ON o.id=p."organizationId" LEFT JOIN "TestPlan" pl ON pl.id=c."testPlanId" AND pl."projectId"=c."projectId" WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId} AND o.id=${scope.organizationId}`;
  if (
    !size ||
    [
      size.labelBytes,
      size.typeBytes,
      size.planBytes,
      size.criteria,
      size.typeCount,
    ].some((value) => typeof value !== "bigint" || value < 0n) ||
    size.labelBytes > 4096n ||
    size.typeBytes > 32768n ||
    size.planBytes > 131072n ||
    size.criteria > 200n ||
    size.typeCount > 2n ||
    size.labelsUnsupported !== false
  )
    throw refused();
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestPlanType" t JOIN "TestCase" c ON c.id=${scope.caseId} LEFT JOIN "TestPlan" pl ON pl.id=c."testPlanId" AND pl."projectId"=c."projectId" WHERE c."projectId"=${scope.projectId} AND t.id IN (c."testPlanTypeId",pl."testPlanTypeId") ORDER BY t.id FOR SHARE OF t) locked`;
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "AcceptanceCriterion" a JOIN "TestCase" c ON c."testPlanId"=a."testPlanId" WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId} ORDER BY a.id LIMIT 201 FOR SHARE OF a) locked`;
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT 1 FROM "TestPlanVersion" v JOIN "TestCase" c ON c."testPlanId"=v."testPlanId" WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId} ORDER BY v."versionNumber" DESC LIMIT 1 FOR SHARE OF v) locked`;
  return size;
}

/** Scalar/JSON expression only; whole context is materialized ONLY as part of
 * the caller's already <=512KiB native-admitted complete V2 case projection. */
export function caseReviewPlanContextProjection(scope: Scope) {
  const resolved = Prisma.sql`jsonb_build_object('action',CASE WHEN o."stepFieldLabels" ? 'action' THEN o."stepFieldLabels"->'action' ELSE to_jsonb(${DEFAULT_STEP_FIELD_LABELS.action}::text) END,'expectedActionOrData',CASE WHEN o."stepFieldLabels" ? 'expectedActionOrData' THEN o."stepFieldLabels"->'expectedActionOrData' ELSE to_jsonb(${DEFAULT_STEP_FIELD_LABELS.expectedActionOrData}::text) END,'expectedResult',CASE WHEN o."stepFieldLabels" ? 'expectedResult' THEN o."stepFieldLabels"->'expectedResult' ELSE to_jsonb(${DEFAULT_STEP_FIELD_LABELS.expectedResult}::text) END,'expectedResponse',CASE WHEN o."stepFieldLabels" ? 'expectedResponse' THEN o."stepFieldLabels"->'expectedResponse' ELSE to_jsonb(${DEFAULT_STEP_FIELD_LABELS.expectedResponse}::text) END)`;
  return Prisma.sql`SELECT jsonb_build_object('kind','CaseReviewPlanContext/v1','organizationLabels',jsonb_build_object('organizationId',o.id,'raw',o."stepFieldLabels",'sqlNull',o."stepFieldLabels" IS NULL,'resolved',${resolved}),
    'references',jsonb_build_object('caseTypeId',c."testPlanTypeId",'planTypeId',pl."testPlanTypeId"),
    'types',coalesce((SELECT jsonb_agg(to_jsonb(t)||jsonb_build_object('fieldSchemaSqlNull',t."fieldSchema" IS NULL) ORDER BY t.id) FROM "TestPlanType" t WHERE t.id IN (c."testPlanTypeId",pl."testPlanTypeId")),'[]'::jsonb),
    'plan',CASE WHEN pl.id IS NULL THEN NULL ELSE to_jsonb(pl)||jsonb_build_object('customFieldsSqlNull',pl."customFields" IS NULL,'executionTemplateSqlNull',pl."executionTemplate" IS NULL,'latestVersion',(SELECT jsonb_build_object('id',v.id,'versionNumber',v."versionNumber") FROM "TestPlanVersion" v WHERE v."testPlanId"=pl.id ORDER BY v."versionNumber" DESC LIMIT 1),'criteria',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.id) FROM "AcceptanceCriterion" a WHERE a."testPlanId"=pl.id),'[]'::jsonb)) END) AS "linkedContext"
    FROM "TestCase" c JOIN "Project" p ON p.id=c."projectId" JOIN "Organization" o ON o.id=p."organizationId" LEFT JOIN "TestPlan" pl ON pl.id=c."testPlanId" AND pl."projectId"=c."projectId" WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId} AND o.id=${scope.organizationId}`;
}
export function validateCaseReviewPlanContext(
  raw: unknown,
): CaseReviewPlanContext {
  try {
    if (caseFieldPresentationJsonBytes(raw) > 172032) throw refused();
    const parsed = caseReviewPlanContextSchema.parse(raw);
    if (
      caseFieldPresentationJsonBytes(parsed.organizationLabels.raw) > 4096 ||
      caseFieldPresentationJsonBytes(parsed.types) > 32768 ||
      caseFieldPresentationJsonBytes(parsed.plan) > 131072
    )
      throw refused();
    const rawLabels = parsed.organizationLabels.raw;
    if (
      rawLabels !== null &&
      (typeof rawLabels !== "object" || Array.isArray(rawLabels))
    )
      throw refused();
    for (const key of Object.keys(DEFAULT_STEP_FIELD_LABELS) as Array<
      keyof typeof DEFAULT_STEP_FIELD_LABELS
    >) {
      const expected =
        rawLabels !== null && Object.hasOwn(rawLabels, key)
          ? (rawLabels as Record<string, unknown>)[key]
          : DEFAULT_STEP_FIELD_LABELS[key];
      if (parsed.organizationLabels.resolved[key] !== expected) throw refused();
    }
    const ids = parsed.types.map((type) => type.id),
      expected = [
        ...new Set(
          [parsed.references.caseTypeId, parsed.references.planTypeId].filter(
            (id): id is string => id !== null,
          ),
        ),
      ].sort();
    if (
      ids.length !== expected.length ||
      ids.some((id, index) => id !== expected[index])
    )
      throw refused();
    if (
      parsed.plan &&
      (parsed.plan.testPlanTypeId !== parsed.references.planTypeId ||
        parsed.plan.criteria.some(
          (item) => item.testPlanId !== parsed.plan!.id,
        ) ||
        new Set(parsed.plan.criteria.map((item) => item.id)).size !==
          parsed.plan.criteria.length)
    )
      throw refused();
    if (!parsed.plan && parsed.references.planTypeId !== null) throw refused();
    return parsed;
  } catch {
    throw refused();
  }
}
export function linkedPlanReviewBlocked(context: CaseReviewPlanContext) {
  return context.plan && ["APPROVED", "ARCHIVED"].includes(context.plan.status)
    ? "This linked plan has a frozen approved or archived trust state. Reopen the parent through its owned workflow before a new case review; no parent approval was invalidated."
    : null;
}
