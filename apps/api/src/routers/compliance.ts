import { assertComplianceAvailable } from "../services/complianceRecovery.js";
import { randomUUID } from "node:crypto";
import { Prisma } from "@vaettir/db";
import type { Context } from "../trpc.js";
import { lockCaseFieldProject } from "../services/caseFields.js";
import { lockCurrentCaseFieldActor } from "../services/caseFieldReadScope.js";
import {
  complianceScope,
  compliancePreview,
  complianceDraftInput,
  complianceSave,
  complianceApply,
  publicComplianceCatalog,
  loadComplianceReference,
  ownedComplianceFramework,
  previewCompliance,
  readComplianceDraft,
  listComplianceDrafts,
  saveComplianceSelection,
  applyComplianceReview,
} from "../services/complianceReview.js";
import { z } from "@vaettir/core/dist/validation.js";
import { TRPCError } from "@trpc/server";
import {
  router,
  protectedProcedure,
  requireProjectAccess,
  requireOrgRole,
  requireNotSuspended,
} from "../trpc.js";
import { recordAudit } from "../services/auditLog.js";
import { dispatchWebhookEvent } from "../services/webhookDelivery.js";
import { notifySlackEvent } from "../services/slackEventNotify.js";
import { sendPushToUser } from "../services/pushNotify.js";

// Recovery images must contain this code; old API67/68 ignore this switch and
// remain unsafe after tenant catalog activation. One shared gate covers every
// compliance query and mutation, including legacy routes and public metadata.
const complianceProcedure = protectedProcedure.use(({ next }) => {
  assertComplianceAvailable();
  return next();
});

const SIGN_OFF_ROLES = ["COMPLIANCE_AUDITOR", "ADMIN", "OWNER"];

