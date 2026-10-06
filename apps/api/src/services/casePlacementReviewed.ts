import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  lockCaseFieldReadScope,
  type CaseFieldReadAuthorization,
  type caseFieldReadScopeSchema,
} from "./caseFieldReadScope.js";
import { lockAccess, folderActorScope } from "./caseFolders.js";
import {
  placementAccessInput,
  placementAccessOutput,
  placementPreviewInput,
  placementPreviewOutput,
  placementMetadata,
  placementMoveInput,
  placementMoveAck,
  placementStoredReceipt,
  placementMoveRequestHash,
  placementCohortHash,
  reviewedPlacementOrders,
} from "./casePlacementReviewedSchema.js";
const options = {
  isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  timeout: 20000,
  maxWait: 5000,
};
// OPEN native concurrency gate: lockAccess's initial Project discovery creates
// the RR snapshot before its advisory/Project lock. Repeated cohort reads and
// existing-row locks do NOT exclude newly committed inserts or non-participating
// legacy placement writers. They prove the admitted snapshot/locked identities,
// not a latest complete-cohort serialization. Do not cut over legacy callers or
// claim native concurrency acceptance until the placement-writer fence and its
// isolated native interleaving fixtures are reviewed and actually validated.
const refusal = () =>
  new TRPCError({
    code: "PRECONDITION_FAILED",
    message:
      "The complete saved placement exceeds supported metadata or retention bounds. No partial order, normalized path or private body was substituted.",
  });
const conflict = (
  message = "Saved placement changed. Keep the draft and explicitly review current source and target before a new request.",
) => new TRPCError({ code: "CONFLICT", message });
const nativeCount = (value: unknown): value is bigint =>
  typeof value === "bigint" && value >= 0n;
