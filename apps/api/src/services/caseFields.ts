import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import {
  caseFieldSchema,
  caseFieldValues,
  validateCaseFieldValues,
} from "./caseFieldSchema.js";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
const id = z.string().min(1).max(200),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
export const caseFieldScope = z
  .object({ projectId: id, caseId: id.optional() })
  .strict();
export const caseFieldSchemaReview = z
  .object({ projectId: id, schema: caseFieldSchema })
  .strict();
export const caseFieldSchemaApproval = caseFieldSchemaReview
  .extend({
    expectedSchemaHash: hash,
    expectedImpactHash: hash,
    actorId: id,
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict();
export const caseFieldValueSave = z
  .object({
    projectId: id,
    caseId: id,
    expectedSchemaHash: hash,
    expectedValueHash: hash,
    values: caseFieldValues,
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict();
export const caseFieldStateOutput = z.object({
  projectId: id,
  organizationId: id,
  caseId: id.nullable(),
  schema: caseFieldSchema,
  schemaVersion: z.number().int().nonnegative(),
  expectedSchemaHash: hash,
  values: caseFieldValues,
  expectedValueHash: hash,
  problems: z.array(z.string()),
  canConfigure: z.boolean(),
  canEdit: z.boolean(),
});
export const caseFieldImpactOutput = z.object({
  projectId: id,
  actorId: id,
  expectedSchemaHash: hash,
  expectedImpactHash: hash,
  affectedCases: z.number().int(),
  missingRequired: z.array(
    z.object({ key: z.string(), label: z.string(), count: z.number().int() }),
  ),
  warnings: z.array(z.string()),
});
export const caseFieldWriteOutput = z.object({
  requestId: z.string().uuid(),
  replayed: z.boolean(),
});
export async function readCaseFieldState(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  caseId?: string,
) {
  await requireCurrentPlanAccess(tx, userId, projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: {
      caseFieldSchema: true,
      caseFieldSchemaVersion: true,
      organizationId: true,
    },
  });
  const schema = caseFieldSchema.parse(project.caseFieldSchema);
  const membership = await tx.membership.findUniqueOrThrow({
    where: {
      organizationId_userId: { organizationId: project.organizationId, userId },
    },
    select: { role: true, seatType: true },
  });
  const tc = caseId
    ? await tx.testCase.findFirst({
        where: { id: caseId, projectId },
        select: { customFields: true, updatedAt: true },
      })
    : null;
  if (caseId && !tc)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Case not found in this project.",
    });
  const values = caseFieldValues.parse(tc?.customFields ?? {});
  return {
    projectId,
    organizationId: project.organizationId,
    caseId: caseId ?? null,
    schema,
    schemaVersion: project.caseFieldSchemaVersion,
    expectedSchemaHash: qualityProfileHash({
      projectId,
      organizationId: project.organizationId,
      version: project.caseFieldSchemaVersion,
      schema,
    }),
    values,
    expectedValueHash: qualityProfileHash({
      caseId: caseId ?? null,
      values,
      updatedAt: tc?.updatedAt.toISOString() ?? null,
    }),
    problems: validateCaseFieldValues(schema, values, values),
    canConfigure:
      membership.seatType === "FULL" &&
      ["OWNER", "ADMIN"].includes(membership.role),
    canEdit:
      membership.seatType === "FULL" &&
      ["OWNER", "ADMIN", "EDITOR"].includes(membership.role),
  };
}
export async function assertCaseFieldAuthoring(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  args: {
    caseId?: string;
    values?: z.infer<typeof caseFieldValues>;
    expectedSchemaHash?: string;
    expectedValueHash?: string;
  },
) {
  await lockCaseFieldProject(tx, userId, projectId);
  const state = await readCaseFieldState(tx, userId, projectId, args.caseId);
  if (
    args.values !== undefined &&
    (!args.expectedSchemaHash ||
      args.expectedSchemaHash !== state.expectedSchemaHash ||
      (args.caseId && args.expectedValueHash !== state.expectedValueHash))
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "Case field definitions or values changed. Refresh and review before saving.",
    });
  const values = args.values ?? state.values;
  const [valueSize] = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT octet_length(${JSON.stringify(values)}::jsonb::text) AS bytes`;
  if (!valueSize || valueSize.bytes > 65536)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Case metadata exceeds the 64 KiB stored-value limit. Keep fields concise before saving.",
    });
  const problems = validateCaseFieldValues(state.schema, values, state.values);
  if (problems.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Complete project case fields before authoring: ${problems.join(" ")}`,
    });
  return values;
}
export async function lockCaseFieldProject(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
) {
  const original = await tx.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!original)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  // Match the shared organization -> membership -> advisory -> project order.
  // An UPDATE project lock also avoids concurrent create SHARE-to-UPDATE upgrades
  // when the stable case-number allocator runs later in this transaction.
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${original.organizationId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${original.organizationId} AND "userId"=${userId} FOR SHARE`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))::text`;
  const [locked] = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  if (locked?.organizationId !== original.organizationId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Project ownership changed. Review current case fields again.",
    });
  await requireCurrentPlanAccess(tx, userId, projectId, true);
}
async function schemaImpact(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof caseFieldSchemaReview>,
) {
  const state = await readCaseFieldState(tx, userId, input.projectId);
  if (!state.canConfigure)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A current full Owner or Admin seat is required to configure case fields.",
    });
  const [schemaSize] = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT octet_length(${JSON.stringify(input.schema)}::jsonb::text) AS bytes`;
  if (!schemaSize || schemaSize.bytes > 32768)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Case field definitions exceed the 32 KiB limit. Reduce field choices before reviewing.",
    });
  for (const previous of state.schema.fields) {
    const next = input.schema.fields.find((f) => f.key === previous.key);
    if (!next)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Retire ${previous.label} instead of deleting its definition.`,
      });
    if (
      previous.type !== next.type ||
      qualityProfileHash(previous.options) !== qualityProfileHash(next.options)
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `Saved field ${previous.label} has immutable type and choices, even after values are cleared. Create a new field key; historical and current metadata stay retained.`,
      });
  }
  const missingRequired: Array<{ key: string; label: string; count: number }> =
    [];
  for (const field of input.schema.fields.filter(
    (f) => !f.retired && f.required,
  )) {
    const [row] = await tx.$queryRaw<
      Array<{ count: number }>
    >`SELECT count(*)::int AS count FROM "TestCase" WHERE "projectId"=${input.projectId} AND vaettir_case_field_value_problem(${JSON.stringify(field)}::jsonb,"customFields"->${field.key})`;
    missingRequired.push({
      key: field.key,
      label: field.label,
      count: row?.count ?? 0,
    });
  }
  const affectedCases = await tx.testCase.count({
    where: { projectId: input.projectId },
  });
  return {
    projectId: input.projectId,
    actorId: userId,
    expectedSchemaHash: state.expectedSchemaHash,
    expectedImpactHash: qualityProfileHash({
      schema: input.schema,
      expectedSchemaHash: state.expectedSchemaHash,
      missingRequired,
      affectedCases,
    }),
    affectedCases,
    missingRequired,
    warnings: [
      "Existing cases and metadata remain retained, including incomplete cases. No values are fabricated or backfilled.",
      "Active required fields must be completed before new cases, explicit content edits or field saves. Incidental risk/run bookkeeping remains unchanged. Unmapped new imports fail closed rather than silently omitting required metadata.",
      "Retired fields and their original values remain readable. Saved keys/types/choices cannot be replaced, even after values are cleared. Advanced templates and approval workflows are not implemented by this configuration.",
    ],
  };
}
export async function getCaseFields(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof caseFieldScope>,
) {
  return db.$transaction(
    (tx) => readCaseFieldState(tx, userId, input.projectId, input.caseId),
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
export async function reviewCaseFieldSchema(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof caseFieldSchemaReview>,
) {
  return db.$transaction((tx) => schemaImpact(tx, userId, input), {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
    timeout: 10000,
  });
}
async function replay(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  kind: string,
  input: unknown,
  requestId: string,
) {
  const receipt = await tx.auditLog.findFirst({
    where: {
      projectId,
      actorId: userId,
      entityType: kind,
      entityId: requestId,
    },
    select: { metadata: true, organizationId: true },
  });
  if (!receipt) return null;
  const currentProject = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (receipt.organizationId !== currentProject.organizationId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "This request receipt belongs to the project's former organization. It cannot be replayed in a different organization.",
    });
  const saved = z.object({ requestHash: hash }).parse(receipt.metadata);
  if (saved.requestHash !== qualityProfileHash(input))
    throw new TRPCError({
      code: "CONFLICT",
      message: "This request ID was already used for different field changes.",
    });
  return { requestId, replayed: true };
}
async function receipt(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  kind: string,
  input: unknown,
  requestId: string,
  evidence: Prisma.InputJsonValue,
  summary?: string,
) {
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { organizationId: true },
  });
  await tx.auditLog.create({
    data: {
      organizationId: project.organizationId,
      projectId,
      actorId: userId,
      entityType: kind,
      entityId: requestId,
      action: "UPDATE",
      summary:
        summary ??
        (kind === "CaseFieldSchemaWrite"
          ? "Approved reviewed project case field definitions"
          : "Saved reviewed case metadata"),
      metadata: {
        requestHash: qualityProfileHash(input),
        input: input as Prisma.InputJsonValue,
        evidence,
      },
    },
  });
}
export async function configureCaseFields(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof caseFieldSchemaApproval>,
) {
  if (input.actorId !== userId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "This field review belongs to a different actor.",
    });
  return db.$transaction(
    async (tx) => {
      await lockCaseFieldProject(tx, userId, input.projectId);
      const state = await readCaseFieldState(tx, userId, input.projectId);
      if (!state.canConfigure)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current Owner/Admin access is required.",
        });
      const previous = await replay(
        tx,
        userId,
        input.projectId,
        "CaseFieldSchemaWrite",
        input,
        input.requestId,
      );
      if (previous) return previous;
      const impact = await schemaImpact(tx, userId, input);
      if (
        impact.expectedSchemaHash !== input.expectedSchemaHash ||
        impact.expectedImpactHash !== input.expectedImpactHash
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Definitions or their affected case population changed after review. Review the impact again.",
        });
      await tx.project.update({
        where: { id: input.projectId },
        data: { caseFieldSchema: input.schema as Prisma.InputJsonValue },
      });
      const after = await readCaseFieldState(tx, userId, input.projectId);
      await receipt(
        tx,
        userId,
        input.projectId,
        "CaseFieldSchemaWrite",
        input,
        input.requestId,
        {
          version: 1,
          beforeSchema: state.schema,
          beforeSchemaVersion: state.schemaVersion,
          afterSchema: after.schema,
          afterSchemaVersion: after.schemaVersion,
          reviewedImpact: impact,
        },
      );
      return { requestId: input.requestId, replayed: false };
    },
    { timeout: 20000 },
  );
}
export async function replayCaseFieldWrite(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  input: unknown,
  requestId: string,
) {
  return replay(tx, userId, projectId, "CaseFieldValueWrite", input, requestId);
}
export async function saveCaseFieldsInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof caseFieldValueSave>,
  restoration?: {
    request: unknown;
    auditId: string;
    side: "BEFORE" | "AFTER";
    sourceHash: string;
  },
) {
  await lockCaseFieldProject(tx, userId, input.projectId);
  await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId} FOR UPDATE`;
  const state = await readCaseFieldState(
    tx,
    userId,
    input.projectId,
    input.caseId,
  );
  if (!state.canEdit)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A current full Editor seat is required.",
    });
  const previous = await replay(
    tx,
    userId,
    input.projectId,
    "CaseFieldValueWrite",
    restoration?.request ?? input,
    input.requestId,
  );
  if (previous) return previous;
  const values = await assertCaseFieldAuthoring(tx, userId, input.projectId, {
    caseId: input.caseId,
    values: input.values,
    expectedSchemaHash: input.expectedSchemaHash,
    expectedValueHash: input.expectedValueHash,
  });
  await tx.testCase.update({
    where: { id: input.caseId },
    data: {
      customFields: values as Prisma.InputJsonValue,
      updatedById: userId,
    },
  });
  await receipt(
    tx,
    userId,
    input.projectId,
    "CaseFieldValueWrite",
    restoration?.request ?? input,
    input.requestId,
    {
      version: 1,
      caseId: input.caseId,
      beforeValues: state.values,
      afterValues: values,
      schema: state.schema,
      schemaVersion: state.schemaVersion,
      recoverySupported: true,
      ...(restoration
        ? {
            restoredFrom: {
              auditId: restoration.auditId,
              side: restoration.side,
              sourceHash: restoration.sourceHash,
            },
          }
        : {}),
    },
    restoration
      ? "Restored reviewed case metadata as a new audited save"
      : undefined,
  );
  return { requestId: input.requestId, replayed: false };
}
export async function saveCaseFields(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof caseFieldValueSave>,
) {
  return db.$transaction(
    (tx) => saveCaseFieldsInTransaction(tx, userId, input),
    { timeout: 10000 },
  );
}
