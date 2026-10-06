import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type {
  Prisma,
  PrismaClient,
  ManualStepResultRevision,
} from "@vaettir/db";
import { observationsSchema } from "./physicalValidation.js";
import {
  readRunExperienceSnapshot,
  qualityProfileHash,
} from "./qualityExperienceProfile.js";
import { lockManualRetestAccess } from "./manualRetestScope.js";

export const stepStatusSchema = z.enum(["PASS", "FAIL", "BLOCKED", "SKIP"]);
const MAX_CURRENT_STEP_BYTES = 4 * 1024 * 1024;
export async function boundedCurrentStepBytes(
  db: PrismaClient | Prisma.TransactionClient,
  testRunId: string,
) {
  const total = await db.manualStepResultHead.aggregate({
    where: { testRunId },
    _sum: { currentPayloadBytes: true },
  });
  const bytes = total._sum.currentPayloadBytes ?? 0;
  if (bytes > MAX_CURRENT_STEP_BYTES)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "This run's saved step observations exceed the bounded result view. They cannot be silently truncated.",
    });
  return bytes;
}
export const stepEvidenceSchema = z.object({
  id: z.string(),
  fileName: z.string(),
});
const verificationSchema = z.object({
  etag: z.string().max(300).nullable(),
  versionId: z.string().max(300).nullable(),
  verifiedAt: z.string().datetime(),
});
export const savedStepEvidenceSchema = stepEvidenceSchema.extend({
  contentType: z.string().max(200),
  sizeBytes: z
    .number()
    .int()
    .positive()
    .max(25 * 1024 * 1024),
  verification: verificationSchema,
});
export const stepRevisionOutputSchema = z.object({
  id: z.string(),
  status: stepStatusSchema,
  note: z.string().nullable(),
  observations: observationsSchema,
  evidenceAttachments: z.array(stepEvidenceSchema).max(20),
  actorName: z.string(),
  recordedAt: z.date(),
  correctionReason: z.string().nullable(),
  previousRevisionId: z.string().nullable(),
  revisionNumber: z.number(),
});
export const recordStepResultInputSchema = z
  .object({
    testRunId: z.string().min(1).max(200),
    testCaseId: z.string().min(1).max(200),
    stepIndex: z.number().int().min(0).max(499),
    status: stepStatusSchema,
    note: z.string().trim().max(10000).optional(),
    observations: observationsSchema.optional(),
    evidenceAttachmentIds: z
      .array(z.string().min(1).max(200))
      .max(20)
      .default([]),
    expectedRevisionId: z.string().min(1).max(200).nullable(),
    idempotencyKey: z.string().uuid(),
    correctionReason: z.string().trim().max(2000).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (
      new Set(value.evidenceAttachmentIds).size !==
      value.evidenceAttachmentIds.length
    )
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Select each evidence file only once",
        path: ["evidenceAttachmentIds"],
      });
  });

export function safeEvidenceFileName(name: string) {
  const label = [...name.slice(0, 1024)]
    .filter((character) => {
      const code = character.codePointAt(0)!;
      return code >= 32 && code !== 127;
    })
    .join("")
    .trim()
    .slice(0, 255);
  return label || "Evidence file";
}

export function stepRevisionOutput(revision: ManualStepResultRevision) {
  const evidence = z
    .array(savedStepEvidenceSchema)
    .max(20)
    .parse(revision.evidenceAttachments);
  return {
    id: revision.id,
    status: stepStatusSchema.parse(revision.status),
    note: revision.note,
    observations: observationsSchema.parse(revision.observations),
    evidenceAttachments: evidence.map((e) => ({
      id: e.id,
      fileName: e.fileName,
    })),
    actorName: revision.actorName,
    recordedAt: revision.recordedAt,
    correctionReason: revision.correctionReason,
    previousRevisionId: revision.previousRevisionId,
    revisionNumber: revision.revisionNumber,
  };
}

