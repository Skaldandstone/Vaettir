import { TRPCError } from "@trpc/server";
import { Prisma, TestCaseType, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { TestCaseStepInputSchema } from "@vaettir/core";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { verificationProfileSchema } from "./physicalValidation.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import {
  caseFieldSchema,
  caseFieldValues,
  validateCaseFieldValues,
} from "./caseFieldSchema.js";
import {
  assertCaseFieldAuthoring,
  caseFieldAuthoringSchemaHash,
  lockCaseFieldProject,
} from "./caseFields.js";
import {
  cloneExpectedScopeSchema,
  cloneDatasetApprovalFields,
  requireCloneDatasetApproval,
  cloneDatasetMappingSchema,
} from "./caseCloneDatasetSchema.js";
import {
  independentCloneScope,
  prepareIndependentCloneDataset,
  createIndependentCloneDataset,
} from "./caseCloneDataset.js";
import { validatedDatasetReplay } from "./caseFolderCopyDatasets.js";
import { lockCurrentCaseFieldActor } from "./caseFieldReadScope.js";

export const cloneScopeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    caseId: z.string().min(1).max(200),
    copyParameterDataset: z.literal(true).optional(),
    expectedScope: cloneExpectedScopeSchema.optional(),
  })
  .strict();
export const cloneInputSchema = cloneScopeSchema
  .extend({
    expectedSourceRevision: z.string().regex(/^[a-f0-9]{64}$/),
    title: z.string().trim().min(1).max(10000),
    suitePath: z.string().trim().min(1).max(240).nullable(),
    reason: z.string().trim().min(1).max(1000),
    confirmed: z.literal(true),
    requestId: z.string().uuid(),
    ...cloneDatasetApprovalFields,
  })
  .strict()
  .superRefine((input, ctx) => {
    requireCloneDatasetApproval(input, ctx);
    if (input.copyParameterDataset && !input.expectedScope)
      ctx.addIssue({
        code: "custom",
        message:
          "Independent dataset copy requires the original account and workspace scope from its review.",
      });
  });
const text = z.string().max(10000);
const stepSchema = TestCaseStepInputSchema.extend({
  action: text.min(1),
  expectedActionOrData: text.nullable().optional(),
  expectedResult: text.nullable().optional(),
  expectedResponse: text.nullable().optional(),
  order: z.number().int().nonnegative(),
}).strict();
const exclusionNotice =
  "Approvals, risk/design assessments, results and run history, paid automation drafts, automation status, prerequisites, datasets, attachments/media, imported/provider source links, compliance and feature/defect links are not copied. The original and its history stay unchanged.";

