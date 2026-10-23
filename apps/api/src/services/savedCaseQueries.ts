import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import {
  Prisma,
  type PrismaClient,
  type SavedTypedCaseQuery,
} from "@vaettir/db";
import { caseQuerySchema } from "./caseQuerySchema.js";
import { assertCustomQueryCompatibility } from "./caseCustomQuery.js";
import {
  caseQueryColumnsSchema,
  savedCaseQueryValue,
  savedCaseQueryWriteInput,
  savedCaseQueryWriteResponse,
  type SavedCaseQueryWriteInput,
  savedCaseQueryCatalogInput,
  savedCaseQueryCatalogKey,
  type SavedCaseQueryCatalogInput,
  type SavedCaseQueryReadInput,
} from "./savedCaseQuerySchema.js";
import {
  savedQueryCatalogCollection,
  savedQueryCatalogOrder,
  savedQueryCatalogPaging,
} from "./savedCaseQueryCatalog.js";

type Access = {
  organizationId: string;
  actorId: string;
  clerkActorId: string;
  canWrite: boolean;
};
type Database = Prisma.TransactionClient;

// The original organization is fixed before locking; reparenting or revoked
// membership fails closed. Lock order matches queue/library writers. No network.
export async function withSavedQueryAccess<T>(
  db: PrismaClient,
  projectId: string,
  actorId: string,
  expectedOrg: string,
  work: (tx: Database, access: Access) => Promise<T>,
  transportClerkActorId?: string,
) {
  return db.$transaction(
    async (tx) => {
      const org = await tx.$queryRaw<Array<{ suspendedAt: Date | null }>>`
      SELECT "suspendedAt" FROM "Organization" WHERE id=${expectedOrg} FOR UPDATE`;
      const members = await tx.$queryRaw<
        Array<{ role: string; seatType: string }>
      >`
      SELECT role,"seatType" FROM "Membership" WHERE "organizationId"=${expectedOrg} AND "userId"=${actorId} FOR UPDATE`;
      const projects = await tx.$queryRaw<Array<{ organizationId: string }>>`
      SELECT "organizationId" FROM "Project" WHERE id=${projectId} FOR UPDATE`;
      const member = members[0];
      if (
        !org[0] ||
        org[0].suspendedAt ||
        !member ||
        !["OWNER", "ADMIN", "EDITOR", "VIEWER", "COMPLIANCE_AUDITOR"].includes(
          member.role,
        ) ||
        !["FULL", "READ_ONLY"].includes(member.seatType) ||
        projects[0]?.organizationId !== expectedOrg
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current project membership is required.",
        });
      await tx.$executeRaw(Prisma.sql`SET LOCAL statement_timeout = '8000ms'`);
      // Actor pin follows Org -> Membership -> Project. Only identity metadata
      // is projected, never a profile/body; old direct callers may omit transport.
      const [actor] = await tx.$queryRaw<Array<{ clerkUserId: string | null }>>`
        SELECT CASE WHEN octet_length("clerkUserId")<=200 THEN "clerkUserId" ELSE NULL END AS "clerkUserId"
        FROM "User" WHERE id=${actorId} FOR SHARE`;
      if (
        !actor ||
        !actor.clerkUserId ||
        (transportClerkActorId !== undefined &&
          actor.clerkUserId !== transportClerkActorId)
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Current saved-query actor identity is unavailable.",
        });
      return work(tx, {
        organizationId: expectedOrg,
        actorId,
        clerkActorId: actor.clerkUserId,
        // Seat assignment normally maps READ_ONLY to VIEWER, but role and seat
        // are independent stored fields. A downgrade retains authorized reads;
        // it must never grant write or replay authority from a cached role.
        canWrite:
          member.seatType === "FULL" &&
          ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
      });
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
const unavailable = () =>
  new TRPCError({
    code: "NOT_FOUND",
    message: "This saved query is unavailable.",
  });
const visible = (record: SavedTypedCaseQuery, access: Access) =>
  record.organizationId === access.organizationId &&
  (record.visibility === "SHARED" || record.createdById === access.actorId);
const writable = (record: SavedTypedCaseQuery, access: Access) =>
  access.canWrite && visible(record, access);
export function savedQueryValue(record: SavedTypedCaseQuery) {
  try {
    return savedCaseQueryValue.parse({
      id: record.id,
      projectId: record.projectId,
      createdById: record.createdById,
      name: record.name,
      visibility: record.visibility,
      query: caseQuerySchema.parse(record.definition),
      columns: caseQueryColumnsSchema.parse(record.columns),
      version: record.version,
      deleted: !!record.deletedAt,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
    });
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This saved query uses unavailable criteria. No conditions have been silently removed.",
    });
  }
}
export async function listSavedCaseQueries(
  tx: Database,
  access: Access,
  projectId: string,
  offset: number,
  options: Pick<SavedCaseQueryCatalogInput, "catalog" | "expectedScope"> = {},
) {
  const input = savedCaseQueryCatalogInput.parse({
    projectId,
    offset,
    ...options,
  });
  if (
    input.expectedScope &&
    (input.expectedScope.organizationId !== access.organizationId ||
      input.expectedScope.clerkActorId !== access.clerkActorId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "The saved-query catalog belongs to the original account and workspace.",
    });
  const filters = input.catalog ?? {
    search: "",
    collection: "ALL" as const,
    sort: "NAME_ASC" as const,
  };
  // Metadata only, with size preflight before returning a legacy name. Literal
  // strpos avoids SQL LIKE wildcard interpretation of %, _ or backslashes.
  const records = await tx.$queryRaw<
    Array<{
      id: string;
      name: string | null;
      visibility: string | null;
      version: number;
      createdById: string | null;
    }>
  >(Prisma.sql`
    SELECT q.id, CASE WHEN octet_length(q.name)<=320 THEN q.name ELSE NULL END AS name,
      CASE WHEN octet_length(q.visibility)<=16 THEN q.visibility ELSE NULL END AS visibility, q.version,
      CASE WHEN octet_length(q."createdById")<=480 THEN q."createdById" ELSE NULL END AS "createdById"
    FROM "SavedTypedCaseQuery" q
    WHERE q."organizationId"=${access.organizationId} AND q."projectId"=${projectId} AND q."deletedAt" IS NULL
      AND (q.visibility='SHARED' OR q."createdById"=${access.actorId})
      AND ${savedQueryCatalogCollection(filters.collection, access.actorId)}
      AND strpos(lower(q.name),lower(${filters.search}))>0
    ORDER BY ${savedQueryCatalogOrder(filters.sort)} OFFSET ${offset} LIMIT 51`);
  if (
    records.some(
      (r) =>
        !r.name ||
        r.name.length > 80 ||
        r.id.length > 120 ||
        !r.createdById ||
        r.createdById.length > 120 ||
        !r.visibility ||
        !["PRIVATE", "SHARED"].includes(r.visibility) ||
        !Number.isInteger(r.version) ||
        r.version < 1 ||
        r.version > 1000000,
    )
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "Saved-query catalog metadata needs repair. No definition was dropped or substituted.",
    });
  return {
    projectId,
    organizationId: access.organizationId,
    clerkActorId: access.clerkActorId,
    offset,
    canWrite: access.canWrite,
    hasMore: records.length > 50,
    ...savedQueryCatalogPaging(offset, records.length > 50),
    ...(input.catalog
      ? {
          catalog: input.catalog,
          catalogKey: savedCaseQueryCatalogKey(input.catalog),
        }
      : {}),
    items: records.slice(0, 50).map((record) => ({
      id: record.id,
      name: record.name!,
      visibility: record.visibility!,
      version: record.version,
      mine: record.createdById === access.actorId,
      canEdit: access.canWrite,
    })),
    limitation:
      "Current saved definitions, not report snapshots. Refresh the catalog after another member edits it. The catalog shows at most four 50-row pages (offsets 0–150); narrow a name search or collection to reach other matches. Paging is a current read, not a frozen inventory.",
  };
}
export async function getSavedCaseQuery(
  tx: Database,
  access: Access,
  projectId: string,
  id: string,
  expectedScope?: SavedCaseQueryReadInput["expectedScope"],
) {
  if (
    expectedScope &&
    (expectedScope.organizationId !== access.organizationId ||
      expectedScope.clerkActorId !== access.clerkActorId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "The selected saved definition belongs to the original account and workspace.",
    });
  const record = await tx.savedTypedCaseQuery.findFirst({
    where: {
      id,
      projectId,
      organizationId: access.organizationId,
      deletedAt: null,
    },
  });
  if (!record || !visible(record, access)) throw unavailable();
  return {
    projectId,
    organizationId: access.organizationId,
    clerkActorId: access.clerkActorId,
    value: savedQueryValue(record),
    canEdit: writable(record, access),
    canMakePrivate: access.canWrite && record.createdById === access.actorId,
  };
}
export async function writeSavedCaseQuery(
  tx: Database,
  access: Access,
  raw: SavedCaseQueryWriteInput,
) {
  const input = savedCaseQueryWriteInput.parse(raw);
  if (
    input.expectedScope &&
    (input.expectedScope.organizationId !== access.organizationId ||
      input.expectedScope.clerkActorId !== access.clerkActorId)
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Return to the account and workspace that reviewed this saved-query request before retrying it.",
    });
  if (!access.canWrite)
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "A current full editor seat is required to save or change query definitions.",
    });
  const requestHash = createHash("sha256")
    .update(JSON.stringify(input))
    .digest("hex");
  const prior = await tx.savedTypedCaseQueryWrite.findUnique({
    where: {
      projectId_actorId_requestId: {
        projectId: input.projectId,
        actorId: access.actorId,
        requestId: input.requestId,
      },
    },
    include: { query: true },
  });
  if (prior) {
    if (
      prior.organizationId !== access.organizationId ||
      !writable(prior.query, access)
    )
      throw unavailable();
    if (prior.requestHash !== requestHash)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "This request belongs to a different query change. Retry its original payload.",
      });
    try {
      return savedCaseQueryWriteResponse.parse(prior.response);
    } catch {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "The original write receipt is unavailable; no replacement change was made.",
      });
    }
  }
  if (
    (await tx.savedTypedCaseQueryWrite.count({
      where: { projectId: input.projectId, actorId: access.actorId },
    })) >= 5000
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "The bounded query write history is full. Contact support; existing receipt retries remain available.",
    });
  // Old authorized receipts replay above even if a field was retired later.
  // New definitions require explicit repair; loading stale JSON never drops it.
  if (input.operation !== "DELETE")
    await assertCustomQueryCompatibility(
      tx,
      input.projectId,
      input.definition.query,
    );
  let record: SavedTypedCaseQuery;
  if (input.operation === "CREATE") {
    const where = {
      projectId: input.projectId,
      organizationId: access.organizationId,
      deletedAt: null,
      ...(input.definition.visibility === "SHARED"
        ? { visibility: "SHARED" }
        : { createdById: access.actorId, visibility: "PRIVATE" }),
    };
    if ((await tx.savedTypedCaseQuery.count({ where })) >= 100)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message:
          "Keep at most 100 shared or 100 personal query definitions per project.",
      });
    record = await tx.savedTypedCaseQuery.create({
      data: {
        projectId: input.projectId,
        organizationId: access.organizationId,
        createdById: access.actorId,
        name: input.definition.name,
        visibility: input.definition.visibility,
        definition: input.definition.query as Prisma.InputJsonValue,
        columns: input.definition.columns as Prisma.InputJsonValue,
      },
    });
  } else {
    const current = await tx.savedTypedCaseQuery.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        organizationId: access.organizationId,
        deletedAt: null,
      },
    });
    if (!current || !writable(current, access)) throw unavailable();
    if (current.version !== input.expectedVersion)
      throw new TRPCError({
        code: "CONFLICT",
        message:
          "The saved query changed. Load its current version before reviewing another edit.",
      });
    if (input.operation === "UPDATE") {
      if (
        input.definition.visibility === "PRIVATE" &&
        current.createdById !== access.actorId
      )
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Only the creator can make a shared query personal.",
        });
      if (
        input.definition.visibility !== current.visibility &&
        (await tx.savedTypedCaseQuery.count({
          where: {
            projectId: input.projectId,
            organizationId: access.organizationId,
            deletedAt: null,
            visibility: input.definition.visibility,
            ...(input.definition.visibility === "PRIVATE"
              ? { createdById: current.createdById }
              : {}),
          },
        })) >= 100
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "The destination saved-query collection is full.",
        });
    }
    const changed = await tx.savedTypedCaseQuery.updateMany({
      where: {
        id: current.id,
        organizationId: access.organizationId,
        projectId: input.projectId,
        version: input.expectedVersion,
        deletedAt: null,
      },
      data:
        input.operation === "DELETE"
          ? { deletedAt: new Date(), version: { increment: 1 } }
          : {
              name: input.definition.name,
              visibility: input.definition.visibility,
              definition: input.definition.query as Prisma.InputJsonValue,
              columns: input.definition.columns as Prisma.InputJsonValue,
              version: { increment: 1 },
            },
    });
    if (changed.count !== 1)
      throw new TRPCError({
        code: "CONFLICT",
        message: "The saved query changed; no edit was applied.",
      });
    record = await tx.savedTypedCaseQuery.findUniqueOrThrow({
      where: { id: current.id },
    });
  }
  const response = savedCaseQueryWriteResponse.parse({
    requestId: input.requestId,
    operation: input.operation,
    value: savedQueryValue(record),
  });
  await tx.savedTypedCaseQueryWrite.create({
    data: {
      projectId: input.projectId,
      organizationId: access.organizationId,
      queryId: record.id,
      actorId: access.actorId,
      requestId: input.requestId,
      requestHash,
      response: response as Prisma.InputJsonValue,
    },
  });
  return response;
}
