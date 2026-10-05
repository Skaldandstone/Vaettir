import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { protectedProcedure, router } from "../trpc.js";
import { testCasesRouter } from "./testCases.js";
import { testDesignRouter } from "./testDesign.js";
import {
  analysisAccess,
  analysisBaseline,
  analysisHash,
  analysisScoped,
  costFor,
  ownedAnalysis,
  readAnalysis,
  unchangedAnalysisCase,
} from "../services/caseAnalysisQueue.js";
import {
  caseAnalysisApprovalSchema,
  caseAnalysisSelectionSchema,
  caseAnalysisJobInputSchema,
  caseAnalysisRequestSchema,
  caseAnalysisReadInputSchema,
  caseAnalysisMineSchema,
} from "../services/caseAnalysisQueueSchema.js";
import { getAiCreditBalance } from "../services/aiCredits.js";

export const caseAnalysisQueueRouter = router({
  review: protectedProcedure
    .input(caseAnalysisSelectionSchema)
    .mutation(async ({ ctx, input }) => {
      const ids = [...input.ids].sort();
      const selection = [input.projectId, input.action, ids];
      const selectionHash = analysisHash(
        analysisScoped(input)
          ? {
              selection,
              originalOrganizationId: input.originalOrganizationId,
              expectedClerkActorId: input.expectedClerkActorId,
            }
          : selection,
      );
      const access = await ctx.prisma.$transaction((tx) =>
        analysisAccess(
          tx,
          input.projectId,
          ctx.user.id,
          false,
          undefined,
          input,
          ctx.user.clerkUserId,
        ),
      );
      const prior = await ctx.prisma.caseAnalysisQueue.findUnique({
        where: {
          projectId_requestedById_requestId: {
            projectId: input.projectId,
            requestedById: ctx.user.id,
            requestId: input.requestId,
          },
        },
      });
      if (prior) {
        if (prior.selectionHash !== selectionHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This request ID already belongs to a different reviewed scope.",
          });
        return readAnalysis(
          ctx.prisma,
          input.projectId,
          ctx.user.id,
          prior.id,
          0,
          input,
          ctx.user.clerkUserId,
        );
      }
      const risk = testCasesRouter.createCaller(ctx),
        design = testDesignRouter.createCaller(ctx);
      const items: Prisma.CaseAnalysisQueueItemCreateWithoutQueueInput[] = [];
      for (const [position, caseId] of ids.entries()) {
        const baseline = await analysisBaseline(
          ctx.prisma,
          input.projectId,
          caseId,
        );
        let inputHash: string, status: string;
        if (input.action === "RISK") {
          const preview = await risk.riskPreview({ id: caseId });
          inputHash = preview.inputHash;
          status =
            preview.savedStatus === "READY"
              ? "SAVED"
              : preview.savedStatus
                ? "UNKNOWN"
                : preview.alreadyAssessed
                  ? "SKIPPED"
                  : "QUEUED";
        } else {
          const preview = await design.preview({ id: caseId });
          inputHash = preview.inputHash;
          const saved = await ctx.prisma.testDesignReview.findUnique({
            where: { testCaseId_inputHash: { testCaseId: caseId, inputHash } },
            select: { status: true },
          });
          status =
            saved?.status === "READY" ? "SAVED" : saved ? "UNKNOWN" : "QUEUED";
        }
        items.push({
          ...baseline,
          position,
          inputHash,
          status,
          maximumCredits: status === "QUEUED" ? costFor(input.action) : 0,
          reason:
            status === "UNKNOWN"
              ? "An earlier paid request needs reconciliation; it will not be retried."
              : status === "SKIPPED"
                ? "Existing human or imported risk assessment preserved."
                : null,
        });
      }
      const maximumCredits = items.reduce(
        (sum, i) => sum + i.maximumCredits,
        0,
      );
      const scopeHash = analysisHash({
        ...(analysisScoped(input)
          ? {
              originalOrganizationId: input.originalOrganizationId,
              expectedClerkActorId: input.expectedClerkActorId,
            }
          : {}),
        projectId: input.projectId,
        actorId: ctx.user.id,
        action: input.action,
        maximumCredits,
        items,
      });
      const job = await ctx.prisma
        .$transaction(
          async (tx) => {
            await analysisAccess(
              tx,
              input.projectId,
              ctx.user.id,
              false,
              access.organizationId,
              input,
              ctx.user.clerkUserId,
            );
            return tx.caseAnalysisQueue.create({
              data: {
                projectId: input.projectId,
                organizationId: access.organizationId,
                requestedById: ctx.user.id,
                requestId: input.requestId,
                selectionHash,
                scopeHash,
                action: input.action,
                maximumCredits,
                caseCount: ids.length,
                items: { create: items },
              },
            });
          },
          { timeout: 15000 },
        )
        .catch(async (error) => {
          if (
            !(error instanceof Prisma.PrismaClientKnownRequestError) ||
            error.code !== "P2002"
          )
            throw error;
          const recovered =
            await ctx.prisma.caseAnalysisQueue.findUniqueOrThrow({
              where: {
                projectId_requestedById_requestId: {
                  projectId: input.projectId,
                  requestedById: ctx.user.id,
                  requestId: input.requestId,
                },
              },
            });
          if (recovered.selectionHash !== selectionHash)
            throw new TRPCError({
              code: "CONFLICT",
              message: "The request ID belongs to another scope.",
            });
          return recovered;
        });
      return readAnalysis(
        ctx.prisma,
        input.projectId,
        ctx.user.id,
        job.id,
        0,
        input,
        ctx.user.clerkUserId,
      );
    }),
  approve: protectedProcedure
    .input(caseAnalysisApprovalSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(
        async (tx) => {
          const { job } = await ownedAnalysis(
            tx,
            input.projectId,
            ctx.user.id,
            input.id,
            true,
            input,
            ctx.user.clerkUserId,
          );
          if (
            job.scopeHash !== input.scopeHash ||
            job.maximumCredits !== input.maximumCredits
          )
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "Review the exact saved scope and maximum before approving.",
            });
          if (job.approvedAt) return;
          if (job.status !== "REVIEW" || job.cancelledAt)
            throw new TRPCError({
              code: "CONFLICT",
              message: "This scope is no longer awaiting approval.",
            });
          const items = await tx.caseAnalysisQueueItem.findMany({
            where: { queueId: job.id, status: "QUEUED" },
            orderBy: { position: "asc" },
          });
          for (const item of items)
            if (!(await unchangedAnalysisCase(tx, job, item)))
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "A selected case changed. Create and review a new scope.",
              });
          if (
            (await getAiCreditBalance(
              tx as unknown as typeof ctx.prisma,
              job.organizationId,
            )) < job.maximumCredits
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "The current credit balance cannot cover this approved maximum.",
            });
          await tx.caseAnalysisQueue.update({
            where: { id: job.id },
            data: {
              approvedAt: new Date(),
              status: items.length ? "QUEUED" : "COMPLETE",
            },
          });
        },
        { timeout: 30000 },
      );
      return readAnalysis(
        ctx.prisma,
        input.projectId,
        ctx.user.id,
        input.id,
        0,
        input,
        ctx.user.clerkUserId,
      );
    }),
  byId: protectedProcedure
    .input(caseAnalysisReadInputSchema)
    .query(({ ctx, input }) =>
      readAnalysis(
        ctx.prisma,
        input.projectId,
        ctx.user.id,
        input.id,
        input.offset,
        input,
        ctx.user.clerkUserId,
      ),
    ),
  mine: protectedProcedure
    .input(caseAnalysisMineSchema)
    .query(({ ctx, input }) =>
      ctx.prisma.$transaction(async (tx) => {
        const access = await analysisAccess(
          tx,
          input.projectId,
          ctx.user.id,
          false,
          undefined,
          input,
          ctx.user.clerkUserId,
        );
        const items = await tx.caseAnalysisQueue.findMany({
          where: {
            projectId: input.projectId,
            organizationId: access.organizationId,
            requestedById: ctx.user.id,
          },
          select: {
            id: true,
            action: true,
            status: true,
            caseCount: true,
            maximumCredits: true,
            createdAt: true,
          },
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: 20,
        });
        return access.scope ? { scope: access.scope, items } : items;
      }),
    ),
  cancel: protectedProcedure
    .input(caseAnalysisJobInputSchema)
    .mutation(async ({ ctx, input }) => {
      await ctx.prisma.$transaction(async (tx) => {
        const { job } = await ownedAnalysis(
          tx,
          input.projectId,
          ctx.user.id,
          input.id,
          false,
          input,
          ctx.user.clerkUserId,
        );
        if (job.status === "COMPLETE") return;
        await tx.caseAnalysisQueue.update({
          where: { id: job.id },
          data: {
            status: "CANCELLED",
            cancelledAt: job.cancelledAt ?? new Date(),
            reason:
              "Cancelled. Already charged work may finish and is not refunded by cancellation.",
          },
        });
        await tx.caseAnalysisQueueItem.updateMany({
          where: { queueId: job.id, status: "QUEUED" },
          data: {
            status: "SKIPPED",
            reason: "Cancelled before claim; no credits spent.",
            completedAt: new Date(),
          },
        });
      });
      return readAnalysis(
        ctx.prisma,
        input.projectId,
        ctx.user.id,
        input.id,
        0,
        input,
        ctx.user.clerkUserId,
      );
    }),
  requestAdmin: protectedProcedure
    .input(caseAnalysisRequestSchema)
    .mutation(({ ctx, input }) =>
      ctx.prisma.$transaction(async (tx) => {
        const { job, scope } = await ownedAnalysis(
          tx,
          input.projectId,
          ctx.user.id,
          input.id,
          false,
          input,
          ctx.user.clerkUserId,
        );
        const dedupeKey = analysisHash([
          "durable-analysis",
          job.organizationId,
          job.requestedById,
          job.scopeHash,
        ]);
        const echo = scope
          ? {
              scope,
              queueId: job.id,
              scopeHash: job.scopeHash,
              maximumCredits: job.maximumCredits,
            }
          : {};
        // New scoped native clients may recover an acknowledged original
        // request even if another tab subsequently approved/cancelled its job.
        // Current scope is locked first; changed human reasons never overwrite.
        if (scope) {
          const receipt = await tx.aiCreditUseRequest.findUnique({
            where: { dedupeKey },
          });
          if (receipt) {
            if (
              receipt.reason !== input.reason ||
              receipt.organizationId !== scope.organizationId ||
              receipt.requestedById !== scope.actorId ||
              receipt.projectId !== input.projectId
            )
              throw new TRPCError({
                code: "CONFLICT",
                message:
                  "Keep the exact original administrator request and reason.",
              });
            return { id: receipt.id, status: receipt.status, ...echo };
          }
        }
        if (job.status !== "REVIEW")
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "Only a reviewed unapproved scope can request administrator help.",
          });
        const ids = (
          await tx.caseAnalysisQueueItem.findMany({
            where: { queueId: job.id, status: "QUEUED" },
            orderBy: { position: "asc" },
            select: { caseId: true },
          })
        ).map((i) => i.caseId);
        if (!ids.length)
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "No new paid work requires approval.",
          });
        const prior = await tx.aiCreditUseRequest.findUnique({
          where: { dedupeKey },
        });
        if (prior) return { id: prior.id, status: prior.status, ...echo };
        const created = await tx.aiCreditUseRequest.create({
          data: {
            organizationId: job.organizationId,
            projectId: job.projectId,
            requestedById: job.requestedById,
            action: job.action,
            caseIds: ids,
            caseCount: ids.length,
            estimatedCredits: job.maximumCredits,
            reason: input.reason,
            dedupeKey,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: job.organizationId,
            projectId: job.projectId,
            actorId: ctx.user.id,
            entityType: "AiCreditUseRequest",
            entityId: created.id,
            action: "CREATE",
            summary: `Requested administrator help for reviewed analysis of ${ids.length} cases`,
            metadata: { queueId: job.id, maximumCredits: job.maximumCredits },
          },
        });
        return { id: created.id, status: created.status, ...echo };
      }),
    ),
});
