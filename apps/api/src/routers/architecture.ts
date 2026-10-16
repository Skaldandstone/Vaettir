import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import {
  reviewArchitecture,
  architectureReviewSchema,
  type ArchitectureCase,
} from "@vaettir/ai-agent";
import {
  router,
  protectedProcedure,
  requireProjectAccess,
  type Context,
} from "../trpc.js";
import {
  architectureAnalysisScope,
  architectureCaseFingerprint,
} from "../services/architectureAnalysisScope.js";
import { lockedProcessingEditor } from "../services/repositoryProcessingApproval.js";
import {
  AI_OPERATION_COSTS,
  chargeAiCredits,
  getAiCreditBalance,
  meterAiCall,
  InsufficientAiCreditsError,
} from "../services/aiCredits.js";
import { withApprovedAnalysisSpend } from "../services/approvedAnalysisSpend.js";
import {
  assertCaseFieldAuthoring,
  lockCaseFieldProject,
} from "../services/caseFields.js";
import { caseFieldValues } from "../services/caseFieldSchema.js";
import { snapshotTestCaseVersion } from "../services/testCaseVersion.js";

const request = z
  .object({
    projectId: z.string().min(1).max(120),
    organizationId: z.string().min(1).max(120),
    fileName: z.string().min(1).max(250),
    content: z.string().min(1).max(1_000_000),
  })
  .strict();
const batchRequest = request.extend({
  expectedScopeHash: z.string().regex(/^[a-f0-9]{64}$/),
  batchIndex: z.number().int().nonnegative(),
  approvedMaximumCredits: z.number().int().nonnegative(),
  approveAiProcessing: z.literal(true),
});
const cost = AI_OPERATION_COSTS.reviewTestDesign;
const select = {
  id: true,
  displayId: true,
  title: true,
  background: true,
  given: true,
  when: true,
  then: true,
  verificationProfile: true,
  steps: {
    orderBy: { order: "asc" as const },
    select: {
      action: true,
      expectedActionOrData: true,
      expectedResult: true,
      expectedResponse: true,
    },
  },
  sharedStepGroup: { select: { projectId: true, steps: true } },
} satisfies Prisma.TestCaseSelect;
type Actor = Context & { user: NonNullable<Context["user"]> };
async function access(
  ctx: Actor,
  input: { projectId: string; organizationId: string },
  edit = false,
) {
  const user = await ctx.prisma.user.findUnique({
    where: { id: ctx.user.id },
    include: { memberships: true },
  });
  if (
    !user ||
    !ctx.authenticatedClerkSubject ||
    user.clerkUserId !== ctx.authenticatedClerkSubject
  )
    throw new TRPCError({ code: "UNAUTHORIZED" });
  const access = await requireProjectAccess(
    { ...ctx, user },
    input.projectId,
    edit ? "EDITOR" : "VIEWER",
  );
  if (access.project.organizationId !== input.organizationId)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This project changed workspace. Reopen Architecture in its current workspace.",
    });
  return access;
}
async function scope(ctx: Actor, input: z.infer<typeof request>, edit = false) {
  const authorization = await access(ctx, input, edit);
  const rows = await ctx.prisma.testCase.findMany({
    where: { projectId: input.projectId, archived: false },
    orderBy: { id: "asc" },
    select,
    take: 15001,
  });
  if (
    rows.some(
      (r) =>
        r.sharedStepGroup && r.sharedStepGroup.projectId !== input.projectId,
    )
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "A shared procedure belongs to another project. Repair its reference before analysis.",
    });
  try {
    const cases: ArchitectureCase[] = rows.map(
      ({ sharedStepGroup, ...row }) => ({
        ...row,
        sharedSteps: sharedStepGroup?.steps ?? null,
      }),
    );
    return {
      ...authorization,
      ...architectureAnalysisScope(
        input.projectId,
        input.fileName,
        input.content,
        cases,
      ),
    };
  } catch (e) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        e instanceof Error ? e.message : "The architecture could not be read.",
    });
  }
}
const prefix = (
  actorId: string,
  organizationId: string,
  projectId: string,
  scopeHash: string,
) =>
  "architecture-" +
  createHash("sha256")
    .update(JSON.stringify([actorId, organizationId, projectId, scopeHash]))
    .digest("hex");
