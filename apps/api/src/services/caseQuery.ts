import { createHash, hkdfSync } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { encryptToken, decryptToken } from "./tokenEncryption.js";
import {
  caseQuerySchema,
  type CaseQuery,
  type CaseQueryRule,
} from "./caseQuerySchema.js";
import {
  assertCustomQueryCompatibility,
  customQueryWhereSql,
  customQuerySortSql,
  customProjectionSql,
  type CaseCustomCell,
} from "./caseCustomQuery.js";

export const caseQueryHash = (query: CaseQuery) =>
  createHash("sha256")
    .update(JSON.stringify(caseQuerySchema.parse(query)))
    .digest("hex");
const cursorBody = z
  .object({
    purpose: z.literal("vaettir-case-query-v1"),
    actor: z.string(),
    organizationId: z.string(),
    projectId: z.string(),
    queryHash: z.string().length(64),
    watermark: z.string().datetime(),
    expiresAt: z.string().datetime(),
    anchor: z
      .object({ id: z.string(), updatedAt: z.string().datetime() })
      .strict()
      .nullable(),
  })
  .strict();
export type CaseQueryCursor = z.infer<typeof cursorBody>;
function cursorEnvironment(env: NodeJS.ProcessEnv) {
  const raw = env.PRODUCTION_SIGNAL_ENCRYPTION_KEY;
  if (!raw || Buffer.from(raw, "base64").length !== 32)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Case-query paging needs the platform encryption key configured. Contact the platform administrator.",
    });
  const key = Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(raw, "base64"),
      Buffer.from("vaettir-case-query-v1"),
      Buffer.from("cursor-only-not-provider-credentials"),
      32,
    ),
  );
  return { ...env, PRODUCTION_SIGNAL_ENCRYPTION_KEY: key.toString("base64") };
}
export function encodeCaseQueryCursor(
  body: CaseQueryCursor,
  env: NodeJS.ProcessEnv = process.env,
) {
  return Buffer.from(
    JSON.stringify(
      encryptToken(
        JSON.stringify(cursorBody.parse(body)),
        cursorEnvironment(env),
      ),
    ),
  ).toString("base64url");
}
export function decodeCaseQueryCursor(
  token: string,
  binding: {
    actor: string;
    organizationId: string;
    projectId: string;
    queryHash: string;
  },
  now: Date,
  env: NodeJS.ProcessEnv = process.env,
) {
  const encryption = cursorEnvironment(env);
  try {
    if (token.length > 2048 || !/^[-_a-zA-Z0-9]+$/.test(token))
      throw Error("Invalid cursor");
    const encrypted = z
      .object({
        ciphertext: z.string().max(1500),
        iv: z.string().max(30),
        authTag: z.string().max(30),
      })
      .strict()
      .parse(JSON.parse(Buffer.from(token, "base64url").toString("utf8")));
    const body = cursorBody.parse(
      JSON.parse(decryptToken(encrypted, encryption)),
    );
    for (const key of [
      "actor",
      "organizationId",
      "projectId",
      "queryHash",
    ] as const)
      if (body[key] !== binding[key]) throw Error("Wrong scope");
    if (
      Date.parse(body.expiresAt) <= now.getTime() ||
      Date.parse(body.watermark) > now.getTime() + 1000 ||
      Date.parse(body.expiresAt) - Date.parse(body.watermark) !== 15 * 60000
    )
      throw Error("Expired cursor");
    return body;
  } catch {
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "This query page is expired or belongs to different criteria. Run the query again.",
    });
  }
}
function ruleWhere(rule: CaseQueryRule): Prisma.TestCaseWhereInput {
  switch (rule.field) {
    case "custom":
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Custom criteria require the project-verified typed query path.",
      });
    case "title":
      return {
        title:
          rule.operator === "equals"
            ? { equals: rule.value, mode: "insensitive" }
            : {
                contains: rule.value.replace(/[\\%_]/g, "\\$&"),
                mode: "insensitive",
              },
      };
    case "displayId":
      return { displayId: { equals: rule.value, mode: "insensitive" } };
    case "tag":
      return { tags: { has: rule.value } };
    case "suite":
      return { suitePath: rule.operator === "unassigned" ? null : rule.value };
    case "priority":
      return { priority: rule.value };
    case "type":
      return { testType: rule.value };
    case "domain":
      return { validationDomain: rule.value };
    case "automation":
      return { automationStatus: rule.value };
    case "review":
      return { reviewStatus: rule.value };
    case "origin":
      return { origin: rule.value };
    case "riskScore":
      return {
        riskScore:
          rule.operator === "unassessed"
            ? null
            : rule.operator === "atLeast"
              ? { gte: rule.value }
              : { lte: rule.value },
      };
    case "flaky":
      return { isFlaky: rule.value };
  }
}
export function caseQueryWhere(
  projectId: string,
  query: CaseQuery,
  watermark: Date,
): Prisma.TestCaseWhereInput {
  const groups = query.groups.map((g) => ({
    [g.match === "all" ? "AND" : "OR"]: g.rules.map(ruleWhere),
  }));
  return {
    projectId,
    updatedAt: { lte: watermark },
    ...(query.archive === "all"
      ? {}
      : { archived: query.archive === "archived" }),
    ...(groups.length
      ? { [query.match === "all" ? "AND" : "OR"]: groups }
      : {}),
  };
}
export async function queryCasePage(
  tx: Prisma.TransactionClient,
  input: {
    projectId: string;
    query: CaseQuery;
    cursor?: string;
    requestId: string;
  },
  actor: string,
  organizationId: string,
  env: NodeJS.ProcessEnv = process.env,
) {
  const now = new Date(),
    queryHash = caseQueryHash(input.query),
    binding = { actor, organizationId, projectId: input.projectId, queryHash };
  const body: CaseQueryCursor = input.cursor
    ? decodeCaseQueryCursor(input.cursor, binding, now, env)
    : {
        purpose: "vaettir-case-query-v1",
        ...binding,
        watermark: now.toISOString(),
        expiresAt: new Date(now.getTime() + 15 * 60000).toISOString(),
        anchor: null,
      };
  // Establish key readiness before any metadata query; no per-process fallback.
  const pageCursor = encodeCaseQueryCursor(body, env);
  await assertCustomQueryCompatibility(tx, input.projectId, input.query);
  const hasCustomRules = input.query.groups.some((group) =>
    group.rules.some((rule) => rule.field === "custom"),
  );
  const where = hasCustomRules
    ? null
    : caseQueryWhere(input.projectId, input.query, new Date(body.watermark));
  const sqlWhere = customQueryWhereSql(
    input.projectId,
    input.query,
    new Date(body.watermark),
  );
  const sortSql = customQuerySortSql(input.query.sort);
  let sqlSeek = Prisma.sql`true`;
  if (body.anchor) {
    const anchor = hasCustomRules
      ? (
          await tx.$queryRaw<
            Array<{
              id: string;
              updatedAt: Date;
              sortValue: string | number | Date;
            }>
          >(Prisma.sql`
      SELECT id,"updatedAt",${sortSql} AS "sortValue" FROM "TestCase" WHERE ${sqlWhere} AND id=${body.anchor.id}
    `)
        )[0]
      : await tx.testCase.findFirst({
          where: { AND: [where!, { id: body.anchor.id }] },
          select: { id: true, updatedAt: true },
        });
    if (!anchor || anchor.updatedAt.toISOString() !== body.anchor.updatedAt)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The page anchor changed or is unavailable. Run the query again to refresh its scope.",
      });
    if (hasCustomRules && "sortValue" in anchor) {
      sqlSeek =
        input.query.direction === "asc"
          ? Prisma.sql`(${sortSql}>${anchor.sortValue} OR (${sortSql}=${anchor.sortValue} AND id>${anchor.id}))`
          : Prisma.sql`(${sortSql}<${anchor.sortValue} OR (${sortSql}=${anchor.sortValue} AND id<${anchor.id}))`;
    }
  }
  const orderBy: Prisma.TestCaseOrderByWithRelationInput[] = [
    { [input.query.sort]: input.query.direction },
    { id: input.query.direction },
  ];
  const [total, identities] = hasCustomRules
    ? await Promise.all([
        tx
          .$queryRaw<Array<{ count: number }>>(
            Prisma.sql`SELECT count(*)::int AS count FROM "TestCase" WHERE ${sqlWhere}`,
          )
          .then((rows) => rows[0]!.count),
        tx.$queryRaw<Array<{ id: string; updatedAt: Date }>>(
          Prisma.sql`SELECT id,"updatedAt" FROM "TestCase" WHERE ${sqlWhere} AND ${sqlSeek} ORDER BY ${sortSql} ${input.query.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`},id ${input.query.direction === "asc" ? Prisma.sql`ASC` : Prisma.sql`DESC`} LIMIT 51`,
        ),
      ])
    : await Promise.all([
        tx.testCase.count({ where: where! }),
        tx.testCase.findMany({
          where: where!,
          select: { id: true, updatedAt: true },
          orderBy,
          take: 51,
          ...(body.anchor ? { cursor: { id: body.anchor.id }, skip: 1 } : {}),
        }),
      ]);
  const selected = identities.slice(0, 50),
    ids = selected.map((r) => r.id);
  const metadata = ids.length
    ? await tx.$queryRaw<
        Array<{
          id: string;
          displayId: string;
          caseNumber: number;
          title: string;
          titleClipped: boolean;
          suitePath: string | null;
          suiteClipped: boolean;
          testType: string;
          priority: string;
          riskScore: number | null;
          automationStatus: string;
          reviewStatus: string;
          archived: boolean;
          updatedAt: Date;
          customValues: Record<string, CaseCustomCell>;
        }>
      >(
        Prisma.sql`SELECT id,"displayId","caseNumber",left(title,1000) AS title,length(title)>1000 AS "titleClipped",left("suitePath",240) AS "suitePath",COALESCE(length("suitePath")>240,false) AS "suiteClipped","testType"::text AS "testType",priority::text AS priority,"riskScore","automationStatus"::text AS "automationStatus","reviewStatus"::text AS "reviewStatus",archived,"updatedAt",${customProjectionSql(input.query.customColumns ?? [])} AS "customValues" FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(ids)})`,
      )
    : [];
  const rows = new Map(metadata.map((r) => [r.id, r]));
  if (rows.size !== ids.length)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "The query page changed. Run it again; no smaller result page has been substituted.",
    });
  const last = selected.at(-1);
  return {
    requestId: input.requestId,
    projectId: input.projectId,
    organizationId,
    queryHash,
    watermark: body.watermark,
    total,
    items: ids.map((id) => rows.get(id)!),
    pageCursor,
    nextCursor:
      identities.length > 50 && last
        ? encodeCaseQueryCursor(
            {
              ...body,
              anchor: { id: last.id, updatedAt: last.updatedAt.toISOString() },
            },
            env,
          )
        : null,
    limitations: [
      "Custom fields use current compatible active definitions. Missing keys, explicit null, empty text, false and zero are distinct. Malformed values are marked invalid, never coerced. Custom columns are not sortable; existing table exports are not changed.",
      "Read-time case metadata, not an immutable report or execution verdict. Changes after this query started are excluded until you run it again.",
      "Title and suite labels may be clipped for bounded display; native case links open the complete current record.",
      "Saved typed queries retain criteria and columns, not their result rows. This explorer remains separate from existing private table views, selection, bulk actions and exports.",
    ],
  };
}
