import { z } from "zod";
import { protectedProcedure, router } from "../trpc.js";
import {
  approvedFolderChangeSchema,
  folderChangeSchema,
} from "../services/caseFolderSchema.js";
import {
  listCaseFolders,
  previewCaseFolderChange,
  writeCaseFolderChange,
} from "../services/caseFolders.js";
import {
  approvedFolderRecoverySchema,
  folderRecoveryInputSchema,
} from "../services/caseFolderRecoverySchema.js";
import {
  listRecoverableFolderChanges,
  previewFolderRecovery,
  writeFolderRecovery,
  readRecoverableFolderCatalog,
} from "../services/caseFolderRecovery.js";
import {
  folderCopyReviewSchema,
  folderCopyApprovalSchema,
} from "../services/caseFolderCopySchema.js";
import {
  previewFolderCopy,
  writeFolderCopy,
} from "../services/caseFolderCopy.js";
export const caseFoldersRouter = router({
  copyPreview: protectedProcedure
    .input(folderCopyReviewSchema)
    .query(({ ctx, input }) =>
      previewFolderCopy(ctx.prisma, ctx.user.id, input),
    ),
  copyWrite: protectedProcedure
    .input(folderCopyApprovalSchema)
    .mutation(({ ctx, input }) =>
      writeFolderCopy(ctx.prisma, ctx.user.id, input),
    ),
  recoveryOptions: protectedProcedure
    .input(z.object({ projectId: z.string().min(1).max(200) }).strict())
    .query(({ ctx, input }) =>
      listRecoverableFolderChanges(ctx.prisma, ctx.user.id, input.projectId),
    ),
  recoveryCatalog: protectedProcedure
    .input(z.object({ projectId: z.string().min(1).max(200) }).strict())
    .query(({ ctx, input }) =>
      readRecoverableFolderCatalog(ctx.prisma, ctx.user.id, input.projectId),
    ),
  recoveryPreview: protectedProcedure
    .input(folderRecoveryInputSchema)
    .query(({ ctx, input }) =>
      previewFolderRecovery(ctx.prisma, ctx.user.id, input),
    ),
  recoveryWrite: protectedProcedure
    .input(approvedFolderRecoverySchema)
    .mutation(({ ctx, input }) =>
      writeFolderRecovery(ctx.prisma, ctx.user.id, input),
    ),
  list: protectedProcedure
    .input(z.object({ projectId: z.string().min(1).max(200) }))
    .query(({ ctx, input }) =>
      listCaseFolders(ctx.prisma, ctx.user.id, input.projectId),
    ),
  preview: protectedProcedure
    .input(folderChangeSchema)
    .query(({ ctx, input }) =>
      previewCaseFolderChange(ctx.prisma, ctx.user.id, input),
    ),
  write: protectedProcedure
    .input(approvedFolderChangeSchema)
    .mutation(({ ctx, input }) =>
      writeCaseFolderChange(ctx.prisma, ctx.user.id, input),
    ),
});
