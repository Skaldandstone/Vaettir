import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockCaseFieldReadScope, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";

const scope = z.object({ projectId: z.string().min(1).max(200), caseId: z.string().min(1).max(200), originalOrganizationId: z.string().min(1).max(200), expectedClerkActorId: z.string().min(1).max(200) });
export const commentBodySchema = z.string().trim().min(1).max(4000)
  .refine(body => !body.includes("\0"), "Comments cannot contain null characters.");
export const commentCreateInput = scope.extend({ requestId: z.string().uuid(), body: commentBodySchema }).strict();
export const commentListInput = scope.extend({
  cursor: z.object({ createdAt: z.union([z.date(), z.string().datetime({ offset: true }).transform(value => new Date(value))]).pipe(z.date()), id: z.string().uuid() }).strict().optional(),
  limit: z.number().int().min(1).max(50).default(25),
}).strict();
export const commentOutput = z.object({
  id: z.string().uuid(), body: z.string().max(4000), createdAt: z.date(),
  authorName: z.string().max(200), isOwn: z.boolean(),
});
type CommentRow = { id: string; body: string; createdAt: Date; authorName: string; isOwn: boolean };
const transactionOptions = { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead, timeout: 10000, maxWait: 5000 };

// Native bound parameters keep text out of SQL syntax. Queries are intentionally
// narrow, so this additive source does not require overwriting generated clients.
export async function listCaseComments(db: PrismaClient, userId: string, input: z.input<typeof commentListInput>, authorized: CaseFieldReadAuthorization) {
  const parsed = commentListInput.parse(input);
  return db.$transaction(async tx => {
    const readScope = await lockCaseFieldReadScope(tx, userId, parsed, authorized);
    const after = parsed.cursor ? Prisma.sql`AND (c."createdAt", c.id) < (${parsed.cursor.createdAt}, ${parsed.cursor.id})` : Prisma.empty;
    const rows = await tx.$queryRaw<CommentRow[]>(Prisma.sql`
      SELECT c.id, c.body, c."createdAt", coalesce(nullif(left(u.name,200),''),'Workspace member') AS "authorName", (c."authorId"=${userId}) AS "isOwn"
      FROM "CaseComment" c JOIN "User" u ON u.id=c."authorId"
      WHERE c."organizationId"=${readScope.organizationId} AND c."projectId"=${parsed.projectId} AND c."caseId"=${parsed.caseId} ${after}
      ORDER BY c."createdAt" DESC,c.id DESC LIMIT ${parsed.limit + 1}`);
    const items = rows.slice(0, parsed.limit).map(item => commentOutput.parse(item));
    const last = items.at(-1);
    return { projectId: parsed.projectId, caseId: parsed.caseId, readScope, items, nextCursor: rows.length > parsed.limit && last ? { id: last.id, createdAt: last.createdAt } : null };
  }, transactionOptions);
}

export async function createCaseComment(db: PrismaClient, userId: string, input: z.input<typeof commentCreateInput>, authorized: CaseFieldReadAuthorization) {
  const parsed = commentCreateInput.parse(input);
  return db.$transaction(async tx => {
    // This lock intentionally allows current READ_ONLY membership for comments,
    // without upgrading their seat or permitting case/body/approval mutations.
    const readScope = await lockCaseFieldReadScope(tx, userId, parsed, authorized);
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "CaseComment" (id,"organizationId","projectId","caseId","authorId","requestId",body)
      VALUES (${randomUUID()},${readScope.organizationId},${parsed.projectId},${parsed.caseId},${userId},${parsed.requestId},${parsed.body})
      ON CONFLICT ("projectId","caseId","authorId","requestId") DO NOTHING`);
    const [saved] = await tx.$queryRaw<CommentRow[]>(Prisma.sql`
      SELECT c.id,c.body,c."createdAt",coalesce(nullif(left(u.name,200),''),'Workspace member') AS "authorName",true AS "isOwn"
      FROM "CaseComment" c JOIN "User" u ON u.id=c."authorId"
      WHERE c."organizationId"=${readScope.organizationId} AND c."projectId"=${parsed.projectId} AND c."caseId"=${parsed.caseId} AND c."authorId"=${userId} AND c."requestId"=${parsed.requestId}`);
    if (!saved || saved.body !== parsed.body) throw new TRPCError({ code: "CONFLICT", message: "This comment request already has different text. Retry the original comment before starting another." });
    return { ...commentOutput.parse(saved), requestId: parsed.requestId };
  }, transactionOptions);
}
