// TEST SUPPORT ONLY. Never import from application routers/services.
// Source authoring is NOT permission to connect, execute, seed or erase data.
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type { PrismaClient, Prisma } from "@vaettir/db";
import { assertOwnedTestDatabase } from "../testOnlyDatabaseSafety.js";
import {
  reviewedStepAckSchema,
  reviewedStepPreviewInputSchema,
  reviewedStepPreviewOutputSchema,
  reviewedStepWriteInputSchema,
  reviewedStepWriteKey,
  type ReviewedStepAck,
  type ReviewedStepPreview,
} from "./manualStepExecutionReviewSchema.js";

export const MANUAL_STEP_FIXTURE_OPT_IN =
  "VAETTIR_MANUAL_STEP_REVIEWED_NATIVE_FIXTURE";
export const MANUAL_STEP_DESTRUCTIVE_OPT_IN =
  "VAETTIR_MANUAL_STEP_REVIEWED_DESTRUCTIVE_FIXTURE";
const refuse = (): never => {
  throw Error(
    "Exact owned synthetic reviewed-step fixture admission required; no evidence was replaced.",
  );
};
const identity = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !value.includes("\0") &&
      !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        value,
      ),
  );
const ownedSchema = z
  .object({
    prefix: z
      .string()
      .regex(
        /^manual-step-reviewed-[0-9]{13}-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/,
      ),
    organizationId: identity,
    organizationSlug: identity,
    projectId: identity,
    projectName: identity,
    actorId: identity,
    // An independently declared synthetic transport subject, NOT a native-row fallback.
    transportClerkSubject: identity,
    recordedActorLabel: identity,
    testRunId: identity,
    testCaseId: identity,
    caseTitle: z
      .string()
      .min(1)
      .max(1000)
      .refine(
        (value) =>
          !value.includes("\0") &&
          !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
            value,
          ),
      ),
  })
  .strict();
export type ManualStepFixtureOwnership = z.infer<typeof ownedSchema>;
export const manualStepFixtureDraftSchema = reviewedStepWriteInputSchema
  .pick({
    stepIndex: true,
    status: true,
    note: true,
    observations: true,
    evidenceAttachmentIds: true,
    expectedRevisionId: true,
    correctionReason: true,
    idempotencyKey: true,
  })
  .strict();
export type ManualStepFixtureDraft = z.infer<
  typeof manualStepFixtureDraftSchema
>;
const freeze = <T>(value: T): T => {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
};

/** Destructive admission belongs BEFORE ANY connection in an erasure-containing
 * later fixture, not a silent skipped final test or automatic normal teardown. */
export function admitManualStepFixtureSource(
  env: Record<string, string | undefined> = process.env,
  destructive = false,
) {
  const admission = assertOwnedTestDatabase(env.DATABASE_URL, env);
  if (
    admission.route !== "LOCAL_DISPOSABLE" ||
    env[MANUAL_STEP_FIXTURE_OPT_IN] !== "1" ||
    (destructive && env[MANUAL_STEP_DESTRUCTIVE_OPT_IN] !== "1")
  )
    return refuse();
  return admission;
}
export function assertManualStepFixtureOwnership(
  raw: ManualStepFixtureOwnership,
) {
  const parsed = ownedSchema.safeParse(raw);
  if (!parsed.success) return refuse();
  const owned = parsed.data;
  if (
    !owned.organizationSlug.startsWith(owned.prefix + "-") ||
    !owned.projectName.startsWith(owned.prefix + "-") ||
    !owned.transportClerkSubject.startsWith(owned.prefix + "-")
  )
    return refuse();
  return freeze(owned);
}
async function nativeRoute(
  db: PrismaClient | Prisma.TransactionClient,
  admission: ReturnType<typeof admitManualStepFixtureSource>,
) {
  const rows = await db.$queryRaw<
    Array<{
      database: string;
      address: string | null;
      port: number | null;
      schema: string | null;
    }>
  >`SELECT current_database() AS database,inet_server_addr()::text AS address,inet_server_port() AS port,current_schema() AS schema`;
  const route = rows[0];
  if (
    rows.length !== 1 ||
    route?.database !== admission.database ||
    !["127.0.0.1", "::1"].includes(route.address ?? "") ||
    route.port !== 5432 ||
    route.schema !== "public"
  )
    return refuse();
}
/** Identity/scalar-only synthetic ownership under actual current FULL locks.
 * No runtime/client is imported until the explicit admission has succeeded. */
