import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { snapshotTestCaseVersion } from "./testCaseVersion.js";
import { lockCurrentCaseFieldActor, type CaseFieldReadAuthorization } from "./caseFieldReadScope.js";
import {
  approvedFolderChangeSchema,
  folderChangeSchema,
  folderStateSchema,
  folderPathSchema,
  folderAncestors,
  pathWithin,
  parentPath,
  leafPath,
  MAX_CASE_FOLDERS,
  MAX_FOLDER_CASES,
} from "./caseFolderSchema.js";

type Tx = Prisma.TransactionClient;
type Change = z.infer<typeof folderChangeSchema>;
const bad = (message: string): never => {
  throw new TRPCError({ code: "BAD_REQUEST", message });
};
export function readFolders(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 256 * 1024)
    return bad(
      "Folder state exceeds the bounded view; no incomplete tree was substituted.",
    );
  const parsed = folderStateSchema.safeParse(value);
  if (!parsed.success)
    return bad(
      "Stored folder definitions need repair; original content was not replaced.",
    );
  return parsed.data;
}
const stableFolderId = (projectId: string, path: string) =>
  `folder_${createHash("sha256")
    .update(JSON.stringify([projectId, path]))
    .digest("hex")}`;
export async function readTree(tx: Tx, projectId: string) {
  const state = await tx.caseFolderState.findUnique({ where: { projectId } });
  const explicit = readFolders(state?.folders ?? []);
  const [oversized] = await tx.$queryRaw<
    Array<{ invalid: boolean }>
  >`SELECT EXISTS(SELECT 1 FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE c."projectId"=${projectId} AND (octet_length(coalesce(nullif(c."suitePath",''),s."filePath"))>960 OR octet_length(s."filePath")>4096)) AS invalid`;
  if (oversized?.invalid)
    return bad(
      "A legacy suite or source path exceeds the bounded hierarchy view. No paths were truncated or silently replaced.",
    );
  // Include source-derived legacy suites without altering their original paths.
  const locations = await tx.$queryRaw<
    Array<{ path: string }>
  >`SELECT DISTINCT coalesce(nullif(c."suitePath",''),s."filePath") AS path FROM "TestCase" c LEFT JOIN "TestCaseSource" s ON s."testCaseId"=c.id WHERE c."projectId"=${projectId} AND coalesce(nullif(c."suitePath",''),s."filePath") IS NOT NULL ORDER BY path LIMIT 501`;
  if (locations.length > MAX_CASE_FOLDERS)
    return bad(
      "Project has more than 500 suite paths; use a smaller hierarchy before editing folders.",
    );
  const paths = new Set<string>();
  for (const path of [
    ...explicit.map((f) => f.path),
    ...locations.map((r) => r.path),
  ]) {
    if (!folderPathSchema.safeParse(path).success)
      return bad(
        "A legacy suite path is outside the supported eight-level / 240-character folder format. No paths were normalized or removed.",
      );
    for (const parent of folderAncestors(path)) paths.add(parent);
  }
  if (paths.size > MAX_CASE_FOLDERS)
    return bad(
      "Hierarchy exceeds the 500-folder safety bound; no branches were hidden.",
    );
  return { explicit, paths: [...paths].sort(), revision: state?.revision ?? 0 };
}
function affectedWhere(projectId: string, fromPath: string) {
  const source = {
    OR: [{ filePath: fromPath }, { filePath: { startsWith: `${fromPath}/` } }],
  };
  return {
    projectId,
    OR: [
      { suitePath: fromPath },
      { suitePath: { startsWith: `${fromPath}/` } },
      { suitePath: null, source },
      { suitePath: "", source },
    ],
  };
}
async function prepare(
  tx: Tx,
  actorId: string,
  input: Change,
  newFolderId = "pending_folder",
) {
  await requireCurrentPlanAccess(tx, actorId, input.projectId, true);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  const tree = await readTree(tx, input.projectId);
  const from = input.fromPath;
  if (from && !tree.paths.includes(from))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Source folder is not in this project.",
    });
  if (from === input.toPath) return bad("Choose a different name or parent.");
  if (from && pathWithin(input.toPath, from))
    return bad("A folder cannot move into itself or its descendants.");
  const parent = parentPath(input.toPath);
  if (parent && !tree.paths.includes(parent))
    return bad("Choose an existing parent folder or the project root.");
  if (input.action === "RENAME" && parentPath(from!) !== parent)
    return bad("Rename preserves the parent; use Move to change parents.");
  if (input.action === "MOVE" && leafPath(from!) !== leafPath(input.toPath))
    return bad("Move preserves the folder name; use Rename to change it.");
  const mapped = (path: string) =>
    from && pathWithin(path, from)
      ? input.toPath + path.slice(from.length)
      : path;
  const subtree = tree.paths.filter((path) => from && pathWithin(path, from));
  const others = tree.paths.filter((path) => !from || !pathWithin(path, from));
  if (others.some((path) => pathWithin(path, input.toPath)))
    return bad(
      "Destination already has a folder or descendants. Folder moves do not silently merge suites.",
    );
  const targetPaths =
    input.action === "CREATE" ? [input.toPath] : subtree.map(mapped);
  if (targetPaths.some((path) => !folderPathSchema.safeParse(path).success))
    return bad(
      "Moved descendants exceed the eight-level / 240-character path bound.",
    );
  if (new Set([...others, ...targetPaths]).size > MAX_CASE_FOLDERS)
    return bad("This change would exceed 500 folder paths.");
  const affected = from
    ? await tx.testCase.findMany({
        where: affectedWhere(input.projectId, from),
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
      })
    : [];
  if (affected.length > MAX_FOLDER_CASES)
    return bad(
      "This subtree exceeds the 1,000-case atomic move limit. No partial move was substituted.",
    );
  const placements = affected.map((c) => ({
    id: c.id,
    displayId: c.displayId,
    fromSuitePath: c.suitePath,
    sourceFilePath: c.source?.filePath ?? null,
    toSuitePath: mapped(c.suitePath || c.source?.filePath || ""),
    sortPosition: c.sortPosition,
    updatedAt: c.updatedAt.toISOString(),
    version: c.versions[0]?.versionNumber ?? 0,
    archived: c.archived,
  }));
  const expectedHash = qualityProfileHash({
    projectId: input.projectId,
    organizationId: project.organizationId,
    action: input.action,
    fromPath: from ?? null,
    toPath: input.toPath,
    tree,
    placements,
  });
  let folders = tree.explicit.map((f) => ({ ...f, path: mapped(f.path) }));
  if (!from || !tree.explicit.some((f) => f.path === from))
    folders.push({ id: newFolderId, path: input.toPath });
  folders = readFolders(folders);
  return { project, tree, folders, placements, expectedHash };
}
export async function listCaseFolders(
  db: PrismaClient,
  actorId: string,
  projectId: string,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const organizationId = await lockAccess(tx, actorId, projectId, false);
      const scope = await folderActorScope(
        tx,
        actorId,
        projectId,
        organizationId,
        authorized,
      );
      const tree = await readTree(tx, projectId);
      let canEdit = false;
      try {
        await requireCurrentPlanAccess(tx, actorId, projectId, true);
        canEdit = true;
      } catch (error) {
        if (!(error instanceof TRPCError && error.code === "FORBIDDEN"))
          throw error;
      }
      return {
        ...scope,
        paths: tree.paths,
        folders: tree.explicit,
        revision: tree.revision,
        canEdit,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function previewCaseFolderChange(
  db: PrismaClient,
  actorId: string,
  input: Change,
  authorized?: CaseFieldReadAuthorization,
) {
  return db.$transaction(
    async (tx) => {
      const organizationId = await lockAccess(tx, actorId, input.projectId);
      const scope = await folderActorScope(
        tx,
        actorId,
        input.projectId,
        organizationId,
        authorized,
      );
      const prepared = await prepare(tx, actorId, input);
      return {
        ...scope,
        action: input.action,
        expectedHash: prepared.expectedHash,
        fromPath: input.fromPath ?? null,
        toPath: input.toPath,
        caseCount: prepared.placements.length,
        archivedCaseCount: prepared.placements.filter((c) => c.archived).length,
        descendantCount: prepared.tree.paths.filter(
          (p) =>
            input.fromPath &&
            p !== input.fromPath &&
            pathWithin(p, input.fromPath),
        ).length,
        cases: prepared.placements.map((c) => ({
          id: c.id,
          displayId: c.displayId,
          fromSuitePath: c.fromSuitePath,
          toSuitePath: c.toSuitePath,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export function folderCaseHeadHash(value: unknown) {
  // Dates and complete own-step rows must remain real values, not empty objects
  // produced by canonicalizing Date instances. No shared-library body is read.
  return qualityProfileHash(JSON.parse(JSON.stringify(value)));
}
export async function folderActorScope(
  tx: Tx,
  actorId: string,
  projectId: string,
  organizationId: string,
  authorized?: CaseFieldReadAuthorization,
) {
  // Callers hold the current Project lock before this scope/body boundary.
  const clerkActorId = await lockCurrentCaseFieldActor(tx, actorId, authorized);
  return { projectId, organizationId, clerkActorId };
}
export async function lockAccess(
  tx: Tx,
  actorId: string,
  projectId: string,
  requireWrite = true,
) {
  const initial = await tx.project.findUnique({
    where: { id: projectId },
    select: { organizationId: true },
  });
  if (!initial)
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${initial.organizationId} FOR SHARE`;
  await tx.$queryRaw`SELECT id FROM "Membership" WHERE "organizationId"=${initial.organizationId} AND "userId"=${actorId} FOR SHARE`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${projectId}))::text`;
  const [locked] = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  if (locked?.organizationId !== initial.organizationId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Project ownership changed. Review its current folders again.",
    });
  await requireCurrentPlanAccess(tx, actorId, projectId, requireWrite);
  return initial.organizationId;
}
export async function writeCaseFolderChange(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof approvedFolderChangeSchema>,
  authorized?: CaseFieldReadAuthorization,
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
          authorized,
        );
        if (
          input.expectedScope &&
          (input.expectedScope.organizationId !== scope.organizationId ||
            input.expectedScope.clerkActorId !== scope.clerkActorId)
        )
          throw new TRPCError({
            code: "FORBIDDEN",
            message:
              "Return to the account and workspace that reviewed this folder request before retrying it.",
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
          const provenance = z
            .object({ organizationId: z.string().min(1) })
            .passthrough()
            .safeParse(prior.receipt);
          if (
            !provenance.success ||
            provenance.data.organizationId !== organizationId
          )
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "The retained folder operation no longer belongs to the current project organization.",
            });
          if (prior.inputHash !== inputHash)
            throw new TRPCError({
              code: "CONFLICT",
              message:
                "This request ID belongs to a different reviewed folder change.",
            });
          return {
            ...scope,
            requestId: input.requestId,
            receiptId: prior.id,
            recovered: true,
          };
        }
        const change: Change = {
          projectId: input.projectId,
          action: input.action,
          toPath: input.toPath,
          ...(input.fromPath ? { fromPath: input.fromPath } : {}),
        };
        const candidate = await prepare(tx, actorId, change);
        // Lock every affected current case; the second snapshot catches content,
        // placement, version and archive edits without copying another tab's data.
        const ids = candidate.placements.map((c) => c.id);
        if (ids.length)
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
        const prepared = await prepare(
          tx,
          actorId,
          change,
          stableFolderId(
            input.projectId,
            JSON.stringify([actorId, input.requestId]),
          ),
        );
        if (prepared.expectedHash !== input.expectedHash)
          throw new TRPCError({
            code: "CONFLICT",
            message:
              "The hierarchy or affected cases changed after review. Nothing was moved.",
          });
        if (ids.length) {
          const [sizes] = await tx.$queryRaw<
            Array<{ bytes: bigint; steps: bigint }>
          >(
            Prisma.sql`SELECT (coalesce(sum(octet_length(to_jsonb(c)::text)),0)+(SELECT coalesce(sum(octet_length(to_jsonb(s)::text)),0) FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)})))::bigint AS bytes,(SELECT count(*)::bigint FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)})) AS steps FROM "TestCase" c WHERE c.id IN (${Prisma.join(ids)})`,
          );
          if (
            !sizes ||
            sizes.bytes > 8n * 1024n * 1024n ||
            sizes.steps > 50000n
          )
            return bad(
              "Affected procedure history exceeds the 8 MiB / 50,000-step bound. No partial move was made.",
            );
        }
        const moves = [];
        for (const placement of prepared.placements) {
          const moved = await tx.testCase.update({
            where: { id: placement.id },
            data: { suitePath: placement.toSuitePath, updatedById: actorId },
            include: { steps: { orderBy: { order: "asc" } } },
          });
          await snapshotTestCaseVersion(tx, {
            testCaseId: moved.id,
            title: moved.title,
            background: moved.background,
            given: moved.given,
            when: moved.when,
            then: moved.then,
            steps: moved.steps.map((s) => ({
              order: s.order,
              action: s.action,
              expectedActionOrData: s.expectedActionOrData,
              expectedResult: s.expectedResult,
              expectedResponse: s.expectedResponse,
              mediaAttachmentIds: s.mediaAttachmentIds,
            })),
            tags: moved.tags,
            priority: moved.priority,
            testType: moved.testType,
            actorId,
          });
          const version = await tx.testCaseVersion.findFirstOrThrow({
            where: { testCaseId: moved.id },
            orderBy: { versionNumber: "desc" },
            select: { versionNumber: true },
          });
          moves.push({
            ...placement,
            newVersion: version.versionNumber,
            appliedUpdatedAt: moved.updatedAt.toISOString(),
            appliedCaseHash: folderCaseHeadHash(moved),
          });
        }
        const state = await tx.caseFolderState.upsert({
          where: { projectId: input.projectId },
          create: {
            projectId: input.projectId,
            revision: 1,
            folders: prepared.folders,
          },
          update: { revision: { increment: 1 }, folders: prepared.folders },
        });
        const receipt = {
          schemaVersion: 1,
          organizationId: prepared.project.organizationId,
          action: input.action,
          fromPath: input.fromPath ?? null,
          toPath: input.toPath,
          reason: input.reason,
          revision: state.revision,
          foldersBefore: prepared.tree.explicit,
          foldersAfter: prepared.folders,
          moves,
        };
        if (
          Buffer.byteLength(JSON.stringify(receipt), "utf8") >
          2 * 1024 * 1024
        )
          return bad(
            "The complete placement receipt exceeds the retention bound. Transaction was not committed.",
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
            organizationId: prepared.project.organizationId,
            projectId: input.projectId,
            actorId,
            entityType: "CaseFolder",
            entityId: saved.id,
            action: "UPDATE",
            summary: `${input.action} folder ${input.toPath}`,
            metadata: {
              receiptId: saved.id,
              fromPath: input.fromPath ?? null,
              toPath: input.toPath,
              affectedCases: moves.length,
            },
          },
        });
        return {
          ...scope,
          requestId: input.requestId,
          receiptId: saved.id,
          recovered: false,
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
