import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import {
  caseFieldSchema,
  caseFieldValues,
  validateCaseFieldValues,
} from "./caseFieldSchema.js";
import {
  lockCaseFieldProject,
  readCaseFieldState,
  replayCaseFieldWrite,
  saveCaseFieldsInTransaction,
} from "./caseFields.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import {
  caseFieldReadPinFields,
  pairedCaseFieldReadPins,
  caseFieldReadScopeSchema,
  lockCaseFieldReadScope,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";
const id = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const fieldHistoryScope = z
  .object({ projectId: id, caseId: id })
  .strict();
export const fieldHistoryListInput = fieldHistoryScope
  .extend({
    ...caseFieldReadPinFields,
    take: z.number().int().min(1).max(10).default(10),
    cursor: z
      .object({ auditId: id, createdAt: z.string().datetime() })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine(pairedCaseFieldReadPins);
export const fieldHistorySelection = fieldHistoryScope
  .extend({ auditId: id, side: z.enum(["BEFORE", "AFTER"]) })
  .strict();
// Read pins must not become part of the restore input or its durable hash.
export const fieldHistoryPreviewInput = fieldHistorySelection
  .extend(caseFieldReadPinFields)
  .strict()
  .superRefine(pairedCaseFieldReadPins);
export const fieldHistoryRestoreInput = fieldHistorySelection
  .extend({
    actorId: id,
    expectedSchemaHash: hash,
    expectedValueHash: hash,
    expectedSourceHash: hash,
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict();
const actor = z.object({
  id,
  label: z.string().max(500),
  source: z.literal("CURRENT_PROFILE"),
});
export const fieldHistoryListOutput = z.object({
  projectId: id,
  caseId: id,
  readScope: caseFieldReadScopeSchema.optional(),
  entries: z
    .array(
      z.object({
        auditId: id,
        createdAt: z.string().datetime(),
        actor,
        summary: z.string().max(1000),
        supported: z.boolean(),
        restoredFromAuditId: id.nullable(),
      }),
    )
    .max(10),
  nextCursor: z
    .object({ auditId: id, createdAt: z.string().datetime() })
    .nullable(),
  warnings: z.array(z.string()).max(5),
});
export const fieldHistoryPreviewOutput = z.object({
  projectId: id,
  caseId: id,
  readScope: caseFieldReadScopeSchema.optional(),
  auditId: id,
  side: z.enum(["BEFORE", "AFTER"]),
  actorId: id,
  expectedSchemaHash: hash,
  expectedValueHash: hash,
  expectedSourceHash: hash,
  historicalSchema: caseFieldSchema.nullable(),
  historicalSchemaVersion: z.number().int().nonnegative().nullable(),
  historicalValues: caseFieldValues.nullable(),
  currentSchema: caseFieldSchema,
  rows: z
    .array(
      z.object({
        key: z.string(),
        label: z.string(),
        saved: z.string(),
        current: z.string(),
        proposed: z.string(),
        changed: z.boolean(),
        treatment: z.enum([
          "Eligible active field",
          "Keep retired value",
          "Keep unknown value",
          "Keep later field",
          "Blocked definition",
          "Unavailable source",
        ]),
      }),
    )
    .max(220),
  warnings: z.array(z.string()).max(250),
  problems: z.array(z.string()).max(250),
  canRestore: z.boolean(),
});
const evidenceSchema = z
  .object({
    version: z.literal(1),
    beforeValues: caseFieldValues,
    afterValues: caseFieldValues,
    schema: caseFieldSchema,
    schemaVersion: z.number().int().nonnegative(),
    restoredFrom: z.object({ auditId: id }).passthrough().optional(),
  })
  .passthrough();
function evidence(metadata: unknown, kind: string, caseId: string) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata))
    return null;
  const record = metadata as Record<string, unknown>;
  if (
    kind === "CaseFieldValueWrite" &&
    (!record.evidence ||
      typeof record.evidence !== "object" ||
      Array.isArray(record.evidence) ||
      (record.evidence as Record<string, unknown>).caseId !== caseId)
  )
    return null;
  const result = evidenceSchema.safeParse(
    kind === "TestCase" ? record.fieldEvidence : record.evidence,
  );
  return result.success ? result.data : null;
}
function historyWhere(
  projectId: string,
  organizationId: string,
  caseId: string,
): Prisma.AuditLogWhereInput {
  return {
    projectId,
    organizationId,
    OR: [
      {
        entityType: "TestCase",
        entityId: caseId,
        action: { in: ["CREATE", "UPDATE"] },
      },
      {
        entityType: "CaseFieldValueWrite",
        metadata: { path: ["evidence", "caseId"], equals: caseId },
      },
    ],
  };
}
async function scope(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof fieldHistoryScope>,
) {
  const current = await readCaseFieldState(
    tx,
    userId,
    input.projectId,
    input.caseId,
  );
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  return {
    current,
    where: historyWhere(input.projectId, project.organizationId, input.caseId),
  };
}
async function boundedRow(
  tx: Prisma.TransactionClient,
  where: Prisma.AuditLogWhereInput,
  auditId: string,
) {
  const record = await tx.auditLog.findFirst({
    where: { ...where, id: auditId },
    select: { id: true, entityType: true, createdAt: true },
  });
  if (!record)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "This metadata record is unavailable in the current case and organization.",
    });
  const [size] = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT coalesce(octet_length(metadata::text),0) AS bytes FROM "AuditLog" WHERE id=${record.id}`;
  if (!size || size.bytes > 262144)
    return { ...record, metadata: null, oversized: true };
  const row = await tx.auditLog.findUniqueOrThrow({
    where: { id: record.id },
    select: { metadata: true },
  });
  return { ...record, metadata: row.metadata, oversized: false };
}
export async function listCaseFieldHistory(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof fieldHistoryListInput>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const readScope = await lockCaseFieldReadScope(
        tx,
        userId,
        input,
        authorized,
      );
      const { where } = await scope(tx, userId, input);
      if (input.cursor) {
        const cursor = await tx.auditLog.findFirst({
          where: { ...where, id: input.cursor.auditId },
          select: { createdAt: true },
        });
        if (
          !cursor ||
          cursor.createdAt.toISOString() !== input.cursor.createdAt
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "Metadata history cursor is unavailable. Refresh this case's history.",
          });
      }
      const rows = await tx.auditLog.findMany({
        where: {
          ...where,
          ...(input.cursor
            ? {
                AND: [
                  {
                    OR: [
                      { createdAt: { lt: new Date(input.cursor.createdAt) } },
                      {
                        createdAt: new Date(input.cursor.createdAt),
                        id: { lt: input.cursor.auditId },
                      },
                    ],
                  },
                ],
              }
            : {}),
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: input.take + 1,
        select: {
          id: true,
          createdAt: true,
        },
      });
      const entries: z.infer<typeof fieldHistoryListOutput>["entries"] = [];
      for (const row of rows.slice(0, input.take)) {
        const record = await boundedRow(tx, where, row.id),
          captured = evidence(record.metadata, record.entityType, input.caseId);
        // The row is already authorized by the project/case/original-org scope.
        // Bound free-form summaries and profile labels in SQL before loading them.
        const [attribution] = await tx.$queryRaw<
          { summary: string; actorId: string; label: string }[]
        >`
          SELECT left(a.summary, 1000) AS summary,
                 u.id AS "actorId",
                 left(coalesce(u.name, u.email), 500) AS label
          FROM "AuditLog" a
          JOIN "User" u ON u.id = a."actorId"
          WHERE a.id = ${row.id}
        `;
        if (!attribution)
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "Metadata history attribution is unavailable. Refresh this case's history.",
          });
        entries.push({
          auditId: row.id,
          createdAt: row.createdAt.toISOString(),
          actor: {
            id: attribution.actorId,
            label: attribution.label,
            source: "CURRENT_PROFILE" as const,
          },
          summary: attribution.summary,
          supported: !!captured,
          restoredFromAuditId: captured?.restoredFrom?.auditId ?? null,
        });
      }
      const last = entries.at(-1);
      return {
        projectId: input.projectId,
        caseId: input.caseId,
        readScope,
        entries,
        nextCursor:
          rows.length > input.take && last
            ? { auditId: last.auditId, createdAt: last.createdAt }
            : null,
        warnings: [
          "Only actor-attributed metadata captured in supported audit records can be reviewed. Legacy procedure versions do not reconstruct metadata.",
          "Actor names/emails are current profiles; the recorded actor ID is retained. This is not a qualified approval or electronic signature.",
        ],
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
function label(value: unknown, exists: boolean) {
  return !exists
    ? "Not set (absent)"
    : value === null
      ? "Not set (null)"
      : value === ""
        ? "Empty text"
        : typeof value === "boolean"
          ? value
            ? "Yes"
            : "No"
          : String(value);
}
async function preview(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof fieldHistorySelection>,
) {
  const { current, where } = await scope(tx, userId, input);
  const record = await boundedRow(tx, where, input.auditId),
    captured = evidence(record.metadata, record.entityType, input.caseId);
  const sourceHash = qualityProfileHash({
    auditId: record.id,
    createdAt: record.createdAt.toISOString(),
    entityType: record.entityType,
    metadata: record.metadata,
  });
  const warnings: string[] = [],
    problems: string[] = [],
    values = { ...current.values };
  const saved = captured
    ? input.side === "BEFORE"
      ? captured.beforeValues
      : captured.afterValues
    : null;
  if (!captured || !saved)
    problems.push(
      record.oversized
        ? "This audit exceeds the 256 KiB review bound. Its contents are not loaded or restored."
        : "This legacy audit has no supported exact metadata/schema snapshot. Nothing is reconstructed from procedure versions.",
    );
  if (captured && saved) {
    for (const field of current.schema.fields) {
      const prior = captured.schema.fields.find((f) => f.key === field.key);
      if (!prior) {
        if (Object.hasOwn(current.values, field.key))
          warnings.push(
            `${field.label}: introduced after this capture; its current value is preserved.`,
          );
        if (
          Object.hasOwn(saved, field.key) &&
          saved[field.key] !== current.values[field.key]
        )
          problems.push(
            `${field.label}: captured value has no recorded field definition. It cannot replace current metadata.`,
          );
        continue;
      }
      if (field.retired) {
        if (
          Object.hasOwn(saved, field.key) !==
            Object.hasOwn(current.values, field.key) ||
          saved[field.key] !== current.values[field.key]
        )
          problems.push(
            `${field.label} is now retired. Its current retained value cannot be replaced or removed.`,
          );
        else
          warnings.push(
            `${field.label} is retired; its retained current value is unchanged.`,
          );
        continue;
      }
      if (
        field.type !== prior.type ||
        qualityProfileHash(field.options) !== qualityProfileHash(prior.options)
      ) {
        problems.push(
          `${field.label}: captured type/choices differ from current definitions. No remapping is inferred.`,
        );
        continue;
      }
      if (
        field.label !== prior.label ||
        field.required !== prior.required ||
        prior.retired
      )
        warnings.push(
          `${field.label}: label, required status or retirement status differs from the captured definition; current rules apply.`,
        );
      if (Object.hasOwn(saved, field.key))
        values[field.key] = saved[field.key]!;
      else delete values[field.key];
    }
    for (const key of Object.keys(saved))
      if (!current.schema.fields.some((f) => f.key === key)) {
        if (
          !Object.hasOwn(current.values, key) ||
          saved[key] !== current.values[key]
        )
          problems.push(
            `${key}: no matching current definition. An unknown historical value cannot be introduced or substituted.`,
          );
        else
          warnings.push(`${key}: unknown retained metadata stays unchanged.`);
      }
    problems.push(
      ...validateCaseFieldValues(current.schema, values, current.values),
    );
  }
  const [valueSize] = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT octet_length(${JSON.stringify(values)}::jsonb::text) AS bytes`;
  if (!valueSize || valueSize.bytes > 65536)
    problems.push(
      "The proposed metadata exceeds the current 64 KiB limit. It cannot be restored by dropping or truncating values.",
    );
  const keys = [
    ...new Set([
      ...Object.keys(saved ?? {}),
      ...Object.keys(current.values),
      ...current.schema.fields.map((f) => f.key),
    ]),
  ];
  const rows = keys.map((key) => {
    const field = current.schema.fields.find((f) => f.key === key),
      previous = captured?.schema.fields.find((f) => f.key === key);
    const treatment: z.infer<
      typeof fieldHistoryPreviewOutput
    >["rows"][number]["treatment"] = !captured
      ? "Unavailable source"
      : !field
        ? "Keep unknown value"
        : field.retired
          ? "Keep retired value"
          : !previous
            ? "Keep later field"
            : field.type !== previous.type ||
                qualityProfileHash(field.options) !==
                  qualityProfileHash(previous.options)
              ? "Blocked definition"
              : "Eligible active field";
    return {
      key,
      label: field?.label ?? previous?.label ?? key,
      saved: saved
        ? label(saved[key], Object.hasOwn(saved, key))
        : "Unavailable",
      current: label(current.values[key], Object.hasOwn(current.values, key)),
      proposed: label(values[key], Object.hasOwn(values, key)),
      changed:
        Object.hasOwn(values, key) !== Object.hasOwn(current.values, key) ||
        values[key] !== current.values[key],
      treatment,
    };
  });
  if (!rows.some((row) => row.changed))
    warnings.push(
      "No supported active values differ. An unchanged comparison cannot create a restore write.",
    );
  warnings.push(
    "A restore is a new metadata save, not an approval or recertification. Procedures, results, prerequisite links and paid drafts remain untouched.",
  );
  return {
    result: {
      projectId: input.projectId,
      caseId: input.caseId,
      auditId: input.auditId,
      side: input.side,
      actorId: userId,
      expectedSchemaHash: current.expectedSchemaHash,
      expectedValueHash: current.expectedValueHash,
      expectedSourceHash: sourceHash,
      historicalSchema: captured?.schema ?? null,
      historicalSchemaVersion: captured?.schemaVersion ?? null,
      historicalValues: saved,
      currentSchema: current.schema,
      rows,
      warnings,
      problems,
      canRestore:
        current.canEdit &&
        !!captured &&
        !problems.length &&
        rows.some((row) => row.changed),
    },
    values,
  };
}
export async function previewCaseFieldHistory(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof fieldHistoryPreviewInput>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const readScope = await lockCaseFieldReadScope(
        tx,
        userId,
        input,
        authorized,
      );
      return { ...(await preview(tx, userId, input)).result, readScope };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
export async function restoreCaseFieldHistory(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof fieldHistoryRestoreInput>,
) {
  if (input.actorId !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This metadata restoration review belongs to a different actor.",
    });
  return db.$transaction(
    async (tx) => {
      await lockCaseFieldProject(tx, userId, input.projectId);
      await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId} FOR UPDATE`;
      await readCaseFieldState(tx, userId, input.projectId, input.caseId);
      const prior = await replayCaseFieldWrite(
        tx,
        userId,
        input.projectId,
        input,
        input.requestId,
      );
      if (prior) return prior;
      const authorized = await scope(tx, userId, input);
      if (
        !(await tx.auditLog.findFirst({
          where: { ...authorized.where, id: input.auditId },
          select: { id: true },
        }))
      )
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            "This metadata record is unavailable in the current case and organization.",
        });
      await tx.$queryRaw`SELECT id FROM "AuditLog" WHERE id=${input.auditId} FOR SHARE`;
      const reviewed = await preview(tx, userId, input),
        result = reviewed.result;
      if (
        result.expectedSchemaHash !== input.expectedSchemaHash ||
        result.expectedValueHash !== input.expectedValueHash ||
        result.expectedSourceHash !== input.expectedSourceHash
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Current metadata, definitions or captured source changed after review. Compare again; nothing was restored.",
        });
      if (!result.canRestore)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            result.problems.join(" ") ||
            "Choose a changed, supported metadata snapshot before restoring.",
        });
      return saveCaseFieldsInTransaction(
        tx,
        userId,
        {
          projectId: input.projectId,
          caseId: input.caseId,
          values: reviewed.values,
          expectedSchemaHash: input.expectedSchemaHash,
          expectedValueHash: input.expectedValueHash,
          reason: input.reason,
          confirmed: true,
          requestId: input.requestId,
        },
        {
          request: input,
          auditId: input.auditId,
          side: input.side,
          sourceHash: input.expectedSourceHash,
        },
      );
    },
    { timeout: 15000 },
  );
}