async function lockedOwnedScope(
  tx: Prisma.TransactionClient,
  owned: ManualStepFixtureOwnership,
  write: boolean,
) {
  const { lockManualRetestAccess } = await import("./manualRetestScope.js");
  const scope = await lockManualRetestAccess(
    tx,
    owned.actorId,
    {
      projectId: owned.projectId,
      sourceRunId: owned.testRunId,
      testCaseId: owned.testCaseId,
      expectedScope: {
        projectId: owned.projectId,
        organizationId: owned.organizationId,
        clerkActorId: owned.transportClerkSubject,
      },
    },
    true,
    owned.transportClerkSubject,
    write,
  );
  if (
    scope.projectId !== owned.projectId ||
    scope.organizationId !== owned.organizationId ||
    scope.actorId !== owned.actorId ||
    scope.clerkActorId !== owned.transportClerkSubject
  )
    return refuse();
  const [labels] = await tx.$queryRaw<
    Array<{
      slug: string | null;
      projectName: string | null;
      title: string | null;
    }>
  >`SELECT
    CASE WHEN octet_length(o.slug)<=800 THEN o.slug ELSE NULL END AS slug,
    CASE WHEN octet_length(p.name)<=800 THEN p.name ELSE NULL END AS "projectName",
    CASE WHEN octet_length(c.title)<=4000 THEN c.title ELSE NULL END AS title
    FROM "Organization" o JOIN "Project" p ON p."organizationId"=o.id JOIN "TestCase" c ON c."projectId"=p.id
    WHERE o.id=${owned.organizationId} AND p.id=${owned.projectId} AND c.id=${owned.testCaseId}`;
  const rows = await tx.$queryRaw<
    Array<{
      projectId: string | null;
      provider: string | null;
      status: string;
      planned: boolean;
      cases: number;
    }>
  >`SELECT
    CASE WHEN octet_length("projectId")<=800 THEN "projectId" ELSE NULL END AS "projectId",
    CASE WHEN octet_length("ciProvider")<=800 THEN "ciProvider" ELSE NULL END AS provider,status::text AS status,${owned.testCaseId}=ANY("manualTestCaseIds") AS planned,
    cardinality("manualTestCaseIds")::int AS cases FROM "TestRun" WHERE id=${owned.testRunId} FOR UPDATE`;
  const run = rows[0];
  if (
    !labels ||
    labels.slug !== owned.organizationSlug ||
    labels.projectName !== owned.projectName ||
    labels.title !== owned.caseTitle ||
    rows.length !== 1 ||
    run?.projectId !== owned.projectId ||
    run.provider !== "manual" ||
    run.status !== "RUNNING" ||
    run.planned !== true ||
    !Number.isInteger(run.cases) ||
    run.cases < 1 ||
    run.cases > 1000
  )
    return refuse();
  return scope;
}

/** Prepare through real reviewed readers; retries submit only the retained body.
 * The helper has NO retry policy, sequencer, fresh baseline on submit or provider
 * operation. Native concurrency assertions must remain concurrent and strict. */
