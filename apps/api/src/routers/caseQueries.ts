import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { protectedProcedure, requireProjectAccess, router } from "../trpc.js";
import { caseQuerySchema } from "../services/caseQuerySchema.js";
import { queryCasePage } from "../services/caseQuery.js";
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
