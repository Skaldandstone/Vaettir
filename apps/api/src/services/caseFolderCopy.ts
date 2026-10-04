import { createHash } from "node:crypto";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { sourceState, createCaseCloneInTransaction } from "./caseClone.js";
import {
  readTree,
  readFolders,
  lockAccess,
  folderCaseHeadHash,
  folderActorScope,
} from "./caseFolders.js";
import {
  folderAncestors,
  folderPathSchema,
  parentPath,
  pathWithin,
  MAX_CASE_FOLDERS,
} from "./caseFolderSchema.js";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import { readCaseFieldState } from "./caseFields.js";
import {
  folderCopyReviewSchema,
  folderCopyApprovalSchema,
  MAX_FOLDER_COPY_CASES,
  MAX_FOLDER_COPY_PREREQUISITES,
  copiedFolderDatasetSchema,
} from "./caseFolderCopySchema.js";
import { reviewedInternalPrerequisites } from "./caseFolderCopyPrerequisites.js";
import {
  prepareFolderDatasets,
  validatedDatasetReplay,
} from "./caseFolderCopyDatasets.js";

type Tx = Prisma.TransactionClient;
type Review = z.infer<typeof folderCopyReviewSchema>;
function refuse(message: string): never {
  throw new TRPCError({ code: "BAD_REQUEST", message });
}
function conflict(message: string): never {
  throw new TRPCError({ code: "CONFLICT", message });
}
export const folderCopyNotice =
  "Copy creates new Manual, Pending review cases. It preserves the reviewed procedures, titles, tags, priority, physical setup and currently valid human fields, not old risk/approval evidence. Results, run/history records, paid drafts, assessments, imported/provider source links, feature/defect links and compliance evidence are not copied. Source identity/procedure provenance is retained explicitly. Shared libraries, step media, attachments, prerequisites, datasets and archived cases are unsupported and block this entire copy. No AI credits are used.";
const internalCopyNotice =
  folderCopyNotice.replace("prerequisites, ", "") +
  " With explicit internal-prerequisite review, only relationships whose two endpoints are selected are remapped to new copied IDs. Any outgoing or incoming external relationship blocks the whole copy. New links record this actor and creation time, not old execution or approval evidence. Procedure versions do not contain relationship history; the folder receipt and prerequisite audit retain this new mapping.";
const copiedPrerequisiteSchema = z
  .object({
    sourceDependentId: z.string().min(1).max(200),
    sourcePrerequisiteId: z.string().min(1).max(200),
    sourceDependentDisplayId: z.string().min(1).max(200),
    sourcePrerequisiteDisplayId: z.string().min(1).max(200),
    dependentId: z.string().min(1).max(200),
    prerequisiteId: z.string().min(1).max(200),
    dependentDisplayId: z.string().min(1).max(200),
    prerequisiteDisplayId: z.string().min(1).max(200),
  })
  .strict();
