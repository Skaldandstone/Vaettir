import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "@vaettir/core/dist/validation.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import { assertComplianceAvailable } from "./complianceRecovery.js";

type Scope = { projectId: string; caseId: string; organizationId: string };
const id = z.string().min(1).max(200);
const text = z.string().max(10000);
export const caseReviewComplianceContextSchema = z
  .object({
    kind: z.literal("CaseReviewComplianceContext/v1"),
    projectId: id,
    organizationId: id,
    caseId: id,
    caseRevision: z.number().int().positive(),
    mappings: z
      .array(
        z
          .object({
            mapping: z.object({ testCaseId: id, controlId: id }).strict(),
            control: z
              .object({
                id,
                frameworkId: id,
                revision: z.number().int().positive(),
                code: text,
                title: text,
                description: text.nullable(),
              })
              .strict(),
            framework: z
              .object({
                id,
                organizationId: id,
                catalogKey: text.nullable(),
                revision: z.number().int().positive(),
                key: text,
                name: text,
                version: text.nullable(),
                description: text.nullable(),
                isBuiltIn: z.boolean(),
              })
              .strict(),
          })
          .strict(),
      )
      .min(1)
      .max(50),
  })
  .strict();
const refused = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "The complete compliance mapping context is unowned, missing or exceeds supported review bounds. No mappings were omitted or adopted.",
  });

/** Metadata first, before any private definition bodies. Unmapped V2 cases
 * retain their original bytes and remain readable in compliance recovery. */
export async function admitCaseReviewComplianceContext(
  tx: Prisma.TransactionClient,
  scope: Scope,
) {
  const [links] = await tx.$queryRaw<
    Array<{
      mappingCount: bigint;
      mappingForeign: boolean;
      mappingUnowned: boolean;
    }>
  >`
    SELECT count(*)::bigint AS "mappingCount",
      coalesce(bool_or(f."organizationId" IS NOT NULL AND f."organizationId"<>${scope.organizationId}),false) AS "mappingForeign",
      coalesce(bool_or(k.id IS NULL OR f.id IS NULL OR f."organizationId" IS NULL),false) AS "mappingUnowned"
    FROM "TestCaseComplianceControl" m LEFT JOIN "ComplianceControl" k ON k.id=m."controlId" LEFT JOIN "ComplianceFramework" f ON f.id=k."frameworkId"
    WHERE m."testCaseId"=${scope.caseId}`;
  if (
    !links ||
    typeof links.mappingCount !== "bigint" ||
    links.mappingCount < 0n
  )
    throw refused();
  if (links.mappingCount === 0n) return { count: 0, bytes: 0n };
  assertComplianceAvailable();
  if (links.mappingForeign)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Mapped compliance definitions do not belong to the original organization. No foreign definition bodies were loaded.",
    });
  if (links.mappingUnowned !== false || links.mappingCount > 50n)
    throw refused();
  const [size] = await tx.$queryRaw<Array<{ mappingBytes: bigint }>>`
    SELECT coalesce(sum(octet_length(to_jsonb(m)::text)::bigint+octet_length(to_jsonb(k)::text)+octet_length(to_jsonb(f)::text)+128),0)::bigint AS "mappingBytes"
    FROM "TestCaseComplianceControl" m JOIN "ComplianceControl" k ON k.id=m."controlId" JOIN "ComplianceFramework" f ON f.id=k."frameworkId"
    WHERE m."testCaseId"=${scope.caseId} AND f."organizationId"=${scope.organizationId}`;
  if (
    !size ||
    typeof size.mappingBytes !== "bigint" ||
    size.mappingBytes < 0n ||
    size.mappingBytes > 65536n
  )
    throw refused();
  // Caller already holds the original project/case locks. Lock all admitted
  // native definitions and edges in stable order; RR rejects changed rows.
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT f.id FROM "ComplianceFramework" f WHERE f."organizationId"=${scope.organizationId} AND EXISTS(SELECT 1 FROM "ComplianceControl" k JOIN "TestCaseComplianceControl" m ON m."controlId"=k.id WHERE k."frameworkId"=f.id AND m."testCaseId"=${scope.caseId}) ORDER BY f.id FOR SHARE OF f) locked`;
  await tx.$queryRaw`SELECT count(*)::bigint FROM (SELECT k.id FROM "ComplianceControl" k JOIN "TestCaseComplianceControl" m ON m."controlId"=k.id WHERE m."testCaseId"=${scope.caseId} ORDER BY k.id FOR SHARE OF k,m) locked`;
  return { count: Number(links.mappingCount), bytes: size.mappingBytes };
}

export function caseReviewComplianceContextProjection(scope: Scope) {
  return Prisma.sql`SELECT jsonb_build_object('kind','CaseReviewComplianceContext/v1','projectId',${scope.projectId}::text,'organizationId',${scope.organizationId}::text,'caseId',${scope.caseId}::text,'caseRevision',(SELECT c."complianceRevision" FROM "TestCase" c WHERE c.id=${scope.caseId} AND c."projectId"=${scope.projectId}),
    'mappings',coalesce(jsonb_agg(jsonb_build_object('mapping',to_jsonb(m),'control',to_jsonb(k),'framework',to_jsonb(f)) ORDER BY m."controlId"),'[]'::jsonb))
    FROM "TestCaseComplianceControl" m JOIN "ComplianceControl" k ON k.id=m."controlId" JOIN "ComplianceFramework" f ON f.id=k."frameworkId"
    WHERE m."testCaseId"=${scope.caseId} AND f."organizationId"=${scope.organizationId}`;
}

export function validateCaseReviewComplianceContext(
  raw: unknown,
  scope: Scope,
  count: number,
) {
  try {
    if (caseFieldPresentationJsonBytes(raw) > 65536) throw refused();
    const parsed = caseReviewComplianceContextSchema.parse(raw);
    if (
      parsed.caseId !== scope.caseId ||
      parsed.projectId !== scope.projectId ||
      parsed.organizationId !== scope.organizationId ||
      parsed.mappings.length !== count
    )
      throw refused();
    const ids = new Set<string>();
    for (const row of parsed.mappings) {
      if (
        row.mapping.testCaseId !== scope.caseId ||
        row.mapping.controlId !== row.control.id ||
        row.control.frameworkId !== row.framework.id ||
        row.framework.organizationId !== scope.organizationId ||
        ids.has(row.control.id)
      )
        throw refused();
      ids.add(row.control.id);
    }
    return parsed;
  } catch {
    throw refused();
  }
}
