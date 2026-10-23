import { TRPCError } from "@trpc/server";
import { Prisma, TestCaseType, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { TestCaseStepInputSchema } from "@vaettir/core";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import {
  validationDomainSchema,
  verificationProfileSchema,
} from "./physicalValidation.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import { caseFieldPresentationJsonBytes } from "./caseFieldPresentationSchema.js";
import {
  assertCaseFieldAuthoring,
  lockCaseFieldProject,
} from "./caseFields.js";
import {
  lockCaseFieldReadScope,
  lockCurrentCaseFieldActor,
  caseFieldReadScopeSchema,
  caseFieldReadPinFields,
  pairedCaseFieldReadPins,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";

export const restoreFieldSchema = z.enum([
  "title",
  "background",
  "given",
  "when",
  "then",
  "steps",
  "tags",
  "priority",
  "testType",
  "validationDomain",
  "verificationProfile",
]);
export const versionScopeSchema = z.object({
  projectId: z.string().min(1).max(200),
  testCaseId: z.string().min(1).max(200),
});
export const versionPreviewSchema = versionScopeSchema
  .extend({ versionNumber: z.number().int().positive() })
  .strict();
export const historicalComparisonSchema = versionScopeSchema
  .extend({
    fromVersionNumber: z.number().int().min(1).max(2147483647),
    toVersionNumber: z.number().int().min(1).max(2147483647),
  })
  .strict();
const historicalVersionSchema = z.object({
  id: z.string(),
  versionNumber: z.number().int().positive(),
  createdAt: z.string().datetime(),
});
export const historicalComparisonOutputSchema = z.object({
  caseId: z.string(),
  displayId: z.string(),
  from: historicalVersionSchema,
  to: historicalVersionSchema,
  fields: z
    .array(
      z.object({
        key: restoreFieldSchema,
        label: z.string(),
        changed: z.boolean(),
        from: z.string(),
        to: z.string(),
      }),
    )
    .max(11),
  warnings: z.array(z.string()).max(5),
});
export const versionRestoreSchema = versionPreviewSchema
  .extend({
    expectedCaseRevision: z.string().regex(/^[a-f0-9]{64}$/),
    expectedVersionRevision: z.string().regex(/^[a-f0-9]{64}$/),
    fields: z
      .array(restoreFieldSchema)
      .min(1)
      .max(11)
      .refine((v) => new Set(v).size === v.length, "Choose each field once"),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
    requestId: z.string().uuid(),
  })
  .strict();
const fieldPreviewSchema = z.object({
  key: restoreFieldSchema,
  label: z.string(),
  changed: z.boolean(),
  restorable: z.boolean(),
  reason: z.string().nullable(),
  current: z.string(),
  saved: z.string(),
});
export const versionPreviewOutputSchema = z.object({
  caseId: z.string(),
  displayId: z.string(),
  versionNumber: z.number(),
  versionId: z.string(),
  createdAt: z.string().datetime(),
  expectedCaseRevision: z.string(),
  expectedVersionRevision: z.string(),
  fields: z.array(fieldPreviewSchema).max(11),
  warnings: z.array(z.string()),
  canRestore: z.boolean(),
});
export const versionRestoreOutputSchema = z.object({
  restoredVersionNumber: z.number(),
  createdVersionNumber: z.number(),
  displayId: z.string(),
  replayed: z.boolean(),
});
// Read activation fields are deliberately NOT put into versionPreviewSchema:
// legacy restore inherits that schema and hashes its exact parsed input.
const readFields = {
  ...caseFieldReadPinFields,
  readRequestId: z.string().uuid().optional(),
};
export const versionListReadSchema = versionScopeSchema
  .extend({
    ...readFields,
    take: z.number().int().min(1).max(20).default(10),
    before: z.number().int().positive().optional(),
  })
  .strict()
  .superRefine(pairedCaseFieldReadPins);
export const versionPreviewReadSchema = versionPreviewSchema
  .extend(readFields)
  .strict()
  .superRefine(pairedCaseFieldReadPins);
export const historicalComparisonReadSchema = historicalComparisonSchema
  .extend(readFields)
  .strict()
  .superRefine(pairedCaseFieldReadPins);
export const versionAccessReadSchema = versionScopeSchema
  .extend({ ...readFields, readRequestId: z.string().uuid() })
  .strict()
  .superRefine(pairedCaseFieldReadPins);
const readProjectionSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ACCESS") }).strict(),
  z
    .object({
      kind: z.literal("LIST"),
      take: z.number().int().min(1).max(20),
      before: z.number().int().positive().nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("CURRENT"),
      versionNumber: z.number().int().positive(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("HISTORICAL"),
      fromVersionNumber: z.number().int().positive(),
      toVersionNumber: z.number().int().positive(),
    })
    .strict(),
]);
export const versionReadContextSchema = z
  .object({
    readRequestId: z.string().uuid(),
    readScope: caseFieldReadScopeSchema,
    caseId: z.string().min(1).max(200),
    canRecover: z.boolean(),
    projection: readProjectionSchema,
  })
  .strict();
export const versionPreviewReadOutputSchema = versionPreviewOutputSchema.extend(
  { readContext: versionReadContextSchema.optional() },
);
export const historicalComparisonReadOutputSchema =
  historicalComparisonOutputSchema.extend({
    readContext: versionReadContextSchema.optional(),
  });
export const versionRestoreReviewedSchema = z
  .object({
    request: versionRestoreSchema,
    originalOrganizationId: z.string().min(1).max(200),
    expectedClerkActorId: z.string().min(1).max(200),
    expectedNativeActorId: z.string().min(1).max(200),
  })
  .strict();
export const versionRestoreReviewedOutputSchema = versionRestoreOutputSchema
  .extend({
    requestId: z.string().uuid(),
    requestHash: z.string().regex(/^[a-f0-9]{64}$/),
    caseId: z.string().min(1).max(200),
    readScope: caseFieldReadScopeSchema,
    scopeProof: z.literal("CURRENT_LOCKED_AUTHORIZATION"),
  })
  .strict();
type ReadInput =
  | z.infer<typeof versionPreviewReadSchema>
  | z.infer<typeof historicalComparisonReadSchema>
  | z.infer<typeof versionListReadSchema>
  | z.infer<typeof versionAccessReadSchema>;
type ReviewedPins = Pick<
  z.infer<typeof versionRestoreReviewedSchema>,
  "originalOrganizationId" | "expectedClerkActorId" | "expectedNativeActorId"
>;

export async function caseVersionReadContext(
  tx: Prisma.TransactionClient,
  userId: string,
  input: ReadInput,
  scope: z.infer<typeof caseFieldReadScopeSchema>,
  projection: z.infer<typeof readProjectionSchema>,
): Promise<{ readContext?: z.infer<typeof versionReadContextSchema> }> {
  if (input.readRequestId === undefined) return {};
  const member = await tx.membership.findFirst({
    where: { userId, organizationId: scope.organizationId },
    select: { role: true, seatType: true },
  });
  return {
    readContext: versionReadContextSchema.parse({
      readRequestId: input.readRequestId,
      readScope: scope,
      caseId: input.testCaseId,
      projection,
      canRecover:
        !!member &&
        member.seatType === "FULL" &&
        ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
    }),
  };
}
export async function readCaseVersionAccess(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof versionAccessReadSchema>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const scope = await lockCaseFieldReadScope(
        tx,
        userId,
        {
          projectId: input.projectId,
          caseId: input.testCaseId,
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        },
        authorized,
      );
      await requireCurrentPlanAccess(tx, userId, input.projectId);
      return versionReadContextSchema.parse(
        (
          await caseVersionReadContext(tx, userId, input, scope, {
            kind: "ACCESS",
          })
        ).readContext,
      );
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}
/** Interim NEW-reviewed-write admission only. The shared version helper cannot
 * attest SQL NULL versus JSON null from a JS null, so both are refused here.
 * This is not a precision-preserving native read codec or a legacy migration. */
export async function assertReviewedVersionProfileRoundTrip(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof versionPreviewSchema>,
  currentProfile: unknown,
  historical?: { value: unknown },
) {
  const refused = () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The native verification profile cannot be versioned exactly by the current reviewed-restore codec. No profile or history was converted or overwritten.",
    });
  const encode = (value: unknown) => {
    try {
      if (caseFieldPresentationJsonBytes(value) > 524288) throw refused();
      return JSON.stringify(value);
    } catch {
      throw refused();
    }
  };
  const currentJson = encode(currentProfile);
  const [current] = await tx.$queryRaw<
    Array<{ exact: boolean; nativeKind: string }>
  >`
    SELECT ("verificationProfile" IS NOT DISTINCT FROM ${currentJson}::jsonb) AS exact,
      CASE WHEN "verificationProfile" IS NULL THEN 'SQL_NULL' WHEN "verificationProfile"='null'::jsonb THEN 'JSON_NULL' ELSE 'VALUE' END AS "nativeKind"
    FROM "TestCase" WHERE id=${input.testCaseId} AND "projectId"=${input.projectId}`;
  if (
    current?.exact !== true ||
    current.nativeKind !== "VALUE" ||
    currentProfile === null
  )
    throw refused();
  if (historical) {
    const savedJson = encode(historical.value);
    const [saved] = await tx.$queryRaw<
      Array<{ exact: boolean; nativeKind: string }>
    >`
      SELECT (v."verificationProfile" IS NOT DISTINCT FROM ${savedJson}::jsonb) AS exact,
        CASE WHEN v."verificationProfile" IS NULL THEN 'SQL_NULL' WHEN v."verificationProfile"='null'::jsonb THEN 'JSON_NULL' ELSE 'VALUE' END AS "nativeKind"
      FROM "TestCaseVersion" v JOIN "TestCase" c ON c.id=v."testCaseId"
      WHERE c."projectId"=${input.projectId} AND v."testCaseId"=${input.testCaseId} AND v."versionNumber"=${input.versionNumber}`;
    if (
      saved?.exact !== true ||
      saved.nativeKind !== "VALUE" ||
      historical.value === null
    )
      throw refused();
  }
}
const freshnessNotice =
  "Retained risk/design assessments, paid drafts and review decisions may refer to other case content. Review them again; this restore does not recertify them.";