const resultMetadata = z.object({ result: architectureReviewSchema });
const mappingDecision = z.object({
  revision: z.number().int().positive(),
  caseId: z.string(),
  caseHash: z.string(),
  elementId: z.string(),
  decision: z.enum(["CONFIRMED", "REJECTED"]),
});
const savedDocument = z.object({
  hash: z.string(),
  fileName: z.string(),
  content: z.string(),
  format: z.enum(["PLANTUML", "SVG"]),
});
async function retainDocument(
  tx: Prisma.TransactionClient,
  ctx: Actor,
  input: z.infer<typeof request>,
  document: ReturnType<typeof architectureAnalysisScope>["document"],
) {
  const id =
    "architecture-document-" +
    createHash("sha256")
      .update(
        JSON.stringify([input.organizationId, input.projectId, document.hash]),
      )
      .digest("hex");
  if (!(await tx.auditLog.findUnique({ where: { id } }))) {
    const count = await tx.auditLog.count({
      where: {
        organizationId: input.organizationId,
        projectId: input.projectId,
        entityType: "ArchitectureDocument",
      },
    });
    if (count >= 100)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Architecture version retention capacity reached. No existing version was removed.",
      });
    await tx.auditLog.create({
      data: {
        id,
        organizationId: input.organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType: "ArchitectureDocument",
        entityId: document.hash,
        action: "CREATE",
        summary:
          "Retained architecture source version in Vaettir; not shared with Atlassian",
        metadata: { ...document, content: input.content },
      },
    });
  }
}