export async function beginOwnedManualStepFixture(
  db: PrismaClient,
  rawOwned: ManualStepFixtureOwnership,
  env: Record<string, string | undefined> = process.env,
  destructive = false,
) {
  const admission = admitManualStepFixtureSource(env, destructive),
    owned = assertManualStepFixtureOwnership(rawOwned);
  await nativeRoute(db, admission);
  await db.$transaction((tx) => lockedOwnedScope(tx, owned, false), {
    isolationLevel: "RepeatableRead",
    timeout: 20000,
    maxWait: 5000,
  });
  const actor = freeze({
    id: owned.actorId,
    clerkUserId: owned.transportClerkSubject,
  });
  async function admittedRoute() {
    const current = admitManualStepFixtureSource(env, destructive);
    if (current.database !== admission.database) return refuse();
    await nativeRoute(db, admission);
  }
  async function actualPreview(stepIndex: number) {
    await admittedRoute();
    const service = await import("./manualStepExecutionReview.js");
    const input = reviewedStepPreviewInputSchema.parse({
      projectId: owned.projectId,
      testRunId: owned.testRunId,
      testCaseId: owned.testCaseId,
      stepIndex,
      originalOrganizationId: owned.organizationId,
      expectedClerkActorId: owned.transportClerkSubject,
      expectedNativeActorId: owned.actorId,
      readRequestId: randomUUID(),
    });
    const parsed = reviewedStepPreviewOutputSchema.safeParse(
      await service.previewReviewedStep(db, actor, input),
    );
    if (!parsed.success) return refuse();
    const preview = parsed.data;
    if (
      preview.readRequestId !== input.readRequestId ||
      preview.projectId !== input.projectId ||
      preview.testRunId !== input.testRunId ||
      preview.testCaseId !== input.testCaseId ||
      preview.stepIndex !== stepIndex ||
      preview.scope.projectId !== owned.projectId ||
      preview.scope.organizationId !== owned.organizationId ||
      preview.scope.actorId !== owned.actorId ||
      preview.scope.actorClerkUserId !== owned.transportClerkSubject ||
      !preview.supported ||
      !preview.canRecord ||
      !preview.canRecover ||
      !preview.procedureHash ||
      !preview.currentFingerprint
    )
      return refuse();
    return { preview, service };
  }
  async function prepare(rawDraft: ManualStepFixtureDraft) {
    const draft = manualStepFixtureDraftSchema.parse(rawDraft),
      { preview, service } = await actualPreview(draft.stepIndex);
    const request = freeze(
      reviewedStepWriteInputSchema.parse({
        ...draft,
        projectId: owned.projectId,
        testRunId: owned.testRunId,
        testCaseId: owned.testCaseId,
        originalOrganizationId: owned.organizationId,
        expectedClerkActorId: owned.transportClerkSubject,
        expectedNativeActorId: owned.actorId,
        expectedProcedureHash: preview.procedureHash,
        expectedCurrentFingerprint: preview.currentFingerprint,
        confirmed: true,
      }),
    );
    const requestHash = createHash("sha256")
      .update(reviewedStepWriteKey(request))
      .digest("hex");
    async function submit() {
      await admittedRoute();
      const result = reviewedStepAckSchema.safeParse(
        await service.recordReviewedStep(db, actor, request),
      );
      if (!result.success) return refuse();
      const ack = result.data;
      if (
        ack.projectId !== owned.projectId ||
        ack.testRunId !== owned.testRunId ||
        ack.testCaseId !== owned.testCaseId ||
        ack.stepIndex !== request.stepIndex ||
        ack.scope.projectId !== owned.projectId ||
        ack.scope.organizationId !== owned.organizationId ||
        ack.scope.actorId !== owned.actorId ||
        ack.scope.actorClerkUserId !== owned.transportClerkSubject ||
        ack.requestHash !== requestHash ||
        ack.idempotencyKey !== request.idempotencyKey
      )
        return refuse();
      return ack; // recovered is actual server metadata; never falsified for old comparisons.
    }
    return Object.freeze({
      request,
      requestHash,
      observedRevisionId: preview.current?.id ?? null,
      submit,
    });
  }
  /** Explicit FIRST historical normalized-wire seed. Not a retired API execution,
   * reviewed envelope, import bypass or claim of original tenancy/Clerk history.
   * Limited to one planned case with no prerequisites and no selected files.
   * No occupied rows are modified; normal FK/deferred/projection guards remain. */
  async function seedAcceptedLegacy(raw: unknown) {
    await admittedRoute();
    const legacy = await import("./manualStepExecution.js"),
      { observationsSchema, measurementVerdict } =
        await import("./physicalValidation.js"),
      { qualityProfileHash } = await import("./qualityExperienceProfile.js");
    const request = legacy.recordStepResultInputSchema.parse(raw);
    if (
      request.testRunId !== owned.testRunId ||
      request.testCaseId !== owned.testCaseId ||
      request.stepIndex !== 0 ||
      request.expectedRevisionId !== null ||
      request.correctionReason?.trim() ||
      request.evidenceAttachmentIds.length
    )
      return refuse();
    const { preview } = await actualPreview(0);
    const observations = observationsSchema.parse(request.observations ?? {}),
      evidenceIds = [...request.evidenceAttachmentIds].sort(),
      note = request.note?.trim() || null,
      correctionReason = request.correctionReason?.trim() || null;
    const requestHash = qualityProfileHash({
      testCaseId: request.testCaseId,
      stepIndex: request.stepIndex,
      status: request.status,
      note,
      observations,
      evidenceAttachmentIds: evidenceIds,
      expectedRevisionId: request.expectedRevisionId,
      correctionReason,
    });
    const definition: ReviewedStepPreview["frozenDefinition"] =
      preview.frozenDefinition;
    if (
      !definition ||
      typeof definition !== "object" ||
      Array.isArray(definition) ||
      !Array.isArray((definition as { steps?: unknown }).steps)
    )
      return refuse();
    const count = (definition as { steps: unknown[] }).steps.length;
    if (count < 1 || count > 500) return refuse();
    const caseStatus = count === 1 ? request.status : null;
    const payloadBytes =
      Buffer.byteLength(
        JSON.stringify({
          note,
          observations,
          evidenceAttachments: [],
          actorName: owned.recordedActorLabel,
          correctionReason,
        }),
        "utf8",
      ) + 2048;
    if (
      payloadBytes > 262144 ||
      observations.measurements.some((row) =>
        [row.value, row.lowerLimit, row.upperLimit].some(
          (value) =>
            value !== undefined &&
            Number.isInteger(value) &&
            !Number.isSafeInteger(value),
        ),
      ) ||
      (request.status === "PASS" &&
        observations.measurements.some(
          (row) => measurementVerdict(row) === "OUT_OF_RANGE",
        ))
    )
      return refuse();
    const wire = await db.$transaction(
      async (tx) => {
        await nativeRoute(tx, admission);
        await lockedOwnedScope(tx, owned, true);
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ManualStepExecutionReview/v1'),
        hashtext(${qualityProfileHash({ actorId: owned.actorId, idempotencyKey: request.idempotencyKey })}))::text`;
        const [current] = await tx.$queryRaw<
          Array<{ exact: boolean; singleCase: boolean; runBytes: bigint }>
        >`SELECT
        octet_length(to_jsonb(r)::text)::bigint AS "runBytes",
        (r."manualTestCaseIds"=ARRAY[${owned.testCaseId}]::text[] AND r."manualPrerequisites" IS NOT DISTINCT FROM ${JSON.stringify({ [owned.testCaseId]: [] })}::jsonb
          AND CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array' THEN jsonb_array_length(r."executionContext"->'caseDefinitions') ELSE -1 END=1) AS "singleCase",
        (SELECT count(*)=1 AND bool_and(d IS NOT DISTINCT FROM ${JSON.stringify(definition)}::jsonb)
          FROM jsonb_array_elements(CASE WHEN jsonb_typeof(r."executionContext"->'caseDefinitions')='array'
          THEN r."executionContext"->'caseDefinitions' ELSE '[]'::jsonb END) d WHERE d->>'testCaseId'=${owned.testCaseId}) AS exact
        FROM "TestRun" r WHERE r.id=${owned.testRunId} AND r."projectId"=${owned.projectId}`;
        if (
          !current ||
          current.exact !== true ||
          current.singleCase !== true ||
          typeof current.runBytes !== "bigint" ||
          current.runBytes < 0n ||
          current.runBytes > 4194304n
        )
          return refuse();
        const where = {
          testRunId: owned.testRunId,
          testCaseId: owned.testCaseId,
        };
        const occupied = await Promise.all([
          tx.testResult.count({ where }),
          tx.manualStepResultHead.count({ where }),
          tx.manualStepResultRevision.count({ where }),
          tx.manualCaseResultHead.count({ where }),
          tx.manualCaseResultRevision.count({ where }),
          tx.manualStepResultRevision.count({
            where: {
              testRunId: owned.testRunId,
              actorId: owned.actorId,
              idempotencyKey: request.idempotencyKey,
            },
          }),
        ]);
        if (occupied.some((value) => !Number.isInteger(value) || value !== 0))
          return refuse();
        const [namespace] = await tx.$queryRaw<
          Array<{ count: bigint }>
        >`SELECT count(*) AS count FROM "AuditLog"
        WHERE "entityType" LIKE 'ManualStepExecutionReview/%' AND "actorId"=${owned.actorId} AND metadata->>'idempotencyKey'=${request.idempotencyKey}`;
        if (namespace?.count !== 0n) return refuse(); // Never synthesize old provenance over a reviewed UUID.
        const revision = await tx.manualStepResultRevision.create({
          data: {
            testRunId: owned.testRunId,
            testCaseId: owned.testCaseId,
            stepIndex: 0,
            revisionNumber: 1,
            status: request.status,
            caseStatusAtRecord: caseStatus,
            note,
            observations,
            evidenceAttachmentIds: evidenceIds,
            evidenceAttachments: [],
            actorId: owned.actorId,
            actorName: owned.recordedActorLabel,
            correctionReason,
            previousRevisionId: null,
            idempotencyKey: request.idempotencyKey,
            requestHash,
          },
          select: { id: true },
        });
        await tx.manualStepResultHead.create({
          data: {
            testRunId: owned.testRunId,
            testCaseId: owned.testCaseId,
            stepIndex: 0,
            currentRevisionId: revision.id,
            revisionCount: 1,
            currentPayloadBytes: payloadBytes,
          },
        });
        if (caseStatus !== null) {
          // The normal exact derived-write selector, after a genuine owned head.
          // Not a constraint-disable switch; abort/rollback retains original errors.
          await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', ${JSON.stringify([owned.testRunId, owned.testCaseId])}, true)`;
          await tx.testResult.create({
            data: {
              testRunId: owned.testRunId,
              testCaseId: owned.testCaseId,
              status: caseStatus,
              note: `Derived from ${count} recorded step outcomes. Per-step measurements and evidence remain on their immutable revisions.`,
              observations: {},
            },
          });
          await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', '', true)`;
        }
        return { revisionId: revision.id, caseStatus };
      },
      { isolationLevel: "RepeatableRead", timeout: 20000, maxWait: 5000 },
    );
    return Object.freeze({
      request: freeze(request),
      requestHash,
      wire: freeze(wire),
      provenance:
        "SYNTHETIC_LEGACY_WIRE_SEED_ORIGINAL_TENANCY_UNRECORDED" as const,
    });
  }
  return Object.freeze({ prepare, seedAcceptedLegacy });
}

/** Explicit old-wire comparison view only. Full scoped ACK stays available; this
 * projection is not provenance, success inference or a rewrite of recovered. */
export function manualStepFixtureWireView(raw: ReviewedStepAck) {
  const parsed = reviewedStepAckSchema.safeParse(raw);
  if (!parsed.success) return refuse();
  return {
    revisionId: parsed.data.revisionId,
    caseStatus: parsed.data.caseStatus,
  };
}
