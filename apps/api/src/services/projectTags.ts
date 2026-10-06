import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import {
  lockCaseFieldReadScope,
  type CaseFieldReadAuthorization,
} from "./caseFieldReadScope.js";
import {
  PROJECT_TAG_PAGE_SIZE,
  PROJECT_TAG_EDGES,
  MAX_TAG_MATCHING_CASES,
  MAX_TAG_RELATIONSHIPS,
  MAX_TAG_IDENTITY_BYTES,
  MAX_TAG_RELATION_BYTES,
  MAX_TAG_COHORT_BYTES,
  MAX_TAG_PAGE_BYTES,
  projectTagPageInput,
  projectTagPageOutput,
  projectTagRow,
  projectTagLimitations,
  type ProjectTagPageInput,
  type ProjectTagRow,
} from "./projectTagsSchema.js";

const unavailable = (detail: string) =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `This exact project tag scope is unavailable: ${detail}. No smaller or empty scope was substituted.`,
  });
const conflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message:
      "The exact tag scope, linked population or page anchor changed. Restart this section; no replacement page was guessed.",
  });
export function projectTagScopeHash(raw: ProjectTagPageInput) {
  const input = projectTagPageInput.parse(raw);
  return createHash("sha256")
    .update(
      JSON.stringify([
        input.projectId,
        input.originalOrganizationId,
        input.expectedClerkActorId,
        input.tag,
        input.section,
        input.archive,
        input.review,
      ]),
    )
    .digest("hex");
}
function matchingCases(input: ProjectTagPageInput) {
  return Prisma.sql`SELECT c.id,c."testPlanId" FROM "TestCase" c
    WHERE c."projectId"=${input.projectId} AND ${input.tag}=ANY(c.tags)
    AND ${input.archive === "ALL" ? Prisma.sql`true` : input.archive === "ARCHIVED" ? Prisma.sql`c.archived=true` : Prisma.sql`c.archived=false`}
    AND ${input.review === "ALL" ? Prisma.sql`true` : Prisma.sql`c."reviewStatus"::text=${input.review}`}`;
}
const memberHash = Prisma.sql`md5(string_agg(length(m.id)::text || ':' || m.id,',' ORDER BY m.id COLLATE "C"))`;
function entityRows(input: ProjectTagPageInput) {
  const matched = matchingCases(input);
  if (input.section === "CASES")
    return Prisma.sql`WITH matched AS (${matched})
    SELECT c.id,c.title,c."displayId",c."caseNumber",c."reviewStatus"::text AS "reviewStatus",c.archived,NULL::text AS status,1::int AS "matchingCaseCount",md5(c.id) AS "memberHash"
    FROM matched m JOIN "TestCase" c ON c.id=m.id AND c."projectId"=${input.projectId}`;
  if (input.section === "PLANS")
    return Prisma.sql`WITH matched AS (${matched})
    SELECT p.id,p.name AS title,NULL::text AS "displayId",NULL::int AS "caseNumber",NULL::text AS "reviewStatus",NULL::boolean AS archived,p.status::text AS status,count(DISTINCT m.id)::int AS "matchingCaseCount",${memberHash} AS "memberHash"
    FROM matched m JOIN "TestPlan" p ON p.id=m."testPlanId" AND p."projectId"=${input.projectId} GROUP BY p.id`;
  if (input.section === "RELEASES")
    return Prisma.sql`WITH matched AS (${matched})
    SELECT r.id,r.name AS title,NULL::text AS "displayId",NULL::int AS "caseNumber",NULL::text AS "reviewStatus",NULL::boolean AS archived,r.status::text AS status,count(DISTINCT m.id)::int AS "matchingCaseCount",${memberHash} AS "memberHash"
    FROM matched m JOIN "TestPlan" p ON p.id=m."testPlanId" AND p."projectId"=${input.projectId}
    JOIN "Release" r ON r.id=p."releaseId" AND r."projectId"=${input.projectId} GROUP BY r.id`;
  return Prisma.sql`WITH matched AS (${matched}), distinct_links AS (
    SELECT DISTINCT m.id,l."requirementId" FROM matched m JOIN "CaseTraceabilityLink" l ON l."caseId"=m.id
    AND l."projectId"=${input.projectId} AND l."removedAt" IS NULL AND l."requirementId" IS NOT NULL)
    SELECT q.id,q.title,NULL::text AS "displayId",NULL::int AS "caseNumber",NULL::text AS "reviewStatus",NULL::boolean AS archived,NULL::text AS status,count(DISTINCT m.id)::int AS "matchingCaseCount",${memberHash} AS "memberHash"
    FROM distinct_links m JOIN "Requirement" q ON q.id=m."requirementId" AND q."projectId"=${input.projectId} GROUP BY q.id`;
}
function admittedInteger(
  value: bigint | number,
  maximum: number,
  label: string,
) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0 || number > maximum)
    throw unavailable(label);
  return number;
}
type NativeRow = {
  id: string;
  title: string;
  displayId: string | null;
  caseNumber: number | null;
  reviewStatus: string | null;
  archived: boolean | null;
  status: string | null;
  matchingCaseCount: number;
  memberHash: string;
};
export function projectTagMetadataRow(
  section: ProjectTagPageInput["section"],
  row: NativeRow,
): ProjectTagRow {
  const checked = projectTagRow.safeParse({
    id: row.id,
    title: row.title,
    matchingCaseCount: row.matchingCaseCount,
    edge: PROJECT_TAG_EDGES[section],
    ...(section === "CASES"
      ? {
          displayId: row.displayId,
          caseNumber: row.caseNumber,
          reviewStatus: row.reviewStatus,
          archived: row.archived,
        }
      : {}),
    ...(section === "PLANS" || section === "RELEASES"
      ? { status: row.status }
      : {}),
  });
  if (!checked.success)
    throw unavailable(
      "a projected native identity or label is unsupported by the typed metadata boundary",
    );
  return checked.data;
}
export function projectTagPopulationHash(
  baseCases: number,
  baseHash: string,
  sectionHash: string,
) {
  if (
    !Number.isSafeInteger(baseCases) ||
    baseCases < 0 ||
    baseCases > MAX_TAG_MATCHING_CASES ||
    !/^[a-f0-9]{32}$/.test(baseHash) ||
    !/^[a-f0-9]{32}$/.test(sectionHash)
  )
    throw unavailable(
      "the current base or linked population could not be identified",
    );
  // Advisory change detection only, never a signature or authorization grant.
  return createHash("md5")
    .update(JSON.stringify([baseCases, baseHash, sectionHash]))
    .digest("hex");
}
export function projectTagIdsOrdered(ids: string[], afterId?: string) {
  return ids.every((id, index) => {
    const previous = index === 0 ? afterId : ids[index - 1];
    return (
      previous === undefined ||
      Buffer.compare(Buffer.from(id, "utf8"), Buffer.from(previous, "utf8")) > 0
    );
  });
}
export async function readProjectTagPage(
  db: PrismaClient,
  actorId: string,
  raw: ProjectTagPageInput,
  authorized: CaseFieldReadAuthorization,
) {
  const input = projectTagPageInput.parse(raw),
    scopeHash = projectTagScopeHash(input);
  if (input.cursor && input.cursor.scopeHash !== scopeHash) throw conflict();
  return db.$transaction(
    async (tx) => {
      const readScope = await lockCaseFieldReadScope(
        tx,
        actorId,
        input,
        authorized,
      );
      const asOf = new Date().toISOString(),
        matched = matchingCases(input);
      // Native aggregate admission BEFORE returning any case or related body.
      const [caseGate] = await tx.$queryRaw<
        Array<{ cases: bigint; identityBytes: bigint; unsupported: boolean }>
      >(Prisma.sql`
      WITH matched AS (${matched}) SELECT count(*) AS cases,coalesce(sum(octet_length(id)),0) AS "identityBytes",
      coalesce(bool_or(length(id) NOT BETWEEN 1 AND 200 OR octet_length(id)>800),false) AS unsupported FROM matched`);
      if (!caseGate || caseGate.unsupported)
        throw unavailable("matching case identities are unsupported");
      const matchingCasesCount = admittedInteger(
        caseGate.cases,
        MAX_TAG_MATCHING_CASES,
        "matching case count exceeds its bound",
      );
      admittedInteger(
        caseGate.identityBytes,
        MAX_TAG_IDENTITY_BYTES,
        "matching case identity bytes exceed their bound",
      );
      if (input.section === "PLANS" || input.section === "RELEASES") {
        const [relation] = await tx.$queryRaw<
          Array<{ foreign: boolean }>
        >(Prisma.sql`WITH matched AS (${matched})
        SELECT coalesce(bool_or(m."testPlanId" IS NOT NULL AND (p.id IS NULL OR p."projectId"<>${input.projectId})
          OR ${input.section === "RELEASES" ? Prisma.sql`p."releaseId" IS NOT NULL AND (r.id IS NULL OR r."projectId"<>${input.projectId})` : Prisma.sql`false`}),false) AS foreign
        FROM matched m LEFT JOIN "TestPlan" p ON p.id=m."testPlanId" LEFT JOIN "Release" r ON r.id=p."releaseId"`);
        if (!relation || relation.foreign)
          throw unavailable(
            "a direct linked plan or release is missing or foreign",
          );
      }
      if (input.section === "REQUIREMENTS") {
        const [relation] = await tx.$queryRaw<
          Array<{
            links: bigint;
            identityBytes: bigint;
            unsupported: boolean;
            foreign: boolean;
          }>
        >(Prisma.sql`WITH matched AS (${matched})
        SELECT count(*) AS links,coalesce(sum(octet_length(l.id)+octet_length(l."caseId")+octet_length(l."requirementId")),0) AS "identityBytes",
        coalesce(bool_or(length(l.id) NOT BETWEEN 1 AND 200 OR length(l."requirementId") NOT BETWEEN 1 AND 200 OR octet_length(l.id)>800 OR octet_length(l."requirementId")>800),false) AS unsupported,
        coalesce(bool_or(l."projectId"<>${input.projectId} OR q.id IS NULL OR q."projectId"<>${input.projectId} OR s."organizationId" IS DISTINCT FROM ${input.originalOrganizationId}),false) AS foreign
        FROM matched m JOIN "CaseTraceabilityLink" l ON l."caseId"=m.id AND l."removedAt" IS NULL AND l."requirementId" IS NOT NULL
        LEFT JOIN "Requirement" q ON q.id=l."requirementId" LEFT JOIN "CaseTraceabilityState" s ON s."projectId"=l."projectId"`);
        if (!relation || relation.foreign || relation.unsupported)
          throw unavailable(
            "an active direct requirement reference is unsupported, foreign or belongs to another original workspace",
          );
        admittedInteger(
          relation.links,
          MAX_TAG_RELATIONSHIPS,
          "direct requirement reference count exceeds its bound",
        );
        admittedInteger(
          relation.identityBytes,
          MAX_TAG_RELATION_BYTES,
          "direct requirement reference identities exceed their byte bound",
        );
      }
      const rows = entityRows(input);
      const [gate] = await tx.$queryRaw<
        Array<{
          entities: bigint;
          bytes: bigint;
          unsupported: boolean;
          anchorPresent: boolean;
        }>
      >(Prisma.sql`
      WITH rows AS (${rows}) SELECT count(*) AS entities,coalesce(sum(octet_length(to_jsonb(rows)::text)),0) AS bytes,
      coalesce(bool_or(length(id) NOT BETWEEN 1 AND 200 OR octet_length(id)>800 OR length(title)>10000
        OR length("displayId")>200 OR octet_length("displayId")>800 OR "caseNumber"<0
        OR length("reviewStatus")>100 OR length(status)>100 OR "matchingCaseCount" NOT BETWEEN 1 AND ${MAX_TAG_MATCHING_CASES}),false) AS unsupported,
      ${input.cursor ? Prisma.sql`coalesce(bool_or(id=${input.cursor.afterId}),false)` : Prisma.sql`true`} AS "anchorPresent" FROM rows`);
      if (!gate || gate.unsupported)
        throw unavailable(
          "projected entity metadata exceeds its native bounds",
        );
      const total = admittedInteger(
        gate.entities,
        MAX_TAG_MATCHING_CASES,
        "distinct associated entity count exceeds its bound",
      );
      admittedInteger(
        gate.bytes,
        MAX_TAG_COHORT_BYTES,
        "complete section metadata exceeds its byte bound",
      );
      if (!gate.anchorPresent) throw conflict();
      const [population] = await tx.$queryRaw<
        Array<{
          populationHash: string;
          basePopulationHash: string;
          baseCases: bigint;
        }>
      >(Prisma.sql`WITH rows AS (${rows}), base AS (${matched})
      SELECT md5(coalesce(string_agg(md5(to_jsonb(rows)::text),'' ORDER BY id COLLATE "C"),'')) AS "populationHash",
        (SELECT count(*) FROM base) AS "baseCases",
        (SELECT md5(coalesce(string_agg(length(id)::text || ':' || id,'' ORDER BY id COLLATE "C"),'')) FROM base) AS "basePopulationHash" FROM rows`);
      if (!population || !/^[a-f0-9]{32}$/.test(population.populationHash))
        throw unavailable(
          "the current linked population could not be identified",
        );
      const baseCases = admittedInteger(
        population.baseCases,
        MAX_TAG_MATCHING_CASES,
        "base population count is unsupported",
      );
      if (baseCases !== matchingCasesCount)
        throw unavailable(
          "the matched base population count disagrees with its native admission gate",
        );
      const populationHash = projectTagPopulationHash(
        baseCases,
        population.basePopulationHash,
        population.populationHash,
      );
      if (input.cursor && input.cursor.populationHash !== populationHash)
        throw conflict();
      const pageRows = Prisma.sql`WITH rows AS (${rows}) SELECT * FROM rows WHERE ${input.cursor ? Prisma.sql`id COLLATE "C">${input.cursor.afterId}` : Prisma.sql`true`} ORDER BY id COLLATE "C" LIMIT ${PROJECT_TAG_PAGE_SIZE + 1}`;
      const [pageGate] = await tx.$queryRaw<
        Array<{ bytes: bigint; rows: bigint }>
      >(
        Prisma.sql`WITH page AS (${pageRows}) SELECT count(*) AS rows,coalesce(sum(octet_length(to_jsonb(page)::text)),0) AS bytes FROM page`,
      );
      if (!pageGate)
        throw unavailable("the projected page could not be bounded");
      admittedInteger(
        pageGate.bytes,
        MAX_TAG_PAGE_BYTES,
        "projected page metadata exceeds its byte bound",
      );
      const expectedPageRows = admittedInteger(
        pageGate.rows,
        PROJECT_TAG_PAGE_SIZE + 1,
        "projected page count exceeds its bound",
      );
      const page = await tx.$queryRaw<NativeRow[]>(pageRows);
      if (
        page.length !== expectedPageRows ||
        new Set(page.map((row) => row.id)).size !== page.length ||
        page.length > total ||
        !projectTagIdsOrdered(
          page.map((row) => row.id),
          input.cursor?.afterId,
        )
      )
        throw unavailable(
          "projected native identities disagree with complete counts",
        );
      const items = page
          .slice(0, PROJECT_TAG_PAGE_SIZE)
          .map((row) => projectTagMetadataRow(input.section, row)),
        last = items.at(-1);
      const output = projectTagPageOutput.safeParse({
        projectId: input.projectId,
        organizationId: readScope.organizationId,
        clerkActorId: readScope.actorClerkUserId,
        requestId: input.requestId,
        readScope,
        scopeHash,
        tag: input.tag,
        section: input.section,
        archive: input.archive,
        review: input.review,
        asOf,
        total,
        matchingCases: matchingCasesCount,
        items,
        nextCursor:
          page.length > PROJECT_TAG_PAGE_SIZE && last
            ? {
                scopeHash,
                populationHash,
                afterId: last.id,
              }
            : null,
        limitations: projectTagLimitations,
      });
      // PostgreSQL character counts use codepoints; DTO limits use UTF-16
      // codeunits. Byte preflight remains native. Unsupported astral-width
      // metadata refuses generically, never a raw Zod body or empty success.
      if (!output.success)
        throw unavailable(
          "the projected page is unsupported by the typed metadata boundary",
        );
      return output.data;
    },
    { isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 },
  );
}