type Scope = z.infer<typeof caseFieldReadScopeSchema>;
type Row = z.infer<typeof placementMetadata>;
type Intent = z.infer<typeof placementPreviewInput>;
async function readAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  input: z.infer<typeof placementAccessInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const readScope = await lockCaseFieldReadScope(
    tx,
    userId,
    { ...input, caseId: undefined },
    authorized,
  );
  if (
    input.expectedNativeActorId !== undefined &&
    input.expectedNativeActorId !== readScope.actorId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Restore the original native placement reader before continuing.",
    });
  const member = await tx.membership.findUniqueOrThrow({
    where: {
      organizationId_userId: {
        organizationId: readScope.organizationId,
        userId,
      },
    },
    select: { role: true, seatType: true },
  });
  const canWrite =
    member.seatType === "FULL" &&
    ["OWNER", "ADMIN", "EDITOR"].includes(member.role);
  return placementAccessOutput.parse({
    projectId: input.projectId,
    caseId: input.caseId,
    readRequestId: input.readRequestId,
    readScope,
    canWrite,
    canRecover: canWrite,
  });
}
export async function accessReviewedCasePlacement(
  db: PrismaClient,
  userId: string,
  raw: z.input<typeof placementAccessInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = placementAccessInput.parse(raw);
  return db.$transaction(
    (tx) => readAccess(tx, userId, input, authorized),
    options,
  );
}
async function cohort(tx: Prisma.TransactionClient, input: Intent) {
  // Exact selected-case scalar admission, before ANY native path/row body read.
  const [selected] = await tx.$queryRaw<
    Array<{ count: bigint; bytes: bigint; unsupported: boolean }>
  >`SELECT count(*)::bigint AS count,coalesce(sum(octet_length(c.id)+octet_length(c."displayId")+coalesce(octet_length(c."suitePath"),0)),0)::bigint AS bytes,coalesce(bool_or(length(c.id) NOT BETWEEN 1 AND 200 OR octet_length(c.id)>800 OR length(c."displayId") NOT BETWEEN 1 AND 200 OR octet_length(c."displayId")>800 OR length(c."suitePath")>240 OR octet_length(c."suitePath")>960),false) AS unsupported FROM "TestCase" c WHERE c.id=${input.caseId} AND c."projectId"=${input.projectId} AND c.archived=false`;
  if (
    !selected ||
    !nativeCount(selected.count) ||
    !nativeCount(selected.bytes) ||
    typeof selected.unsupported !== "boolean" ||
    selected.unsupported ||
    selected.count > 1n ||
    selected.bytes > 4096n
  )
    throw refusal();
  if (selected.count !== 1n)
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        "An active case in the original project is required for a new placement.",
    });
  const filter = Prisma.sql`c."projectId"=${input.projectId} AND c.archived=false AND (c."suitePath" IS NOT DISTINCT FROM ${input.expectedSuitePath}::text OR c."suitePath" IS NOT DISTINCT FROM ${input.targetSuitePath}::text)`;
  const [size] = await tx.$queryRaw<
    Array<{
      count: bigint;
      sourceCount: bigint;
      targetCount: bigint;
      bytes: bigint;
      unsupported: boolean;
    }>
  >(
    Prisma.sql`SELECT count(*)::bigint AS count,count(*) FILTER(WHERE c."suitePath" IS NOT DISTINCT FROM ${input.expectedSuitePath}::text)::bigint AS "sourceCount",count(*) FILTER(WHERE c."suitePath" IS NOT DISTINCT FROM ${input.targetSuitePath}::text)::bigint AS "targetCount",coalesce(sum(octet_length(jsonb_build_array(c.id,c."displayId",c."suitePath",c."sortPosition",c."createdAt"::text,c."reviewStatus")::text)),0)::bigint AS bytes,coalesce(bool_or(length(c.id) NOT BETWEEN 1 AND 200 OR octet_length(c.id)>800 OR length(c."displayId") NOT BETWEEN 1 AND 200 OR octet_length(c."displayId")>800 OR length(c."suitePath")>240 OR octet_length(c."suitePath")>960 OR length(c."createdAt"::text)>100),false) AS unsupported FROM "TestCase" c WHERE ${filter}`,
  );
  if (
    !size ||
    ![size.count, size.sourceCount, size.targetCount, size.bytes].every(
      nativeCount,
    ) ||
    typeof size.unsupported !== "boolean" ||
    size.unsupported ||
    size.count > 4000n ||
    size.sourceCount > 2000n ||
    size.targetCount > 2000n ||
    (input.expectedSuitePath !== input.targetSuitePath &&
      size.targetCount >= 2000n) ||
    size.bytes > 1048576n
  )
    throw refusal();
  const native = await tx.$queryRaw<Row[]>(
    Prisma.sql`SELECT c.id,c."displayId",c."suitePath",c."sortPosition",c."createdAt"::text AS "createdAtText",c."reviewStatus"::text AS "reviewStatus" FROM "TestCase" c WHERE ${filter} ORDER BY c."sortPosition",c."createdAt",c.id LIMIT 4001`,
  );
  let rows: Row[];
  try {
    rows = z.array(placementMetadata).max(4000).parse(native);
  } catch {
    throw refusal();
  }
  if (
    rows.length !== Number(size.count) ||
    new Set(rows.map((row) => row.id)).size !== rows.length
  )
    throw refusal();
  const moving = rows.find((row) => row.id === input.caseId);
  if (
    !moving ||
    moving.suitePath !== input.expectedSuitePath ||
    moving.sortPosition !== input.expectedSortPosition
  )
    throw conflict();
  try {
    reviewedPlacementOrders(rows, input);
  } catch {
    throw conflict();
  }
  return {
    rows,
    moving,
    sourceCount: Number(size.sourceCount),
    targetCount: Number(size.targetCount),
  };
}
export async function previewReviewedCasePlacement(
  db: PrismaClient,
  userId: string,
  raw: z.input<typeof placementPreviewInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = placementPreviewInput.parse(raw);
  return db.$transaction(async (tx) => {
    const access = await readAccess(tx, userId, input, authorized),
      current = await cohort(tx, input);
    try {
      return placementPreviewOutput.parse({
        ...access,
        ...current,
        intent: {
          caseId: input.caseId,
          expectedSuitePath: input.expectedSuitePath,
          expectedSortPosition: input.expectedSortPosition,
          targetSuitePath: input.targetSuitePath,
          beforeCaseId: input.beforeCaseId,
        },
        expectedCohortHash: placementCohortHash(
          access.readScope,
          input,
          current.rows,
        ),
        warnings: [
          "Order includes all active cases in both exact persisted suites in this admitted snapshot, including hidden review lanes. Archived cases are unchanged.",
          "Native NULL, empty and whitespace paths are distinct. This operation changes persisted suite assignment and order, never source-file paths or saved procedures.",
          "This is a current placement review, not a case-content version or folder lifecycle change.",
          "Native whole-cohort concurrency is not yet validated: the current snapshot and existing-row locks do not exclude every concurrent insert or legacy writer.",
        ],
      });
    } catch {
      throw refusal();
    }
  }, options);
}
export async function moveReviewedCasePlacement(
  db: PrismaClient,
  userId: string,
  raw: z.input<typeof placementMoveInput>,
  authorized: CaseFieldReadAuthorization,
) {
  const input = placementMoveInput.parse(raw),
    requestHash = placementMoveRequestHash(input);
  try {
    return await db.$transaction(async (tx) => {
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout='8000ms'`);
      const organizationId = await lockAccess(
          tx,
          userId,
          input.projectId,
          true,
        ),
        actor = await folderActorScope(
          tx,
          userId,
          input.projectId,
          organizationId,
          authorized,
        );
      if (
        organizationId !== input.originalOrganizationId ||
        actor.clerkActorId !== input.expectedClerkActorId ||
        userId !== input.expectedNativeActorId
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message:
            "Restore the original native author and workspace before recovering a retained placement request.",
        });
      const scope: Scope = {
        projectId: input.projectId,
        organizationId,
        actorId: userId,
        actorClerkUserId: actor.clerkActorId,
      };
      // Existing native UNIQUE(projectId,actorId,requestId), domain separated.
      // Never adopt/rewrite an old folder receipt or collide silently with it.
      const [prior] = await tx.$queryRaw<
        Array<{
          id: string;
          inputHash: string;
          kind: string | null;
          version: string | null;
          organizationId: string | null;
          bytes: bigint;
        }>
      >`SELECT CASE WHEN length(id) BETWEEN 1 AND 200 AND octet_length(id)<=800 THEN id ELSE NULL END AS id,CASE WHEN length("inputHash")=64 AND "inputHash" ~ '^[a-f0-9]{64}$' THEN "inputHash" ELSE NULL END AS "inputHash",CASE WHEN jsonb_typeof(receipt->'kind')='string' AND length(receipt->>'kind')<=100 AND octet_length(receipt->>'kind')<=400 THEN receipt->>'kind' ELSE NULL END AS kind,CASE WHEN jsonb_typeof(receipt->'version')='number' AND receipt->>'version'='1' THEN '1' ELSE NULL END AS version,CASE WHEN jsonb_typeof(receipt->'organizationId')='string' AND length(receipt->>'organizationId') BETWEEN 1 AND 200 AND octet_length(receipt->>'organizationId')<=800 THEN receipt->>'organizationId' ELSE NULL END AS "organizationId",octet_length(receipt::text)::bigint AS bytes FROM "CaseFolderWrite" WHERE "projectId"=${input.projectId} AND "actorId"=${userId} AND "requestId"=${input.requestId}`;
      const ack = (
        receipt: z.infer<typeof placementStoredReceipt>,
        receiptId: string,
        recovered: boolean,
      ) =>
        placementMoveAck.parse({
          kind: receipt.kind,
          version: receipt.version,
          projectId: input.projectId,
          caseId: input.caseId,
          readScope: scope,
          requestId: input.requestId,
          requestHash,
          receiptId,
          suitePath: receipt.suitePath,
          sortPosition: receipt.sortPosition,
          recovered,
        });
      if (prior) {
        if (prior.kind !== "CasePlacementReviewedMove" || prior.version !== "1")
          throw conflict(
            "This UUID already belongs to a different reviewed operation. Retain the original request; it was not adopted or replaced.",
          );
        if (prior.organizationId !== organizationId)
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "The retained placement receipt belongs to a former organization.",
          });
        if (prior.inputHash !== requestHash)
          throw conflict(
            "Retry the exact original placement request. This UUID cannot approve replacement content.",
          );
        if (
          !prior.id ||
          prior.id.length > 200 ||
          !nativeCount(prior.bytes) ||
          prior.bytes > 2097152n
        )
          throw refusal();
        const stored = await tx.caseFolderWrite.findUniqueOrThrow({
          where: {
            projectId_actorId_requestId: {
              projectId: input.projectId,
              actorId: userId,
              requestId: input.requestId,
            },
          },
          select: { id: true, receipt: true },
        });
        let receipt: z.infer<typeof placementStoredReceipt>;
        try {
          receipt = placementStoredReceipt.parse(stored.receipt);
        } catch {
          throw refusal();
        }
        if (
          stored.id !== prior.id ||
          receipt.requestHash !== requestHash ||
          receipt.requestId !== input.requestId ||
          receipt.caseId !== input.caseId ||
          receipt.organizationId !== organizationId ||
          JSON.stringify(receipt.scope) !== JSON.stringify(scope) ||
          receipt.beforeCohortHash !== input.expectedCohortHash ||
          placementCohortHash(scope, input, receipt.before) !==
            input.expectedCohortHash ||
          receipt.suitePath !== input.targetSuitePath
        )
          throw conflict(
            "The retained receipt has unsupported original scope or identity; no replacement acknowledgement was constructed.",
          );
        let retainedPlan: ReturnType<typeof reviewedPlacementOrders>;
        try {
          retainedPlan = reviewedPlacementOrders(receipt.before, input);
        } catch {
          throw refusal();
        }
        if (
          receipt.sortPosition !== retainedPlan.index ||
          JSON.stringify(receipt.after) !== JSON.stringify(retainedPlan.after)
        )
          throw conflict(
            "The retained placement receipt has inconsistent complete order evidence; it was not repaired or adopted.",
          );
        return ack(receipt, stored.id, true);
      }
      const previewInput: Intent = {
        projectId: input.projectId,
        caseId: input.caseId,
        originalOrganizationId: input.originalOrganizationId,
        expectedClerkActorId: input.expectedClerkActorId,
        expectedNativeActorId: input.expectedNativeActorId,
        expectedSuitePath: input.expectedSuitePath,
        expectedSortPosition: input.expectedSortPosition,
        targetSuitePath: input.targetSuitePath,
        beforeCaseId: input.beforeCaseId,
        readRequestId: input.requestId,
      };
      const initial = await cohort(tx, previewInput);
      const locked = await tx.$queryRaw<Array<{ id: string }>>(
        Prisma.sql`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(initial.rows.map((row) => row.id).sort())}) ORDER BY id FOR UPDATE`,
      );
      const admittedIds = new Set(initial.rows.map((row) => row.id));
      if (
        locked.length !== admittedIds.size ||
        new Set(locked.map((row) => row.id)).size !== locked.length ||
        locked.some((row) => !admittedIds.has(row.id))
      )
        throw conflict();
      const current = await cohort(tx, previewInput),
        currentHash = placementCohortHash(scope, input, current.rows);
      if (
        currentHash !== input.expectedCohortHash ||
        placementCohortHash(scope, input, initial.rows) !== currentHash
      )
        throw conflict();
      const planned = reviewedPlacementOrders(current.rows, input),
        receipt = placementStoredReceipt.parse({
          kind: "CasePlacementReviewedMove",
          version: 1,
          organizationId,
          scope,
          caseId: input.caseId,
          requestId: input.requestId,
          requestHash,
          before: current.rows,
          after: planned.after,
          beforeCohortHash: currentHash,
          suitePath: input.targetSuitePath,
          sortPosition: planned.index,
        });
      // Match existing folder retention bound. Compute before first row write.
      if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > 2097152)
        throw refusal();
      const [encoded] = await tx.$queryRaw<
        Array<{ bytes: bigint }>
      >`SELECT octet_length(${JSON.stringify(receipt)}::jsonb::text)::bigint AS bytes`;
      if (!encoded || !nativeCount(encoded.bytes) || encoded.bytes > 2097152n)
        throw refusal();
      for (let index = 0; index < planned.after.length; index++) {
        const after = planned.after[index]!,
          before = current.rows[index]!;
        if (
          before.suitePath === after.suitePath &&
          before.sortPosition === after.sortPosition
        )
          continue;
        const changed = await tx.testCase.updateMany({
          where: {
            id: after.id,
            projectId: input.projectId,
            archived: false,
            suitePath: before.suitePath,
            sortPosition: before.sortPosition,
          },
          data: {
            suitePath: after.suitePath,
            sortPosition: after.sortPosition,
            ...(after.id === input.caseId ? { updatedById: userId } : {}),
          },
        });
        if (changed.count !== 1) throw conflict();
      }
      const saved = await tx.caseFolderWrite.create({
        data: {
          projectId: input.projectId,
          actorId: userId,
          requestId: input.requestId,
          inputHash: requestHash,
          receipt: receipt as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.auditLog.create({
        data: {
          organizationId,
          projectId: input.projectId,
          actorId: userId,
          entityType: "CasePlacementReviewedMove",
          entityId: input.caseId,
          action: "UPDATE",
          summary: "Saved explicitly reviewed case suite placement and order",
          metadata: {
            version: 1,
            receiptId: saved.id,
            requestId: input.requestId,
            requestHash,
            caseId: input.caseId,
            affectedCases: current.rows.length,
          },
        },
      });
      return ack(receipt, saved.id, false);
    }, options);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      ["P2034", "P2002", "40001"].includes(String(error.code))
    )
      throw conflict(
        "Native placement serialization refused this attempt. An earlier unknown response is not proof of rejection; retain and retry the exact original UUID.",
      );
    throw error;
  }
}