export const architectureRouter = router({
  documents: protectedProcedure
    .input(request.pick({ projectId: true, organizationId: true }))
    .query(async ({ ctx, input }) => {
      await access(ctx, input);
      const rows = await ctx.prisma.auditLog.findMany({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityType: "ArchitectureDocument",
        },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        take: 100,
      });
      return rows.map((r) => {
        const d = savedDocument.parse(r.metadata);
        return {
          hash: d.hash,
          fileName: d.fileName,
          format: d.format,
          savedAt: r.createdAt,
        };
      });
    }),
  openDocument: protectedProcedure
    .input(
      request
        .pick({ projectId: true, organizationId: true })
        .extend({ hash: z.string().regex(/^[a-f0-9]{64}$/) }),
    )
    .mutation(async ({ ctx, input }) => {
      await access(ctx, input);
      const row = await ctx.prisma.auditLog.findFirst({
        where: {
          organizationId: input.organizationId,
          projectId: input.projectId,
          entityType: "ArchitectureDocument",
          entityId: input.hash,
        },
      });
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return savedDocument.parse(row.metadata);
    }),
  saveDocument: protectedProcedure
    .input(request)
    .mutation(async ({ ctx, input }) => {
      const current = await scope(ctx, input, true);
      return ctx.prisma.$transaction(async (tx) => {
        await lockedProcessingEditor(
          tx,
          input.organizationId,
          ctx.user.id,
          input.projectId,
        );
        await access(
          { ...ctx, prisma: tx as unknown as PrismaClient },
          input,
          true,
        );
        await retainDocument(tx, ctx, input, current.document);
        return { hash: current.document.hash };
      });
    }),
  preview: protectedProcedure
    .input(request)
    .mutation(async ({ ctx, input }) => {
      const current = await scope(ctx, input),
        id = prefix(
          ctx.user.id,
          current.project.organizationId,
          input.projectId,
          current.scopeHash,
        );
      const completed = await ctx.prisma.auditLog.findMany({
        where: {
          projectId: input.projectId,
          organizationId: current.project.organizationId,
          actorId: ctx.user.id,
          entityType: "ArchitectureReviewResult",
          entityId: id,
        },
        orderBy: { createdAt: "asc" },
      });
      const decisions = await ctx.prisma.auditLog.findMany({
        where: {
          projectId: input.projectId,
          organizationId: current.project.organizationId,
          entityType: "ArchitectureMappingDecision",
          entityId: current.document.hash,
        },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      });
      const caseHashes = new Map(
        current.definitions.map((c) => [c.id, architectureCaseFingerprint(c)]),
      );
      return {
        projectId: input.projectId,
        organizationId: input.organizationId,
        actorClerkUserId: ctx.authenticatedClerkSubject,
        scopeHash: current.scopeHash,
        document: current.document,
        cases: current.definitions.map((c) => ({
          id: c.id,
          displayId: c.displayId,
          title: c.title,
        })),
        unprocessed: current.unprocessed,
        batchCount: current.batches.length,
        maximumCredits: cost * current.batches.length,
        balance: await getAiCreditBalance(
          ctx.prisma,
          current.project.organizationId,
        ),
        canSpend:
          current.membership.seatType === "FULL" &&
          ["OWNER", "ADMIN", "EDITOR"].includes(current.membership.role),
        results: completed.map((row) => ({
          batchIndex: Number((row.metadata as Prisma.JsonObject).batchIndex),
          ...resultMetadata.parse(row.metadata),
        })),
        decisions: [
          ...new Map(
            decisions
              .map((row) => mappingDecision.parse(row.metadata))
              .sort((a, b) => a.revision - b.revision)
              .filter((d) => caseHashes.get(d.caseId) === d.caseHash)
              .map((d) => [JSON.stringify([d.caseId, d.elementId]), d]),
          ).values(),
        ],
      };
    }),
  analyzeBatch: protectedProcedure
    .input(batchRequest)
    .mutation(async ({ ctx, input }) => {
      const current = await scope(ctx, input, true),
        organizationId = current.project.organizationId;
      if (
        input.expectedScopeHash !== current.scopeHash ||
        input.approvedMaximumCredits !== cost * current.batches.length
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Diagram, test definitions or price changed. Review the current scope again.",
        });
      const batch = current.batches[input.batchIndex];
      if (!batch) throw new TRPCError({ code: "BAD_REQUEST" });
      const group = prefix(
          ctx.user.id,
          organizationId,
          input.projectId,
          current.scopeHash,
        ),
        id = `${group}-${input.batchIndex}`;
      const metadata = {
        protocol: "architecture-review/v1",
        scopeHash: current.scopeHash,
        documentHash: current.document.hash,
        batchIndex: input.batchIndex,
        maximumCredits: cost,
        caseIds: batch.map((c) => c.id),
      };
      const audit = (
        suffix: string,
        entityType: string,
        values: Prisma.InputJsonObject,
      ) => ({
        id: id + suffix,
        organizationId,
        projectId: input.projectId,
        actorId: ctx.user.id,
        entityType,
        entityId: group,
        action: "CREATE" as const,
        summary:
          "Architecture review: proposed traceability, not measured coverage",
        metadata: { ...metadata, ...values },
      });
      // Provider work is outside the database transaction. The attempt and its
      // maximum debit commit together, so a balance refusal never strands a job.
      return withApprovedAnalysisSpend(
        {
          organizationId,
          caseId: id,
          inputHash: current.scopeHash,
          operation: "reviewTestDesign",
          maximumCredits: cost,
          validate: async (tx) => {
            await lockedProcessingEditor(
              tx,
              organizationId,
              ctx.user.id,
              input.projectId,
            );
            if (await tx.auditLog.findUnique({ where: { id: id + "-charge" } }))
              throw new TRPCError({ code: "CONFLICT" });
          },
          recordCharge: async (tx, transactionId, credits) => {
            await tx.auditLog.create({
              data: audit("-charge", "ArchitectureReviewCharge", {
                transactionId,
                credits,
              }),
            });
          },
          recordMeter: async (tx, transactionId, facts) => {
            if (await tx.auditLog.findUnique({ where: { id: id + "-meter" } }))
              return false;
            await tx.auditLog.create({
              data: audit("-meter", "ArchitectureReviewMeter", {
                transactionId,
                ...facts,
              }),
            });
            return true;
          },
        },
        async () => {
          const earlier = await ctx.prisma.auditLog.findMany({
            where: {
              projectId: input.projectId,
              actorId: ctx.user.id,
              organizationId,
              entityType: "ArchitectureReviewResult",
              entityId: group,
              NOT: { id: id + "-result" },
            },
          });
          let elements = current.document.elements;
          if (!batch.length) {
            if (earlier.length !== current.batches.length - 1)
              throw new TRPCError({
                code: "PRECONDITION_FAILED",
                message:
                  "Finish existing-case mapping before requesting gap suggestions.",
              });
            const mapped = new Set(
              earlier.flatMap((row) =>
                resultMetadata
                  .parse(row.metadata)
                  .result.mappings.flatMap((m) =>
                    m.matches
                      .filter((link) => link.confidence !== "LOW")
                      .map((link) => link.elementId),
                  ),
              ),
            );
            elements = elements.filter((e) => !mapped.has(e.id));
          }
          const work = async () =>
            !elements.length
              ? { mappings: [], suggestions: [] }
              : reviewArchitecture(elements, batch);
          const reservation = await ctx.prisma.$transaction(async (tx) => {
            await lockedProcessingEditor(
              tx,
              organizationId,
              ctx.user.id,
              input.projectId,
            );
            const fresh = await scope(
              { ...ctx, prisma: tx as unknown as PrismaClient },
              input,
              true,
            );
            if (fresh.scopeHash !== current.scopeHash)
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "The architecture or cases changed. Review the scope again.",
              });
            const done = await tx.auditLog.findUnique({
              where: { id: id + "-result" },
            });
            if (done)
              return {
                result: resultMetadata.parse(done.metadata).result,
                charge: null,
              };
            if (await tx.auditLog.findUnique({ where: { id } }))
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "This batch already started. Refresh to recover its result. An unconfirmed or failed attempt needs reconciliation; no automatic repeat charge.",
              });
            const recent = await tx.auditLog.count({
              where: {
                actorId: ctx.user.id,
                organizationId,
                entityType: "ArchitectureReviewAttempt",
                createdAt: { gt: new Date(Date.now() - 3600000) },
              },
            });
            if (recent >= 800)
              throw new TRPCError({ code: "TOO_MANY_REQUESTS" });
            await tx.auditLog.create({
              data: audit("", "ArchitectureReviewAttempt", {}),
            });
            await retainDocument(tx, ctx, input, current.document);
            const charge = elements.length
              ? await chargeAiCredits(
                  tx as unknown as PrismaClient,
                  organizationId,
                  "reviewTestDesign",
                  `Architecture analysis ${id}`,
                )
              : null;
            return { result: null, charge };
          });
          if (reservation.result) return reservation.result;
          try {
            const result = reservation.charge
              ? await meterAiCall(ctx.prisma, reservation.charge, work)
              : await work();
            // Refuse stale or revoked results at the publication boundary too.
            await ctx.prisma.$transaction(async (tx) => {
              await lockedProcessingEditor(
                tx,
                organizationId,
                ctx.user.id,
                input.projectId,
              );
              const fresh = await scope(
                { ...ctx, prisma: tx as unknown as PrismaClient },
                input,
                true,
              );
              if (fresh.scopeHash !== current.scopeHash)
                throw new TRPCError({
                  code: "CONFLICT",
                  message:
                    "Cases changed during analysis. This result cannot be accepted against the current definitions.",
                });
              await tx.auditLog.create({
                data: audit("-result", "ArchitectureReviewResult", {
                  result: result as Prisma.InputJsonValue,
                }),
              });
            });
            return result;
          } catch (e) {
            await ctx.prisma.auditLog
              .create({
                data: audit("-failed", "ArchitectureReviewFailure", {
                  diagnostic: "NOT_ACCEPTED_RECONCILE_BEFORE_RETRY",
                }),
              })
              .catch(() => undefined);
            if (e instanceof TRPCError) throw e;
            throw new TRPCError({
              code: "PRECONDITION_FAILED",
              message:
                "The architecture review was not accepted. Its attempt and any charge are retained for reconciliation; no repeated processing was started.",
            });
          }
        },
      ).catch((e: unknown) => {
        if (e instanceof InsufficientAiCreditsError)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message:
              "Not enough purchased AI credits for this batch. No attempt or debit was committed; add credits and review again.",
          });
        throw e;
      });
    }),
  createDraft: protectedProcedure
    .input(
      request.extend({
        resultScopeHash: z.string().regex(/^[a-f0-9]{64}$/),
        batchIndex: z.number().int().nonnegative(),
        draftIndex: z.number().int().min(0).max(11),
        requestId: z.string().uuid(),
        reviewedAssumptions: z.literal(true),
        customFields: caseFieldValues.optional(),
        expectedFieldSchemaHash: z
          .string()
          .regex(/^[a-f0-9]{64}$/)
          .optional(),
        title: z.string().trim().min(1).max(1000),
        preconditions: z.array(z.string().trim().min(1).max(10000)).max(20),
        actions: z.array(z.string().trim().min(1).max(10000)).min(1).max(20),
        expectedResults: z
          .array(z.string().trim().min(1).max(10000))
          .min(1)
          .max(20),
        testType: z.enum([
          "UNIT",
          "FUNCTIONAL",
          "CONTRACT",
          "INSTRUMENTATION",
          "SMOKE",
          "SANITY",
          "REGRESSION",
          "E2E",
          "PERFORMANCE",
          "SECURITY",
          "ACCESSIBILITY",
          "EXPLORATORY",
          "COMPLIANCE",
          "OTHER",
        ]),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await scope(ctx, input, true),
        group = prefix(
          ctx.user.id,
          input.organizationId,
          input.projectId,
          input.resultScopeHash,
        );
      const result = await ctx.prisma.auditLog.findFirst({
        where: {
          id: `${group}-${input.batchIndex}-result`,
          projectId: input.projectId,
          organizationId: input.organizationId,
          actorId: ctx.user.id,
          entityType: "ArchitectureReviewResult",
          entityId: group,
        },
      });
      const original =
        result &&
        resultMetadata.parse(result.metadata).result.suggestions[
          input.draftIndex
        ];
      if (
        !original ||
        (result!.metadata as Prisma.JsonObject).documentHash !==
          current.document.hash
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "Choose a retained suggestion for this exact architecture document.",
        });
      const id =
        "architecture-create-" +
        createHash("sha256")
          .update(
            JSON.stringify([ctx.user.id, input.projectId, input.requestId]),
          )
          .digest("hex");
      const payloadHash = createHash("sha256")
        .update(JSON.stringify(input))
        .digest("hex");
      return ctx.prisma.$transaction(async (tx) => {
        await lockCaseFieldProject(tx, ctx.user.id, input.projectId);
        await scope(
          { ...ctx, prisma: tx as unknown as PrismaClient },
          input,
          true,
        );
        const previous = await tx.auditLog.findUnique({ where: { id } });
        if (previous) {
          const meta = previous.metadata as Prisma.JsonObject;
          if (meta.payloadHash !== payloadHash)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This save request was already used with different content.",
            });
          const saved = await tx.testCase.findFirst({
            where: { id: String(meta.caseId), projectId: input.projectId },
            select: { id: true, displayId: true },
          });
          if (!saved)
            throw new TRPCError({
              code: "NOT_FOUND",
              message:
                "The previously saved case is no longer available. This request will not recreate it.",
            });
          return saved;
        }
        const customFields = await assertCaseFieldAuthoring(
          tx,
          ctx.user.id,
          input.projectId,
          {
            values: input.customFields,
            expectedSchemaHash: input.expectedFieldSchemaHash,
          },
          { clerkActorId: ctx.authenticatedClerkSubject! },
        );
        const steps = input.actions.map((action, order) => ({
          order,
          action,
          expectedActionOrData: null,
          expectedResponse: null,
          expectedResult:
            order === input.actions.length - 1
              ? input.expectedResults.join("\n")
              : null,
          mediaAttachmentIds: [],
        }));
        const created = await tx.testCase.create({
          data: {
            projectId: input.projectId,
            title: input.title,
            background: input.preconditions.join("\n") || null,
            given: [],
            when: [],
            then: [],
            tags: [],
            testType: input.testType,
            customFields: customFields as Prisma.InputJsonValue,
            origin: "AI_REVERSE_ENGINEERED",
            reviewStatus: "PENDING_REVIEW",
            confidence:
              original.confidence === "HIGH"
                ? 0.9
                : original.confidence === "MEDIUM"
                  ? 0.6
                  : 0.3,
            aiSnapshot: {
              title: original.title,
              background: original.preconditions.join("\n"),
              given: [],
              when: [],
              then: [],
              tags: [],
              protocol: "architecture-review/v1",
              documentHash: current.document.hash,
              resultScopeHash: input.resultScopeHash,
              original: original as Prisma.InputJsonValue,
            },
            createdById: ctx.user.id,
            updatedById: ctx.user.id,
            steps: { create: steps },
          },
        });
        await snapshotTestCaseVersion(tx, {
          testCaseId: created.id,
          title: created.title,
          background: created.background,
          given: [],
          when: [],
          then: [],
          steps,
          tags: [],
          priority: created.priority,
          testType: created.testType,
          actorId: ctx.user.id,
        });
        await tx.auditLog.create({
          data: {
            id,
            organizationId: input.organizationId,
            projectId: input.projectId,
            actorId: ctx.user.id,
            entityType: "ArchitectureDraftCreation",
            entityId: created.id,
            action: "CREATE",
            summary:
              "Saved a reviewed architecture proposal as a pending test case; existing cases unchanged",
            metadata: {
              payloadHash,
              caseId: created.id,
              documentHash: current.document.hash,
              resultScopeHash: input.resultScopeHash,
              batchIndex: input.batchIndex,
              draftIndex: input.draftIndex,
              reviewedAssumptions: true,
            },
          },
        });
        return { id: created.id, displayId: created.displayId };
      });
    }),
  decide: protectedProcedure
    .input(
      request.extend({
        expectedScopeHash: z.string(),
        caseId: z.string(),
        elementId: z.string(),
        decision: z.enum(["CONFIRMED", "REJECTED"]),
        requestId: z.string().uuid(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const current = await scope(ctx, input, true);
      if (
        input.expectedScopeHash !== current.scopeHash ||
        !current.definitions.some((c) => c.id === input.caseId) ||
        !current.document.elements.some((e) => e.id === input.elementId)
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "The architecture or case changed; review current evidence.",
        });
      return ctx.prisma.$transaction(async (tx) => {
        await lockedProcessingEditor(
          tx,
          current.project.organizationId,
          ctx.user.id,
          input.projectId,
        );
        const fresh = await scope(
          { ...ctx, prisma: tx as unknown as PrismaClient },
          input,
          true,
        );
        if (fresh.scopeHash !== current.scopeHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Cases changed. Review current evidence before saving this mapping.",
          });
        const id =
          "architecture-decision-" +
          createHash("sha256")
            .update(
              JSON.stringify([ctx.user.id, input.projectId, input.requestId]),
            )
            .digest("hex");
        const metadata = {
          scopeHash: current.scopeHash,
          caseHash: architectureCaseFingerprint(
            current.definitions.find((c) => c.id === input.caseId)!,
          ),
          documentHash: current.document.hash,
          caseId: input.caseId,
          elementId: input.elementId,
          decision: input.decision,
        };
        const previous = await tx.auditLog.findUnique({ where: { id } });
        if (previous) {
          const old = previous.metadata as Prisma.JsonObject;
          if (
            Object.entries(metadata).some(([key, value]) => old[key] !== value)
          )
            throw new TRPCError({ code: "CONFLICT" });
          return { saved: true };
        }
        await tx.auditLog.create({
          data: {
            id,
            organizationId: current.project.organizationId,
            projectId: input.projectId,
            actorId: ctx.user.id,
            entityType: "ArchitectureMappingDecision",
            entityId: current.document.hash,
            action: "CREATE",
            summary:
              "Reviewed architecture-to-case traceability; no case procedure changed",
            metadata: {
              ...metadata,
              revision:
                (await tx.auditLog.count({
                  where: {
                    organizationId: current.project.organizationId,
                    projectId: input.projectId,
                    entityType: "ArchitectureMappingDecision",
                    entityId: current.document.hash,
                  },
                })) + 1,
            },
          },
        });
        return { saved: true };
      });
    }),
});