export async function sourceState(
  tx: Prisma.TransactionClient,
  input: z.infer<typeof cloneScopeSchema>,
) {
  const identity = await tx.testCase.findFirst({
    where: { id: input.caseId, projectId: input.projectId },
    select: { id: true, archived: true, sharedStepGroupId: true },
  });
  if (!identity)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Case not found in this project.",
    });
  if (identity.archived)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Restore this archived case before duplicating it.",
    });
  if (
    identity.sharedStepGroupId &&
    !(await tx.sharedStepGroup.findFirst({
      where: { id: identity.sharedStepGroupId, projectId: input.projectId },
      select: { id: true },
    }))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The referenced step library does not belong to this project. Nothing was copied.",
    });
  const [size] = await tx.$queryRaw<
    Array<{ bytes: number; stepCount: number }>
  >`
    SELECT (octet_length(concat(c.title,c.background,c.given::text,c."when"::text,c."then"::text,c.tags::text,c."verificationProfile"::text,c."suitePath",c."customFields"::text))
      + coalesce((SELECT sum(octet_length(concat(s.action,s."expectedActionOrData",s."expectedResult",s."expectedResponse",s."mediaAttachmentIds"::text))) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)
      + coalesce((SELECT octet_length(g.steps::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"=c."projectId"),0))::int AS bytes,
      (SELECT count(*)::int FROM "TestCaseStep" s WHERE s."testCaseId"=c.id) AS "stepCount"
    FROM "TestCase" c WHERE c.id=${input.caseId} AND c."projectId"=${input.projectId}`;
  if (!size)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Case not found in this project.",
    });
  if (size.bytes > 524288 || size.stepCount > 500)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This case exceeds the 512 KiB / 500-step duplicate limit. Nothing was copied.",
    });
  const source = await tx.testCase.findFirstOrThrow({
    where: { id: input.caseId, projectId: input.projectId },
    select: {
      id: true,
      displayId: true,
      archived: true,
      title: true,
      background: true,
      given: true,
      when: true,
      then: true,
      tags: true,
      testType: true,
      priority: true,
      suitePath: true,
      testPlanId: true,
      validationDomain: true,
      verificationProfile: true,
      customFields: true,
      sharedStepGroupId: true,
      steps: {
        orderBy: { order: "asc" },
        select: {
          order: true,
          action: true,
          expectedActionOrData: true,
          expectedResult: true,
          expectedResponse: true,
          mediaAttachmentIds: true,
        },
      },
      sharedStepGroup: { select: { id: true, projectId: true, steps: true } },
    },
  });
  if (source.archived)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Restore this archived case before duplicating it.",
    });
  if (
    source.sharedStepGroup &&
    source.sharedStepGroup.projectId !== input.projectId
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The referenced step library does not belong to this project. Nothing was copied.",
    });
  const steps = source.sharedStepGroup
    ? z.array(stepSchema).max(500).parse(source.sharedStepGroup.steps)
    : source.steps.map((s) =>
        stepSchema.parse({
          order: s.order,
          action: s.action,
          expectedActionOrData: s.expectedActionOrData,
          expectedResult: s.expectedResult,
          expectedResponse: s.expectedResponse,
          mediaAttachmentIds: s.mediaAttachmentIds,
        }),
      );
  if (source.sharedStepGroup && !steps.every((s, i) => s.order === i))
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "The shared procedure order needs repair before duplication.",
    });
  const definitionSchema = z.object({
    title: text.min(1),
    background: text.nullable(),
    given: z.array(text).max(500),
    when: z.array(text).max(500),
    then: z.array(text).max(500),
    tags: z.array(z.string().max(200)).max(100),
    priority: z.enum(["CRITICAL", "HIGH", "MEDIUM", "LOW"]),
    testType: z.nativeEnum(TestCaseType),
  });
  const definition = definitionSchema.parse(source);
  z.string().max(240).nullable().parse(source.suitePath);
  verificationProfileSchema.strict().parse(source.verificationProfile);
  const projectFields = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: {
      organizationId: true,
      caseFieldSchema: true,
      caseFieldSchemaVersion: true,
    },
  });
  const fieldSchema = caseFieldSchema.parse(projectFields.caseFieldSchema);
  const authoredFields = caseFieldValues.parse(source.customFields);
  const fieldProblems = validateCaseFieldValues(
    fieldSchema,
    authoredFields,
    {},
  );
  if (fieldProblems.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `${source.displayId} cannot be copied without losing or invalidating human metadata: ${fieldProblems.join(" ")} Complete required source fields, or ask the project owner to restore a compatible active definition for retained fields.`,
    });
  // Source-content identity stays actor-independent for existing clone reviews.
  // This private capture is reused only after the original source revision check.
  const fieldSchemaScope = {
    projectId: input.projectId,
    organizationId: projectFields.organizationId,
    version: projectFields.caseFieldSchemaVersion,
    schema: fieldSchema,
  };
  const expectedFieldSchemaHash = qualityProfileHash(fieldSchemaScope);
  const mediaReferencesExcluded = steps.reduce(
    (sum, s) => sum + (s.mediaAttachmentIds?.length ?? 0),
    0,
  );
  const authoredSteps = steps.map((s, i) => ({
    order: i,
    action: s.action,
    expectedActionOrData: s.expectedActionOrData ?? null,
    expectedResult: s.expectedResult ?? null,
    expectedResponse: s.expectedResponse ?? null,
    mediaAttachmentIds: [] as string[],
  }));
  return {
    source,
    definition,
    authoredSteps,
    authoredFields,
    expectedFieldSchemaHash,
    fieldSchemaScope,
    preview: {
      sourceId: source.id,
      sourceDisplayId: source.displayId,
      expectedSourceRevision: qualityProfileHash({
        sourceId: source.id,
        projectId: input.projectId,
        content: testCaseContentRevision(source),
        archived: source.archived,
        authoredFields,
        expectedFieldSchemaHash,
      }),
      suggestedTitle: `Copy of ${source.title}`.slice(0, 10000),
      suitePath: source.suitePath,
      definition: {
        ...definition,
        validationDomain: source.validationDomain,
        // Runtime strict validation above proves a shallow string profile;
        // preserve missing legacy fields rather than inventing defaults.
        verificationProfile: source.verificationProfile as Record<
          string,
          string
        >,
        steps: authoredSteps,
        customFields: authoredFields,
      },
      sharedProcedureMaterialized: Boolean(source.sharedStepGroupId),
      mediaReferencesExcluded,
      warnings: [
        exclusionNotice,
        "Supported current human case fields are preserved. Missing required fields or retained metadata without a compatible active definition block duplication rather than being dropped.",
        "The new case receives a fresh stable ID, Manual automation and Pending review. Its priority is a new manual decision, not a copy of past risk or business-override evidence.",
        ...(source.sharedStepGroupId
          ? [
              "The current shared procedure is copied into independent steps. The duplicate will not follow future edits to that library.",
            ]
          : []),
        ...(mediaReferencesExcluded
          ? [
              `${mediaReferencesExcluded} step media references will be omitted; reattach evidence to the new case before use.`,
            ]
          : []),
        ...(!authoredSteps.length &&
        !(source.given.length && source.when.length && source.then.length)
          ? [
              "The source has no complete executable procedure. The duplicate preserves this incomplete definition and requires editing before execution.",
            ]
          : []),
      ],
    },
  };
}

