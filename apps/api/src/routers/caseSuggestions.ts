import { z } from "zod";
import { smartCaseSchema } from "@vaettir/ai-agent";
import { router, protectedProcedure } from "../trpc.js";
import { suggestionScopeSchema, suggestionSelectionSchema, smartMapping, smartRecommendations, applySmartRecommendations, smartSuggestionConfiguration } from "../services/smartCaseSuggestions.js";
import { parseXlsxWorkbookIsolated } from "../services/xlsxImportIsolation.js";
import { XLSX_MAX_BASE64_CHARACTERS } from "../services/xlsxImportLimits.js";
import { requireProjectAccess } from "../trpc.js";
import { TRPCError } from "@trpc/server";
const scope = suggestionScopeSchema.extend({ requestId: z.string().uuid(), approved: z.literal(true) });
const analysis = scope.extend({ expectedPolicyVersion: z.number().int().positive() });
export const caseSuggestionsRouter = router({
  configuration: protectedProcedure.input(suggestionScopeSchema.strict())
    .query(({ ctx, input }) => smartSuggestionConfiguration(ctx.prisma, ctx.user.id, ctx.authenticatedClerkSubject, input)),
  mapping: protectedProcedure.input(analysis.extend({ csvText: z.string().min(1).max(1024 * 1024).optional(), fileBase64: z.string().min(1).max(XLSX_MAX_BASE64_CHARACTERS).optional(), sheetName: z.string().min(1).max(200).optional() }).strict()
    .refine(v => Boolean(v.csvText) !== Boolean(v.fileBase64) && Boolean(v.fileBase64) === Boolean(v.sheetName), "Choose a CSV snapshot or one workbook tab."))
    .mutation(async ({ ctx, input, signal }) => {
      let csvText = input.csvText;
      if (!csvText) {
        await requireProjectAccess(ctx, input.projectId, "EDITOR");
        const sheets = await parseXlsxWorkbookIsolated(Buffer.from(input.fileBase64!, "base64"), signal, JSON.stringify([ctx.authenticatedClerkSubject, ctx.user.id, input.originalOrganizationId, input.projectId]));
        csvText = sheets.find(s => s.name === input.sheetName)?.csvText ?? undefined;
        if (!csvText) throw new TRPCError({ code: "BAD_REQUEST", message: "This workbook tab has no recognized header. Review its source before analysis." });
      }
      return smartMapping(ctx.prisma, ctx.user.id, ctx.authenticatedClerkSubject, { ...input, csvText }, signal);
    }),
  recommend: protectedProcedure.input(analysis.extend({ cases: z.array(smartCaseSchema).min(1).max(20).optional(), caseIds: z.array(z.string().min(1).max(200)).min(1).max(20).optional() }).strict()
    .refine(v => Boolean(v.cases) !== Boolean(v.caseIds), "Choose imported definitions or existing cases, not both.")
    .refine(v => !v.caseIds || new Set(v.caseIds).size === v.caseIds.length, "Choose distinct cases."))
    .mutation(({ ctx, input, signal }) => smartRecommendations(ctx.prisma, ctx.user.id, ctx.authenticatedClerkSubject, input, signal)),
  applyReviewed: protectedProcedure.input(scope.extend({ reviewIds: z.array(z.string().uuid()).min(1).max(10).refine(ids => new Set(ids).size === ids.length), selections: suggestionSelectionSchema }).strict())
    .mutation(({ ctx, input }) => applySmartRecommendations(ctx.prisma, ctx.user.id, ctx.authenticatedClerkSubject, input)),
});
