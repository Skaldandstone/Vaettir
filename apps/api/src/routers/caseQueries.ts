import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { caseQuerySchema } from "../services/caseQuerySchema.js";
import { queryCasePage } from "../services/caseQuery.js";
import {
  savedCaseQueryWriteInput,
  savedCaseQueryCatalogInput,
  savedCaseQueryReadInput,
} from "../services/savedCaseQuerySchema.js";
import {
  withSavedQueryAccess,
  listSavedCaseQueries,
  getSavedCaseQuery,
  writeSavedCaseQuery,
} from "../services/savedCaseQueries.js";
export const caseQueryInput = z
  .object({
    projectId: z.string().min(1).max(120),
    query: caseQuerySchema,
    cursor: z.string().max(2048).optional(),
    requestId: z.string().uuid(),
  })
  .strict();
export function createCaseQueriesRouter(env: NodeJS.ProcessEnv = process.env) {
  return router({
    savedList: protectedProcedure
      .input(savedCaseQueryCatalogInput)
      .query(async ({ ctx, input }) => {
        const { project } = await requireProjectAccess(ctx, input.projectId, "VIEWER");
        return withSavedQueryAccess(
          ctx.prisma,
          input.projectId,
          ctx.user.id,
          project.organizationId,
          (tx, access) => listSavedCaseQueries(
            tx, access, input.projectId, input.offset,
            { catalog: input.catalog, expectedScope: input.expectedScope },
          ),
          ctx.user.clerkUserId,
        );
      }),
    savedById: protectedProcedure
      .input(savedCaseQueryReadInput)
      .query(async ({ ctx, input }) => {
        const { project } = await requireProjectAccess(ctx, input.projectId, "VIEWER");
        return withSavedQueryAccess(
          ctx.prisma,
          input.projectId,
          ctx.user.id,
          project.organizationId,
          (tx, access) => getSavedCaseQuery(
            tx, access, input.projectId, input.id, input.expectedScope,
          ),
          ctx.user.clerkUserId,
        );
      }),
    savedWrite: protectedProcedure
      .input(savedCaseQueryWriteInput)
      .mutation(async ({ ctx, input }) => {
        const { project } = await requireProjectAccess(ctx, input.projectId, "VIEWER");
        return withSavedQueryAccess(
          ctx.prisma,
          input.projectId,
          ctx.user.id,
          project.organizationId,
          (tx, access) => writeSavedCaseQuery(tx, access, input),
          ctx.user.clerkUserId,
        );
      }),
    page: protectedProcedure
      .input(caseQueryInput)
      .query(async ({ ctx, input }) => {
        const { project } = await requireProjectAccess(
          ctx,
          input.projectId,
          "VIEWER",
        );
        return ctx.prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${project.organizationId} FOR UPDATE`;
            await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${project.organizationId} AND "userId"=${ctx.user.id} FOR UPDATE`;
            const [member, org, parents] = await Promise.all([
              tx.membership.findUnique({
                where: {
                  organizationId_userId: {
                    organizationId: project.organizationId,
                    userId: ctx.user.id,
                  },
                },
                select: { id: true },
              }),
              tx.organization.findUnique({
                where: { id: project.organizationId },
                select: { suspendedAt: true },
              }),
              tx.$queryRaw<
                Array<{ organizationId: string }>
              >`SELECT "organizationId" FROM "Project" WHERE id=${input.projectId} FOR UPDATE`,
            ]);
            if (
              !member ||
              !org ||
              org.suspendedAt ||
              parents[0]?.organizationId !== project.organizationId
            )
              throw new TRPCError({ code: "FORBIDDEN" });
            await tx.$executeRaw(
              Prisma.sql`SET LOCAL statement_timeout = '8000ms'`,
            );
            return queryCasePage(
              tx,
              input,
              ctx.user.id,
              project.organizationId,
              env,
            );
          },
          { isolationLevel: "RepeatableRead", timeout: 20000 },
        );
      }),
  });
}
export const caseQueriesRouter = createCaseQueriesRouter();