export function aggregateStepStatus(
  statuses: string[],
): "PASS" | "FAIL" | "BLOCKED" | "SKIP" {
  if (statuses.includes("FAIL")) return "FAIL";
  if (statuses.includes("BLOCKED")) return "BLOCKED";
  if (statuses.includes("SKIP")) return "SKIP";
  return "PASS";
}

export function frozenStructuredCase(
  run: { executionContext: unknown; manualTestCaseIds: string[] },
  testCaseId: string,
) {
  const snapshot = readRunExperienceSnapshot(run.executionContext);
  const definition = snapshot?.caseDefinitions.find(
    (c) => c.testCaseId === testCaseId,
  );
  if (!run.manualTestCaseIds.includes(testCaseId) || !definition?.steps.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Step execution requires a frozen structured procedure in this run. Start a new run with structured steps; current or legacy live definitions cannot replace the saved baseline.",
    });
  return definition;
}

export async function requirePassedPrerequisites(
  tx: Prisma.TransactionClient,
  run: { id: string; manualPrerequisites: unknown },
  testCaseId: string,
  status: string,
) {
  if (status === "BLOCKED" || status === "SKIP") return;
  const graph = z.record(z.array(z.string())).parse(run.manualPrerequisites);
  const ids = graph[testCaseId] ?? [];
  const passed = await tx.testResult.count({
    where: { testRunId: run.id, testCaseId: { in: ids }, status: "PASS" },
  });
  if (passed !== ids.length)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Complete all prerequisite cases with Pass before executing this case.",
    });
}

export async function protectExecutedDependents(
  tx: Prisma.TransactionClient,
  run: { id: string; manualPrerequisites: unknown },
  testCaseId: string,
) {
  const graph = z.record(z.array(z.string())).parse(run.manualPrerequisites);
  const ids = Object.entries(graph)
    .filter(([, required]) => required.includes(testCaseId))
    .map(([id]) => id);
  const [caseCount, stepCount] = await Promise.all([
    tx.testResult.count({
      where: {
        testRunId: run.id,
        testCaseId: { in: ids },
        status: { in: ["PASS", "FAIL"] },
      },
    }),
    tx.manualStepResultRevision.count({
      where: {
        testRunId: run.id,
        testCaseId: { in: ids },
        status: { in: ["PASS", "FAIL"] },
      },
    }),
  ]);
  if (caseCount || stepCount)
    throw new TRPCError({
      code: "CONFLICT",
      message:
        "A dependent case has already run. Start a new run to correct this passed prerequisite without rewriting the completed execution.",
    });
}

/** Recovery-only legacy adapter. The native legacy tuple was run/actor/UUID;
 * original organization and Clerk provenance were not stored and are not invented.
 * New reviewed envelopes retain their separate global actor/UUID namespace. */