const text = z.string().max(10000);
const stepsSchema = z
  .array(
    TestCaseStepInputSchema.extend({
      order: z.number().int().nonnegative(),
      action: text.min(1),
      expectedActionOrData: text.nullable().optional(),
      expectedResult: text.nullable().optional(),
      expectedResponse: text.nullable().optional(),
    }).strict(),
  )
  .max(500)
  .refine(
    (steps) => steps.every((s, i) => s.order === i),
    "Saved step order needs repair before restoration",
  );
const labels: Record<z.infer<typeof restoreFieldSchema>, string> = {
  title: "Title",
  background: "Background",
  given: "Given",
  when: "When",
  then: "Then",
  steps: "Structured steps and recorded media",
  tags: "Tags",
  priority: "Priority",
  testType: "Test type",
  validationDomain: "Validation domain",
  verificationProfile: "Verification profile",
};

/** Read-only saved-to-saved comparison. Deliberately provides no restore CAS. */
export async function compareHistoricalCaseVersions(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof historicalComparisonReadSchema>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const scope = await lockCaseFieldReadScope(
        tx,
        userId,
        {
          projectId: input.projectId,
          caseId: input.testCaseId,
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        },
        authorized,
      );
      await requireCurrentPlanAccess(tx, userId, input.projectId);
      const currentIdentity = await tx.testCase.findFirst({
        where: { id: input.testCaseId, projectId: input.projectId },
        select: { id: true, displayId: true },
      });
      if (!currentIdentity)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Case not found in this project.",
        });
      const sizes = await tx.$queryRaw<
        Array<{ versionNumber: number; bytes: number }>
      >`
      SELECT v."versionNumber", octet_length(row_to_json(v)::text)::int AS bytes
      FROM "TestCaseVersion" v
      WHERE v."testCaseId" = ${currentIdentity.id}
      AND v."versionNumber" IN (${input.fromVersionNumber}, ${input.toVersionNumber})`;
      const numbers = new Set([input.fromVersionNumber, input.toVersionNumber]);
      if (sizes.length !== numbers.size)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "A selected saved version is unavailable for this case.",
        });
      if (sizes.some((v) => v.bytes > 524288))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A saved version exceeds the 512 KiB comparison limit. Use a focused manual review; nothing was changed.",
        });
      const versions = await tx.testCaseVersion.findMany({
        where: {
          testCaseId: currentIdentity.id,
          versionNumber: { in: [...numbers] },
        },
        take: 2,
        select: {
          id: true,
          versionNumber: true,
          createdAt: true,
          title: true,
          background: true,
          given: true,
          when: true,
          then: true,
          steps: true,
          tags: true,
          priority: true,
          testType: true,
          validationDomain: true,
          verificationProfile: true,
        },
      });
      const from = versions.find(
        (v) => v.versionNumber === input.fromVersionNumber,
      )!;
      const to = versions.find(
        (v) => v.versionNumber === input.toVersionNumber,
      )!;
      const fields = restoreFieldSchema.options.map((key) => {
        // Display exactly what each snapshot recorded. Do not invent missing
        // historical media, shared-library identities or verification context.
        const fromText = JSON.stringify(from[key], null, 2);
        const toText = JSON.stringify(to[key], null, 2);
        return {
          key,
          label: labels[key],
          changed: fromText !== toText,
          from: fromText,
          to: toText,
        };
      });
      return {
        ...(await caseVersionReadContext(tx, userId, input, scope, {
          kind: "HISTORICAL",
          fromVersionNumber: input.fromVersionNumber,
          toVersionNumber: input.toVersionNumber,
        })),
        caseId: currentIdentity.id,
        displayId: currentIdentity.displayId,
        from: {
          id: from.id,
          versionNumber: from.versionNumber,
          createdAt: from.createdAt.toISOString(),
        },
        to: {
          id: to.id,
          versionNumber: to.versionNumber,
          createdAt: to.createdAt.toISOString(),
        },
        fields,
        warnings: [
          "This is a read-only comparison of two saved versions. It does not change the current case or create a version, audit event or restore request.",
          "Only recorded snapshot fields are shown. Historical shared-library identity, missing media, placement, prerequisites and approval/assessment context are not reconstructed.",
          "Older domain defaults and incomplete verification profiles are not proof of the historical validation setup. Recorded media IDs are references, not recovered media files.",
          "To restore the destination version, switch to its current-case review. That uses a fresh current-content baseline, selected supported fields and explicit approval.",
        ],
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}