export async function previewCaseClone(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof cloneScopeSchema>,
): Promise<
  Awaited<ReturnType<typeof sourceState>>["preview"] & {
    projectId?: string;
    organizationId?: string;
    clerkActorId?: string;
    copyParameterDataset?: boolean;
    datasetAvailable?: boolean;
    datasetReviewHash?: string;
    datasetSource?: Awaited<
      ReturnType<typeof prepareIndependentCloneDataset>
    >["source"];
    dataset?: Awaited<
      ReturnType<typeof prepareIndependentCloneDataset>
    >["data"];
  }
> {
  return db.$transaction(
    async (tx) => {
      await requireCurrentPlanAccess(tx, userId, input.projectId, true);
      const scoped = input.expectedScope || input.copyParameterDataset;
      // Even omitted legacy input must pin the native actor before source bodies.
      await lockCaseFieldProject(tx, userId, input.projectId);
      await lockCurrentCaseFieldActor(tx, userId);
      const scope = scoped
        ? await independentCloneScope(
            tx,
            userId,
            input.projectId,
            input.expectedScope,
          )
        : null;
      try {
        const state = await sourceState(tx, input);
        if (input.copyParameterDataset) {
          const p = await prepareIndependentCloneDataset(
            tx,
            input.projectId,
            state,
          );
          return {
            ...state.preview,
            ...scope!,
            copyParameterDataset: true,
            datasetAvailable: true,
            datasetSource: p.source,
            dataset: p.data,
            datasetReviewHash: p.reviewHash,
            warnings: [
              ...state.preview.warnings.map((w) =>
                w === exclusionNotice ? w.replace("datasets, ", "") : w,
              ),
              "The explicitly reviewed supported dataset is copied to a fresh dataset identity and row indexes; old dataset approvals, versions and executions are not copied. Resolver compatibility is not execution or readiness acceptance.",
            ],
          };
        }
        // Exact legacy preview shape when no new optional scope or flag exists.
        if (!scope) return state.preview;
        const datasetAvailable = !!(await tx.testCaseDataset.findUnique({
          where: { testCaseId: state.source.id },
          select: { id: true },
        }));
        return {
          ...state.preview,
          ...scope,
          copyParameterDataset: false,
          datasetAvailable,
        };
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This case contains unsupported authored fields. Repair it before duplicating; nothing was copied.",
          });
        throw error;
      }
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 10000,
    },
  );
}

