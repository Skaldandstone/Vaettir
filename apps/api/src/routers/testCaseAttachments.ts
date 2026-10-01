import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { buildTestCaseAttachmentKey, createGenericUploadUrl, createViewUrl, canonicalUrl, keyFromCanonicalUrl, verifyStoredAttachment } from "../services/artifactStorage.js";
import { requireCurrentPlanAccess } from "../services/testPlanExecution.js";

const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024; // 25MB - generous for a mockup/log/doc, not a video

// 2026-08-27 competitor parity audit: attachments on the test case's own
// authoring record - every competitor researched supports this. Same
// presigned-both-ways pattern P5-15 already proved out for run evidence:
// the API server never touches the actual file bytes either way.
export const testCaseAttachmentsRouter = router({
  list: protectedProcedure
    .input(z.object({ testCaseId: z.string() }))
    .output(
      z.array(
        z.object({
          id: z.string(),
          fileName: z.string(),
          contentType: z.string(),
          sizeBytes: z.number(),
          uploadedByEmail: z.string().nullable(),
          createdAt: z.date(),
          uploadCompletedAt: z.date().nullable(),
        }),
      ),
    )
    .query(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, tc.projectId);
      const attachments = await ctx.prisma.testCaseAttachment.findMany({
        where: { testCaseId: input.testCaseId },
        include: { uploadedBy: { select: { email: true } } },
        orderBy: { createdAt: "desc" },
      });
      return attachments.map((a) => ({
        id: a.id,
        fileName: a.fileName,
        contentType: a.contentType,
        sizeBytes: a.sizeBytes,
        uploadedByEmail: a.uploadedBy?.email ?? null,
        createdAt: a.createdAt,
        uploadCompletedAt: a.uploadCompletedAt,
      }));
    }),

  // Request, PUT, then confirm. A request row is not verified evidence.
  requestUpload: protectedProcedure
    .input(z.object({ testCaseId: z.string(), fileName: z.string().min(1).max(255), contentType: z.string().min(1).max(200), sizeBytes: z.number().int().positive() }))
    .output(z.object({ attachmentId: z.string(), uploadUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, tc.projectId, "EDITOR");
      await requireCurrentPlanAccess(ctx.prisma, ctx.user.id, tc.projectId, true);
      if (input.sizeBytes > MAX_ATTACHMENT_BYTES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Attachment too large: ${Math.round(input.sizeBytes / 1024 / 1024)}MB (max 25MB)`,
        });
      }

      const key = buildTestCaseAttachmentKey(tc.projectId, input.testCaseId, input.fileName);
      const [uploadUrl, attachment] = await Promise.all([
        createGenericUploadUrl(key, input.contentType),
        ctx.prisma.testCaseAttachment.create({
          data: {
            testCaseId: input.testCaseId,
            fileName: input.fileName,
            contentType: input.contentType,
            sizeBytes: input.sizeBytes,
            storageUrl: canonicalUrl(key),
            uploadedById: ctx.user.id,
          },
        }),
      ]);

      return { attachmentId: attachment.id, uploadUrl };
    }),

  confirmUpload: protectedProcedure
    .input(z.object({ attachmentId: z.string().min(1).max(200) }))
    .output(z.object({ attachmentId: z.string(), uploadCompletedAt: z.date() }))
    .mutation(async ({ ctx, input }) => {
      const attachment = await ctx.prisma.testCaseAttachment.findUniqueOrThrow({
        where: { id: input.attachmentId },
        include: { testCase: { select: { projectId: true } } },
      });
      const projectId = attachment.testCase.projectId;
      await requireProjectAccess(ctx, projectId, "EDITOR");
      await requireCurrentPlanAccess(ctx.prisma, ctx.user.id, projectId, true);
      if (attachment.uploadCompletedAt)
        return { attachmentId: attachment.id, uploadCompletedAt: attachment.uploadCompletedAt };
      let verification;
      try {
        verification = await verifyStoredAttachment(keyFromCanonicalUrl(attachment.storageUrl), attachment);
      } catch (cause) {
        const message = cause instanceof Error && cause.message === "Stored file size or type does not match the upload. Upload the file again."
          ? cause.message : "Stored file could not be verified. Retry verification after the upload completes.";
        throw new TRPCError({ code: "BAD_REQUEST", message });
      }
      return ctx.prisma.$transaction(async tx => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))::text`;
        await requireCurrentPlanAccess(tx, ctx.user.id, projectId, true);
        const current = await tx.testCaseAttachment.findFirst({
          where: { id: input.attachmentId, testCase: { projectId } },
        });
        if (!current || current.storageUrl !== attachment.storageUrl || current.sizeBytes !== attachment.sizeBytes || current.contentType !== attachment.contentType)
          throw new TRPCError({ code: "CONFLICT", message: "The file record changed. Refresh before verifying it." });
        const confirmed = current.uploadCompletedAt ? current : await tx.testCaseAttachment.update({
          where: { id: current.id },
          data: { uploadCompletedAt: new Date(verification.verifiedAt), uploadVerification: verification },
        });
        return { attachmentId: confirmed.id, uploadCompletedAt: confirmed.uploadCompletedAt! };
      });
    }),

  getViewUrl: protectedProcedure
    .input(z.object({ attachmentId: z.string() }))
    .output(z.object({ viewUrl: z.string() }))
    .query(async ({ ctx, input }) => {
      const attachment = await ctx.prisma.testCaseAttachment.findUniqueOrThrow({
        where: { id: input.attachmentId },
        include: { testCase: { select: { projectId: true } } },
      });
      await requireProjectAccess(ctx, attachment.testCase.projectId);
      const viewUrl = await createViewUrl(keyFromCanonicalUrl(attachment.storageUrl));
      return { viewUrl };
    }),

  delete: protectedProcedure.input(z.object({ attachmentId: z.string() })).mutation(async ({ ctx, input }) => {
    const attachment = await ctx.prisma.testCaseAttachment.findUniqueOrThrow({
      where: { id: input.attachmentId },
      include: { testCase: { select: { projectId: true } } },
    });
    await requireProjectAccess(ctx, attachment.testCase.projectId, "EDITOR");
    await ctx.prisma.$transaction(async tx => {
      // The case editor uses the same project lock before replacing steps.
      // Do not leave a saved step pointing at a deleted image/video.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${attachment.testCase.projectId}))::text`;
      await requireCurrentPlanAccess(tx, ctx.user.id, attachment.testCase.projectId, true);
      const retained = await tx.manualStepResultRevision.count({ where: {
        evidenceAttachmentIds: { has: input.attachmentId },
      } });
      if (retained) throw new TRPCError({ code: "CONFLICT", message: "This file is retained by step execution history and cannot be deleted." });
      const frozenPattern = JSON.stringify({ caseDefinitions: [{ steps: [{ mediaAttachmentIds: [input.attachmentId] }] }] });
      const [frozen] = await tx.$queryRaw<{ retained: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM "TestRun"
          WHERE "projectId" = ${attachment.testCase.projectId}
          AND "executionContext" @> ${frozenPattern}::jsonb) AS retained`;
      if (frozen?.retained) throw new TRPCError({ code: "CONFLICT", message: "This file is retained by a saved run procedure and cannot be deleted." });
      const referenced = await tx.testCaseStep.count({ where: {
        testCaseId: attachment.testCaseId,
        mediaAttachmentIds: { has: input.attachmentId },
      } });
      if (referenced) throw new TRPCError({ code: "CONFLICT", message: "This file is linked to a test step. Unlink it from the step before deleting it." });
      await tx.testCaseAttachment.delete({ where: { id: input.attachmentId, testCaseId: attachment.testCaseId } });
    });
    return { deleted: true };
  }),
});
