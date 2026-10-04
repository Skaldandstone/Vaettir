import { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { TestCaseStepInputSchema } from "@vaettir/core";
import { z } from "zod";
import {
  manualExecutionReadScopeInputSchema,
  manualExecutionReadScopeOutputSchema,
  manualExecutionReadRequestKey,
  supportedManualExecutionIdentity,
  type ManualExecutionReadScopeInput,
  type ManualExecutionObservedReadScope,
} from "./manualExecutionReadScopeSchema.js";

const MiB = 1024n * 1024n;
const denied = () =>
  new TRPCError({
    code: "FORBIDDEN",
    message:
      "Current signed-in access to the originally reviewed project and workspace is required.",
  });
const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "Manual execution is unavailable in this project.",
  });
const oversized = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "Saved execution exceeds the bounded read view or has unsupported relationships. Evidence was not truncated or substituted.",
  });

/** Call before any private execution body is fetched, inside the caller's bounded
 * RepeatableRead/Serializable transaction (existing native read uses20s).
 * Locks: Organization -> Membership -> Project -> User -> TestRun. Scope echoes
 * identify the current pinned read boundary, never invented historical tenancy. */
export async function lockManualExecutionReadScope(
  tx: Prisma.TransactionClient,
  actorId: string,
  authenticatedClerkActorId: string,
  raw: ManualExecutionReadScopeInput,
): Promise<ManualExecutionObservedReadScope> {
  const input = manualExecutionReadScopeInputSchema.parse(raw);
  if (
    !supportedManualExecutionIdentity(actorId) ||
    !supportedManualExecutionIdentity(authenticatedClerkActorId)
  )
    throw denied();
  await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
  const [transaction] = await tx.$queryRaw<
    Array<{ isolation: string }>
  >`SELECT current_setting('transaction_isolation') AS isolation`;
  if (
    !transaction ||
    !["repeatable read", "serializable"].includes(transaction.isolation)
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Execution reads require a bounded stable-snapshot transaction.",
    });
  // Indexed identity-only discovery. No run JSON, provider URL or project body.
  const [found] = await tx.$queryRaw<
    Array<{ projectId: string | null; organizationId: string | null }>
  >`
    SELECT CASE WHEN octet_length(r."projectId")<=800 THEN r."projectId" ELSE NULL END AS "projectId",
      CASE WHEN octet_length(p."organizationId")<=800 THEN p."organizationId" ELSE NULL END AS "organizationId"
    FROM "TestRun" r JOIN "Project" p ON p.id=r."projectId" WHERE r.id=${input.testRunId}`;
  if (!found || !found.projectId || !found.organizationId) throw unavailable();
  if (
    !supportedManualExecutionIdentity(found.projectId) ||
    !supportedManualExecutionIdentity(found.organizationId)
  )
    throw oversized();
  if (input.projectId !== undefined && input.projectId !== found.projectId)
    throw unavailable();
  const projectId = found.projectId,
    organizationId = found.organizationId;
  const [org] = await tx.$queryRaw<
    Array<{ suspendedAt: Date | null }>
  >`SELECT "suspendedAt" FROM "Organization" WHERE id=${organizationId} FOR SHARE`;
  const [member] = await tx.$queryRaw<
    Array<{ role: string; seatType: string }>
  >`SELECT role::text AS role,"seatType"::text AS "seatType" FROM "Membership" WHERE "organizationId"=${organizationId} AND "userId"=${actorId} FOR SHARE`;
  const [project] = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR SHARE`;
  const [actor] = await tx.$queryRaw<
    Array<{ clerkUserId: string | null }>
  >`SELECT CASE WHEN octet_length("clerkUserId")<=800 THEN "clerkUserId" ELSE NULL END AS "clerkUserId" FROM "User" WHERE id=${actorId} FOR SHARE`;
  const [run] = await tx.$queryRaw<
    Array<{ projectId: string; manual: boolean }>
  >`SELECT "projectId",("ciProvider"='manual') AS manual FROM "TestRun" WHERE id=${input.testRunId} FOR SHARE`;
  if (
    !org ||
    org.suspendedAt ||
    !member ||
    !project ||
    project.organizationId !== organizationId ||
    !actor?.clerkUserId ||
    actor.clerkUserId !== authenticatedClerkActorId ||
    !run ||
    run.projectId !== projectId ||
    !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
      member.role,
    ) ||
    !["FULL", "READ_ONLY"].includes(member.seatType) ||
    (input.originalOrganizationId !== undefined &&
      input.originalOrganizationId !== organizationId) ||
    (input.expectedClerkActorId !== undefined &&
      input.expectedClerkActorId !== actor.clerkUserId)
  )
    throw denied();
  // READ_ONLY editors retain readable access; FULL-only write authority is
  // separate. Do not turn a seat-assignment convention into a new read policy.
  if (!run.manual)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This view requires a recorded manual execution.",
    });
  await preflightManualExecutionRead(
    tx,
    input.testRunId,
    projectId,
    organizationId,
  );
  return manualExecutionReadScopeOutputSchema.parse({
    testRunId: input.testRunId,
    projectId,
    organizationId,
    originalOrganizationId: organizationId,
    actorId,
    clerkActorId: actor.clerkUserId,
    canWrite:
      member.seatType === "FULL" &&
      ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
    readRequestKey: manualExecutionReadRequestKey(input),
  });
}

/** SQL aggregates measure bodies before projection into JS. No provider/media
 * reads, no truncation, no rewritten cases. Missing legacy cases may still be
 * represented by frozen evidence; existing foreign case/library pointers refuse. */
async function preflightManualExecutionRead(
  tx: Prisma.TransactionClient,
  testRunId: string,
  projectId: string,
  organizationId: string,
) {
  const [run] = await tx.$queryRaw<
    Array<{
      bytes: bigint;
      scopeBytes: bigint;
      graphBytes: bigint;
      count: number;
      uniqueCount: bigint;
      invalidId: boolean;
      labelBytes: bigint;
    }>
  >`
    SELECT octet_length(to_jsonb(r)::text)::bigint AS bytes,
      octet_length(r."manualTestCaseIds"::text)::bigint AS "scopeBytes",cardinality(r."manualTestCaseIds")::int AS count,
      octet_length(r."manualPrerequisites"::text)::bigint AS "graphBytes",
      (SELECT count(DISTINCT id) FROM unnest(r."manualTestCaseIds") id) AS "uniqueCount",
      EXISTS(SELECT 1 FROM unnest(r."manualTestCaseIds") id WHERE id IS NULL OR length(id)<1 OR length(id)>200) AS "invalidId",
      (SELECT octet_length(o."stepFieldLabels"::text)::bigint FROM "Organization" o WHERE o.id=${organizationId}) AS "labelBytes"
    FROM "TestRun" r WHERE r.id=${testRunId} AND r."projectId"=${projectId}`;
  if (
    !run ||
    run.bytes > 4n * MiB ||
    run.scopeBytes > 512n * 1024n ||
    run.graphBytes > 512n * 1024n ||
    run.count > 500 ||
    BigInt(run.count) !== run.uniqueCount ||
    run.invalidId ||
    run.labelBytes > 16384n
  )
    throw oversized();
  // Bounded identity/relationship metadata only, never case bodies. All graph
  // endpoints must be in the run's pinned scope, including missing legacy cases.
  const [scope] = await tx.$queryRaw<Array<{ ids: string[]; graph: unknown }>>`
    SELECT "manualTestCaseIds" AS ids,"manualPrerequisites" AS graph FROM "TestRun" WHERE id=${testRunId} AND "projectId"=${projectId}`;
  if (!scope || scope.ids.some((id) => !supportedManualExecutionIdentity(id)))
    throw oversized();
  const parsedGraph = z
    .record(z.array(z.string()).max(500))
    .safeParse(scope.graph);
  if (!parsedGraph.success) throw oversized();
  const ids = new Set(scope.ids),
    entries = Object.entries(parsedGraph.data);
  const graph = parsedGraph.data;
  if (entries.length > 500) throw oversized();
  let edges = 0;
  for (const [id, dependencies] of entries) {
    edges += dependencies.length;
    if (
      edges > 10000 ||
      !ids.has(id) ||
      new Set(dependencies).size !== dependencies.length ||
      dependencies.some(
        (dependency) => !ids.has(dependency) || dependency === id,
      )
    )
      throw oversized();
  }
  const visiting = new Set<string>(),
    visited = new Set<string>();
  function visit(id: string): void {
    if (visiting.has(id)) throw oversized();
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of graph[id] ?? []) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const id of ids) visit(id);
  const [foreign] = await tx.$queryRaw<
    Array<{
      foreignCase: boolean;
      foreignLibrary: boolean;
      danglingLibrary: boolean;
    }>
  >`
    SELECT EXISTS(SELECT 1 FROM "TestCase" c WHERE c.id=ANY(r."manualTestCaseIds") AND c."projectId"<>${projectId}) AS "foreignCase",
      EXISTS(SELECT 1 FROM "TestCase" c JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" WHERE c.id=ANY(r."manualTestCaseIds") AND c."projectId"=${projectId} AND g."projectId"<>${projectId}) AS "foreignLibrary",
      EXISTS(SELECT 1 FROM "TestCase" c LEFT JOIN "SharedStepGroup" g ON g.id=c."sharedStepGroupId" WHERE c.id=ANY(r."manualTestCaseIds") AND c."projectId"=${projectId} AND c."sharedStepGroupId" IS NOT NULL AND g.id IS NULL) AS "danglingLibrary"
    FROM "TestRun" r WHERE r.id=${testRunId} AND r."projectId"=${projectId}`;
  if (
    !foreign ||
    foreign.foreignCase ||
    foreign.foreignLibrary ||
    foreign.danglingLibrary
  )
    throw oversized();
  const [cases] = await tx.$queryRaw<
    Array<{
      count: bigint;
      bytes: bigint;
      maxBytes: bigint;
      steps: bigint;
      maxSteps: bigint;
      libraryBytes: bigint;
    }>
  >`
    WITH scoped AS (SELECT c.* FROM "TestCase" c JOIN "TestRun" r ON c.id=ANY(r."manualTestCaseIds") WHERE r.id=${testRunId} AND c."projectId"=${projectId}),
    sizes AS(SELECT c.id,octet_length(to_jsonb(c)::text)::bigint AS bytes,
      (SELECT count(*) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id) AS steps,
      coalesce((SELECT sum(octet_length(to_jsonb(s)::text)) FROM "TestCaseStep" s WHERE s."testCaseId"=c.id),0)::bigint AS "stepBytes",
      coalesce((SELECT octet_length(to_jsonb(g)::text) FROM "SharedStepGroup" g WHERE g.id=c."sharedStepGroupId" AND g."projectId"=${projectId}),0)::bigint AS "libraryBytes"
      FROM scoped c)
    SELECT count(*) AS count,coalesce(sum(bytes+"stepBytes"+"libraryBytes"),0)::bigint AS bytes,
      coalesce(max(bytes+"stepBytes"+"libraryBytes"),0)::bigint AS "maxBytes",coalesce(sum(steps),0)::bigint AS steps,coalesce(max(steps),0)::bigint AS "maxSteps",
      coalesce(sum("libraryBytes"),0)::bigint AS "libraryBytes" FROM sizes`;
  if (
    !cases ||
    cases.count > 500n ||
    cases.bytes > 8n * MiB ||
    cases.maxBytes > 512n * 1024n ||
    cases.steps > 25000n ||
    cases.maxSteps > 500n ||
    cases.libraryBytes > 2n * MiB
  )
    throw oversized();
  const libraries = await tx.$queryRaw<Array<{ steps: unknown }>>`
    SELECT DISTINCT g.id,g.steps FROM "SharedStepGroup" g JOIN "TestCase" c ON c."sharedStepGroupId"=g.id JOIN "TestRun" r ON c.id=ANY(r."manualTestCaseIds")
    WHERE r.id=${testRunId} AND c."projectId"=${projectId} AND g."projectId"=${projectId}`;
  // Actual authoring parser, not a cast or a fallback. No normalized result is
  // substituted: supported stored steps remain unchanged in the caller.
  const librarySteps = z.array(TestCaseStepInputSchema).max(500);
  if (
    libraries.length > 500 ||
    libraries.some((group) => !librarySteps.safeParse(group.steps).success)
  )
    throw oversized();
  const [results] = await tx.$queryRaw<
    Array<{
      count: bigint;
      bytes: bigint;
      maxBytes: bigint;
      duplicateCases: boolean;
    }>
  >`
    SELECT count(*) AS count,coalesce(sum(octet_length(to_jsonb(t)::text)),0)::bigint AS bytes,coalesce(max(octet_length(to_jsonb(t)::text)),0)::bigint AS "maxBytes",
      count(*)<>count(DISTINCT t."testCaseId") AS "duplicateCases"
    FROM "TestResult" t JOIN "TestRun" r ON r.id=t."testRunId" WHERE r.id=${testRunId} AND t."testCaseId"=ANY(r."manualTestCaseIds")`;
  if (
    !results ||
    results.count > 500n ||
    results.bytes > 4n * MiB ||
    results.maxBytes > 256n * 1024n ||
    results.duplicateCases
  )
    throw oversized();
  const [heads] = await tx.$queryRaw<
    Array<{
      count: bigint;
      bytes: bigint;
      maxBytes: bigint;
      invalidScope: boolean;
    }>
  >`
    SELECT count(*) AS count,coalesce(sum(octet_length(to_jsonb(v)::text)),0)::bigint AS bytes,coalesce(max(octet_length(to_jsonb(v)::text)),0)::bigint AS "maxBytes",
      coalesce(bool_or(v."testRunId"<>h."testRunId" OR v."testCaseId"<>h."testCaseId" OR v."stepIndex"<>h."stepIndex"),false) AS "invalidScope"
    FROM "ManualStepResultHead" h JOIN "TestRun" r ON r.id=h."testRunId" JOIN "ManualStepResultRevision" v ON v.id=h."currentRevisionId"
    WHERE r.id=${testRunId} AND h."testCaseId"=ANY(r."manualTestCaseIds")`;
  if (
    !heads ||
    heads.count > 25000n ||
    heads.bytes > 4n * MiB ||
    heads.maxBytes > 256n * 1024n ||
    heads.invalidScope
  )
    throw oversized();
  // The existing page reads sibling snapshots for an isolated dataset batch.
  // Bound all same-project matching contexts before that additional projection;
  // malformed/missing batch provenance is still validated by the page parser.
  const [batch] = await tx.$queryRaw<
    Array<{ count: bigint; bytes: bigint; maxBytes: bigint }>
  >`
    SELECT count(*) AS count,coalesce(sum(octet_length(s."executionContext"::text)),0)::bigint AS bytes,
      coalesce(max(octet_length(s."executionContext"::text)),0)::bigint AS "maxBytes"
    FROM "TestRun" s JOIN "TestRun" r ON r.id=${testRunId}
    WHERE s."projectId"=${projectId} AND jsonb_typeof(r."executionContext"#>'{datasetExecution,batchId}')='string'
      AND s."executionContext"#>>'{datasetExecution,batchId}'=r."executionContext"#>>'{datasetExecution,batchId}'`;
  if (
    !batch ||
    batch.count > 50n ||
    batch.bytes > 8n * MiB ||
    batch.maxBytes > 4n * MiB
  )
    throw oversized();
}
