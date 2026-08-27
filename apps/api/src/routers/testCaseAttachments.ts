import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router, protectedProcedure, requireProjectAccess } from "../trpc.js";
import { buildTestCaseAttachmentKey, createGenericUploadUrl, createViewUrl, canonicalUrl, keyFromCanonicalUrl } from "../services/artifactStorage.js";

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
      }));
    }),

  // Two-step upload, same shape as P5-15's requestArtifactUpload: the
  // caller PUTs bytes straight to the presigned URL, then this row is
  // already recorded and immediately listable - the client doesn't need
  // a second "confirm" call.
  requestUpload: protectedProcedure
    .input(z.object({ testCaseId: z.string(), fileName: z.string().min(1), contentType: z.string().min(1), sizeBytes: z.number().positive() }))
    .output(z.object({ attachmentId: z.string(), uploadUrl: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const tc = await ctx.prisma.testCase.findUniqueOrThrow({ where: { id: input.testCaseId }, select: { projectId: true } });
      await requireProjectAccess(ctx, tc.projectId, "EDITOR");
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
    await ctx.prisma.testCaseAttachment.delete({ where: { id: input.attachmentId } });
    return { deleted: true };
  }),
});