export async function cloneCase(
  db: PrismaClient,
  userId: string,
  input: z.infer<typeof cloneInputSchema>,
): Promise<{
  caseId: string;
  displayId: string;
  replayed: boolean;
  requestId?: string;
  projectId?: string;
  organizationId?: string;
  clerkActorId?: string;
  copyParameterDataset?: true;
  datasetReviewHash?: string;
  copiedDataset?: z.infer<typeof cloneDatasetMappingSchema>;
}> {
  if (
    input.copyParameterDataset &&
    (!input.expectedScope ||
      !input.expectedDatasetHash ||
      !input.expectedDataset)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Review the complete independent dataset and original account/workspace before duplication.",
    });
  const requestHash = qualityProfileHash(input);
  return db.$transaction(
    async (tx) => {
      await lockCaseFieldProject(tx, userId, input.projectId);
      await lockCurrentCaseFieldActor(tx, userId);
      const organization = await tx.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true },
      });
      const scope =
        input.expectedScope || input.copyParameterDataset
          ? await independentCloneScope(
              tx,
              userId,
              input.projectId,
              input.expectedScope,
            )
          : null;
      const receipt = await tx.auditLog.findFirst({
        where: {
          projectId: input.projectId,
          actorId: userId,
          entityType: "TestCaseClone",
          metadata: { path: ["requestId"], equals: input.requestId },
        },
        select: { metadata: true, organizationId: true },
      });
      if (receipt) {
        if (receipt.organizationId !== organization.organizationId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "The retained clone belongs to the project's previous organization and cannot be replayed in its current scope.",
          });
        const saved = z
          .object({
            requestHash: z.string(),
            caseId: z.string(),
            displayId: z.string(),
            sourceCaseId: z.string().optional(),
            copyParameterDataset: z.literal(true).optional(),
            datasetReviewHash: z
              .string()
              .regex(/^[a-f0-9]{64}$/)
              .optional(),
            copiedDataset: cloneDatasetMappingSchema.optional(),
          })
          .safeParse(receipt.metadata);
        if (!saved.success || saved.data.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request identity was already used for a different duplicate review.",
          });
        if (input.copyParameterDataset) {
          if (
            !saved.data.copyParameterDataset ||
            !saved.data.copiedDataset ||
            saved.data.datasetReviewHash !== input.expectedDatasetHash ||
            !input.expectedDataset ||
            saved.data.sourceCaseId !== input.caseId
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Retained independent dataset receipt does not match this exact reviewed request; nothing was recreated.",
            });
          validatedDatasetReplay(
            input.projectId,
            [input.expectedDataset],
            [saved.data.copiedDataset],
            [
              {
                sourceId: input.caseId,
                caseId: saved.data.caseId,
                displayId: saved.data.displayId,
              },
            ],
            saved.data.datasetReviewHash!,
          );
        } else if (
          saved.data.copyParameterDataset ||
          saved.data.copiedDataset ||
          saved.data.datasetReviewHash
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Retained dataset mode does not match this ordinary duplicate request.",
          });
        if (
          !(await tx.testCase.findFirst({
            where: { id: saved.data.caseId, projectId: input.projectId },
            select: { id: true },
          }))
        )
          throw new TRPCError({
            code: "NOT_FOUND",
            message:
              "The previously created duplicate is no longer available; it was not recreated.",
          });
        return {
          caseId: saved.data.caseId,
          displayId: saved.data.displayId,
          replayed: true,
          ...(scope ? { ...scope, requestId: input.requestId } : {}),
          ...(input.copyParameterDataset
            ? {
                copyParameterDataset: true as const,
                datasetReviewHash: saved.data.datasetReviewHash,
                copiedDataset: saved.data.copiedDataset,
              }
            : {}),
        };
      }
      if (input.copyParameterDataset) {
        // UPDATE prevents a new dataset or prerequisite FK appearing after the
        // negative dependency check. SHARE protects existing dataset body edits.
        await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId} FOR UPDATE`;
        await tx.$queryRaw`SELECT d.id FROM "TestCaseDataset" d JOIN "TestCase" c ON c.id=d."testCaseId" WHERE c.id=${input.caseId} AND c."projectId"=${input.projectId} FOR SHARE OF d`;
      } else
        await tx.$queryRaw`SELECT id FROM "TestCase" WHERE id=${input.caseId} AND "projectId"=${input.projectId} FOR SHARE`;
      await tx.$queryRaw`SELECT s.id FROM "TestCaseStep" s JOIN "TestCase" c ON c.id=s."testCaseId" WHERE c.id=${input.caseId} AND c."projectId"=${input.projectId} FOR SHARE OF s`;
      await tx.$queryRaw`SELECT g.id FROM "SharedStepGroup" g JOIN "TestCase" c ON c."sharedStepGroupId"=g.id WHERE c.id=${input.caseId} AND c."projectId"=${input.projectId} AND g."projectId"=${input.projectId} FOR SHARE OF g`;
      let state;
      try {
        state = await sourceState(tx, input);
      } catch (error) {
        if (error instanceof z.ZodError)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This case contains unsupported authored fields. Repair it before duplicating; nothing was copied.",
          });
        throw error;
      }
      if (state.preview.expectedSourceRevision !== input.expectedSourceRevision)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The source changed after review. Refresh and review it again; nothing was copied.",
        });
      const plan = input.copyParameterDataset
        ? await prepareIndependentCloneDataset(
            tx,
            input.projectId,
            state,
            input.title,
          )
        : null;
      if (
        plan &&
        (plan.reviewHash !== input.expectedDatasetHash ||
          qualityProfileHash(plan.source) !==
            qualityProfileHash(input.expectedDataset))
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "The complete saved dataset contents, identity or row order changed after review. Nothing was copied.",
        });
      const created = await createCaseCloneInTransaction(
        tx,
        userId,
        input,
        state,
      );
      if (!plan)
        return {
          ...created,
          ...(scope ? { ...scope, requestId: input.requestId } : {}),
        };
      const copiedDataset = await createIndependentCloneDataset(
        tx,
        scope!,
        userId,
        input.requestId,
        input.reason,
        plan,
        created,
      );
      const audit = await tx.auditLog.findFirstOrThrow({
        where: {
          projectId: input.projectId,
          organizationId: organization.organizationId,
          actorId: userId,
          entityType: "TestCaseClone",
          entityId: created.caseId,
          metadata: { path: ["requestId"], equals: input.requestId },
        },
        select: { id: true, metadata: true },
      });
      await tx.auditLog.update({
        where: { id: audit.id },
        data: {
          metadata: {
            ...(audit.metadata as Prisma.JsonObject),
            copyParameterDataset: true,
            datasetReviewHash: plan.reviewHash,
            copiedDataset,
            excluded: exclusionNotice.replace("datasets, ", ""),
          },
        },
      });
      return {
        ...created,
        ...scope!,
        requestId: input.requestId,
        copyParameterDataset: true as const,
        datasetReviewHash: plan.reviewHash,
        copiedDataset,
      };
    },
    { timeout: 10000 },
  );
}

/** Reused inside an already authorized, locked reviewed transaction. */
export async function createCaseCloneInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof cloneInputSchema>,
  state: Awaited<ReturnType<typeof sourceState>>,
  options: { sortPosition?: number } = {},
) {
  if (
    input.caseId !== state.source.id ||
    input.expectedSourceRevision !== state.preview.expectedSourceRevision
  )
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The transaction-bound clone source does not match its reviewed identity.",
    });
  const requestHash = qualityProfileHash(input);
  const destination = await tx.testCase.aggregate({
    where: {
      projectId: input.projectId,
      suitePath: input.suitePath,
      archived: false,
    },
    _max: { sortPosition: true },
  });
  const sortPosition =
    options.sortPosition ?? (destination._max.sortPosition ?? -1) + 1;
  if (
    !Number.isInteger(sortPosition) ||
    sortPosition < -2147483648 ||
    sortPosition > 2147483647
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This suite's order needs normalization before another case can be appended. Nothing was copied.",
    });
  // Clone/folder entrypoints already hold Project -> User before case locks.
  // Resolve that pinned mapping without introducing a late Case -> User lock.
  const actor = await tx.user.findUnique({
    where: { id: userId },
    select: { clerkUserId: true },
  });
  if (!actor?.clerkUserId || actor.clerkUserId.length > 200)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current clone actor identity is unavailable.",
    });
  const fields = await assertCaseFieldAuthoring(tx, userId, input.projectId, {
    values: state.authoredFields,
    expectedSchemaHash: caseFieldAuthoringSchemaHash(
      state.fieldSchemaScope,
      userId,
      actor.clerkUserId,
    ),
  });
  const created = await tx.testCase.create({
    data: {
      projectId: input.projectId,
      ...state.definition,
      customFields: fields,
      title: input.title,
      suitePath: input.suitePath,
      sortPosition,
      validationDomain: state.source.validationDomain,
      verificationProfile: state.source
        .verificationProfile as Prisma.InputJsonValue,
      origin: "AUTHORED",
      automationStatus: "MANUAL",
      reviewStatus: "PENDING_REVIEW",
      createdById: userId,
      updatedById: userId,
      steps: { create: state.authoredSteps },
    },
    include: { steps: { orderBy: { order: "asc" } } },
  });
  await snapshotTestCaseVersion(tx, {
    testCaseId: created.id,
    title: created.title,
    background: created.background,
    given: created.given,
    when: created.when,
    then: created.then,
    steps: state.authoredSteps,
    tags: created.tags,
    priority: created.priority,
    testType: created.testType,
    actorId: userId,
  });
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  await tx.auditLog.create({
    data: {
      organizationId: project.organizationId,
      projectId: input.projectId,
      actorId: userId,
      entityType: "TestCaseClone",
      entityId: created.id,
      action: "CREATE",
      summary: `Duplicated ${state.source.displayId} as ${created.displayId}`,
      metadata: {
        requestId: input.requestId,
        requestHash,
        caseId: created.id,
        displayId: created.displayId,
        sourceCaseId: state.source.id,
        sourceDisplayId: state.source.displayId,
        sourceRevision: input.expectedSourceRevision,
        reason: input.reason,
        sharedProcedureMaterialized: state.preview.sharedProcedureMaterialized,
        mediaReferencesExcluded: state.preview.mediaReferencesExcluded,
        excluded: exclusionNotice,
      },
    },
  });
  await tx.auditLog.create({
    data: {
      organizationId: project.organizationId,
      projectId: input.projectId,
      actorId: userId,
      entityType: "TestCasePriority",
      entityId: created.id,
      action: "UPDATE",
      summary:
        "Set duplicated case priority as a new manual authoring decision",
      metadata: {
        mode: "MANUAL",
        to: created.priority,
        rationale: input.reason,
        riskSeverity: null,
        riskScore: null,
      },
    },
  });
  return {
    caseId: created.id,
    displayId: created.displayId,
    replayed: false,
  };
}
