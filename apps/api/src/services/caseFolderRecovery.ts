import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import {
  folderCaseHeadHash,
  folderActorScope,
  lockAccess,
  readTree,
} from "./caseFolders.js";
import {
  folderPathSchema,
  pathWithin,
  MAX_FOLDER_CASES,
} from "./caseFolderSchema.js";
import {
  approvedFolderRecoverySchema,
  folderRecoveryInputSchema,
  recoverableFolderReceiptSchema,
} from "./caseFolderRecoverySchema.js";

type Tx = Prisma.TransactionClient;
type Review = z.infer<typeof folderRecoveryInputSchema>;
function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}
async function prepareRecovery(tx: Tx, actorId: string, input: Review) {
  await requireCurrentPlanAccess(tx, actorId, input.projectId, true);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  const [size] = await tx.$queryRaw<
    Array<{ bytes: number }>
  >`SELECT octet_length(receipt::text) AS bytes FROM "CaseFolderWrite" WHERE id=${input.originalReceiptId} AND "projectId"=${input.projectId}`;
  if (!size)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Folder receipt is not in this project.",
    });
  if (size.bytes > 2 * 1024 * 1024)
    conflict(
      "Retained folder receipt exceeds the supported bound; no partial recovery is offered.",
    );
  const original = await tx.caseFolderWrite.findFirstOrThrow({
    where: { id: input.originalReceiptId, projectId: input.projectId },
  });
  const parsed = recoverableFolderReceiptSchema.safeParse(original.receipt);
  if (!parsed.success)
    conflict(
      "This receipt does not retain the complete supported rename/move baseline. No history or procedure was invented.",
    );
  const saved = parsed.data;
  if (saved.organizationId !== project.organizationId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Receipt organization no longer matches the project.",
    });
  const tree = await readTree(tx, input.projectId);
  if (
    tree.revision !== saved.revision ||
    qualityProfileHash(tree.explicit) !== qualityProfileHash(saved.foldersAfter)
  )
    conflict(
      "Folders changed after that operation. Review current folders instead of overwriting newer organization work.",
    );
  if (tree.paths.some((path) => pathWithin(path, saved.fromPath)))
    conflict(
      "The original location now contains a folder or descendants. Recovery never merges or overwrites them.",
    );
  const metadata = await tx.testCase.findMany({
    where: {
      projectId: input.projectId,
      OR: [
        { suitePath: saved.toPath },
        { suitePath: { startsWith: saved.toPath + "/" } },
        {
          suitePath: null,
          source: {
            OR: [
              { filePath: saved.toPath },
              { filePath: { startsWith: saved.toPath + "/" } },
            ],
          },
        },
        {
          suitePath: "",
          source: {
            OR: [
              { filePath: saved.toPath },
              { filePath: { startsWith: saved.toPath + "/" } },
            ],
          },
        },
      ],
    },
    select: {
      id: true,
      displayId: true,
      suitePath: true,
      sortPosition: true,
      updatedAt: true,
      archived: true,
      source: { select: { filePath: true } },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { versionNumber: true },
      },
    },
    orderBy: { id: "asc" },
    take: MAX_FOLDER_CASES + 1,
  });
  const ids = metadata.map((row) => row.id);
  if (
    metadata.length > MAX_FOLDER_CASES ||
    metadata.length !== saved.moves.length ||
    qualityProfileHash([...ids].sort()) !==
      qualityProfileHash(saved.moves.map((m) => m.id).sort())
  )
    conflict(
      "The operation's case membership changed. No incomplete subtree recovery was substituted.",
    );
  for (const move of saved.moves) {
    const row = metadata.find((c) => c.id === move.id)!;
    const oldEffective = move.fromSuitePath || move.sourceFilePath;
    if (
      !oldEffective ||
      !pathWithin(oldEffective, saved.fromPath) ||
      move.toSuitePath !==
        saved.toPath + oldEffective.slice(saved.fromPath.length)
    )
      conflict(
        "The retained placement mapping is inconsistent; original data remains unchanged.",
      );
    if (
      row.displayId !== move.displayId ||
      row.suitePath !== move.toSuitePath ||
      row.sortPosition !== move.sortPosition ||
      row.archived !== move.archived ||
      (row.source?.filePath ?? null) !== move.sourceFilePath ||
      row.updatedAt.toISOString() !== move.appliedUpdatedAt ||
      row.versions[0]?.versionNumber !== move.newVersion
    )
      conflict(
        "A case's placement, identity, order, source, archive state or saved version changed after that operation.",
      );
  }
  if (ids.length) {
    const [sizes] = await tx.$queryRaw<Array<{ bytes: bigint; steps: bigint }>>(
      Prisma.sql`SELECT (coalesce(sum(octet_length(to_jsonb(c)::text)),0)+(SELECT coalesce(sum(octet_length(to_jsonb(s)::text)),0) FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)})))::bigint AS bytes,(SELECT count(*)::bigint FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)})) AS steps FROM "TestCase" c WHERE c.id IN (${Prisma.join(ids)})`,
    );
    if (!sizes || sizes.bytes > 8n * 1024n * 1024n || sizes.steps > 50000n)
      conflict(
        "Current procedure history exceeds the bounded recovery size; no cases were skipped.",
      );
  }
  // Own case rows only, after authorization, placement verification and byte guard.
  // Never load a foreign shared library or restore its mutable content.
  const heads = ids.length
    ? await tx.testCase.findMany({
        where: { projectId: input.projectId, id: { in: ids } },
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { id: "asc" },
      })
    : [];
  for (const move of saved.moves) {
    const head = heads.find((c) => c.id === move.id);
    if (!head || folderCaseHeadHash(head) !== move.appliedCaseHash)
      conflict(
        "Case content changed after that folder operation. Recovery refuses to overwrite or conceal a newer human edit.",
      );
  }
  const expectedHash = qualityProfileHash({
    projectId: input.projectId,
    organizationId: project.organizationId,
    originalReceiptId: original.id,
    originalInputHash: original.inputHash,
    tree,
    metadata,
    heads: heads.map(folderCaseHeadHash),
  });
  return {
    original,
    saved,
    tree,
    ids,
    expectedHash,
    organizationId: project.organizationId,
  };
}
export async function readRecoverableFolderCatalog(
  db: PrismaClient,
  actorId: string,
  projectId: string,
) {
  return db.$transaction(
    async (tx) => {
      const organizationId = await lockAccess(tx, actorId, projectId);
      const scope = await folderActorScope(
        tx,
        actorId,
        projectId,
        organizationId,
      );
      // Only bounded receipt summaries. Missing old provenance is not made up.
      const rows = await tx.$queryRaw<
        Array<{
          id: string;
          action: string;
          fromPath: string;
          toPath: string;
          createdAt: Date;
        }>
      >`SELECT id,receipt->>'action' AS action,receipt->>'fromPath' AS "fromPath",receipt->>'toPath' AS "toPath","createdAt" FROM "CaseFolderWrite" WHERE "projectId"=${projectId} AND receipt->>'organizationId'=${organizationId} AND receipt->>'schemaVersion'='1' AND receipt->>'action' IN ('RENAME','MOVE') AND length(receipt->>'fromPath') BETWEEN 1 AND 240 AND length(receipt->>'toPath') BETWEEN 1 AND 240 ORDER BY "createdAt" DESC,id DESC LIMIT 25`;
      return {
        ...scope,
        items: rows.map((row) => ({
          ...row,
          createdAt: row.createdAt.toISOString(),
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
// Keep the legacy endpoint's exact array shape for existing clients.
export async function listRecoverableFolderChanges(
  db: PrismaClient,
  actorId: string,
  projectId: string,
) {
  return (await readRecoverableFolderCatalog(db, actorId, projectId)).items;
}
export async function previewFolderRecovery(
  db: PrismaClient,
  actorId: string,
  input: Review,
) {
  return db.$transaction(
    async (tx) => {
      const organizationId = await lockAccess(tx, actorId, input.projectId);
      const scope = await folderActorScope(
        tx,
        actorId,
        input.projectId,
        organizationId,
      );
      const p = await prepareRecovery(tx, actorId, input);
      return {
        ...scope,
        expectedHash: p.expectedHash,
        originalReceiptId: p.original.id,
        fromPath: p.saved.toPath,
        toPath: p.saved.fromPath,
        caseCount: p.saved.moves.length,
        archivedCaseCount: p.saved.moves.filter((m) => m.archived).length,
        cases: p.saved.moves.map((m) => ({
          id: m.id,
          displayId: m.displayId,
          currentPath: m.toSuitePath,
          restoredSuitePath: m.fromSuitePath,
          restoredEffectivePath: m.fromSuitePath || m.sourceFilePath,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function writeFolderRecovery(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof approvedFolderRecoverySchema>,
) {
  const inputHash = qualityProfileHash(input);
  const execute = () =>
    db.$transaction(
      async (tx) => {
        const organizationId = await lockAccess(tx, actorId, input.projectId);
        const scope = await folderActorScope(
          tx,
          actorId,
          input.projectId,
          organizationId,
        );
        if (
          input.expectedScope &&
          (input.expectedScope.organizationId !== scope.organizationId ||
            input.expectedScope.clerkActorId !== scope.clerkActorId)
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Return to the account and workspace that reviewed this folder recovery before retrying it.",
          });
        const prior = await tx.caseFolderWrite.findUnique({
          where: {
            projectId_actorId_requestId: {
              projectId: input.projectId,
              actorId,
              requestId: input.requestId,
            },
          },
        });
        if (prior) {
          if (prior.inputHash !== inputHash)
            conflict(
              "This request identity belongs to a different folder operation.",
            );
          const restored = z
            .object({
              schemaVersion: z.literal(2),
              organizationId: z.string().min(1),
              action: z.literal("RESTORE"),
              toPath: folderPathSchema,
            })
            .passthrough()
            .safeParse(prior.receipt);
          if (!restored.success)
            conflict(
              "The retained recovery response is unsupported. Its original receipt was not replaced.",
            );
          if (restored.data.organizationId !== organizationId)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "The retained recovery no longer belongs to the current project organization.",
            });
          return {
            ...scope,
            requestId: input.requestId,
            originalReceiptId: input.originalReceiptId,
            receiptId: prior.id,
            recovered: true,
            destinationPath: restored.data.toPath,
          };
        }
        const first = await prepareRecovery(tx, actorId, input);
        if (first.ids.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(first.ids)}) ORDER BY id FOR UPDATE`,
          );
        const p = await prepareRecovery(tx, actorId, input);
        if (p.expectedHash !== input.expectedHash)
          conflict(
            "Recovery impact changed after review. No placement or history was changed.",
          );
        const moves = [];
        for (const move of p.saved.moves) {
          const current = await tx.testCase.update({
            where: { id: move.id },
            data: { suitePath: move.fromSuitePath, updatedById: actorId },
            include: { steps: { orderBy: { order: "asc" } } },
          });
          // Append the unchanged CURRENT procedure. Never replace it with an old
          // snapshot or alter results/frozen definitions from any original run.
          await snapshotTestCaseVersion(tx, {
            testCaseId: current.id,
            title: current.title,
            background: current.background,
            given: current.given,
            when: current.when,
            then: current.then,
            tags: current.tags,
            priority: current.priority,
            testType: current.testType,
            actorId,
            steps: current.steps.map((s) => ({
              order: s.order,
              action: s.action,
              expectedActionOrData: s.expectedActionOrData,
              expectedResult: s.expectedResult,
              expectedResponse: s.expectedResponse,
              mediaAttachmentIds: s.mediaAttachmentIds,
            })),
          });
          const version = await tx.testCaseVersion.findFirstOrThrow({
            where: { testCaseId: current.id },
            orderBy: { versionNumber: "desc" },
            select: { versionNumber: true },
          });
          moves.push({
            id: move.id,
            displayId: move.displayId,
            fromSuitePath: move.toSuitePath,
            toSuitePath: move.fromSuitePath,
            priorVersion: move.newVersion,
            newVersion: version.versionNumber,
            appliedUpdatedAt: current.updatedAt.toISOString(),
            appliedCaseHash: folderCaseHeadHash(current),
          });
        }
        const state = await tx.caseFolderState.update({
          where: { projectId: input.projectId },
          data: { revision: { increment: 1 }, folders: p.saved.foldersBefore },
        });
        const receipt = {
          schemaVersion: 2,
          action: "RESTORE",
          organizationId: p.organizationId,
          originalReceiptId: p.original.id,
          fromPath: p.saved.toPath,
          toPath: p.saved.fromPath,
          revision: state.revision,
          reason: input.reason,
          foldersBefore: p.tree.explicit,
          foldersAfter: p.saved.foldersBefore,
          moves,
        };
        if (
          Buffer.byteLength(JSON.stringify(receipt), "utf8") >
          2 * 1024 * 1024
        )
          conflict(
            "The complete recovery receipt exceeds the retention bound. Nothing was committed.",
          );
        const saved = await tx.caseFolderWrite.create({
          data: {
            projectId: input.projectId,
            actorId,
            requestId: input.requestId,
            inputHash,
            receipt: receipt as Prisma.InputJsonValue,
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: p.organizationId,
            projectId: input.projectId,
            actorId,
            entityType: "CaseFolder",
            entityId: saved.id,
            action: "UPDATE",
            summary: `Reviewed folder recovery to ${p.saved.fromPath}`,
            metadata: {
              receiptId: saved.id,
              originalReceiptId: p.original.id,
              affectedCases: moves.length,
            },
          },
        });
        return {
          ...scope,
          requestId: input.requestId,
          originalReceiptId: input.originalReceiptId,
          receiptId: saved.id,
          recovered: false,
          destinationPath: p.saved.fromPath,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 30000 },
    );
  try {
    return await execute();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2034" ||
        (error.code === "P2010" && error.meta?.code === "40001"))
    )
      return execute();
    throw error;
  }
}
