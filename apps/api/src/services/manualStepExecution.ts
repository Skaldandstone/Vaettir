import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type {
  Prisma,
  PrismaClient,
  ManualStepResultRevision,
  TestResultStatus,
} from "@vaettir/db";
import {
  observationsSchema,
  measurementVerdict,
} from "./physicalValidation.js";
import {
  readRunExperienceSnapshot,
  qualityProfileHash,
} from "./qualityExperienceProfile.js";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";

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

export async function recordManualStepResult(
  db: PrismaClient,
  actor: { id: string; name: string | null },
  input: z.infer<typeof recordStepResultInputSchema>,
) {
  const found = await db.testRun.findUnique({
    where: { id: input.testRunId },
    select: { projectId: true },
  });
  if (!found)
    throw new TRPCError({ code: "NOT_FOUND", message: "Test run not found" });
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
  return db.$transaction(
    async (tx) => {
      // Shared with attachment deletion/confirmation. Fixed lock order: project then run.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${found.projectId}))::text`;
      await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id = ${input.testRunId} FOR UPDATE`;
      const run = await tx.testRun.findUniqueOrThrow({
        where: { id: input.testRunId },
      });
      await requireCurrentPlanAccess(tx, actor.id, run.projectId, true);
      const receipt = await tx.manualStepResultRevision.findUnique({
        where: {
          testRunId_actorId_idempotencyKey: {
            testRunId: run.id,
            actorId: actor.id,
            idempotencyKey: input.idempotencyKey,
          },
        },
      });
      if (receipt) {
        if (receipt.requestHash !== requestHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "This step-recording key was used for a different request. Keep the original request for recovery or explicitly review a new correction.",
          });
        return {
          revisionId: receipt.id,
          caseStatus: receipt.caseStatusAtRecord as
            "PASS" | "FAIL" | "BLOCKED" | "SKIP" | null,
          recovered: true,
        };
      }
      if (run.ciProvider !== "manual" || run.status !== "RUNNING")
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Only an active manual run can accept new step observations. Previous receipts and history remain available.",
        });
      if (await tx.manualCaseResultHead.count({
        where: { testRunId: run.id, testCaseId: input.testCaseId },
      })) throw new TRPCError({
        code: "CONFLICT",
        message: "This case retains immutable whole-case observations. Correct those observations or start a separate run for per-step execution; prior evidence cannot be replaced.",
      });
      const definition = frozenStructuredCase(run, input.testCaseId);
      if (input.stepIndex >= definition.steps.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "That step is not part of the frozen run procedure.",
        });
      const totalBytes = await boundedCurrentStepBytes(tx, run.id);
      const heads = await tx.manualStepResultHead.findMany({
        where: { testRunId: run.id, testCaseId: input.testCaseId },
        include: { currentRevision: true },
      });
      const current = heads.find((h) => h.stepIndex === input.stepIndex);
      if ((current?.currentRevisionId ?? null) !== input.expectedRevisionId)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This step changed while you were recording it. Refresh and review the current result before correcting it.",
        });
      if (current && !correctionReason)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Explain why this recorded step needs correction. Prior observations will be retained.",
        });
      if ((current?.revisionCount ?? 0) >= 100)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This step has reached its revision limit. Start a new run rather than replacing recorded history.",
        });
      const caseResult = await tx.testResult.findFirst({
        where: { testRunId: run.id, testCaseId: input.testCaseId },
      });
      if (!heads.length && caseResult)
        throw new TRPCError({
          code: "CONFLICT",
          message:
            "This case already has a case-level verdict. Start a new run for per-step execution; the existing result will not be cleared.",
        });
      await requirePassedPrerequisites(tx, run, input.testCaseId, input.status);
      if (caseResult?.status === "PASS" && input.status !== "PASS")
        await protectExecutedDependents(tx, run, input.testCaseId);
      if (
        input.status === "PASS" &&
        observations.measurements.some(
          (m) => measurementVerdict(m) === "OUT_OF_RANGE",
        )
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "A reading is outside its recorded limits. Review the evidence or record Fail instead of Pass.",
        });
      const attachments = evidenceIds.length
        ? await tx.testCaseAttachment.findMany({
            where: {
              id: { in: evidenceIds },
              testCase: { projectId: run.projectId },
              uploadCompletedAt: { not: null },
            },
          })
        : [];
      if (attachments.length !== evidenceIds.length)
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "An evidence file is unavailable, outside this project, or its upload has not been confirmed. Nothing was recorded.",
        });
      const byId = new Map(attachments.map((a) => [a.id, a]));
      const evidenceAttachments = evidenceIds.map((id) => {
        const a = byId.get(id)!;
        const verification = verificationSchema.safeParse(a.uploadVerification);
        if (
          !verification.success ||
          a.sizeBytes <= 0 ||
          a.sizeBytes > 25 * 1024 * 1024
        )
          throw new TRPCError({
            code: "BAD_REQUEST",
            message:
              "This evidence upload needs metadata verification before it can support a step result.",
          });
        return savedStepEvidenceSchema.parse({
          id,
          fileName: safeEvidenceFileName(a.fileName),
          contentType: a.contentType,
          sizeBytes: a.sizeBytes,
          verification: verification.data,
        });
      });
      const statuses = new Map(
        heads.map((h) => [h.stepIndex, h.currentRevision.status]),
      );
      statuses.set(input.stepIndex, input.status);
      const caseStatus =
        statuses.size === definition.steps.length
          ? aggregateStepStatus([...statuses.values()])
          : null;
      const actorName = actor.name?.trim().slice(0, 200) || "Workspace member";
      // Includes full persisted evidence metadata plus conservative identity/timestamp overhead.
      const currentPayloadBytes =
        Buffer.byteLength(
          JSON.stringify({
            note,
            observations,
            evidenceAttachments,
            actorName,
            correctionReason,
          }),
          "utf8",
        ) + 2048;
      if (
        totalBytes - (current?.currentPayloadBytes ?? 0) + currentPayloadBytes >
        MAX_CURRENT_STEP_BYTES
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "This run has reached its bounded observation size. Start a smaller new run; no existing evidence or history was replaced.",
        });
      const revision = await tx.manualStepResultRevision.create({
        data: {
          testRunId: run.id,
          testCaseId: input.testCaseId,
          stepIndex: input.stepIndex,
          revisionNumber: (current?.revisionCount ?? 0) + 1,
          status: input.status,
          caseStatusAtRecord: caseStatus,
          note,
          observations,
          evidenceAttachmentIds: evidenceIds,
          evidenceAttachments,
          actorId: actor.id,
          actorName,
          correctionReason,
          previousRevisionId: current?.currentRevisionId ?? null,
          idempotencyKey: input.idempotencyKey,
          requestHash,
        },
      });
      await tx.manualStepResultHead.upsert({
        where: {
          testRunId_testCaseId_stepIndex: {
            testRunId: run.id,
            testCaseId: input.testCaseId,
            stepIndex: input.stepIndex,
          },
        },
        create: {
          testRunId: run.id,
          testCaseId: input.testCaseId,
          stepIndex: input.stepIndex,
          currentRevisionId: revision.id,
          revisionCount: revision.revisionNumber,
          currentPayloadBytes,
        },
        update: {
          currentRevisionId: revision.id,
          revisionCount: revision.revisionNumber,
          currentPayloadBytes,
        },
      });
      if (caseStatus) {
        const data = {
          status: caseStatus as TestResultStatus,
          note: `Derived from ${definition.steps.length} recorded step outcomes. Per-step measurements and evidence remain on their immutable revisions.`,
          observations: {},
        };
        // Mixed-version database protection. This local selector is scoped to
        // this exact derived write, not an actor authorization substitute.
        await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', ${JSON.stringify([run.id, input.testCaseId])}, true)`;
        if (caseResult)
          await tx.testResult.update({ where: { id: caseResult.id }, data });
        else
          await tx.testResult.create({
            data: {
              testRunId: run.id,
              testCaseId: input.testCaseId,
              ...data,
            },
          });
        // Failed SQL aborts the transaction; rollback clears SET LOCAL. A
        // finally reset would mask the original failure with PostgreSQL 25P02.
        await tx.$queryRaw`SELECT set_config('vaettir.manual_step_projection', '', true)`;
      }
      return { revisionId: revision.id, caseStatus, recovered: false };
    },
    { timeout: 20000 },
  );
}
