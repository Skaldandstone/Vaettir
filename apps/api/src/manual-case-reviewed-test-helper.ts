// TEST SUPPORT ONLY. No application/router import may use this module.
// Authoring this source is not permission to connect, seed, erase or execute.
import { createHash, randomUUID } from "node:crypto";
import type { PrismaClient, Prisma } from "@vaettir/db";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";
import {
  manualCaseResultReadSchema,
  manualCaseResultWriteSchema,
  manualCaseResultWriteKey,
  manualCaseReviewedReadKey,
  type ManualCaseResultRead,
  type ManualCaseResultWrite,
  type ManualCaseReviewedRead,
} from "./services/manualCaseResultSchema.js";
type CaseApi = ReturnType<
  typeof import("./routers/manualCaseResults.js").manualCaseResultsRouter.createCaller
>;
export const MANUAL_CASE_FIXTURE_OPT_IN =
  "VAETTIR_MANUAL_CASE_HISTORY_NATIVE_FIXTURE";
export const MANUAL_CASE_ERASURE_OPT_IN =
  "VAETTIR_MANUAL_CASE_HISTORY_DESTRUCTIVE_FIXTURE";
export function admitManualCaseFixtureSource(
  env: Record<string, string | undefined> = process.env,
  destructive = false,
) {
  const admitted = assertOwnedTestDatabase(env.DATABASE_URL, env);
  if (
    admitted.route !== "LOCAL_DISPOSABLE" ||
    env[MANUAL_CASE_FIXTURE_OPT_IN] !== "1" ||
    (destructive && env[MANUAL_CASE_ERASURE_OPT_IN] !== "1")
  )
    throw Error(
      "Explicit owned local manual-case fixture admission required; no native work was started",
    );
  return admitted;
}
export function manualCaseFixtureEnabled(
  env: Record<string, string | undefined> = process.env,
  destructive = false,
) {
  try {
    admitManualCaseFixtureSource(env, destructive);
    return true;
  } catch {
    return false;
  }
}
export type ManualCaseFixtureOwnership = {
  prefix: string;
  organizationId: string;
  organizationSlug: string;
  projectId: string;
  actorId: string;
  clerkActorId: string;
  testRunId: string;
  testCaseId: string;
};
const refuses = (): never => {
  throw Error(
    "Exact synthetic manual-case fixture ownership required; no evidence was replaced",
  );
};
export function assertManualCaseFixtureOwnership(
  owned: ManualCaseFixtureOwnership,
  read: ManualCaseResultRead,
) {
  if (
    !/^manual-case-revision-[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
      owned.prefix,
    ) ||
    !owned.organizationSlug.startsWith(owned.prefix + "-") ||
    !owned.clerkActorId.startsWith(owned.prefix + "-") ||
    [
      owned.organizationId,
      owned.projectId,
      owned.actorId,
      owned.testRunId,
      owned.testCaseId,
    ].some((id) => !id || id.length > 200 || id.includes("\0")) ||
    read.projectId !== owned.projectId ||
    read.testRunId !== owned.testRunId ||
    read.testCaseId !== owned.testCaseId ||
    read.expectedScope.projectId !== owned.projectId ||
    read.expectedScope.organizationId !== owned.organizationId ||
    read.expectedScope.clerkActorId !== owned.clerkActorId
  )
    return refuses();
}
/** Normal production reviewed readers, not a seed or bypass. Fresh read UUIDs
 * bind actual native author before constructing any new source fixture intent. */
