import { TRPCError } from "@trpc/server";
import { Prisma, TestCaseType, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { TestCaseStepInputSchema } from "@vaettir/core";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { testCaseContentRevision } from "./testCaseContentRevision.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { verificationProfileSchema } from "./physicalValidation.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";

export const cloneScopeSchema = z
  .object({
    projectId: z.string().min(1).max(200),
    caseId: z.string().min(1).max(200),
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
  })
  .strict();
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

async function sourceState(
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
    SELECT (octet_length(concat(c.title,c.background,c.given::text,c."when"::text,c."then"::text,c.tags::text,c."verificationProfile"::text,c."suitePath"))
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
    preview: {
      sourceId: source.id,
      sourceDisplayId: source.displayId,
      expectedSourceRevision: qualityProfileHash({
        sourceId: source.id,
        projectId: input.projectId,
        content: testCaseContentRevision(source),
        archived: source.archived,
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
      },
      sharedProcedureMaterialized: Boolean(source.sharedStepGroupId),
      mediaReferencesExcluded,
      warnings: [
        exclusionNotice,
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
) {
  return db.$transaction(
    async (tx) => {
      await requireCurrentPlanAccess(tx, userId, input.projectId, true);
      try {
        return (await sourceState(tx, input)).preview;
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
) {
  const requestHash = qualityProfileHash(input);
  return db.$transaction(
    async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.projectId}))::text`;
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${input.projectId} FOR UPDATE`;
      await tx.$queryRaw`SELECT o.id FROM "Organization" o JOIN "Project" p ON p."organizationId"=o.id WHERE p.id=${input.projectId} FOR SHARE OF o`;
      await tx.$queryRaw`SELECT m.id FROM "Membership" m JOIN "Project" p ON p."organizationId"=m."organizationId" WHERE p.id=${input.projectId} AND m."userId"=${userId} FOR SHARE OF m`;
      await requireCurrentPlanAccess(tx, userId, input.projectId, true);
      const receipt = await tx.auditLog.findFirst({
        where: {
          projectId: input.projectId,
          actorId: userId,
          entityType: "TestCaseClone",
          metadata: { path: ["requestId"], equals: input.requestId },
        },
        select: { metadata: true },
      });
      if (receipt) {
        const saved = z
          .object({
            requestHash: z.string(),
            caseId: z.string(),
            displayId: z.string(),
          })
          .safeParse(receipt.metadata);
        if (!saved.success || saved.data.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request identity was already used for a different duplicate review.",
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
        };
      }
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
      const destination = await tx.testCase.aggregate({
        where: {
          projectId: input.projectId,
          suitePath: input.suitePath,
          archived: false,
        },
        _max: { sortPosition: true },
      });
      const sortPosition = (destination._max.sortPosition ?? -1) + 1;
      if (sortPosition > 2147483647)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This suite's order needs normalization before another case can be appended. Nothing was copied.",
        });
      const created = await tx.testCase.create({
        data: {
          projectId: input.projectId,
          ...state.definition,
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
            sharedProcedureMaterialized:
              state.preview.sharedProcedureMaterialized,
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
    },
    { timeout: 10000 },
  );
}
