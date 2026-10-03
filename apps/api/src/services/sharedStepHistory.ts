import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { requireCurrentPlanAccess } from "./testPlanExecution.js";
import { qualityProfileHash } from "./qualityExperienceProfile.js";
import {
  sharedLibraryContentSchema,
  sharedLibraryRefSchema,
  sharedLibrarySnapshotSchema,
  sharedLibraryWriteSchema,
} from "./sharedStepHistorySchema.js";

const fail = (
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" = "BAD_REQUEST",
): never => {
  throw new TRPCError({ code, message });
};

/** Organization -> membership -> project matches queries and credit operations.
 * Read the parent first, then recheck it after locking; a reparent is not an
 * implicit authorization grant or an approval of a different tenant's content. */
async function lockLibraryAccess(
  tx: Prisma.TransactionClient,
  actorId: string,
  projectId: string,
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
  const locked = await tx.$queryRaw<
    Array<{ organizationId: string }>
  >`SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
  if (locked[0]?.organizationId !== initial.organizationId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Project ownership changed. Refresh the current project before reviewing library changes.",
    });
  await requireCurrentPlanAccess(tx, actorId, projectId, true);
}
export function boundedSharedLibrary(value: unknown) {
  if (Buffer.byteLength(JSON.stringify(value), "utf8") > 256 * 1024)
    return fail(
      "This library exceeds the 256 KiB review limit. Nothing was replaced.",
    );
  const parsed = sharedLibrarySnapshotSchema.safeParse(value);
  if (!parsed.success)
    return fail(
      "This saved library has unsupported content. Its original JSON is retained; no procedure was invented or normalized.",
    );
  return parsed.data;
}

async function loadHead(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: z.infer<typeof sharedLibraryRefSchema>,
) {
  await requireCurrentPlanAccess(tx, actorId, input.projectId);
  const project = await tx.project.findUniqueOrThrow({
    where: { id: input.projectId },
    select: { organizationId: true },
  });
  const head = await tx.sharedStepGroup.findFirst({
    where: { id: input.id, projectId: input.projectId },
    select: {
      id: true,
      name: true,
      description: true,
      revision: true,
      archivedAt: true,
      updatedAt: true,
      _count: { select: { testCases: true } },
    },
  });
  if (!head)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Step library not found in this project.",
    });
  const [size] = await tx.$queryRaw<
    Array<{ bytes: bigint }>
  >`SELECT octet_length(steps::text)::bigint AS bytes FROM "SharedStepGroup" WHERE id=${head.id} AND "projectId"=${input.projectId}`;
  if (!size || size.bytes > 256n * 1024n)
    return fail(
      "This library exceeds the bounded review. Nothing was loaded or replaced.",
    );
  const content = await tx.sharedStepGroup.findUniqueOrThrow({
    where: { id: head.id },
    select: { steps: true },
  });
  const snapshot = boundedSharedLibrary({
    name: head.name,
    description: head.description,
    steps: content.steps,
    archived: head.archivedAt !== null,
  });
  return {
    id: head.id,
    revision: head.revision,
    updatedAt: head.updatedAt,
    usageCount: head._count.testCases,
    snapshot,
    revisionHash: qualityProfileHash({
      revision: head.revision,
      snapshot,
      usageCount: head._count.testCases,
      organizationId: project.organizationId,
    }),
  };
}

export async function reviewSharedLibrary(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof sharedLibraryRefSchema> & { before?: number },
) {
  return db.$transaction(
    async (tx) => {
      const head = await loadHead(tx, actorId, input);
      const revisions = await tx.sharedStepGroupRevision.findMany({
        where: {
          groupId: input.id,
          ...(input.before ? { revision: { lt: input.before } } : {}),
        },
        orderBy: { revision: "desc" },
        take: 11,
        select: {
          id: true,
          revision: true,
          kind: true,
          actorName: true,
          recordedAt: true,
          reason: true,
          sourceRevision: true,
          snapshot: true,
        },
      });
      const content = revisions
        .slice(0, 10)
        .map((r) => ({ ...r, snapshot: boundedSharedLibrary(r.snapshot) }));
      let canEdit = false;
      try {
        await requireCurrentPlanAccess(tx, actorId, input.projectId, true);
        canEdit = true;
      } catch (error) {
        if (!(error instanceof TRPCError && error.code === "FORBIDDEN"))
          throw error;
      }
      return {
        ...head,
        canEdit,
        revisions: content,
        nextCursor: revisions.length > 10 ? content[9]!.revision : null,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}

async function validateMedia(
  tx: Prisma.TransactionClient,
  projectId: string,
  snapshot: z.infer<typeof sharedLibrarySnapshotSchema>,
) {
  const ids = [
    ...new Set(snapshot.steps.flatMap((s) => s.mediaAttachmentIds ?? [])),
  ];
  if (!ids.length) return;
  const valid = await tx.testCaseAttachment.count({
    where: {
      id: { in: ids },
      testCase: { projectId },
      uploadCompletedAt: { not: null },
    },
  });
  if (valid !== ids.length)
    return fail(
      "A saved media reference is missing, unverified or outside this project. Nothing was restored; original history is retained.",
    );
}

export async function writeSharedLibrary(
  db: PrismaClient,
  actorId: string,
  input: z.infer<typeof sharedLibraryWriteSchema>,
) {
  const requestHash = qualityProfileHash(input);
  const execute = () =>
    db.$transaction(
      async (tx) => {
        await lockLibraryAccess(tx, actorId, input.projectId);
        await tx.$queryRaw`SELECT id FROM "SharedStepGroup" WHERE id=${input.id} AND "projectId"=${input.projectId} FOR UPDATE`;
        const head = await loadHead(tx, actorId, input);
        const prior = await tx.sharedStepGroupRevision.findFirst({
          where: { groupId: input.id, actorId, requestId: input.requestId },
          select: { id: true, revision: true, requestHash: true },
        });
        if (prior) {
          if (prior.requestHash !== requestHash)
            return fail(
              "This request key belongs to different reviewed content. Nothing was replaced.",
              "CONFLICT",
            );
          return { id: input.id, revision: prior.revision, recovered: true };
        }
        if (head.revisionHash !== input.expectedRevisionHash)
          return fail(
            "This library changed after review. Refresh it and review again; nothing was overwritten.",
            "CONFLICT",
          );
        if (head.revision >= 100)
          return fail(
            "This library reached the retained 100-revision limit. History must not be deleted to continue.",
          );
        let snapshot = head.snapshot;
        if (input.action === "UPDATE") {
          if (snapshot.archived)
            return fail("Recover this archived library before editing it.");
          const authored = sharedLibraryContentSchema.parse(input.content);
          snapshot = {
            ...authored,
            steps: authored.steps.map((s) => ({
              ...s,
              expectedActionOrData: s.expectedActionOrData ?? null,
              expectedResult: s.expectedResult ?? null,
              expectedResponse: s.expectedResponse ?? null,
            })),
            archived: false,
          };
        } else if (input.action === "RESTORE") {
          if (snapshot.archived)
            return fail(
              "Recover this archived library before restoring its procedure.",
            );
          const source = await tx.sharedStepGroupRevision.findFirst({
            where: { groupId: input.id, revision: input.sourceRevision },
            select: { snapshot: true },
          });
          if (!source) return fail("Saved revision not found in this library.");
          snapshot = {
            ...boundedSharedLibrary(source.snapshot),
            archived: false,
          };
        } else if (input.action === "ARCHIVE") {
          if (head.usageCount)
            return fail(
              "Unlink the current cases before archiving this library. Their instructions were not removed.",
            );
          snapshot = { ...snapshot, archived: true };
        } else snapshot = { ...snapshot, archived: false };
        snapshot = boundedSharedLibrary(snapshot);
        if (qualityProfileHash(snapshot) === qualityProfileHash(head.snapshot))
          return fail(
            "The reviewed action makes no change. No duplicate revision was created.",
          );
        await validateMedia(tx, input.projectId, snapshot);
        const [retained] = await tx.$queryRaw<
          Array<{ bytes: bigint }>
        >`SELECT coalesce(sum(octet_length(snapshot::text)),0)::bigint AS bytes FROM "SharedStepGroupRevision" WHERE "groupId"=${input.id}`;
        if (
          !retained ||
          retained.bytes + BigInt(Buffer.byteLength(JSON.stringify(snapshot))) >
            8n * 1024n * 1024n
        )
          return fail(
            "This library reached its 8 MiB retained-history limit. No history was deleted.",
          );
        const actor = await tx.user.findUniqueOrThrow({
          where: { id: actorId },
          select: { name: true, email: true },
        });
        await tx.$queryRaw`SELECT set_config('vaettir.shared_step_write',${JSON.stringify({ id: input.id, kind: input.action, actorId, actorName: actor.name ?? actor.email, requestId: input.requestId, requestHash, reason: input.reason, sourceRevision: input.sourceRevision ?? null })},true)`;
        const revision = head.revision + 1;
        await tx.sharedStepGroup.update({
          where: { id: input.id },
          data: {
            name: snapshot.name,
            description: snapshot.description,
            steps: snapshot.steps as Prisma.InputJsonValue,
            archivedAt: snapshot.archived ? new Date() : null,
            revision,
          },
        });
        const receipt = await tx.sharedStepGroupRevision.findFirst({
          where: {
            groupId: input.id,
            revision,
            actorId,
            requestId: input.requestId,
          },
          select: { requestHash: true, snapshot: true },
        });
        if (
          !receipt ||
          receipt.requestHash !== requestHash ||
          qualityProfileHash(receipt.snapshot) !== qualityProfileHash(snapshot)
        )
          return fail(
            "The exact retained revision was not captured. The update was rolled back.",
            "CONFLICT",
          );
        return { id: input.id, revision, recovered: false };
      },
      { isolationLevel: "RepeatableRead", timeout: 20000 },
    );
  try {
    return await execute();
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      (["P2002", "P2034"].includes(error.code) ||
        (error.code === "P2010" && error.meta?.code === "40001"))
    )
      return execute();
    throw error;
  }
}

export async function createSharedLibrary(
  db: PrismaClient,
  actorId: string,
  input: {
    projectId: string;
    requestId: string;
    content: z.infer<typeof sharedLibraryContentSchema>;
  },
) {
  const id = `shared_${createHash("sha256")
    .update(JSON.stringify([input.projectId, actorId, input.requestId]))
    .digest("hex")}`;
  const requestHash = qualityProfileHash(input);
  return db.$transaction(
    async (tx) => {
      await lockLibraryAccess(tx, actorId, input.projectId);
      const prior = await tx.sharedStepGroupRevision.findFirst({
        where: { groupId: id, actorId, requestId: input.requestId },
        select: { requestHash: true },
      });
      if (prior) {
        if (prior.requestHash !== requestHash)
          return fail(
            "This creation key was used for different content.",
            "CONFLICT",
          );
        return { id, revision: 1, recovered: true };
      }
      const snapshot = boundedSharedLibrary({
        ...input.content,
        steps: input.content.steps.map((s) => ({
          ...s,
          expectedActionOrData: s.expectedActionOrData ?? null,
          expectedResult: s.expectedResult ?? null,
          expectedResponse: s.expectedResponse ?? null,
        })),
        archived: false,
      });
      await validateMedia(tx, input.projectId, snapshot);
      const actor = await tx.user.findUniqueOrThrow({
        where: { id: actorId },
        select: { name: true, email: true },
      });
      await tx.$queryRaw`SELECT set_config('vaettir.shared_step_create',${JSON.stringify({ id, actorId, actorName: actor.name ?? actor.email, requestId: input.requestId, requestHash })},true)`;
      await tx.sharedStepGroup.create({
        data: {
          id,
          projectId: input.projectId,
          createdById: actorId,
          name: snapshot.name,
          description: snapshot.description,
          steps: snapshot.steps as Prisma.InputJsonValue,
        },
      });
      const receipt = await tx.sharedStepGroupRevision.findFirst({
        where: {
          groupId: id,
          revision: 1,
          actorId,
          requestId: input.requestId,
        },
        select: { requestHash: true, snapshot: true },
      });
      if (
        !receipt ||
        receipt.requestHash !== requestHash ||
        qualityProfileHash(receipt.snapshot) !== qualityProfileHash(snapshot)
      )
        return fail(
          "The creation receipt was not retained. Nothing was created.",
          "CONFLICT",
        );
      return { id, revision: 1, recovered: false };
    },
    { isolationLevel: "ReadCommitted", timeout: 20000 },
  );
}