export async function recordManualStepResult(
  db: PrismaClient,
  actor: { id: string; name: string | null; clerkUserId: string | null },
  input: z.infer<typeof recordStepResultInputSchema>,
) {
  if (
    !actor ||
    typeof actor.clerkUserId !== "string" ||
    !actor.clerkUserId.length ||
    actor.clerkUserId.length > 200 ||
    actor.clerkUserId.includes("\0")
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "An independently authenticated signed-in actor is required.",
    });
  const observations = observationsSchema.parse(input.observations ?? {});
  const evidenceIds = [...input.evidenceAttachmentIds].sort();
  const note = input.note?.trim() || null;
  const correctionReason = input.correctionReason?.trim() || null;
  const requestHash = qualityProfileHash({
    testCaseId: input.testCaseId,
    stepIndex: input.stepIndex,
    status: input.status,
    note,
    observations,
    evidenceAttachmentIds: evidenceIds,
    expectedRevisionId: input.expectedRevisionId,
    correctionReason,
  });
  const unsupported = () =>
    new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The retained step receipt has unsupported metadata. Nothing was rewritten; refresh reviewed history before deciding how to recover.",
    });
  const identity = z
    .string()
    .min(1)
    .max(200)
    .refine((value) => !value.includes("\0"));
  const hash = z.string().regex(/^[a-f0-9]{64}$/);
  const scalarReceiptSchema = z
    .object({
      id: identity,
      testRunId: identity,
      testCaseId: identity,
      stepIndex: z.number().int().min(0).max(499),
      actorId: identity,
      idempotencyKey: z.string().uuid(),
      requestHash: hash,
      status: stepStatusSchema,
      caseStatusAtRecord: stepStatusSchema.nullable(),
    })
    .strict();
  const reviewedScalarSchema = z
    .object({
      revisionId: identity,
      testRunId: identity,
      testCaseId: identity,
      projectId: identity,
      organizationId: identity,
      actorId: identity,
      actorClerkUserId: identity,
      valid: z.literal(true),
    })
    .strict();
  const admittedCount = (rows: Array<{ count: bigint; bytes: bigint }>) => {
    const row = rows[0];
    if (
      rows.length !== 1 ||
      !row ||
      typeof row.count !== "bigint" ||
      typeof row.bytes !== "bigint" ||
      row.count < 0n ||
      row.count > 1n ||
      row.bytes < 0n ||
      row.bytes > 8192n ||
      (row.count === 1n && row.bytes === 0n) ||
      (row.count === 0n && row.bytes !== 0n)
    )
      throw unsupported();
    return row.count;
  };
  return db.$transaction(
    async (tx) => {
      // Identity-only discovery. No run procedure, note, evidence or current head is read.
      const found = await tx.$queryRaw<
        Array<{ projectId: string | null }>
      >`SELECT
      CASE WHEN length("projectId") BETWEEN 1 AND 200 AND octet_length("projectId") <= 800
      THEN "projectId" ELSE NULL END AS "projectId" FROM "TestRun" WHERE id=${input.testRunId}`;
      if (!found.length)
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Test run not found",
        });
      const project = identity.safeParse(found[0]?.projectId);
      if (found.length !== 1 || !project.success) throw unsupported();
      const scope = await lockManualRetestAccess(
        tx,
        actor.id,
        {
          projectId: project.data,
          sourceRunId: input.testRunId,
          testCaseId: input.testCaseId,
        },
        true,
        actor.clerkUserId!,
        true,
      );
      const locked = await tx.$queryRaw<
        Array<{ projectId: string | null }>
      >`SELECT
      CASE WHEN length("projectId") BETWEEN 1 AND 200 AND octet_length("projectId") <= 800
      THEN "projectId" ELSE NULL END AS "projectId" FROM "TestRun" WHERE id=${input.testRunId} FOR UPDATE`;
      if (locked.length !== 1 || locked[0]?.projectId !== scope.projectId)
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The current run scope is unavailable.",
        });
      // Same mutex as reviewedStep: a reviewed receipt cannot race a legacy recovery.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('ManualStepExecutionReview/v1'),
      hashtext(${qualityProfileHash({ actorId: actor.id, idempotencyKey: input.idempotencyKey })}))::text`;
      const count = admittedCount(
        await tx.$queryRaw<Array<{ count: bigint; bytes: bigint }>>`SELECT
      count(*) AS count, coalesce(sum(octet_length(id) + octet_length("testRunId") +
      octet_length("testCaseId") + octet_length("actorId") + octet_length("idempotencyKey") +
      octet_length("requestHash") + octet_length(status::text) + coalesce(octet_length("caseStatusAtRecord"::text),0) + 8),0)::bigint AS bytes
      FROM "ManualStepResultRevision" WHERE "testRunId"=${input.testRunId}
      AND "actorId"=${actor.id} AND "idempotencyKey"=${input.idempotencyKey}`,
      );
      if (!count)
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "This legacy step endpoint only recovers an already accepted original request. Use the reviewed step editor for new observations. A lost earlier acknowledgement may already have applied; refresh history rather than automatically resubmitting.",
        });
      const rows = await tx.$queryRaw<
        unknown[]
      >`SELECT id,"testRunId","testCaseId","stepIndex",
      "actorId","idempotencyKey","requestHash",status::text AS status,"caseStatusAtRecord"::text AS "caseStatusAtRecord"
      FROM "ManualStepResultRevision" WHERE "testRunId"=${input.testRunId}
      AND "actorId"=${actor.id} AND "idempotencyKey"=${input.idempotencyKey}`;
      const parsed = scalarReceiptSchema.safeParse(rows[0]);
      if (rows.length !== 1 || !parsed.success) throw unsupported();
      const receipt = parsed.data;
      if (
        receipt.testRunId !== input.testRunId ||
        receipt.actorId !== actor.id ||
        receipt.idempotencyKey !== input.idempotencyKey ||
        receipt.testCaseId !== input.testCaseId ||
        receipt.stepIndex !== input.stepIndex ||
        receipt.status !== input.status ||
        receipt.requestHash !== requestHash
      )
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This step-recording key belongs to a different retained request. Keep the exact original request for recovery.",
        });

      // Reviewed UUIDs are global per actor, unlike the old compound tuple. Admit
      // every matching namespace before extracting scalars, never materialize JSON.
      const reviewedCount = admittedCount(
        await tx.$queryRaw<Array<{ count: bigint; bytes: bigint }>>`SELECT
      count(*) AS count, coalesce(sum(octet_length(metadata::text) + octet_length("entityType") +
      octet_length("entityId") + coalesce(octet_length("projectId"),0) +
      coalesce(octet_length("organizationId"),0) + coalesce(octet_length("actorId"),0)),0)::bigint AS bytes
      FROM "AuditLog" WHERE "entityType" LIKE 'ManualStepExecutionReview/%'
      AND "actorId"=${actor.id} AND metadata->>'idempotencyKey'=${input.idempotencyKey}`,
      );
      if (reviewedCount) {
        // Strict v1 shape + native FK/scalar corroboration only. Foreign evidence,
        // procedure and notes are neither returned nor decoded for distinct run B.
        const corroborated = await tx.$queryRaw<unknown[]>`SELECT
        CASE WHEN length(v.id) BETWEEN 1 AND 200 AND octet_length(v.id)<=800 THEN v.id ELSE NULL END AS "revisionId",
        CASE WHEN length(v."testRunId") BETWEEN 1 AND 200 AND octet_length(v."testRunId")<=800 THEN v."testRunId" ELSE NULL END AS "testRunId",
        a.metadata->>'testCaseId' AS "testCaseId", a.metadata->>'projectId' AS "projectId",
        a.metadata->'scope'->>'organizationId' AS "organizationId",
        a.metadata->'scope'->>'actorId' AS "actorId",
        a.metadata->'scope'->>'actorClerkUserId' AS "actorClerkUserId",
        coalesce(a."entityType"='ManualStepExecutionReview/v1'
          AND jsonb_typeof(a.metadata)='object'
          AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(a.metadata)='object' THEN a.metadata ELSE '{}'::jsonb END))=11
          AND a.metadata ?& ARRAY['projectId','testRunId','testCaseId','stepIndex','scope','idempotencyKey','requestHash','revisionId','caseStatus','recovered','provenance']
          AND jsonb_typeof(a.metadata->'scope')='object'
          AND (SELECT count(*) FROM jsonb_object_keys(CASE WHEN jsonb_typeof(a.metadata->'scope')='object' THEN a.metadata->'scope' ELSE '{}'::jsonb END))=4
          AND (a.metadata->'scope') ?& ARRAY['projectId','organizationId','actorId','actorClerkUserId']
          AND (SELECT bool_and(jsonb_typeof(field)='string' AND length(field #>> '{}') BETWEEN 1 AND 200
            AND octet_length(field #>> '{}')<=800) FROM (VALUES
            (a.metadata->'projectId'),(a.metadata->'testRunId'),(a.metadata->'testCaseId'),
            (a.metadata->'idempotencyKey'),(a.metadata->'revisionId'),
            (a.metadata->'scope'->'projectId'),(a.metadata->'scope'->'organizationId'),
            (a.metadata->'scope'->'actorId'),(a.metadata->'scope'->'actorClerkUserId')) AS scalars(field))
          AND jsonb_typeof(a.metadata->'recovered')='boolean'
          AND a.metadata->>'provenance'='REVIEWED_REQUEST_BOUND_AT_WRITE'
          AND jsonb_typeof(a.metadata->'provenance')='string'
          AND jsonb_typeof(a.metadata->'stepIndex')='number'
          AND a.metadata->>'stepIndex'=v."stepIndex"::text AND v."stepIndex" BETWEEN 0 AND 499
          AND jsonb_typeof(a.metadata->'requestHash')='string' AND (a.metadata->>'requestHash') ~ '^[a-f0-9]{64}$'
          AND (v."requestHash") ~ '^[a-f0-9]{64}$'
          AND jsonb_typeof(a.metadata->'revisionId')='string' AND a.metadata->>'revisionId'=v.id
          AND jsonb_typeof(a.metadata->'testRunId')='string' AND a.metadata->>'testRunId'=v."testRunId"
          AND jsonb_typeof(a.metadata->'testCaseId')='string' AND a.metadata->>'testCaseId'=v."testCaseId"
          AND jsonb_typeof(a.metadata->'idempotencyKey')='string' AND a.metadata->>'idempotencyKey'=v."idempotencyKey"
          AND jsonb_typeof(a.metadata->'projectId')='string' AND a.metadata->>'projectId'=r."projectId"
          AND jsonb_typeof(a.metadata->'scope'->'projectId')='string' AND a.metadata->'scope'->>'projectId'=r."projectId"
          AND jsonb_typeof(a.metadata->'scope'->'organizationId')='string' AND a.metadata->'scope'->>'organizationId'=p."organizationId"
          AND jsonb_typeof(a.metadata->'scope'->'actorId')='string' AND a.metadata->'scope'->>'actorId'=v."actorId"
          AND jsonb_typeof(a.metadata->'scope'->'actorClerkUserId')='string' AND a.metadata->'scope'->>'actorClerkUserId'=u."clerkUserId"
          AND a."entityId"=r.id AND a."projectId"=r."projectId" AND a."organizationId"=p."organizationId"
          AND a."actorId"=v."actorId" AND v."actorId"=${actor.id}
          AND v."idempotencyKey"=${input.idempotencyKey}
          AND ((a.metadata->'caseStatus'='null'::jsonb AND v."caseStatusAtRecord" IS NULL) OR
            (jsonb_typeof(a.metadata->'caseStatus')='string' AND a.metadata->>'caseStatus' IN ('PASS','FAIL','BLOCKED','SKIP')
              AND a.metadata->>'caseStatus'=v."caseStatusAtRecord"::text)),false) AS valid
        FROM "AuditLog" a
        LEFT JOIN "ManualStepResultRevision" v ON v.id=a.metadata->>'revisionId'
        LEFT JOIN "TestRun" r ON r.id=v."testRunId"
        LEFT JOIN "Project" p ON p.id=r."projectId"
        LEFT JOIN "User" u ON u.id=v."actorId"
        WHERE a."entityType" LIKE 'ManualStepExecutionReview/%' AND a."actorId"=${actor.id}
        AND a.metadata->>'idempotencyKey'=${input.idempotencyKey}`;
        const parsedReviewed = reviewedScalarSchema.safeParse(corroborated[0]);
        if (corroborated.length !== 1 || !parsedReviewed.success)
          throw unsupported();
        const item = parsedReviewed.data;
        if (
          item.revisionId === receipt.id ||
          item.testRunId === receipt.testRunId
        )
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "A reviewed step receipt cannot be adopted through the legacy endpoint. Recover the exact reviewed request in its original editor.",
          });
      }
      return {
        revisionId: receipt.id,
        caseStatus: receipt.caseStatusAtRecord,
        recovered: true,
      };
    },
    { isolationLevel: "ReadCommitted", timeout: 20000, maxWait: 5000 },
  );
}