function copyNotice(input: Review) {
  const base = input.copyInternalPrerequisites
    ? internalCopyNotice
    : folderCopyNotice;
  return input.copyParameterDatasets
    ? base.replace("datasets and archived cases", "archived cases") +
        " Explicit dataset review copies only supported parameter names and complete ordered concrete row values to fresh dataset IDs. Row identity is the new dataset ID plus row index, not an independent stable row ID. Unknown overrides/correlations or a prerequisite with its own dataset block the whole copy. Dataset source hashes/mapping are retained, not historical executions."
    : base;
}
function copyFolderId(
  projectId: string,
  actorId: string,
  requestId: string,
  path: string,
) {
  return `folder_${qualityProfileHash({ projectId, actorId, requestId, path, kind: "COPY" })}`;
}
function childRequestId(requestId: string, caseId: string) {
  const hex = createHash("sha256")
    .update(JSON.stringify(["folder-copy-case", requestId, caseId]))
    .digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
function sourceScope(input: Review): Prisma.TestCaseWhereInput {
  return {
    projectId: input.projectId,
    OR: [
      { suitePath: input.fromPath },
      { suitePath: { startsWith: input.fromPath + "/" } },
      {
        suitePath: null,
        source: {
          OR: [
            { filePath: input.fromPath },
            { filePath: { startsWith: input.fromPath + "/" } },
          ],
        },
      },
      {
        suitePath: "",
        source: {
          OR: [
            { filePath: input.fromPath },
            { filePath: { startsWith: input.fromPath + "/" } },
          ],
        },
      },
    ],
  };
}
async function prepareCopy(
  tx: Tx,
  actorId: string,
  input: Review,
  lockedIds?: string[],
) {
  await requireCurrentPlanAccess(tx, actorId, input.projectId, true);
  const fieldState = await readCaseFieldState(tx, actorId, input.projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  const tree = await readTree(tx, input.projectId);
  if (!tree.paths.includes(input.fromPath))
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Source folder is not in this project.",
    });
  if (pathWithin(input.toPath, input.fromPath))
    refuse("Copy must use a new location outside the source subtree.");
  const parent = parentPath(input.toPath);
  if (parent && !tree.paths.includes(parent))
    refuse("Choose an existing destination parent or project root.");
  if (tree.paths.some((p) => pathWithin(p, input.toPath)))
    refuse(
      "Destination already has a folder or cases. Copy does not silently merge or overwrite them.",
    );
  const mapPath = (path: string) =>
    input.toPath + path.slice(input.fromPath.length);
  const sourcePaths = tree.paths.filter((p) => pathWithin(p, input.fromPath));
  const destinationPaths = sourcePaths.map(mapPath);
  if (destinationPaths.some((p) => !folderPathSchema.safeParse(p).success))
    refuse(
      "Copied descendants exceed the eight-level / 240-character folder bound.",
    );
  if (
    new Set([...tree.paths, ...destinationPaths.flatMap(folderAncestors)])
      .size > MAX_CASE_FOLDERS
  )
    refuse(
      "Copy would exceed the 500-folder hierarchy bound. No branches were omitted.",
    );
  const rows = await tx.testCase.findMany({
    where: sourceScope(input),
    select: {
      id: true,
      displayId: true,
      suitePath: true,
      sortPosition: true,
      archived: true,
      updatedAt: true,
      sharedStepGroupId: true,
      source: { select: { filePath: true } },
      dataset: { select: { id: true } },
      _count: {
        select: { attachments: true, prerequisites: true, requiredBy: true },
      },
      versions: {
        orderBy: { versionNumber: "desc" },
        take: 1,
        select: { versionNumber: true },
      },
    },
    orderBy: { id: "asc" },
    take: MAX_FOLDER_COPY_CASES + 1,
  });
  if (rows.length > MAX_FOLDER_COPY_CASES)
    refuse(
      "Folder copy supports at most 50 cases per atomic review. No partial selection was substituted.",
    );
  if (
    lockedIds &&
    (rows.length !== lockedIds.length ||
      rows.some((r) => !lockedIds.includes(r.id)))
  )
    conflict(
      "Complete source selection changed while acquiring copy locks. Review again; nothing was copied.",
    );
  for (const row of rows) {
    const unsupported = [
      ...(row.archived ? ["archived case"] : []),
      ...(row.sharedStepGroupId ? ["shared step library"] : []),
      ...(row.dataset && !input.copyParameterDatasets
        ? ["parameter dataset"]
        : []),
      ...(row._count.attachments ? ["case attachments"] : []),
      ...(!input.copyInternalPrerequisites &&
      (row._count.prerequisites || row._count.requiredBy)
        ? ["prerequisite relationship"]
        : []),
    ];
    if (unsupported.length)
      refuse(
        `${row.displayId} uses unsupported copy dependencies: ${unsupported.join(", ")}. Use its original case or explicitly review independent authoring; folder copy cannot silently remove these references.`,
      );
  }
  const ids = rows.map((r) => r.id);
  const touching =
    input.copyInternalPrerequisites && ids.length
      ? await tx.testCasePrerequisite.findMany({
          // No project filter: fail closed even on an invalid legacy edge touching
          // a selected identity. Foreign endpoint identities never leave validation.
          where: {
            OR: [{ dependentId: { in: ids } }, { prerequisiteId: { in: ids } }],
          },
          select: { projectId: true, dependentId: true, prerequisiteId: true },
          orderBy: [{ dependentId: "asc" }, { prerequisiteId: "asc" }],
          take: MAX_FOLDER_COPY_PREREQUISITES + 1,
        })
      : [];
  const internalPrerequisites = input.copyInternalPrerequisites
    ? reviewedInternalPrerequisites(input.projectId, ids, touching)
    : [];
  if (
    input.copyInternalPrerequisites &&
    (await tx.testCasePrerequisite.count({
      where: { projectId: input.projectId },
    })) +
      internalPrerequisites.length >
      10000
  )
    refuse(
      "Copy would exceed the existing 10,000-link project prerequisite editing bound. Nothing was copied.",
    );
  const prerequisiteReviewHash = input.copyInternalPrerequisites
    ? qualityProfileHash({
        projectId: input.projectId,
        edges: internalPrerequisites,
      })
    : null;
  if (ids.length) {
    const [sizes] = await tx.$queryRaw<
      Array<{ bytes: bigint; steps: bigint; hasMedia: boolean }>
    >(
      Prisma.sql`SELECT (coalesce(sum(octet_length(to_jsonb(c)::text)),0)+(SELECT coalesce(sum(octet_length(to_jsonb(s)::text)),0) FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)})))::bigint AS bytes,(SELECT count(*)::bigint FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)})) AS steps,EXISTS(SELECT 1 FROM "TestCaseStep" s WHERE s."testCaseId" IN (${Prisma.join(ids)}) AND cardinality(s."mediaAttachmentIds")>0) AS "hasMedia" FROM "TestCase" c WHERE c.id IN (${Prisma.join(ids)})`,
    );
    if (!sizes || sizes.bytes > 8n * 1024n * 1024n || sizes.steps > 25000n)
      refuse(
        "Source procedures exceed the 8 MiB / 25,000-step batch copy bound. No cases were skipped.",
      );
    if (sizes.hasMedia)
      refuse(
        "Source steps contain media references. Folder copy cannot silently omit them; use reviewed independent authoring instead.",
      );
    if (input.copyParameterDatasets) {
      const [datasetSize] = await tx.$queryRaw<Array<{ bytes: bigint }>>(
        Prisma.sql`SELECT coalesce(sum(octet_length(d.rows::text)+octet_length(d."parameterNames"::text)),0)::bigint AS bytes FROM "TestCaseDataset" d JOIN "TestCase" c ON c.id=d."testCaseId" WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ids)})`,
      );
      if (!datasetSize || sizes.bytes + datasetSize.bytes > 8n * 1024n * 1024n)
        refuse(
          "Complete procedures and datasets exceed the 8 MiB folder-copy bound. No authored data was omitted.",
        );
    }
  }
  const heads = ids.length
    ? await tx.testCase.findMany({
        where: { projectId: input.projectId, id: { in: ids } },
        include: { steps: { orderBy: { order: "asc" } } },
        orderBy: { id: "asc" },
      })
    : [];
  const cases = [];
  for (const row of rows) {
    let state;
    try {
      state = await sourceState(tx, {
        projectId: input.projectId,
        caseId: row.id,
      });
    } catch (error) {
      if (error instanceof z.ZodError)
        refuse(
          `${row.displayId} contains unsupported authored content. Repair that case before copying this complete folder.`,
        );
      throw error;
    }
    const effective = row.suitePath || row.source?.filePath;
    if (!effective || !pathWithin(effective, input.fromPath))
      conflict("Source placement changed while reviewing copy.");
    const head = heads.find((h) => h.id === row.id);
    if (!head)
      conflict(
        "A source case changed or disappeared while reviewing copy. Nothing was copied.",
      );
    cases.push({
      row,
      state,
      sourcePath: effective,
      destinationPath: mapPath(effective),
      headHash: folderCaseHeadHash(head),
    });
  }
  // Preserve the complete reviewed within-folder order. New positions are
  // consecutively allocated, so old ties cannot reorder due to new case IDs.
  cases.sort(
    (a, b) =>
      a.sourcePath.localeCompare(b.sourcePath) ||
      a.row.sortPosition - b.row.sortPosition ||
      a.state.source.title.localeCompare(b.state.source.title) ||
      a.row.id.localeCompare(b.row.id),
  );
  const positions = new Map<string, number>();
  const ordered = cases.map((c) => {
    const position = positions.get(c.destinationPath) ?? 0;
    positions.set(c.destinationPath, position + 1);
    return { ...c, destinationPosition: position };
  });
  const datasetPlan = input.copyParameterDatasets
    ? await prepareFolderDatasets(
        tx,
        input.projectId,
        ordered,
        internalPrerequisites,
      )
    : null;
  const expectedHash = qualityProfileHash({
    projectId: input.projectId,
    organizationId: project.organizationId,
    fromPath: input.fromPath,
    toPath: input.toPath,
    tree,
    fieldSchemaHash: fieldState.expectedSchemaHash,
    ...(input.copyParameterDatasets
      ? {
          copyParameterDatasets: true,
          datasetSources: datasetPlan!.sources,
          datasetReviewHash: datasetPlan!.reviewHash,
        }
      : {}),
    ...(input.copyInternalPrerequisites
      ? {
          copyInternalPrerequisites: true,
          internalPrerequisites,
          prerequisiteReviewHash,
        }
      : {}),
    cases: ordered.map((c) => ({
      id: c.row.id,
      displayId: c.row.displayId,
      sourcePath: c.sourcePath,
      sourcePosition: c.row.sortPosition,
      destinationPath: c.destinationPath,
      destinationPosition: c.destinationPosition,
      latestVersion: c.row.versions[0]?.versionNumber ?? 0,
      updatedAt: c.row.updatedAt.toISOString(),
      headHash: c.headHash,
      sourceRevision: c.state.preview.expectedSourceRevision,
    })),
  });
  return {
    project,
    tree,
    destinationPaths,
    fieldState,
    cases: ordered,
    expectedHash,
    internalPrerequisites,
    prerequisiteReviewHash,
    datasetPlan,
  };
}
export async function previewFolderCopy(
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
      const p = await prepareCopy(tx, actorId, input);
      return {
        ...scope,
        expectedHash: p.expectedHash,
        fromPath: input.fromPath,
        toPath: input.toPath,
        caseCount: p.cases.length,
        folderCount: p.destinationPaths.length,
        fieldSchemaHash: p.fieldState.expectedSchemaHash,
        customFieldLabels: Object.fromEntries(
          p.fieldState.schema.fields.map((f) => [f.key, f.label]),
        ),
        notice: copyNotice(input),
        copyParameterDatasets: !!input.copyParameterDatasets,
        datasetReviewHash: p.datasetPlan?.reviewHash ?? null,
        datasetSources: p.datasetPlan?.sources ?? [],
        datasets:
          p.datasetPlan?.datasets.map((d) => ({
            ...d.source,
            sourceDisplayId: p.cases.find((c) => c.row.id === d.caseId)!.row
              .displayId,
            parameterNames: d.data.parameterNames,
            rows: d.data.rows,
          })) ?? [],
        copyInternalPrerequisites: !!input.copyInternalPrerequisites,
        prerequisiteReviewHash: p.prerequisiteReviewHash,
        internalPrerequisites: p.internalPrerequisites.map((edge) => ({
          ...edge,
          dependentDisplayId: p.cases.find(
            (c) => c.row.id === edge.dependentId,
          )!.row.displayId,
          prerequisiteDisplayId: p.cases.find(
            (c) => c.row.id === edge.prerequisiteId,
          )!.row.displayId,
        })),
        orderNotice:
          "Copied cases keep the reviewed within-folder order; destination positions are newly numbered. Source order is not changed.",
        destinationPaths: p.destinationPaths,
        cases: p.cases.map((c) => ({
          sourceId: c.row.id,
          sourceDisplayId: c.row.displayId,
          title: c.state.source.title,
          sourcePath: c.sourcePath,
          destinationPath: c.destinationPath,
          sourcePosition: c.row.sortPosition,
          destinationPosition: c.destinationPosition,
          sourceRevision: c.state.preview.expectedSourceRevision,
          customFields: c.state.authoredFields,
          warnings:
            input.copyInternalPrerequisites || input.copyParameterDatasets
              ? [
                  ...c.state.preview.warnings,
                  "The independent clone does not copy old relationship/dataset evidence. This reviewed folder batch then creates only the explicitly selected internal links and supported datasets between new identities.",
                ]
              : c.state.preview.warnings,
          definition: c.state.preview.definition,
        })),
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function writeFolderCopy(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof folderCopyApprovalSchema>,
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
              "Return to the account and workspace that reviewed this folder copy before retrying it.",
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
          const saved = z
            .object({
              schemaVersion: z.union([
                z.literal(3),
                z.literal(4),
                z.literal(5),
              ]),
              action: z.literal("COPY"),
              organizationId: z.string(),
              toPath: folderPathSchema,
              copies: z
                .array(
                  z.object({
                    sourceId: z.string(),
                    caseId: z.string(),
                    displayId: z.string(),
                  }),
                )
                .max(MAX_FOLDER_COPY_CASES),
              prerequisiteReviewHash: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .optional(),
              copiedPrerequisites: z
                .array(copiedPrerequisiteSchema)
                .max(MAX_FOLDER_COPY_PREREQUISITES)
                .optional(),
              datasetReviewHash: z
                .string()
                .regex(/^[a-f0-9]{64}$/)
                .optional(),
              copiedDatasets: z
                .array(copiedFolderDatasetSchema)
                .max(MAX_FOLDER_COPY_CASES)
                .optional(),
            })
            .passthrough()
            .safeParse(prior.receipt);
          if (!saved.success)
            conflict(
              "Retained folder-copy response is unsupported; original receipt was not replaced.",
            );
          if (saved.data.organizationId !== organizationId)
            throw new TRPCError({
              code: "FORBIDDEN",
              message:
                "Retained copy belongs to the project's previous organization.",
            });
          const copiedPrerequisites = saved.data.copiedPrerequisites ?? [];
          if (input.copyInternalPrerequisites) {
            if (
              saved.data.schemaVersion !==
                (input.copyParameterDatasets ? 5 : 4) ||
              saved.data.prerequisiteReviewHash !==
                input.expectedPrerequisiteHash ||
              !saved.data.copiedPrerequisites
            )
              conflict(
                "Retained internal prerequisite copy evidence does not match the approved request. Nothing was recreated.",
              );
            const pairs = reviewedInternalPrerequisites(
              input.projectId,
              saved.data.copies.map((c) => c.sourceId),
              copiedPrerequisites.map((edge) => ({
                projectId: input.projectId,
                dependentId: edge.sourceDependentId,
                prerequisiteId: edge.sourcePrerequisiteId,
              })),
            );
            if (
              qualityProfileHash({
                projectId: input.projectId,
                edges: pairs,
              }) !== saved.data.prerequisiteReviewHash ||
              qualityProfileHash(pairs) !==
                qualityProfileHash(input.expectedInternalPrerequisites)
            )
              conflict(
                "Retained internal prerequisite graph is unsupported; the original receipt was not replaced.",
              );
            const map = new Map(saved.data.copies.map((c) => [c.sourceId, c]));
            const sourceIds = new Set(saved.data.copies.map((c) => c.sourceId));
            if (
              sourceIds.size !== saved.data.copies.length ||
              new Set(saved.data.copies.map((c) => c.caseId)).size !==
                saved.data.copies.length ||
              saved.data.copies.some(
                (c) =>
                  sourceIds.has(c.caseId) ||
                  !c.caseId ||
                  c.caseId.length > 200 ||
                  !c.displayId ||
                  c.displayId.length > 200,
              ) ||
              copiedPrerequisites.some((edge) => {
                const dependent = map.get(edge.sourceDependentId),
                  prerequisite = map.get(edge.sourcePrerequisiteId);
                return (
                  !dependent ||
                  !prerequisite ||
                  dependent.caseId === edge.sourceDependentId ||
                  prerequisite.caseId === edge.sourcePrerequisiteId ||
                  dependent.caseId !== edge.dependentId ||
                  prerequisite.caseId !== edge.prerequisiteId ||
                  dependent.displayId !== edge.dependentDisplayId ||
                  prerequisite.displayId !== edge.prerequisiteDisplayId
                );
              })
            )
              conflict(
                "Retained prerequisite mapping does not identify the original new cases. Nothing was recreated.",
              );
          } else if (
            saved.data.schemaVersion !==
              (input.copyParameterDatasets ? 5 : 3) ||
            saved.data.prerequisiteReviewHash !== undefined ||
            copiedPrerequisites.length
          ) {
            conflict(
              "Retained copy mode does not match this independent-copy request.",
            );
          }
          const copiedDatasets = saved.data.copiedDatasets ?? [];
          if (input.copyParameterDatasets) {
            if (
              saved.data.schemaVersion !== 5 ||
              !saved.data.copiedDatasets ||
              !input.expectedDatasets ||
              saved.data.datasetReviewHash !== input.expectedDatasetHash
            )
              conflict(
                "Retained dataset-copy approval is unsupported; the original receipt was not replaced.",
              );
            validatedDatasetReplay(
              input.projectId,
              input.expectedDatasets,
              copiedDatasets,
              saved.data.copies,
              saved.data.datasetReviewHash!,
            );
          } else if (
            saved.data.schemaVersion === 5 ||
            saved.data.datasetReviewHash !== undefined ||
            saved.data.copiedDatasets !== undefined
          ) {
            conflict(
              "Retained dataset copy mode does not match this exact request.",
            );
          }
          const ids = saved.data.copies.map((c) => c.caseId);
          if (
            (await tx.testCase.count({
              where: { projectId: input.projectId, id: { in: ids } },
            })) !== ids.length
          )
            conflict(
              "Some original copied cases are no longer available. Exact retry does not recreate them.",
            );
          return {
            ...scope,
            requestId: input.requestId,
            receiptId: prior.id,
            recovered: true,
            destinationPath: saved.data.toPath,
            copies: saved.data.copies,
            copyInternalPrerequisites: !!input.copyInternalPrerequisites,
            prerequisiteReviewHash: saved.data.prerequisiteReviewHash ?? null,
            copiedPrerequisites,
            copyParameterDatasets: !!input.copyParameterDatasets,
            datasetReviewHash: saved.data.datasetReviewHash ?? null,
            copiedDatasets,
          };
        }
        const candidates = await tx.testCase.findMany({
          where: sourceScope(input),
          select: { id: true },
          orderBy: { id: "asc" },
          take: MAX_FOLDER_COPY_CASES + 1,
        });
        if (candidates.length > MAX_FOLDER_COPY_CASES)
          refuse(
            "Folder copy supports at most 50 cases per atomic review. No partial selection was substituted.",
          );
        const ids = candidates.map((c) => c.id);
        // UPDATE case locks block newly inserted FK dependency/step references;
        // SHARE own-step locks block changes to existing procedure/media rows.
        // Complete preparation uses fresh ReadCommitted statements after those
        // locks, not a stale negative dependency snapshot. It verifies that the
        // entire source identity selection was locked before reading bodies.
        if (ids.length) {
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(ids)}) ORDER BY id FOR UPDATE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "TestCaseStep" WHERE "testCaseId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
          );
          await tx.$queryRaw(
            Prisma.sql`SELECT id FROM "TestCaseSource" WHERE "testCaseId" IN (${Prisma.join(ids)}) ORDER BY id FOR SHARE`,
          );
          if (input.copyInternalPrerequisites)
            await tx.$queryRaw(
              Prisma.sql`SELECT "dependentId", "prerequisiteId" FROM "TestCasePrerequisite" WHERE "dependentId" IN (${Prisma.join(ids)}) OR "prerequisiteId" IN (${Prisma.join(ids)}) ORDER BY "dependentId", "prerequisiteId" LIMIT ${MAX_FOLDER_COPY_PREREQUISITES + 1} FOR SHARE`,
            );
          if (input.copyParameterDatasets)
            await tx.$queryRaw(
              Prisma.sql`SELECT d.id FROM "TestCaseDataset" d JOIN "TestCase" c ON c.id=d."testCaseId" WHERE c."projectId"=${input.projectId} AND c.id IN (${Prisma.join(ids)}) ORDER BY d.id FOR SHARE OF d`,
            );
        }
        const p = await prepareCopy(tx, actorId, input, ids);
        if (p.expectedHash !== input.expectedHash)
          conflict(
            "Source selection, content, schema or folder hierarchy changed after review. Nothing was copied.",
          );
        if (
          input.copyInternalPrerequisites &&
          (p.prerequisiteReviewHash !== input.expectedPrerequisiteHash ||
            qualityProfileHash(p.internalPrerequisites) !==
              qualityProfileHash(input.expectedInternalPrerequisites))
        )
          conflict(
            "The complete internal prerequisite graph changed after review. Nothing was copied.",
          );
        if (
          input.copyParameterDatasets &&
          (p.datasetPlan?.reviewHash !== input.expectedDatasetHash ||
            qualityProfileHash(p.datasetPlan?.sources) !==
              qualityProfileHash(input.expectedDatasets))
        )
          conflict(
            "The complete dataset contents, identities or row ordering changed after review. Nothing was copied.",
          );
        const folders = readFolders([
          ...p.tree.explicit,
          ...p.destinationPaths.map((path) => ({
            id: copyFolderId(input.projectId, actorId, input.requestId, path),
            path,
          })),
        ]);
        const copies = [];
        for (const c of p.cases) {
          const created = await createCaseCloneInTransaction(
            tx,
            actorId,
            {
              projectId: input.projectId,
              caseId: c.row.id,
              expectedSourceRevision: c.state.preview.expectedSourceRevision,
              title: c.state.source.title,
              suitePath: c.destinationPath,
              reason: input.reason,
              confirmed: true,
              requestId: childRequestId(input.requestId, c.row.id),
            },
            c.state,
            { sortPosition: c.destinationPosition },
          );
          copies.push({
            sourceId: c.row.id,
            sourceDisplayId: c.row.displayId,
            caseId: created.caseId,
            displayId: created.displayId,
            sourcePath: c.sourcePath,
            destinationPath: c.destinationPath,
            sourcePosition: c.row.sortPosition,
            destinationPosition: c.destinationPosition,
            sourceRevision: c.state.preview.expectedSourceRevision,
          });
        }
        // All fresh identities exist before any relationship insert. Nothing
        // points at original cases; insert/receipt/history failure rolls back all.
        const copyBySource = new Map(copies.map((c) => [c.sourceId, c]));
        const copiedDatasets: Array<z.infer<typeof copiedFolderDatasetSchema>> =
          [];
        for (const d of p.datasetPlan?.datasets ?? []) {
          const copied = copyBySource.get(d.caseId);
          if (!copied || ids.includes(copied.caseId))
            conflict(
              "The fresh dataset case mapping is incomplete. Nothing was copied.",
            );
          const created = await tx.testCaseDataset.create({
            data: {
              testCaseId: copied.caseId,
              parameterNames: d.data.parameterNames,
              rows: d.data.rows,
            },
            select: { id: true, parameterNames: true, rows: true },
          });
          if (
            created.id === d.source.sourceDatasetId ||
            qualityProfileHash({
              parameterNames: created.parameterNames,
              rows: created.rows,
            }) !== d.source.contentHash
          )
            conflict(
              "The complete copied dataset values could not be verified. Nothing was committed.",
            );
          copiedDatasets.push(
            copiedFolderDatasetSchema.parse({
              ...d.source,
              caseId: copied.caseId,
              displayId: copied.displayId,
              datasetId: created.id,
            }),
          );
        }
        if (input.copyParameterDatasets) {
          validatedDatasetReplay(
            input.projectId,
            input.expectedDatasets!,
            copiedDatasets,
            copies,
            p.datasetPlan!.reviewHash,
          );
          await tx.auditLog.create({
            data: {
              organizationId,
              projectId: input.projectId,
              actorId,
              entityType: "TestCaseDatasetCopy",
              entityId: input.requestId,
              action: "CREATE",
              summary:
                "Created reviewed supported parameter datasets for freshly copied cases",
              metadata: {
                requestId: input.requestId,
                datasetReviewHash: p.datasetPlan!.reviewHash,
                reason: input.reason,
                copiedDatasets,
                sourceDatasetsUnchanged: true,
                rowIdentity: "DATASET_ID_AND_ROW_INDEX",
                procedureVersionContainsDataset: false,
              },
            },
          });
        }
        const copiedPrerequisites = p.internalPrerequisites.map((edge) => {
          const dependent = copyBySource.get(edge.dependentId),
            prerequisite = copyBySource.get(edge.prerequisiteId);
          if (
            !dependent ||
            !prerequisite ||
            dependent.caseId === prerequisite.caseId ||
            ids.includes(dependent.caseId) ||
            ids.includes(prerequisite.caseId)
          )
            conflict(
              "The complete new identity map could not be verified; nothing was copied.",
            );
          return {
            sourceDependentId: edge.dependentId,
            sourcePrerequisiteId: edge.prerequisiteId,
            sourceDependentDisplayId: dependent.sourceDisplayId,
            sourcePrerequisiteDisplayId: prerequisite.sourceDisplayId,
            dependentId: dependent.caseId,
            prerequisiteId: prerequisite.caseId,
            dependentDisplayId: dependent.displayId,
            prerequisiteDisplayId: prerequisite.displayId,
          };
        });
        if (copiedPrerequisites.length) {
          await tx.testCasePrerequisite.createMany({
            data: copiedPrerequisites.map((edge) => ({
              projectId: input.projectId,
              dependentId: edge.dependentId,
              prerequisiteId: edge.prerequisiteId,
              createdById: actorId,
            })),
          });
          await tx.auditLog.create({
            data: {
              organizationId,
              projectId: input.projectId,
              actorId,
              entityType: "TestCasePrerequisiteCopy",
              entityId: input.requestId,
              action: "CREATE",
              summary:
                "Created reviewed internal prerequisites between newly copied cases",
              metadata: {
                requestId: input.requestId,
                prerequisiteReviewHash: p.prerequisiteReviewHash,
                reason: input.reason,
                copiedPrerequisites,
                sourceEdgesUnchanged: true,
                procedureVersionContainsRelationships: false,
              },
            },
          });
        }
        const state = await tx.caseFolderState.upsert({
          where: { projectId: input.projectId },
          create: { projectId: input.projectId, revision: 1, folders },
          update: { revision: { increment: 1 }, folders },
        });
        const receipt = {
          schemaVersion: input.copyParameterDatasets
            ? 5
            : input.copyInternalPrerequisites
              ? 4
              : 3,
          action: "COPY",
          organizationId,
          fromPath: input.fromPath,
          toPath: input.toPath,
          revision: state.revision,
          reason: input.reason,
          fieldSchemaHash: p.fieldState.expectedSchemaHash,
          foldersBefore: p.tree.explicit,
          foldersAfter: folders,
          copies,
          excluded: copyNotice(input),
          ...(input.copyParameterDatasets
            ? { datasetReviewHash: p.datasetPlan!.reviewHash, copiedDatasets }
            : {}),
          ...(input.copyInternalPrerequisites
            ? {
                prerequisiteReviewHash: p.prerequisiteReviewHash,
                copiedPrerequisites,
              }
            : {}),
        };
        if (
          Buffer.byteLength(JSON.stringify(receipt), "utf8") >
          2 * 1024 * 1024
        )
          refuse(
            "Complete folder-copy receipt exceeds the retention bound. Nothing was committed.",
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
            organizationId,
            projectId: input.projectId,
            actorId,
            entityType: "CaseFolder",
            entityId: saved.id,
            action: "CREATE",
            summary: `Copied folder ${input.fromPath} to ${input.toPath}`,
            metadata: {
              receiptId: saved.id,
              caseCount: copies.length,
              folderCount: p.destinationPaths.length,
              fromPath: input.fromPath,
              toPath: input.toPath,
            },
          },
        });
        return {
          ...scope,
          requestId: input.requestId,
          receiptId: saved.id,
          recovered: false,
          destinationPath: input.toPath,
          copies: copies.map((c) => ({
            sourceId: c.sourceId,
            caseId: c.caseId,
            displayId: c.displayId,
          })),
          copyInternalPrerequisites: !!input.copyInternalPrerequisites,
          prerequisiteReviewHash: p.prerequisiteReviewHash,
          copiedPrerequisites,
          copyParameterDatasets: !!input.copyParameterDatasets,
          datasetReviewHash: p.datasetPlan?.reviewHash ?? null,
          copiedDatasets,
        };
      },
      { isolationLevel: "ReadCommitted", timeout: 30000 },
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