async function reviewState(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof versionPreviewSchema>,
  scope: z.infer<typeof caseFieldReadScopeSchema>,
) {
  if (scope.projectId !== input.projectId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Version review belongs to a different project.",
    });
  const [size] = await tx.$queryRaw<
    Array<{ currentBytes: number; savedBytes: number }>
  >`
    SELECT (octet_length(concat(c.title, c.background, c.given::text, c."when"::text, c."then"::text, c.tags::text, c."verificationProfile"::text))
      + coalesce((SELECT sum(octet_length(concat(s.action, s."expectedActionOrData", s."expectedResult", s."expectedResponse", s."mediaAttachmentIds"::text))) FROM "TestCaseStep" s WHERE s."testCaseId" = c.id),0)
      + coalesce((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id = c."sharedStepGroupId"),0))::int AS "currentBytes",
      octet_length(row_to_json(v)::text)::int AS "savedBytes"
    FROM "TestCase" c JOIN "TestCaseVersion" v ON v."testCaseId" = c.id
    WHERE c.id = ${input.testCaseId} AND c."projectId" = ${input.projectId} AND v."versionNumber" = ${input.versionNumber}`;
  if (!size)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Case version not found in this project.",
    });
  if (size.currentBytes > 524288 || size.savedBytes > 524288)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This case or version exceeds the 512 KiB comparison limit. Use a focused manual review; nothing was restored.",
    });
  const current = await tx.testCase.findFirstOrThrow({
    where: { id: input.testCaseId, projectId: input.projectId },
    include: { steps: { orderBy: { order: "asc" } }, sharedStepGroup: true },
  });
  if (
    current.steps.length > 500 ||
    (current.sharedStepGroup &&
      current.sharedStepGroup.projectId !== input.projectId)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The current procedure or shared library needs review before comparison.",
    });
  const saved = await tx.testCaseVersion.findUniqueOrThrow({
    where: {
      testCaseId_versionNumber: {
        testCaseId: current.id,
        versionNumber: input.versionNumber,
      },
    },
  });
  const stepParse = stepsSchema.safeParse(saved.steps);
  const profileRecord =
    saved.verificationProfile &&
    typeof saved.verificationProfile === "object" &&
    !Array.isArray(saved.verificationProfile)
      ? saved.verificationProfile
      : {};
  const physicalRecorded = [
    "setup",
    "safety",
    "instruments",
    "acceptanceCriteria",
  ].every((k) => Object.hasOwn(profileRecord, k));
  const profileParse = verificationProfileSchema
    .strict()
    .safeParse(saved.verificationProfile);
  const schemas = {
    title: text.min(1),
    background: text.nullable(),
    given: z.array(text).max(500),
    when: z.array(text).max(500),
    then: z.array(text).max(500),
    tags: z.array(z.string().max(200)).max(100),
    priority: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
    testType: z.nativeEnum(TestCaseType),
    validationDomain: validationDomainSchema,
    verificationProfile: verificationProfileSchema.strict(),
    steps: stepsSchema,
  };
  const ownCurrentSteps = current.steps.map((s) => ({
    order: s.order,
    action: s.action,
    expectedActionOrData: s.expectedActionOrData,
    expectedResult: s.expectedResult,
    expectedResponse: s.expectedResponse,
    mediaAttachmentIds: s.mediaAttachmentIds,
  }));
  const normalizedSteps = stepParse.success
    ? stepParse.data.map((s) => ({
        ...s,
        expectedActionOrData: s.expectedActionOrData ?? null,
        expectedResult: s.expectedResult ?? null,
        expectedResponse: s.expectedResponse ?? null,
        mediaAttachmentIds: s.mediaAttachmentIds ?? [],
      }))
    : null;
  const mediaKnown =
    stepParse.success &&
    stepParse.data.every((s) => Object.hasOwn(s, "mediaAttachmentIds"));
  const mediaIds = [
    ...new Set(normalizedSteps?.flatMap((s) => s.mediaAttachmentIds) ?? []),
  ];
  const attachments = mediaIds.length
    ? await tx.testCaseAttachment.findMany({
        where: { id: { in: mediaIds }, testCaseId: current.id },
        select: { id: true, contentType: true },
      })
    : [];
  const mediaValid =
    attachments.length === mediaIds.length &&
    attachments.every((a) => /^(image|video)\//i.test(a.contentType));
  const fields = restoreFieldSchema.options.map((key) => {
    let reason: string | null = schemas[key].safeParse(saved[key]).success
      ? null
      : "Saved field is unsupported or invalid; the current value is preserved.";
    if (
      (key === "validationDomain" || key === "verificationProfile") &&
      (!physicalRecorded || !profileParse.success)
    )
      reason =
        "This older version did not record a complete verification profile. Current domain and profile are preserved.";
    if (key === "steps") {
      if (current.sharedStepGroupId)
        reason =
          "This case uses a shared library. Older versions do not record its identity; shared steps are preserved.";
      else if (!stepParse.success)
        reason =
          "The saved step format or order is unsupported; current steps are preserved.";
      else if (
        !mediaKnown &&
        current.steps.some((s) => s.mediaAttachmentIds.length)
      )
        reason =
          "This older version did not record media references. Current step media cannot be silently removed.";
      else if (!mediaValid)
        reason =
          "A saved image/video reference is missing or belongs to another case. Restore other fields or repair media first.";
    }
    const currentValue =
      key === "steps"
        ? (current.sharedStepGroup?.steps ?? ownCurrentSteps)
        : current[key];
    const savedValue =
      key === "steps" && normalizedSteps ? normalizedSteps : saved[key];
    const currentText = JSON.stringify(currentValue, null, 2),
      savedText = JSON.stringify(savedValue, null, 2);
    return {
      key,
      label: labels[key],
      changed: currentText !== savedText,
      restorable: !reason,
      reason,
      current: currentText,
      saved: savedText,
    };
  });
  const warnings = [
    "Only selected, supported saved fields are restored. Suite, plan, prerequisites, case ID, review decisions, risk records, paid drafts, traceability and run evidence stay unchanged.",
    "A restore creates a new version and audit receipt; previous versions are never rewritten. Retained approvals and recommendations are not proof that restored content was reviewed.",
  ];
  warnings.push(
    "Restoring priority is a new manual priority decision using your reason and the current risk context, not recovery of an older business-override rationale.",
  );
  warnings.push(freshnessNotice);
  if (!mediaKnown)
    warnings.push(
      "This version did not record per-step media. No missing historical media is invented.",
    );
  return {
    current,
    saved,
    normalizedSteps,
    preview: {
      caseId: current.id,
      displayId: current.displayId,
      versionNumber: saved.versionNumber,
      versionId: saved.id,
      createdAt: saved.createdAt.toISOString(),
      expectedCaseRevision: testCaseContentRevision(current),
      // Ephemeral restore intent, not a universal saved-content checksum.
      // Global case revisions and historical saved bodies stay actor-independent.
      expectedVersionRevision: qualityProfileHash({
        kind: "CaseVersionRestoreReview/v2",
        scope,
        caseId: current.id,
        versionNumber: saved.versionNumber,
        savedRevision: qualityProfileHash({
          ...saved,
          createdAt: saved.createdAt.toISOString(),
        }),
      }),
      fields,
      warnings,
    },
  };
}