export async function reviewedManualCaseFixture(
  api: CaseApi,
  read: ManualCaseResultRead,
  nativeActorId: string,
) {
  admitManualCaseFixtureSource();
  const original = manualCaseResultReadSchema.parse(read);
  const accessInput = {
      ...original,
      expectedNativeActorId: nativeActorId,
      readRequestId: randomUUID(),
    },
    access = await api.accessReviewed(accessInput);
  const c = access.readContext;
  if (
    c.projection !== "ACCESS" ||
    c.requestId !== accessInput.readRequestId ||
    c.requested !== manualCaseReviewedReadKey(accessInput) ||
    c.scope.projectId !== original.projectId ||
    c.scope.organizationId !== original.expectedScope.organizationId ||
    c.scope.clerkActorId !== original.expectedScope.clerkActorId ||
    c.scope.actorId !== nativeActorId
  )
    return refuses();
  const reviewedRead: ManualCaseReviewedRead = {
    ...original,
    expectedNativeActorId: nativeActorId,
    readRequestId: randomUUID(),
  };
  const preview = await api.previewReviewed(reviewedRead),
    p = preview.readContext;
  if (
    p.projection !== "PREVIEW" ||
    p.requestId !== reviewedRead.readRequestId ||
    p.requested !== manualCaseReviewedReadKey(reviewedRead) ||
    p.scope.projectId !== c.scope.projectId ||
    p.scope.organizationId !== c.scope.organizationId ||
    p.scope.clerkActorId !== c.scope.clerkActorId ||
    p.scope.actorId !== c.scope.actorId
  )
    return refuses();
  return { read: original, reviewedRead, preview };
}
async function withEmptyOwnedCase<T>(
  db: PrismaClient,
  owned: ManualCaseFixtureOwnership,
  read: ManualCaseResultRead,
  work: (
    tx: Prisma.TransactionClient,
    runtime: typeof import("@vaettir/db"),
  ) => Promise<T>,
): Promise<T> {
  const admission = admitManualCaseFixtureSource();
  assertManualCaseFixtureOwnership(owned, read);
  // Dynamic runtime imports follow test-only admission. No client is constructed here.
  const runtime = await import("@vaettir/db"),
    { lockManualRetestAccess } =
      await import("./services/manualRetestScope.js");
  return db.$transaction(
    async (tx) => {
      const [route] = await tx.$queryRaw<
        Array<{
          database: string;
          address: string | null;
          port: number | null;
          schema: string | null;
        }>
      >`SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port,current_schema() AS schema`;
      if (
        route?.database !== admission.database ||
        !["127.0.0.1", "::1"].includes(route.address ?? "") ||
        route.port !== 5432 ||
        route.schema !== "public"
      )
        return refuses();
      const scope = await lockManualRetestAccess(
        tx,
        owned.actorId,
        {
          projectId: read.projectId,
          sourceRunId: read.testRunId,
          testCaseId: read.testCaseId,
          expectedScope: read.expectedScope,
        },
        true,
        owned.clerkActorId,
        true,
      );
      if (
        scope.actorId !== owned.actorId ||
        scope.organizationId !== owned.organizationId ||
        scope.clerkActorId !== owned.clerkActorId
      )
        return refuses();
      const org = await tx.organization.findUniqueOrThrow({
          where: { id: owned.organizationId },
          select: { slug: true },
        }),
        project = await tx.project.findUniqueOrThrow({
          where: { id: owned.projectId },
          select: { organizationId: true, name: true },
        });
      const [run] = await tx.$queryRaw<
        Array<{
          projectId: string;
          provider: string;
          status: string;
          planned: boolean;
        }>
      >`SELECT "projectId","ciProvider" AS provider,status::text AS status,${owned.testCaseId}=ANY("manualTestCaseIds") AS planned FROM "TestRun" WHERE id=${owned.testRunId} FOR UPDATE`;
      const [nativeCase] = await tx.$queryRaw<
        Array<{ projectId: string; title: string }>
      >`SELECT "projectId",title FROM "TestCase" WHERE id=${owned.testCaseId} FOR SHARE`;
      if (
        org.slug !== owned.organizationSlug ||
        project.organizationId !== owned.organizationId ||
        !project.name.startsWith(owned.prefix) ||
        run?.projectId !== owned.projectId ||
        run.provider !== "manual" ||
        run.status !== "RUNNING" ||
        run.planned !== true ||
        nativeCase?.projectId !== owned.projectId ||
        !nativeCase.title.startsWith(owned.prefix)
      )
        return refuses();
      const where = {
        testRunId: owned.testRunId,
        testCaseId: owned.testCaseId,
      };
      const occupied = await Promise.all([
        tx.testResult.count({ where }),
        tx.manualCaseResultHead.count({ where }),
        tx.manualCaseResultRevision.count({ where }),
        tx.manualStepResultHead.count({ where }),
        tx.manualStepResultRevision.count({ where }),
      ]);
      if (occupied.some((count) => count !== 0)) return refuses();
      return work(tx, runtime);
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
/** Explicit HISTORICAL unversioned native fixture. Never a production API path.
 * No author/time are invented for the unversioned TestResult. No overwrites. */
export async function seedSyntheticUnversionedManualCase(
  db: PrismaClient,
  owned: ManualCaseFixtureOwnership,
  raw: {
    status: "FAIL" | "PASS" | "BLOCKED" | "SKIP";
    note: string | null;
    observations: Prisma.InputJsonValue;
  },
) {
  const read = {
    projectId: owned.projectId,
    testRunId: owned.testRunId,
    testCaseId: owned.testCaseId,
    expectedScope: {
      projectId: owned.projectId,
      organizationId: owned.organizationId,
      clerkActorId: owned.clerkActorId,
    },
  };
  return withEmptyOwnedCase(db, owned, read, async (tx) =>
    tx.testResult.create({
      data: {
        testRunId: owned.testRunId,
        testCaseId: owned.testCaseId,
        status: raw.status,
        note: raw.note,
        observations: raw.observations,
      },
    }),
  );
}
/** Only a FIRST historical v1 receipt, synthesized with original parsed wire/hash.
 * Does not claim the retired production writer ran. Native FK/deferred guards
 * stay enabled: result, immutable revision and final head commit together. */
export async function seedSyntheticAcceptedLegacyManualCase(
  db: PrismaClient,
  owned: ManualCaseFixtureOwnership,
  raw: ManualCaseResultWrite,
) {
  admitManualCaseFixtureSource();
  const request = manualCaseResultWriteSchema.parse(raw);
  assertManualCaseFixtureOwnership(owned, request);
  if (request.expectedRevisionId !== null || request.correctionReason !== null)
    return refuses();
  const requestHash = createHash("sha256")
    .update(manualCaseResultWriteKey(request))
    .digest("hex");
  return withEmptyOwnedCase(db, owned, request, async (tx, runtime) => {
    const { qualityProfileHash } =
      await import("./services/qualityExperienceProfile.js");
    if (
      request.expectedCurrentFingerprint !==
      qualityProfileHash({
        projectId: request.projectId,
        testRunId: request.testRunId,
        testCaseId: request.testCaseId,
        result: null,
        head: null,
      })
    )
      return refuses();
    if (
      await tx.manualCaseResultRevision.findUnique({
        where: {
          organizationId_actorId_idempotencyKey: {
            organizationId: owned.organizationId,
            actorId: owned.actorId,
            idempotencyKey: request.idempotencyKey,
          },
        },
        select: { id: true },
      })
    )
      return refuses();
    const actorLabel = "Synthetic historical v1 receipt fixture",
      [size] = await tx.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT (octet_length(concat(${request.note}::text,${JSON.stringify(request.observations)}::jsonb::text,${actorLabel}::text))+2048)::bigint AS bytes`;
    if (
      typeof size?.bytes !== "bigint" ||
      size.bytes < 2048n ||
      size.bytes > 256n * 1024n
    )
      return refuses();
    const result = await tx.testResult.create({
      data: {
        testRunId: request.testRunId,
        testCaseId: request.testCaseId,
        status: request.status,
        note: request.note,
        observations: request.observations,
      },
    });
    const revision = await tx.manualCaseResultRevision.create({
      data: {
        organizationId: owned.organizationId,
        projectId: owned.projectId,
        testRunId: owned.testRunId,
        testCaseId: owned.testCaseId,
        testResultId: result.id,
        revisionNumber: 1,
        status: request.status,
        note: request.note,
        observations: request.observations,
        legacyPrior: runtime.Prisma.DbNull,
        correctionReason: null,
        actorId: owned.actorId,
        actorClerkUserId: owned.clerkActorId,
        actorLabel,
        previousRevisionId: null,
        idempotencyKey: request.idempotencyKey,
        requestHash,
        payloadBytes: Number(size.bytes),
      },
    });
    await tx.manualCaseResultHead.create({
      data: {
        organizationId: owned.organizationId,
        projectId: owned.projectId,
        testRunId: owned.testRunId,
        testCaseId: owned.testCaseId,
        testResultId: result.id,
        currentRevisionId: revision.id,
        revisionCount: 1,
        currentPayloadBytes: Number(size.bytes),
      },
    });
    return {
      request,
      requestHash,
      resultId: result.id,
      revisionId: revision.id,
      revisionNumber: 1,
    };
  });
}
