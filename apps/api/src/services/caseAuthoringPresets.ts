import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { readCaseFieldState, lockCaseFieldProject } from "./caseFields.js";
import { lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import {
  validateCaseFieldValues,
  fieldValueProblem,
} from "./caseFieldSchema.js";
import {
  qualityProfileHash,
  readQualityExperience,
} from "./qualityExperienceProfile.js";
import {
  caseAuthoringPresetDefinition,
  caseAuthoringPresetSaved,
  caseAuthoringPresetReceipt,
  caseAuthoringPresetReview,
  caseAuthoringPresetApproval,
  caseAuthoringPresetScope,
  caseAuthoringPresetPrefill,
  presetEvidenceNotice,
  caseAuthoringPresetExpectedScope,
} from "./caseAuthoringPresetSchema.js";

type Tx = Prisma.TransactionClient;
type Review = z.infer<typeof caseAuthoringPresetReview>;
type Definition = z.infer<typeof caseAuthoringPresetDefinition>;
function refuse(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}
type ExpectedScope = z.infer<typeof caseAuthoringPresetExpectedScope>;
async function context(tx: Tx, actorId: string, projectId: string, expectedScope?: ExpectedScope, authorized?: CaseFieldReadAuthorization) {
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
  // Pin current ownership/membership before any library body or retained receipt read.
  const original = await tx.project.findUnique({ where: { id: projectId }, select: { organizationId: true } });
  if (!original) throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${original.organizationId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${original.organizationId} AND "userId"=${actorId} FOR SHARE`;
  const [locked] = await tx.$queryRaw<Array<{ organizationId: string }>>`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR SHARE`;
  if (locked?.organizationId !== original.organizationId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Project ownership changed; no preset content was read." });
  const clerkActorId = await lockCurrentCaseFieldActor(tx, actorId, authorized);
  await requireCurrentPlanAccess(tx, actorId, projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { organizationId: true, qualityProfile: true },
  });
  const member = await tx.membership.findUniqueOrThrow({
    where: {
      organizationId_userId: {
        organizationId: project.organizationId,
        userId: actorId,
      },
    },
    select: { role: true, seatType: true },
  });
  if (expectedScope && (expectedScope.organizationId !== project.organizationId || expectedScope.clerkActorId !== clerkActorId))
    throw new TRPCError({ code: "FORBIDDEN", message: "Preset access belongs to a different original organization or signed-in actor. Retained drafts and requests were not replaced." });
  const fields = await readCaseFieldState(
    tx,
    actorId,
    projectId,
    undefined,
    clerkActorId,
  );
  const profile = readQualityExperience(project.qualityProfile);
  return {
    organizationId: project.organizationId,
    clerkActorId,
    fields,
    profile,
    canEdit:
      member.seatType === "FULL" &&
      ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
    canManage:
      member.seatType === "FULL" && ["OWNER", "ADMIN"].includes(member.role),
  };
}
function compatibility(
  definition: Definition,
  ctx: Awaited<ReturnType<typeof context>>,
) {
  const optionalSchema = {
    ...ctx.fields.schema,
    fields: ctx.fields.schema.fields.map((field) => ({
      ...field,
      required: false,
    })),
  };
  const problems = validateCaseFieldValues(
    optionalSchema,
    definition.customFields,
    {},
  );
  if (problems.length)
    refuse(
      `Preset defaults are incompatible with current human fields: ${problems.join(" ")} Edit the preset or restore compatible active field definitions; no value is silently discarded.`,
    );
  const requiredFields = ctx.fields.schema.fields.flatMap((field) => {
    const problem = fieldValueProblem(
      field,
      definition.customFields[field.key],
    );
    return problem ? [problem] : [];
  });
  const applicability = definition.applicability;
  const matches =
    !applicability ||
    (!!ctx.profile.experience &&
      qualityProfileHash(applicability) ===
        qualityProfileHash(ctx.profile.experience));
  const warnings = [
    presetEvidenceNotice,
    ...(requiredFields.length
      ? [
          "Complete the following current required fields in each new case; these values are not invented.",
        ]
      : []),
    ...(!definition.steps.length &&
    !(
      definition.given.length &&
      definition.when.length &&
      definition.then.length
    )
      ? [
          "This scaffold has no complete executable procedure. Author the missing actions/expected criteria before creating or running the case.",
        ]
      : []),
    ...(matches
      ? []
      : [
          "Preset applicability differs from this project's current granular profile. This is advisory, not a certification or access decision; explicitly review the mismatch before using it.",
        ]),
  ];
  return { requiredFields, applicabilityMatches: matches, warnings };
}
function saved(record: {
  id: string;
  name: string;
  version: number;
  archivedAt: Date | null;
  definition: unknown;
}) {
  return caseAuthoringPresetSaved.parse({
    presetId: record.id,
    name: record.name,
    version: record.version,
    archived: !!record.archivedAt,
    definition: record.definition,
  });
}
async function boundTypedDefaults(tx: Tx, definition: Definition) {
  const [size] = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT octet_length(${JSON.stringify(definition.customFields)}::jsonb::text) AS bytes`;
  if (!size || size.bytes > 65536)
    refuse(
      "Preset human defaults exceed the 64 KiB case metadata limit. Reduce the complete defaults before review; no values were dropped.",
    );
}
async function currentPreset(
  tx: Tx,
  projectId: string,
  organizationId: string,
  presetId: string,
  awaitingOwnReceipt = false,
) {
  const [size] = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(definition::text) AS bytes FROM "CaseAuthoringPreset" WHERE id=${presetId} AND "projectId"=${projectId} AND "organizationId"=${organizationId}`;
  if (size && size.bytes > 262144)
    refuse("Retained preset exceeds the 256 KiB supported body bound. No content was truncated or normalized.");
  const record = await tx.caseAuthoringPreset.findFirst({
    where: { id: presetId, projectId, organizationId },
  });
  if (!record)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "Preset is not available in this project's original organization scope.",
    });
  if (!awaitingOwnReceipt) {
    const head = saved(record);
    const [receiptSize] = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(receipt::text) AS bytes FROM "CaseAuthoringPresetWrite" WHERE "presetId"=${presetId} AND "projectId"=${projectId} AND "organizationId"=${organizationId} AND receipt->'after'->'version'=to_jsonb(${record.version}::int) LIMIT 1`;
    if (receiptSize && receiptSize.bytes > 614400)
      refuse("Retained preset revision exceeds the 600 KiB supported receipt bound. No reviewed content was inferred.");
    const receipt = await tx.caseAuthoringPresetWrite.findFirst({
      where: {
        presetId,
        projectId,
        organizationId,
        receipt: { path: ["after", "version"], equals: record.version },
      },
    });
    if (
      !receipt ||
      qualityProfileHash(
        caseAuthoringPresetReceipt.parse(receipt.receipt).after,
      ) !== qualityProfileHash(head)
    )
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Current preset content does not match its retained reviewed revision. Nothing was normalized or overwritten; contact support.",
      });
  }
  return record;
}
async function prepare(tx: Tx, actorId: string, input: Review, authorized?: CaseFieldReadAuthorization) {
  const ctx = await context(tx, actorId, input.projectId, input.expectedScope, authorized);
  if (!ctx.canManage)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A current full Owner or Admin seat is required to control authoring presets.",
    });
  const current = input.presetId
    ? saved(
        await currentPreset(
          tx,
          input.projectId,
          ctx.organizationId,
          input.presetId,
        ),
      )
    : null;
  let definition = input.definition ?? current?.definition,
    name = input.name ?? current?.name;
  if (input.operation === "RESTORE") {
    const [size] = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(receipt::text) AS bytes FROM "CaseAuthoringPresetWrite" WHERE id=${input.restoreReceiptId} AND "projectId"=${input.projectId} AND "organizationId"=${ctx.organizationId} AND "presetId"=${input.presetId}`;
    if (size && size.bytes > 614400)
      refuse("Retained restoration exceeds the complete 600 KiB receipt bound. No content was truncated or normalized.");
    const prior = await tx.caseAuthoringPresetWrite.findFirst({
      where: {
        id: input.restoreReceiptId,
        projectId: input.projectId,
        organizationId: ctx.organizationId,
        presetId: input.presetId,
      },
    });
    if (!prior)
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Retained revision is unavailable for this preset.",
      });
    const history = caseAuthoringPresetReceipt.parse(prior.receipt);
    if (
      history.organizationId !== ctx.organizationId ||
      history.projectId !== input.projectId ||
      history.after.presetId !== input.presetId
    )
      refuse(
        "Historical preset scope does not match this project. Nothing was restored.",
      );
    definition = history.after.definition;
    name = history.after.name;
  }
  if (!definition || !name) refuse("Complete preset definition is required.");
  if (Buffer.byteLength(JSON.stringify(definition), "utf8") > 262144)
    refuse("Keep a complete preset within 256 KiB. No content was truncated.");
  const bytes = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT octet_length(${JSON.stringify(definition)}::jsonb::text) AS bytes`;
  if (!bytes[0] || bytes[0].bytes > 262144)
    refuse(
      "Stored preset exceeds the 256 KiB bound. No content was truncated.",
    );
  if (current && current.version >= 1000000)
    refuse(
      "Preset revision bound reached; retain history and contact support.",
    );
  if (input.operation === "ARCHIVE" && current?.archived)
    refuse("Preset is already archived; its identity was retained.");
  if (input.operation === "UNARCHIVE" && !current?.archived)
    refuse("Preset is already active.");
  if (input.operation === "UPDATE" && current?.archived)
    refuse(
      "Unarchive this stable preset before editing it, or review historical content restoration while it stays archived.",
    );
  if (
    await tx.caseAuthoringPreset.count({
      where: {
        projectId: input.projectId,
        name,
        ...(input.presetId ? { id: { not: input.presetId } } : {}),
      },
    })
  )
    refuse(
      "That preset name already exists, including archived identities. Review the existing preset instead of creating a replacement duplicate.",
    );
  const check =
    input.operation === "ARCHIVE"
      ? {
          requiredFields: [] as string[],
          applicabilityMatches: true,
          warnings: [
            presetEvidenceNotice,
            "Archiving retains this exact content, even if its current field defaults need repair.",
          ],
        }
      : compatibility(definition, ctx);
  if (input.operation !== "ARCHIVE") await boundTypedDefaults(tx, definition);
  const expectedHash = qualityProfileHash({
    actorId,
    input,
    current,
    organizationId: ctx.organizationId,
    fieldSchemaHash: ctx.fields.expectedSchemaHash,
    profileHash: ctx.profile.profileHash,
    definition,
    name,
  });
  return { ctx, current, definition, name, ...check, expectedHash };
}
export async function listCaseAuthoringPresets(
  db: PrismaClient,
  actorId: string,
  projectId: string,
  expectedScope?: ExpectedScope,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const ctx = await context(tx, actorId, projectId, expectedScope, authorized);
      const items = await tx.caseAuthoringPreset.findMany({
        where: { projectId, organizationId: ctx.organizationId },
        select: { id: true, name: true, version: true, archivedAt: true },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        take: 51,
      });
      if (items.length > 50)
        refuse(
          "Preset catalog exceeds the supported complete 50-preset bound; no entries were hidden.",
        );
      return {
        projectId,
        organizationId: ctx.organizationId,
        clerkActorId: ctx.clerkActorId,
        canEdit: ctx.canEdit,
        canManage: ctx.canManage,
        items: items.map((item) => ({
          presetId: item.id,
          name: item.name,
          version: item.version,
          archived: !!item.archivedAt,
        })),
        fieldSchemaHash: ctx.fields.expectedSchemaHash,
        profileHash: ctx.profile.profileHash,
        experience: ctx.profile.experience,
        fieldSchema: ctx.fields.schema,
        notice: presetEvidenceNotice,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function getCaseAuthoringPreset(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof caseAuthoringPresetScope>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const ctx = await context(tx, actorId, input.projectId, input.expectedScope, authorized),
        value = saved(
          await currentPreset(
            tx,
            input.projectId,
            ctx.organizationId,
            input.presetId,
          ),
        );
      return { projectId: input.projectId, organizationId: ctx.organizationId, clerkActorId: ctx.clerkActorId, value, canManage: ctx.canManage };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function previewCaseAuthoringPreset(
  db: PrismaClient,
  actorId: string,
  input: Review,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const p = await prepare(tx, actorId, input, authorized);
      return {
        projectId: input.projectId,
        organizationId: p.ctx.organizationId,
        clerkActorId: p.ctx.clerkActorId,
        expectedHash: p.expectedHash,
        current: p.current,
        name: p.name,
        definition: p.definition,
        requiredFields: p.requiredFields,
        applicabilityMatches: p.applicabilityMatches,
        warnings: p.warnings,
        fieldSchemaHash: p.ctx.fields.expectedSchemaHash,
        profileHash: p.ctx.profile.profileHash,
        nextVersion: (p.current?.version ?? 0) + 1,
        nextArchived:
          input.operation === "ARCHIVE" ||
          (input.operation === "RESTORE" && !!p.current?.archived),
        fieldSchema: p.ctx.fields.schema,
        currentExperience: p.ctx.profile.experience,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function writeCaseAuthoringPreset(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof caseAuthoringPresetApproval>,
  authorized?: CaseFieldReadAuthorization,
) {
  const requestHash = qualityProfileHash(input);
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
      await lockCaseFieldProject(tx, actorId, input.projectId);
      const ctx = await context(tx, actorId, input.projectId, input.expectedScope, authorized);
      if (!ctx.canManage)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "A current full Owner or Admin seat is required to control authoring presets.",
        });
      const prior = await tx.caseAuthoringPresetWrite.findUnique({
        where: {
          projectId_actorId_requestId: {
            projectId: input.projectId,
            actorId,
            requestId: input.requestId,
          },
        },
        select: { id: true, organizationId: true, requestHash: true },
      });
      if (prior) {
        if (prior.organizationId !== ctx.organizationId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Retained preset response belongs to the project's previous organization.",
          });
        if (prior.requestHash !== requestHash)
          conflict(
            "This request identity belongs to a different approved preset change. Retry its exact payload.",
          );
        const [size] = await tx.$queryRaw<Array<{ bytes: number }>>`SELECT octet_length(receipt::text) AS bytes FROM "CaseAuthoringPresetWrite" WHERE id=${prior.id} AND "organizationId"=${ctx.organizationId}`;
        if (!size || size.bytes > 614400)
          refuse("Retained response exceeds the supported receipt bound. Keep the original request identity; no replacement write was made.");
        const retained = await tx.caseAuthoringPresetWrite.findUniqueOrThrow({ where: { id: prior.id }, select: { receipt: true } });
        const receipt = caseAuthoringPresetReceipt.parse(retained.receipt);
        if (
          receipt.organizationId !== ctx.organizationId ||
          receipt.projectId !== input.projectId ||
          receipt.actorId !== actorId
        )
          conflict(
            "Retained receipt is unavailable in current scope; no replacement write was made.",
          );
        return {
          projectId: input.projectId,
          organizationId: ctx.organizationId,
          clerkActorId: ctx.clerkActorId,
          requestId: input.requestId,
          receiptId: prior.id,
          replayed: true,
          value: receipt.after,
        };
      }
      if (
        (await tx.caseAuthoringPresetWrite.count({
          where: { projectId: input.projectId },
        })) >= 5000
      )
        refuse(
          "Preset history limit reached; existing receipts remain recoverable. Contact support without discarding history.",
        );
      const {
        expectedHash: _baseline,
        requestId: _request,
        confirmed: _confirmed,
        reason: _reason,
        ...review
      } = input;
      const p = await prepare(tx, actorId, review, authorized);
      if (p.expectedHash !== input.expectedHash)
        conflict(
          "Preset, current human fields or project profile changed after review. Your draft was not applied.",
        );
      let row;
      if (input.operation === "CREATE") {
        if (
          (await tx.caseAuthoringPreset.count({
            where: { projectId: input.projectId },
          })) >= 50
        )
          refuse(
            "Keep at most 50 retained presets per project, including archived identities.",
          );
        row = await tx.caseAuthoringPreset.create({
          data: {
            projectId: input.projectId,
            organizationId: ctx.organizationId,
            createdById: actorId,
            name: p.name,
            definition: p.definition as Prisma.InputJsonValue,
          },
        });
      } else {
        const archived =
          input.operation === "ARCHIVE" ||
          (input.operation === "RESTORE" && !!p.current?.archived);
        const changed = await tx.caseAuthoringPreset.updateMany({
          where: {
            id: input.presetId,
            projectId: input.projectId,
            organizationId: ctx.organizationId,
            version: p.current!.version,
          },
          data: {
            name: p.name,
            definition: p.definition as Prisma.InputJsonValue,
            version: { increment: 1 },
            archivedAt: archived ? new Date() : null,
          },
        });
        if (changed.count !== 1)
          conflict("Preset changed while saving; no new revision was applied.");
        row = await currentPreset(
          tx,
          input.projectId,
          ctx.organizationId,
          input.presetId!,
          true,
        );
      }
      const value = saved(row);
      const receipt = caseAuthoringPresetReceipt.parse({
        schemaVersion: 1,
        organizationId: ctx.organizationId,
        projectId: input.projectId,
        actorId,
        operation: input.operation,
        reason: input.reason,
        before: p.current,
        after: value,
        fieldSchemaHash: ctx.fields.expectedSchemaHash,
        profileHash: ctx.profile.profileHash,
        restoredReceiptId: input.restoreReceiptId ?? null,
      });
      const stored = await tx.caseAuthoringPresetWrite.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          presetId: row.id,
          actorId,
          requestId: input.requestId,
          requestHash,
          receipt: receipt as Prisma.InputJsonValue,
        },
      });
      // Confirm immediate durable head/receipt consistency before returning;
      // no deferred trigger can silently turn a successful response into rollback.
      await currentPreset(tx, input.projectId, ctx.organizationId, row.id);
      await tx.auditLog.create({
        data: {
          organizationId: ctx.organizationId,
          projectId: input.projectId,
          actorId,
          entityType: "CaseAuthoringPreset",
          entityId: row.id,
          action: input.operation === "CREATE" ? "CREATE" : "UPDATE",
          summary: `${input.operation} authoring preset ${row.name}, revision ${row.version}`,
          metadata: {
            receiptId: stored.id,
            reason: input.reason,
            version: row.version,
            archived: !!row.archivedAt,
            restoredReceiptId: input.restoreReceiptId ?? null,
          },
        },
      });
      return {
        projectId: input.projectId,
        organizationId: ctx.organizationId,
        clerkActorId: ctx.clerkActorId,
        requestId: input.requestId,
        receiptId: stored.id,
        replayed: false,
        value,
      };
    },
    { timeout: 20000 },
  );
}
export async function listCaseAuthoringPresetHistory(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof caseAuthoringPresetScope>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const ctx = await context(tx, actorId, input.projectId, input.expectedScope, authorized);
      if (!ctx.canManage)
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "A current full Owner or Admin seat is required to inspect retained preset revisions.",
        });
      await currentPreset(
        tx,
        input.projectId,
        ctx.organizationId,
        input.presetId,
      );
      const [historySize] = await tx.$queryRaw<Array<{ bytes: string; largest: number }>>`SELECT COALESCE(sum(bytes),0)::text AS bytes, COALESCE(max(bytes),0)::int AS largest FROM (SELECT octet_length(receipt::text) AS bytes FROM "CaseAuthoringPresetWrite" WHERE "projectId"=${input.projectId} AND "organizationId"=${ctx.organizationId} AND "presetId"=${input.presetId} ORDER BY "createdAt" DESC,id DESC LIMIT 25) AS retained`;
      if (!historySize || Number(historySize.bytes) > 8388608 || historySize.largest > 614400)
        refuse("Retained preset history exceeds the complete 8 MiB/600 KiB-per-receipt supported bound. No partial history was substituted.");
      const rows = await tx.caseAuthoringPresetWrite.findMany({
        where: {
          projectId: input.projectId,
          organizationId: ctx.organizationId,
          presetId: input.presetId,
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 25,
      });
      return {
        projectId: input.projectId,
        organizationId: ctx.organizationId,
        clerkActorId: ctx.clerkActorId,
        items: rows.map((row) => ({
          receiptId: row.id,
          recordedAt: row.createdAt.toISOString(),
          actorId: row.actorId,
          receipt: caseAuthoringPresetReceipt.parse(row.receipt),
        })),
        limitation:
          "Newest 25 immutable change receipts. Restore appends a new revision and preserves current archive state; it never erases older content.",
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
async function prefillReview(
  tx: Tx,
  actorId: string,
  input: z.infer<typeof caseAuthoringPresetScope>,
  authorized?: CaseFieldReadAuthorization,
) {
  const ctx = await context(tx, actorId, input.projectId, input.expectedScope, authorized);
  if (!ctx.canEdit)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A current full editor seat is required to start a case draft.",
    });
  const value = saved(
    await currentPreset(
      tx,
      input.projectId,
      ctx.organizationId,
      input.presetId,
    ),
  );
  if (value.archived)
    refuse(
      "This stable preset is archived. Ask an Owner/Admin to review unarchiving it before use.",
    );
  const check = compatibility(value.definition, ctx);
  await boundTypedDefaults(tx, value.definition);
  return {
    projectId: input.projectId,
    organizationId: ctx.organizationId,
    clerkActorId: ctx.clerkActorId,
    value,
    ...check,
    fieldSchema: ctx.fields.schema,
    currentExperience: ctx.profile.experience,
    fieldSchemaHash: ctx.fields.expectedSchemaHash,
    profileHash: ctx.profile.profileHash,
    expectedHash: qualityProfileHash({
      actorId,
      ...(input.expectedScope ? { expectedScope: input.expectedScope } : {}),
      projectId: input.projectId,
      organizationId: ctx.organizationId,
      value,
      fieldSchemaHash: ctx.fields.expectedSchemaHash,
      profileHash: ctx.profile.profileHash,
    }),
  };
}
export async function reviewCaseAuthoringPresetPrefill(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof caseAuthoringPresetScope>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction((tx) => prefillReview(tx, actorId, input, authorized), {
    isolationLevel: "RepeatableRead",
    timeout: 20000,
  });
}
export async function confirmCaseAuthoringPresetPrefill(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof caseAuthoringPresetPrefill>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const review = await prefillReview(tx, actorId, input, authorized);
      if (review.expectedHash !== input.expectedHash)
        conflict(
          "Preset, project profile or human field definitions changed. Review a fresh draft instead of silently refreshing approval.",
        );
      return review;
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