export async function previewCaseVersion(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof versionPreviewReadSchema>,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const scope = await lockCaseFieldReadScope(
        tx,
        userId,
        {
          projectId: input.projectId,
          caseId: input.testCaseId,
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        },
        authorized,
      );
      await requireCurrentPlanAccess(tx, userId, input.projectId);
      const membership = await tx.membership.findFirst({
        where: {
          userId,
          organization: { projects: { some: { id: input.projectId } } },
        },
        select: { role: true, seatType: true },
      });
      return {
        ...(await caseVersionReadContext(tx, userId, input, scope, {
          kind: "CURRENT",
          versionNumber: input.versionNumber,
        })),
        ...(await reviewState(tx, input, scope)).preview,
        canRestore: Boolean(
          membership &&
          membership.seatType === "FULL" &&
          ["OWNER", "ADMIN", "EDITOR"].includes(membership.role),
        ),
      };
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}

export function restoreCaseVersion(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof versionRestoreSchema>,
  authorized: CaseFieldReadAuthorization | undefined,
  reviewedPins: ReviewedPins,
): Promise<z.infer<typeof versionRestoreReviewedOutputSchema>>;
export function restoreCaseVersion(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof versionRestoreSchema>,
  authorized?: CaseFieldReadAuthorization,
): Promise<z.infer<typeof versionRestoreOutputSchema>>;
export async function restoreCaseVersion(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof versionRestoreSchema>,
  authorized?: CaseFieldReadAuthorization,
  reviewedPins?: ReviewedPins,
) {
  const requestHash = qualityProfileHash({
    ...input,
    fields: [...input.fields].sort(),
  });
  return db.$transaction(
    async (tx) => {
      await lockCaseFieldProject(tx, userId, input.projectId);
      const actorClerkUserId = await lockCurrentCaseFieldActor(
        tx,
        userId,
        authorized,
      );
      const originalProject = await tx.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true },
      });
      const scope = caseFieldReadScopeSchema.parse({
        projectId: input.projectId,
        organizationId: originalProject.organizationId,
        actorId: userId,
        actorClerkUserId,
      });
      if (
        reviewedPins &&
        (scope.organizationId !== reviewedPins.originalOrganizationId ||
          scope.actorClerkUserId !== reviewedPins.expectedClerkActorId ||
          scope.actorId !== reviewedPins.expectedNativeActorId)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Restore the original organization and signed-in native actor before retrying this reviewed restore. Retained requests were not rebound.",
        });
      const acknowledgement = (
        result: z.infer<typeof versionRestoreOutputSchema>,
      ) =>
        reviewedPins
          ? versionRestoreReviewedOutputSchema.parse({
              ...result,
              requestId: input.requestId,
              requestHash,
              caseId: input.testCaseId,
              readScope: scope,
              scopeProof: "CURRENT_LOCKED_AUTHORIZATION",
            })
          : result;
      await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id = ${input.testCaseId} AND "projectId" = ${input.projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "TestCaseStep" WHERE "testCaseId" = ${input.testCaseId} FOR UPDATE`;
      await tx.$queryRaw`SELECT g.id FROM "SharedStepGroup" g JOIN "TestCase" c ON c."sharedStepGroupId" = g.id WHERE c.id = ${input.testCaseId} AND c."projectId" = ${input.projectId} FOR SHARE OF g`;
      await tx.$queryRaw`SELECT id FROM "TestCaseVersion" WHERE "testCaseId" = ${input.testCaseId} AND "versionNumber" = ${input.versionNumber} FOR SHARE`;
      await requireCurrentPlanAccess(tx, userId, input.projectId, true);
      const receipt = await tx.auditLog.findFirst({
        where: {
          projectId: input.projectId,
          actorId: userId,
          entityType: "TestCaseVersionRestore",
          entityId: input.testCaseId,
          metadata: { path: ["requestId"], equals: input.requestId },
        },
        select: { metadata: true, organizationId: true },
      });
      if (receipt) {
        if (receipt.organizationId !== scope.organizationId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "This restore receipt belongs to the project's original organization and cannot be replayed after an ownership change.",
          });
        const metadata = z
          .object({
            requestHash: z.string(),
            restoredVersionNumber: z.number(),
            createdVersionNumber: z.number(),
            displayId: z.string(),
          })
          .safeParse(receipt.metadata);
        if (!metadata.success || metadata.data.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This restore request identity was already used for a different review.",
          });
        return acknowledgement({
          restoredVersionNumber: metadata.data.restoredVersionNumber,
          createdVersionNumber: metadata.data.createdVersionNumber,
          displayId: metadata.data.displayId,
          replayed: true,
        });
      }
      // Old versions do not contain custom metadata. Keep current values;
      // explicit content restoration requires current required fields complete.
      await assertCaseFieldAuthoring(
        tx,
        userId,
        input.projectId,
        {
          caseId: input.testCaseId,
        },
        authorized,
      );
      const { current, saved, normalizedSteps, preview } = await reviewState(
        tx,
        input,
        scope,
      );
      if (
        preview.expectedCaseRevision !== input.expectedCaseRevision ||
        preview.expectedVersionRevision !== input.expectedVersionRevision
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The case or saved version changed after comparison. Refresh and review again; nothing was restored.",
        });
      const selected = preview.fields.filter((f) =>
        input.fields.includes(f.key),
      );
      if (selected.some((f) => !f.restorable || !f.changed))
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Choose only changed, supported fields from this comparison.",
        });
      if (reviewedPins)
        await assertReviewedVersionProfileRoundTrip(
          tx,
          input,
          current.verificationProfile,
          input.fields.includes("verificationProfile")
            ? { value: saved.verificationProfile }
            : undefined,
        );
      const data: Prisma.TestCaseUpdateInput = {
        updatedBy: { connect: { id: userId } },
      };
      for (const field of input.fields)
        if (field !== "steps") Object.assign(data, { [field]: saved[field] });
      if (input.fields.includes("steps")) {
        if (!normalizedSteps)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "Saved steps are unsupported.",
          });
        await tx.testCaseStep.deleteMany({ where: { testCaseId: current.id } });
        data.steps = { create: normalizedSteps };
      }
      const prospective = {
        ...current,
        ...Object.fromEntries(
          input.fields.filter((k) => k !== "steps").map((k) => [k, saved[k]]),
        ),
        steps: input.fields.includes("steps")
          ? normalizedSteps!
          : current.steps,
      };
      if (
        !prospective.sharedStepGroupId &&
        !prospective.steps.length &&
        !(
          prospective.given.length &&
          prospective.when.length &&
          prospective.then.length
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "The selected restore would leave no complete test procedure. Choose compatible fields together.",
        });
      const changed = await tx.testCase.update({
        where: { id: current.id },
        data,
        include: { steps: { orderBy: { order: "asc" } } },
      });
      await snapshotTestCaseVersion(tx, {
        testCaseId: changed.id,
        title: changed.title,
        background: changed.background,
        given: changed.given,
        when: changed.when,
        then: changed.then,
        steps: changed.steps.map((s) => ({
          order: s.order,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData,
          expectedResult: s.expectedResult,
          expectedResponse: s.expectedResponse,
          mediaAttachmentIds: s.mediaAttachmentIds,
        })),
        tags: changed.tags,
        priority: changed.priority,
        testType: changed.testType,
        actorId: userId,
      });
      const newVersion = await tx.testCaseVersion.findFirstOrThrow({
        where: { testCaseId: changed.id },
        orderBy: { versionNumber: "desc" },
        select: { versionNumber: true },
      });
      const project = await tx.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true },
      });
      if (input.fields.includes("priority"))
        await tx.auditLog.create({
          data: {
            organizationId: project.organizationId,
            projectId: input.projectId,
            actorId: userId,
            entityType: "TestCasePriority",
            entityId: current.id,
            action: "UPDATE",
            summary: `Restored priority from case version ${saved.versionNumber}`,
            metadata: {
              mode: "MANUAL",
              from: current.priority,
              to: changed.priority,
              rationale: input.reason,
              riskSeverity: current.riskSeverity,
              riskScore: current.riskScore,
            },
          },
        });
      await tx.auditLog.create({
        data: {
          organizationId: project.organizationId,
          projectId: input.projectId,
          actorId: userId,
          entityType: "TestCaseVersionRestore",
          entityId: current.id,
          action: "UPDATE",
          summary: `Restored selected fields from ${current.displayId} version ${saved.versionNumber} as version ${newVersion.versionNumber}`,
          metadata: {
            requestId: input.requestId,
            requestHash,
            restoredVersionNumber: saved.versionNumber,
            createdVersionNumber: newVersion.versionNumber,
            sourceVersionId: saved.id,
            displayId: current.displayId,
            fields: input.fields,
            reason: input.reason,
            priorCaseRevision: input.expectedCaseRevision,
            // New receipts retain the reviewed intent token; older receipt
            // checksum evidence is never rewritten or reinterpreted.
            sourceVersionRevision: input.expectedVersionRevision,
          },
        },
      });
      return acknowledgement({
        restoredVersionNumber: saved.versionNumber,
        createdVersionNumber: newVersion.versionNumber,
        displayId: current.displayId,
        replayed: false,
      });
    },
    { timeout: 10000 },
  );
}