// Legacy globals retain their IDs/evidence but acquire no inferred tenant owner.
function reviewActor(ctx: Context) {
  if (!ctx.user || !ctx.authenticatedClerkSubject || ctx.authenticatedApiKeyId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "A current signed-in human account is required.",
    });
  return {
    id: ctx.user.id,
    clerkActorId: ctx.authenticatedClerkSubject,
    workspaceOrganizationId: ctx.workspaceOrganizationId,
  };
}
async function customScope(
  ctx: Context & { user: NonNullable<Context["user"]> },
  projectId?: string,
) {
  if (!projectId)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Select a project for workspace-owned definitions.",
    });
  const { project } = await requireProjectAccess(ctx, projectId, "EDITOR");
  return { project, actor: reviewActor(ctx) };
}
async function customWrite<T>(
  ctx: Context & { user: NonNullable<Context["user"]> },
  projectId: string | undefined,
  work: (tx: Prisma.TransactionClient, organizationId: string) => Promise<T>,
) {
  const { project, actor } = await customScope(ctx, projectId);
  return ctx.prisma.$transaction(async (tx) => {
    await lockCaseFieldProject(tx, actor.id, project.id);
    await lockCurrentCaseFieldActor(tx, actor.id, {
      clerkActorId: actor.clerkActorId,
    });
    const current = await tx.project.findUniqueOrThrow({
      where: { id: project.id },
    });
    if (current.organizationId !== project.organizationId)
      throw new TRPCError({ code: "FORBIDDEN" });
    const result = await work(tx, project.organizationId);
    await tx.auditLog.create({
      data: {
        organizationId: project.organizationId,
        projectId: project.id,
        actorId: actor.id,
        entityType: "ComplianceFramework",
        entityId: project.id,
        action: "UPDATE",
        summary:
          "Saved workspace-owned compliance definitions; legacy global ownership unchanged",
      },
    });
    return result;
  });
}
async function visibleControl(
  ctx: Context & { user: NonNullable<Context["user"]> },
  projectId: string,
  controlId: string,
  mapping = false,
) {
  const { project } = await requireProjectAccess(ctx, projectId);
  const control = await ctx.prisma.complianceControl.findFirst({
    where: {
      id: controlId,
      OR: [
        { framework: { organizationId: project.organizationId } },
        ...(!mapping
          ? [
              {
                framework: { organizationId: null },
                testCases: { some: { testCase: { projectId } } },
              },
            ]
          : []),
      ],
    },
  });
  if (!control)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Control unavailable in this workspace. Legacy evidence is retained; use a workspace-owned definition for new mappings.",
    });
  return control;
}
export const complianceRouter = router({
  catalog: complianceProcedure.query(() => publicComplianceCatalog()),
  loadReference: complianceProcedure
    .input(complianceScope.extend({ key: z.string().min(1).max(200) }))
    .mutation(({ ctx, input }) =>
      loadComplianceReference(ctx.prisma, reviewActor(ctx), input, input.key),
    ),
  preview: complianceProcedure
    .input(compliancePreview)
    .mutation(({ ctx, input }) =>
      previewCompliance(ctx.prisma, reviewActor(ctx), input),
    ),
  reviewDraft: complianceProcedure
    .input(complianceDraftInput)
    .query(({ ctx, input }) =>
      readComplianceDraft(ctx.prisma, reviewActor(ctx), input),
    ),
  reviewDrafts: complianceProcedure
    .input(complianceScope)
    .query(({ ctx, input }) =>
      listComplianceDrafts(ctx.prisma, reviewActor(ctx), input),
    ),
  saveReview: complianceProcedure
    .input(complianceSave)
    .mutation(({ ctx, input }) =>
      saveComplianceSelection(ctx.prisma, reviewActor(ctx), input),
    ),
  applyReview: complianceProcedure
    .input(complianceApply)
    .mutation(({ ctx, input }) =>
      applyComplianceReview(ctx.prisma, reviewActor(ctx), input),
    ),
  listFrameworks: complianceProcedure
    .input(
      z
        .object({
          projectId: z.string().optional(),
          organizationId: z.string().optional(),
          includeHidden: z.boolean().default(false),
        })
        .optional(),
    )
    .output(
      z.array(
        z.object({
          id: z.string(),
          key: z.string(),
          name: z.string(),
          version: z.string().nullable(),
          isBuiltIn: z.boolean(),
          controlCount: z.number(),
          workspaceOwned: z.boolean(),
          revision: z.number(),
          catalogKey: z.string().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const scope = input?.projectId
        ? await requireProjectAccess(ctx, input.projectId)
        : null;
      if (input?.organizationId) {
        requireOrgRole(ctx, input.organizationId);
        await requireNotSuspended(ctx.prisma, input.organizationId);
      }
      const project = scope
        ? await ctx.prisma.project.findUniqueOrThrow({
            where: { id: scope.project.id },
            select: { hiddenComplianceFrameworkIds: true },
          })
        : null;
      const frameworks = await ctx.prisma.complianceFramework.findMany({
        where: {
          AND: [
            {
              OR: [
                {
                  organizationId: {
                    in: scope
                      ? [scope.project.organizationId]
                      : input?.organizationId
                        ? [input.organizationId]
                        : ctx.user.memberships.map((m) => m.organizationId),
                  },
                },
                { isBuiltIn: true, organizationId: null },
                ...(scope
                  ? [
                      {
                        organizationId: null,
                        controls: {
                          some: {
                            testCases: {
                              some: {
                                testCase: { projectId: scope.project.id },
                              },
                            },
                          },
                        },
                      },
                    ]
                  : []),
              ],
            },
            ...(project && !input?.includeHidden
              ? [{ id: { notIn: project.hiddenComplianceFrameworkIds } }]
              : []),
          ],
        },
        include: {
          _count: {
            select: {
              controls: scope
                ? {
                    where: {
                      OR: [
                        {
                          framework: {
                            organizationId: scope.project.organizationId,
                          },
                        },
                        {
                          testCases: {
                            some: { testCase: { projectId: scope.project.id } },
                          },
                        },
                      ],
                    },
                  }
                : {
                    where: {
                      framework: {
                        organizationId: {
                          in: input?.organizationId
                            ? [input.organizationId]
                            : ctx.user.memberships.map((m) => m.organizationId),
                        },
                      },
                    },
                  },
            },
          },
        },
        orderBy: [{ isBuiltIn: "desc" }, { name: "asc" }],
      });
      return frameworks.map((f) => ({
        id: f.id,
        key: f.key,
        name: f.name,
        version: f.version,
        isBuiltIn: f.isBuiltIn,
        controlCount: f._count.controls,
        workspaceOwned: f.organizationId !== null,
        revision: f.revision,
        catalogKey: f.catalogKey,
      }));
    }),

  createFramework: complianceProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        key: z.string().min(1),
        name: z.string().min(1),
        version: z.string().optional(),
        description: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      customWrite(ctx, input.projectId, (tx, organizationId) =>
        tx.complianceFramework.create({
          data: {
            key: `workspace:${randomUUID()}:${input.key}`,
            organizationId,
            name: input.name,
            version: input.version,
            description: input.description,
            isBuiltIn: false,
          },
        }),
      ),
    ),

  setFrameworkVisibility: complianceProcedure
    .input(
      z.object({
        projectId: z.string(),
        frameworkId: z.string(),
        hidden: z.boolean(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { project } = await requireProjectAccess(
        ctx,
        input.projectId,
        "ADMIN",
      );
      const framework = await ctx.prisma.complianceFramework.findFirst({
        where: {
          id: input.frameworkId,
          OR: [
            { organizationId: project.organizationId },
            { isBuiltIn: true, organizationId: null },
            {
              organizationId: null,
              controls: {
                some: {
                  testCases: { some: { testCase: { projectId: project.id } } },
                },
              },
            },
          ],
        },
      });
      if (!framework) throw new TRPCError({ code: "FORBIDDEN" });
      await ctx.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${project.id} FOR UPDATE`;
        const current = await tx.project.findUniqueOrThrow({
          where: { id: project.id },
        });
        const ids = new Set(current.hiddenComplianceFrameworkIds);
        if (input.hidden) ids.add(framework.id);
        else ids.delete(framework.id);
        await tx.project.update({
          where: { id: project.id },
          data: { hiddenComplianceFrameworkIds: [...ids] },
        });
        await tx.auditLog.create({
          data: {
            organizationId: project.organizationId,
            projectId: project.id,
            actorId: ctx.user.id,
            entityType: "ComplianceFramework",
            entityId: framework.id,
            action: "UPDATE",
            summary: `${input.hidden ? "Hid" : "Restored"} framework "${framework.name}" in this project; evidence retained`,
          },
        });
      });
      return { hidden: input.hidden };
    }),

  // P3-02: bulk-import a control set (AICPA TSC, NIST CSF, etc.) from
  // structured data an admin already has - a spreadsheet export, a vendor's
  // published control list - rather than hand-typing each control through
  // createControl one at a time, and rather than this codebase hand-seeding
  // (and silently going stale on) the text of external published standards.
  // skipDuplicates means re-importing an updated file is safe to run again:
  // existing (frameworkId, code) rows are left alone, not overwritten.
  importControls: complianceProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        frameworkId: z.string(),
        controls: z
          .array(
            z.object({
              code: z.string().min(1),
              title: z.string().min(1),
              description: z.string().optional(),
            }),
          )
          .min(1)
          .max(500),
      }),
    )
    .output(z.object({ createdCount: z.number(), skippedCount: z.number() }))
    .mutation(({ ctx, input }) =>
      customWrite(ctx, input.projectId, async (tx, organizationId) => {
        await ownedComplianceFramework(
          tx,
          organizationId,
          input.frameworkId,
          true,
        );
        const result = await tx.complianceControl.createMany({
          data: input.controls.map((c) => ({
            ...c,
            frameworkId: input.frameworkId,
          })),
          skipDuplicates: true,
        });
        return {
          createdCount: result.count,
          skippedCount: input.controls.length - result.count,
        };
      }),
    ),

  createControl: complianceProcedure
    .input(
      z.object({
        projectId: z.string().optional(),
        frameworkId: z.string(),
        code: z.string().min(1),
        title: z.string().min(1),
        description: z.string().optional(),
      }),
    )
    .mutation(({ ctx, input }) =>
      customWrite(ctx, input.projectId, async (tx, organizationId) => {
        await ownedComplianceFramework(
          tx,
          organizationId,
          input.frameworkId,
          true,
        );
        const { projectId: _projectId, ...data } = input;
        return tx.complianceControl.create({ data });
      }),
    ),

  // Per-control coverage within one project: how many of that project's
  // test cases are mapped to each control. A control with 0 is the gap
  // this whole feature exists to surface -- "which controls have zero
  // mapped test cases," straight from the roadmap ticket.
  controlCoverage: complianceProcedure
    .input(z.object({ projectId: z.string(), frameworkId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          code: z.string(),
          title: z.string(),
          description: z.string().nullable(),
          mappedTestCaseCount: z.number(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const controls = await ctx.prisma.complianceControl.findMany({
        where: {
          frameworkId: input.frameworkId,
          OR: [
            {
              framework: {
                organizationId: (
                  await requireProjectAccess(ctx, input.projectId)
                ).project.organizationId,
              },
            },
            {
              framework: { organizationId: null },
              testCases: { some: { testCase: { projectId: input.projectId } } },
            },
          ],
        },
        include: {
          _count: {
            select: {
              testCases: {
                where: { testCase: { projectId: input.projectId } },
              },
            },
          },
        },
        orderBy: { code: "asc" },
      });
      return controls.map((c) => ({
        id: c.id,
        code: c.code,
        title: c.title,
        description: c.description,
        mappedTestCaseCount: c._count.testCases,
      }));
    }),

  testCaseControls: complianceProcedure
    .input(z.object({ testCaseId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          code: z.string(),
          title: z.string(),
          frameworkName: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({
        where: { id: input.testCaseId },
        select: { projectId: true },
      });
      const { project } = await requireProjectAccess(ctx, tc.projectId);
      const mappings = await ctx.prisma.testCaseComplianceControl.findMany({
        where: {
          testCaseId: input.testCaseId,
          control: {
            framework: {
              OR: [
                { organizationId: project.organizationId },
                { organizationId: null },
              ],
            },
          },
        },
        include: { control: { include: { framework: true } } },
      });
      return mappings.map((m) => ({
        id: m.control.id,
        code: m.control.code,
        title: m.control.title,
        frameworkName: m.control.framework.name,
      }));
    }),

  mapTestCase: complianceProcedure
    .input(z.object({ testCaseId: z.string(), controlId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [tc, control] = await Promise.all([
        ctx.prisma.testCase.findUniqueOrThrow({
          where: { id: input.testCaseId },
          select: { projectId: true, title: true },
        }),
        ctx.prisma.complianceControl.findUniqueOrThrow({
          where: { id: input.controlId },
        }),
      ]);
      const { project } = await requireProjectAccess(
        ctx,
        tc.projectId,
        "EDITOR",
      );
      await visibleControl(ctx, tc.projectId, input.controlId, true);
      await ctx.prisma.testCaseComplianceControl.upsert({
        where: {
          testCaseId_controlId: {
            testCaseId: input.testCaseId,
            controlId: input.controlId,
          },
        },
        create: { testCaseId: input.testCaseId, controlId: input.controlId },
        update: {},
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: tc.projectId,
        actorId: ctx.user.id,
        entityType: "TestCaseComplianceControl",
        entityId: `${input.testCaseId}:${input.controlId}`,
        action: "MAP",
        summary: `Mapped test case "${tc.title}" to control "${control.code}"`,
      });
    }),

  unmapTestCase: complianceProcedure
    .input(z.object({ testCaseId: z.string(), controlId: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const [tc, control] = await Promise.all([
        ctx.prisma.testCase.findUniqueOrThrow({
          where: { id: input.testCaseId },
          select: { projectId: true, title: true },
        }),
        ctx.prisma.complianceControl.findUniqueOrThrow({
          where: { id: input.controlId },
        }),
      ]);
      const { project } = await requireProjectAccess(
        ctx,
        tc.projectId,
        "EDITOR",
      );
      await visibleControl(ctx, tc.projectId, input.controlId);
      await ctx.prisma.testCaseComplianceControl.deleteMany({
        where: { testCaseId: input.testCaseId, controlId: input.controlId },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: tc.projectId,
        actorId: ctx.user.id,
        entityType: "TestCaseComplianceControl",
        entityId: `${input.testCaseId}:${input.controlId}`,
        action: "UNMAP",
        summary: `Unmapped test case "${tc.title}" from control "${control.code}"`,
      });
    }),

  // Test cases already mapped to a control -- feeds the "record evidence"
  // picker (evidence only makes sense for a case actually mapped to the
  // control it's meant to prove).
  mappedTestCases: complianceProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(z.array(z.object({ id: z.string(), title: z.string() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      await visibleControl(ctx, input.projectId, input.controlId);
      const mappings = await ctx.prisma.testCaseComplianceControl.findMany({
        where: {
          controlId: input.controlId,
          testCase: { projectId: input.projectId },
        },
        include: { testCase: { select: { id: true, title: true } } },
      });
      return mappings.map((m) => ({
        id: m.testCase.id,
        title: m.testCase.title,
      }));
    }),

  // Test cases in a project not yet mapped to a given control -- feeds a
  // "map an existing case to this control" picker.
  unmappedTestCases: complianceProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(z.array(z.object({ id: z.string(), title: z.string() })))
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      await visibleControl(ctx, input.projectId, input.controlId);
      return ctx.prisma.testCase.findMany({
        where: {
          projectId: input.projectId,
          complianceControls: { none: { controlId: input.controlId } },
        },
        select: { id: true, title: true },
        orderBy: { title: "asc" },
        take: 200,
      });
    }),

  // P3-04: the auditor-handoff report -- unlike controlCoverage (a UI-
  // friendly count), this names the actual mapped test cases and their
  // current review status, since "evidence exists" isn't the same claim as
  // "evidence exists and someone signed off on it." Returned as structured
  // data; the client renders it to CSV (no server-side file generation
  // needed for a report this shaped).
  exportReport: complianceProcedure
    .input(z.object({ projectId: z.string(), frameworkId: z.string() }))
    .output(
      z.object({
        frameworkName: z.string(),
        projectName: z.string(),
        generatedAt: z.date(),
        controls: z.array(
          z.object({
            code: z.string(),
            title: z.string(),
            description: z.string().nullable(),
            mappedTestCases: z.array(
              z.object({ title: z.string(), reviewStatus: z.string() }),
            ),
          }),
        ),
      }),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      const [project, framework] = await Promise.all([
        ctx.prisma.project.findUniqueOrThrow({
          where: { id: input.projectId },
          select: { name: true },
        }),
        ctx.prisma.complianceFramework.findFirstOrThrow({
          where: {
            id: input.frameworkId,
            OR: [
              {
                organizationId: (
                  await requireProjectAccess(ctx, input.projectId)
                ).project.organizationId,
              },
              { isBuiltIn: true, organizationId: null },
              {
                organizationId: null,
                controls: {
                  some: {
                    testCases: {
                      some: { testCase: { projectId: input.projectId } },
                    },
                  },
                },
              },
            ],
          },
        }),
      ]);
      const controls = await ctx.prisma.complianceControl.findMany({
        where: {
          frameworkId: input.frameworkId,
          OR: [
            {
              framework: {
                organizationId: (
                  await requireProjectAccess(ctx, input.projectId)
                ).project.organizationId,
              },
            },
            {
              framework: { organizationId: null },
              testCases: { some: { testCase: { projectId: input.projectId } } },
            },
          ],
        },
        include: {
          testCases: {
            where: { testCase: { projectId: input.projectId } },
            include: {
              testCase: { select: { title: true, reviewStatus: true } },
            },
          },
        },
        orderBy: { code: "asc" },
      });
      return {
        frameworkName: framework.name,
        projectName: project.name,
        generatedAt: new Date(),
        controls: controls.map((c) => ({
          code: c.code,
          title: c.title,
          description: c.description,
          mappedTestCases: c.testCases.map((m) => ({
            title: m.testCase.title,
            reviewStatus: m.testCase.reviewStatus,
          })),
        })),
      };
    }),

  // P3-05: records a dated, immutable proof point for a control -- "this
  // specific execution passed on this date" (or a manual attestation with
  // no automated result behind it), distinct from the structural
  // testCases mapping above which only claims "this case is designed to
  // verify this control." No update/delete mutation exists for this model
  // anywhere in the API -- a wrong record is superseded by a new one, not
  // edited.
  recordEvidence: complianceProcedure
    .input(
      z.object({
        projectId: z.string(),
        controlId: z.string(),
        testCaseId: z.string(),
        testResultId: z.string().optional(),
        note: z.string().optional(),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        controlId: z.string(),
        testCaseId: z.string(),
        testResultId: z.string().nullable(),
        note: z.string().nullable(),
        recordedAt: z.date(),
        recordedByEmail: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      await visibleControl(ctx, input.projectId, input.controlId);
      const mapped = await ctx.prisma.testCaseComplianceControl.findFirst({
        where: {
          testCaseId: input.testCaseId,
          controlId: input.controlId,
          testCase: { projectId: input.projectId },
        },
      });
      if (!mapped)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Evidence requires a mapped case in this project.",
        });
      if (
        input.testResultId &&
        !(await ctx.prisma.testResult.findFirst({
          where: { id: input.testResultId, testCaseId: input.testCaseId },
        }))
      )
        throw new TRPCError({ code: "FORBIDDEN" });
      const evidence = await ctx.prisma.complianceEvidence.create({
        data: {
          projectId: input.projectId,
          controlId: input.controlId,
          testCaseId: input.testCaseId,
          testResultId: input.testResultId,
          note: input.note,
          recordedById: ctx.user.id,
        },
        include: { recordedBy: { select: { email: true } } },
      });
      await recordAudit(ctx.prisma, {
        organizationId: (
          await ctx.prisma.project.findUniqueOrThrow({
            where: { id: input.projectId },
            select: { organizationId: true },
          })
        ).organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "ComplianceEvidence",
        entityId: evidence.id,
        action: "CREATE",
        summary: `Recorded evidence for a compliance control`,
      });
      return {
        id: evidence.id,
        controlId: evidence.controlId,
        testCaseId: evidence.testCaseId,
        testResultId: evidence.testResultId,
        note: evidence.note,
        recordedAt: evidence.recordedAt,
        recordedByEmail: evidence.recordedBy.email,
      };
    }),

  listEvidence: complianceProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          testCaseId: z.string(),
          testCaseTitle: z.string(),
          testResultId: z.string().nullable(),
          note: z.string().nullable(),
          recordedAt: z.date(),
          recordedByEmail: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      await visibleControl(ctx, input.projectId, input.controlId);
      const rows = await ctx.prisma.complianceEvidence.findMany({
        where: { projectId: input.projectId, controlId: input.controlId },
        include: {
          testCase: { select: { title: true } },
          recordedBy: { select: { email: true } },
        },
        orderBy: { recordedAt: "desc" },
      });
      return rows.map((r) => ({
        id: r.id,
        testCaseId: r.testCaseId,
        testCaseTitle: r.testCase.title,
        testResultId: r.testResultId,
        note: r.note,
        recordedAt: r.recordedAt,
        recordedByEmail: r.recordedBy.email,
      }));
    }),

  // P3-07: a ComplianceAuditor's (or org ADMIN/OWNER, as an override)
  // formal, durable attestation that a control was reviewed and is
  // operating effectively for a given period. Deliberately gated by ROLE,
  // not just project access level -- COMPLIANCE_AUDITOR ranks below EDITOR
  // in this app's general permission hierarchy (trpc.ts's ROLE_RANK), so
  // requireProjectAccess's minRole check can't express "must actually hold
  // this specific role," hence the explicit membership.role check below.
  signOffControl: complianceProcedure
    .input(
      z.object({
        projectId: z.string(),
        controlId: z.string(),
        period: z.string().min(1),
        statement: z.string().min(1),
      }),
    )
    .output(
      z.object({
        id: z.string(),
        controlId: z.string(),
        period: z.string(),
        statement: z.string(),
        signedAt: z.date(),
        signedByEmail: z.string(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const { membership } = await requireProjectAccess(ctx, input.projectId);
      await visibleControl(ctx, input.projectId, input.controlId);
      if (!SIGN_OFF_ROLES.includes(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only a Compliance Auditor (or an org Admin/Owner) can sign off on a control",
        });
      }
      const signOff = await ctx.prisma.complianceSignOff.create({
        data: {
          projectId: input.projectId,
          controlId: input.controlId,
          period: input.period,
          statement: input.statement,
          signedById: ctx.user.id,
        },
        include: { signedBy: { select: { email: true } } },
      });
      const project = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { organizationId: true, name: true },
      });
      const control = await ctx.prisma.complianceControl.findUnique({
        where: { id: input.controlId },
        select: { title: true },
      });
      await recordAudit(ctx.prisma, {
        organizationId: project.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "ComplianceSignOff",
        entityId: signOff.id,
        action: "CREATE",
        summary: `Signed off on a compliance control for ${input.period}`,
      });
      void dispatchWebhookEvent(
        ctx.prisma,
        project.organizationId,
        "compliance.sign_off_recorded",
        {
          projectId: input.projectId,
          controlId: input.controlId,
          period: input.period,
          signedByEmail: signOff.signedBy.email,
        },
      ).catch(() => undefined);
      void notifySlackEvent(
        ctx.prisma,
        project.organizationId,
        "compliance.sign_off_recorded",
        {
          projectName: project.name,
          controlName: control?.title ?? input.controlId,
          period: input.period,
          signedByEmail: signOff.signedBy.email,
        },
      ).catch(() => undefined);
      // P8-04: auto-fulfill an open request for THIS signer, on THIS
      // control+period - a sign-off that happens unprompted (no matching
      // request) is fine and just leaves no request to fulfill; a request
      // that predates this exact match is left open (it asked someone else,
      // or a different period). findFirst + single update (not updateMany)
      // since fulfilledSignOffId is unique - two open duplicate requests
      // can't both be stamped with the same sign-off id.
      const openRequest = await ctx.prisma.complianceSignOffRequest.findFirst({
        where: {
          controlId: input.controlId,
          projectId: input.projectId,
          period: input.period,
          requestedForId: ctx.user.id,
          fulfilledAt: null,
        },
      });
      if (openRequest) {
        await ctx.prisma.complianceSignOffRequest
          .update({
            where: { id: openRequest.id },
            data: { fulfilledAt: new Date(), fulfilledSignOffId: signOff.id },
          })
          .catch(() => undefined);
      }
      return {
        id: signOff.id,
        controlId: signOff.controlId,
        period: signOff.period,
        statement: signOff.statement,
        signedAt: signOff.signedAt,
        signedByEmail: signOff.signedBy.email,
      };
    }),

  listSignOffs: complianceProcedure
    .input(z.object({ projectId: z.string(), controlId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          period: z.string(),
          statement: z.string(),
          signedAt: z.date(),
          signedByEmail: z.string(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      await visibleControl(ctx, input.projectId, input.controlId);
      const rows = await ctx.prisma.complianceSignOff.findMany({
        where: { projectId: input.projectId, controlId: input.controlId },
        include: { signedBy: { select: { email: true } } },
        orderBy: { signedAt: "desc" },
      });
      return rows.map((r) => ({
        id: r.id,
        period: r.period,
        statement: r.statement,
        signedAt: r.signedAt,
        signedByEmail: r.signedBy.email,
      }));
    }),

  // P8-04: the ask itself, independent of whether/when it's ever fulfilled -
  // see the schema comment on ComplianceSignOffRequest for why this is its
  // own model rather than a status field. Only someone who could sign off
  // themselves can ask someone else to (same SIGN_OFF_ROLES gate as
  // signOffControl), and only of another member who could also actually
  // fulfill it - requesting from a VIEWER would create a request nobody can
  // ever satisfy.
  requestSignOff: complianceProcedure
    .input(
      z.object({
        projectId: z.string(),
        controlId: z.string(),
        period: z.string().min(1),
        requestedForUserId: z.string(),
      }),
    )
    .output(z.object({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { membership, project } = await requireProjectAccess(
        ctx,
        input.projectId,
      );
      await visibleControl(ctx, input.projectId, input.controlId);
      if (!SIGN_OFF_ROLES.includes(membership.role)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Only a Compliance Auditor (or an org Admin/Owner) can request a sign-off",
        });
      }
      const projectFull = await ctx.prisma.project.findUniqueOrThrow({
        where: { id: input.projectId },
        select: { name: true },
      });
      const targetMembership = await ctx.prisma.membership.findFirst({
        where: {
          organizationId: project.organizationId,
          userId: input.requestedForUserId,
        },
      });
      if (
        !targetMembership ||
        !SIGN_OFF_ROLES.includes(targetMembership.role)
      ) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "That member can't sign off on controls (needs Compliance Auditor, Admin, or Owner)",
        });
      }

      const request = await ctx.prisma.complianceSignOffRequest.create({
        data: {
          controlId: input.controlId,
          projectId: input.projectId,
          period: input.period,
          requestedForId: input.requestedForUserId,
          requestedById: ctx.user.id,
        },
      });

      const control = await ctx.prisma.complianceControl.findUnique({
        where: { id: input.controlId },
        select: { title: true },
      });
      void sendPushToUser(ctx.prisma, input.requestedForUserId, {
        title: "Compliance sign-off requested",
        body: `${projectFull.name}: ${control?.title ?? "a control"} for ${input.period}`,
        data: {
          type: "compliance.sign_off_requested",
          projectId: input.projectId,
          controlId: input.controlId,
          period: input.period,
        },
      }).catch(() => undefined);

      return { id: request.id };
    }),

  // Scoped to the CALLER's own pending asks, not project-scoped - this is
  // "what do I owe" from the signer's point of view (the mobile app's
  // primary use case), not an admin view of a project's requests.
  myPendingSignOffRequests: complianceProcedure
    .output(
      z.array(
        z.object({
          id: z.string(),
          projectId: z.string(),
          projectName: z.string(),
          controlId: z.string(),
          controlCode: z.string(),
          controlTitle: z.string(),
          period: z.string(),
          requestedAt: z.date(),
          requestedByEmail: z.string(),
        }),
      ),
    )
    .query(async ({ ctx }) => {
      const requests = await ctx.prisma.complianceSignOffRequest.findMany({
        where: {
          requestedForId: ctx.user.id,
          fulfilledAt: null,
          project: {
            organizationId: ctx.workspaceOrganizationId ?? undefined,
            organization: {
              suspendedAt: null,
              memberships: { some: { userId: ctx.user.id } },
            },
          },
        },
        include: {
          project: { select: { name: true, organizationId: true } },
          control: {
            select: {
              code: true,
              title: true,
              framework: { select: { organizationId: true } },
            },
          },
          requestedBy: { select: { email: true } },
        },
        orderBy: { requestedAt: "desc" },
      });
      return requests
        .filter(
          (r) =>
            r.control.framework.organizationId === null ||
            r.control.framework.organizationId === r.project.organizationId,
        )
        .map((r) => ({
          id: r.id,
          projectId: r.projectId,
          projectName: r.project.name,
          controlId: r.controlId,
          controlCode: r.control.code,
          controlTitle: r.control.title,
          period: r.period,
          requestedAt: r.requestedAt,
          requestedByEmail: r.requestedBy.email,
        }));
    }),
});
