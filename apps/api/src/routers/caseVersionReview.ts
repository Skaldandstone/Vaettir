import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { requireCurrentPlanAccess } from "../services/testPlanExecution.js";
import { lockCaseFieldReadScope } from "../services/caseFieldReadScope.js";
import {
  previewCaseVersion,
  restoreCaseVersion,
  versionRestoreSchema,
  versionRestoreOutputSchema,
  compareHistoricalCaseVersions,
  versionListReadSchema,
  versionPreviewReadSchema,
  historicalComparisonReadSchema,
  versionPreviewReadOutputSchema,
  historicalComparisonReadOutputSchema,
  versionAccessReadSchema,
  versionReadContextSchema,
  readCaseVersionAccess,
  caseVersionReadContext,
  versionRestoreReviewedSchema,
  versionRestoreReviewedOutputSchema,
} from "../services/caseVersionReview.js";

export const caseVersionReviewRouter = router({
  list: protectedProcedure
    .input(versionListReadSchema)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return ctx.prisma.$transaction(
        async (tx) => {
          const scope = await lockCaseFieldReadScope(
            tx,
            ctx.user.id,
            {
              projectId: input.projectId,
              caseId: input.testCaseId,
              originalOrganizationId: input.originalOrganizationId,
              expectedClerkActorId: input.expectedClerkActorId,
            },
            { clerkActorId: ctx.user.clerkUserId },
          );
          await requireCurrentPlanAccess(tx, ctx.user.id, input.projectId);
          const tc = await tx.testCase.findFirst({
            where: { id: input.testCaseId, projectId: input.projectId },
            select: { id: true },
          });
          if (!tc)
            throw new TRPCError({
              code: "NOT_FOUND",
              message: "Case not found in this project.",
            });
          if (
            input.before &&
            !(await tx.testCaseVersion.findUnique({
              where: {
                testCaseId_versionNumber: {
                  testCaseId: tc.id,
                  versionNumber: input.before,
                },
              },
              select: { id: true },
            }))
          )
            throw new TRPCError({
              code: "BAD_REQUEST",
              message:
                "Version cursor is unavailable. Refresh the case changes.",
            });
          const rows = await tx.testCaseVersion.findMany({
            where: {
              testCaseId: tc.id,
              ...(input.before ? { versionNumber: { lt: input.before } } : {}),
            },
            orderBy: { versionNumber: "desc" },
            take: input.take + 1,
            select: {
              id: true,
              versionNumber: true,
              createdAt: true,
              createdBy: { select: { id: true, name: true, email: true } },
            },
          });
          const selected = rows.slice(0, input.take);
          const receipts = selected.length
            ? await tx.auditLog.findMany({
                where: {
                  projectId: input.projectId,
                  entityId: tc.id,
                  entityType: "TestCaseVersionRestore",
                  OR: selected.map((v) => ({
                    metadata: {
                      path: ["createdVersionNumber"],
                      equals: v.versionNumber,
                    },
                  })),
                },
                orderBy: { createdAt: "desc" },
                take: input.take,
                select: { metadata: true },
              })
            : [];
          const restoreReceipts = receipts
            .map((r) =>
              z
                .object({
                  createdVersionNumber: z.number(),
                  restoredVersionNumber: z.number(),
                  reason: z.string().max(1000),
                  fields: z.array(z.string()).max(11),
                })
                .safeParse(r.metadata),
            )
            .filter((r) => r.success)
            .map((r) => r.data);
          const latestRestore = await tx.auditLog.findFirst({
            where: {
              projectId: input.projectId,
              entityId: tc.id,
              entityType: {
                in: ["TestCaseVersionRestore", "TestCaseProcedureRestore"],
              },
            },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: { metadata: true, entityType: true },
          });
          const latestReceipt = latestRestore
            ? z
                .object({
                  createdVersionNumber: z.number().int().positive(),
                  restoredVersionNumber: z.number().int().positive(),
                })
                .safeParse(latestRestore.metadata)
            : null;
          const items = selected.map((v) => ({
            id: v.id,
            versionNumber: v.versionNumber,
            createdAt: v.createdAt.toISOString(),
            createdBy: v.createdBy
              ? {
                  id: v.createdBy.id,
                  label: (v.createdBy.name || v.createdBy.email).slice(0, 320),
                  source: "CURRENT_PROFILE" as const,
                }
              : null,
            restoration:
              restoreReceipts.find(
                (r) => r.createdVersionNumber === v.versionNumber,
              ) ?? null,
          }));
          return {
            ...(await caseVersionReadContext(tx, ctx.user.id, input, scope, {
              kind: "LIST",
              take: input.take,
              before: input.before ?? null,
            })),
            items,
            restorationNotice: latestRestore
              ? (latestRestore.entityType === "TestCaseProcedureRestore"
                  ? "A reviewed procedure snapshot restored selected case content. "
                  : latestReceipt?.success
                    ? `Version ${latestReceipt.data.createdVersionNumber} restored selected fields from version ${latestReceipt.data.restoredVersionNumber}. `
                    : "A restore audit is present with incomplete version metadata. ") +
                "That restore retained prior approval, risk/design assessments and paid drafts; it did not recertify them for the restored content. Review their current applicability."
              : null,
            nextCursor:
              rows.length > input.take
                ? items[items.length - 1]!.versionNumber
                : null,
          };
        },
        {
          isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
          timeout: 10000,
        },
      );
    }),
  preview: protectedProcedure
    .input(versionPreviewReadSchema)
    .output(versionPreviewReadOutputSchema)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return previewCaseVersion(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  compareHistorical: protectedProcedure
    .input(historicalComparisonReadSchema)
    .output(historicalComparisonReadOutputSchema)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return compareHistoricalCaseVersions(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  access: protectedProcedure
    .input(versionAccessReadSchema)
    .output(versionReadContextSchema)
    .query(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId);
      return readCaseVersionAccess(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
  restoreReviewed: protectedProcedure
    .input(versionRestoreReviewedSchema)
    .output(versionRestoreReviewedOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.request.projectId, "EDITOR");
      return restoreCaseVersion(
        ctx.prisma,
        ctx.user.id,
        input.request,
        { clerkActorId: ctx.user.clerkUserId },
        {
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
          expectedNativeActorId: input.expectedNativeActorId,
        },
      );
    }),
  restore: protectedProcedure
    .input(versionRestoreSchema)
    .output(versionRestoreOutputSchema)
    .mutation(async ({ ctx, input }) => {
      await requireProjectAccess(ctx, input.projectId, "EDITOR");
      return restoreCaseVersion(ctx.prisma, ctx.user.id, input, {
        clerkActorId: ctx.user.clerkUserId,
      });
    }),
});
