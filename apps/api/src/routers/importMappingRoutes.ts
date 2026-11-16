import { TRPCError } from "@trpc/server";
import { z } from "@vaettir/core/dist/validation.js";
import { protectedProcedure, requireProjectAccess, type Context } from "../trpc.js";
import { mappingSheetSchema, planMappingSheets } from "../services/importMappingPlan.js";
import { mappingScopeSchema, mappingBatchInput, mappingConfirmInput, mappingResolveInput,
  stageMappingBatch, confirmMappingBatch, cancelMappingBatch, readMappingQueue, listMappingQueues } from "../services/importMappingQueue.js";
import { parseXlsxWorkbookIsolated } from "../services/xlsxImportIsolation.js";
import { XLSX_MAX_BASE64_CHARACTERS } from "../services/xlsxImportLimits.js";

function actor(ctx: { user: { id: string }; authenticatedClerkSubject?: string | null; authenticatedApiKeyId?: string | null }) {
  if (!ctx.authenticatedClerkSubject || ctx.authenticatedApiKeyId) throw new TRPCError({ code: "FORBIDDEN", message: "Sign in to manage an import." });
  return { id: ctx.user.id, clerkActorId: ctx.authenticatedClerkSubject };
}
async function authorizedActor(ctx: Context & { user: NonNullable<Context["user"]> }, input: z.infer<typeof mappingScopeSchema>) {
  const originalActor = actor(ctx);
  const access = await requireProjectAccess(ctx, input.projectId, "EDITOR");
  if (access.project.organizationId !== input.originalOrganizationId || originalActor.clerkActorId !== input.expectedClerkActorId)
    throw new TRPCError({ code: "FORBIDDEN", message: "Restore the original project and account." });
  return originalActor;
}
const upload = mappingScopeSchema.extend({ requestId: z.string().uuid(), sourceLabel: z.string().max(1000),
  source: z.discriminatedUnion("format", [
    z.object({ format: z.literal("CSV"), sheets: z.array(mappingSheetSchema).length(1) }).strict(),
    z.object({ format: z.literal("SHEETS"), sheets: z.array(mappingSheetSchema).min(1).max(20) }).strict(),
    z.object({ format: z.literal("XLSX"), fileBase64: z.string().min(1).max(XLSX_MAX_BASE64_CHARACTERS),
      sheets: z.array(mappingSheetSchema.omit({ csvText: true, originalRowNumbers: true, source: true })).min(1).max(20),
    }).strict(),
  ]),
}).strict();

export const importMappingProcedures = {
  prepareMapping: protectedProcedure.input(upload).mutation(async ({ ctx, input, signal }) => {
    const originalActor = await authorizedActor(ctx, input);
    try {
      let sheets;
      if (input.source.format === "XLSX") {
        const workbook = await parseXlsxWorkbookIsolated(Buffer.from(input.source.fileBase64, "base64"), signal,
          JSON.stringify([originalActor, input.projectId, input.originalOrganizationId]));
        sheets = input.source.sheets.map(selection => {
          const sheet = workbook.find(s => s.name === selection.name);
          if (!sheet?.csvText) throw new Error("A selected worksheet has no recognizable header. Choose a header or export that table as CSV.");
          return { ...selection, csvText: sheet.csvText, originalRowNumbers: sheet.originalRowNumbers };
        });
      } else sheets = input.source.sheets;
      const planned = planMappingSheets(sheets, input.source.format);
      if (signal?.aborted) throw new Error("Import cancelled.");
      return await stageMappingBatch(ctx.prisma, originalActor, input, {
        requestId: input.requestId, sourceLabel: input.sourceLabel, sourceDigest: planned.digest, rows: planned.rows,
      });
    } catch (error) {
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: "BAD_REQUEST", message: error instanceof Error && error.name !== "ZodError" ? error.message : "Check source fields and import limits." });
    }
  }),
  confirmMapping: protectedProcedure.input(mappingConfirmInput).mutation(async ({ ctx, input }) => confirmMappingBatch(ctx.prisma, await authorizedActor(ctx, input), input)),
  cancelMapping: protectedProcedure.input(mappingConfirmInput).mutation(async ({ ctx, input }) => cancelMappingBatch(ctx.prisma, await authorizedActor(ctx, input), input)),
  resolveMapping: protectedProcedure.input(mappingResolveInput).mutation(async ({ ctx, input }) => confirmMappingBatch(ctx.prisma, await authorizedActor(ctx, input), input)),
  mappingQueue: protectedProcedure.input(mappingBatchInput).query(async ({ ctx, input }) => readMappingQueue(ctx.prisma, await authorizedActor(ctx, input), input)),
  mappingQueues: protectedProcedure.input(mappingScopeSchema).query(async ({ ctx, input }) => listMappingQueues(ctx.prisma, await authorizedActor(ctx, input), input)),
};
