import { createHash } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { z } from "zod";
import { lockManualRetestAccess } from "./manualRetestScope.js";
import {
  qualityProfileHash,
  runCaseDefinitionSchema,
} from "./qualityExperienceProfile.js";
import { retestClosure } from "./manualRetest.js";
import { admitWholeCaseFrozenGraph } from "./manualCaseReviewedGraph.js";
import { measurementVerdict } from "./physicalValidation.js";
import {
  protectExecutedDependents,
  requirePassedPrerequisites,
} from "./manualStepExecution.js";
import {
  manualCaseExactObservationsSchema,
  manualCaseReviewedAccessSchema,
  manualCaseReviewedReadSchema,
  manualCaseReviewedHistorySchema,
  manualCaseReviewedWriteSchema,
  manualCaseReviewedWriteKey,
  manualCaseReviewedReadKey,
  manualCaseReviewedAccessOutputSchema,
  manualCaseReviewedPreviewOutputSchema,
  manualCaseReviewedHistoryOutputSchema,
  manualCaseReviewedAckSchema,
  type ManualCaseReviewedAccess,
  type ManualCaseReviewedRead,
  type ManualCaseReviewedWrite,
} from "./manualCaseResultSchema.js";

type Actor = { id: string; clerkUserId: string };
type Tx = Prisma.TransactionClient;
const reject = (
  message: string,
  code:
    | "PRECONDITION_FAILED"
    | "CONFLICT"
    | "FORBIDDEN"
    | "NOT_FOUND" = "PRECONDITION_FAILED",
): never => {
  throw new TRPCError({ code, message });
};
function safeJson(value: unknown) {
  const queue: Array<{ value: unknown; depth: number }> = [{ value, depth: 0 }];
  let nodes = 0;
  while (queue.length) {
    const item = queue.pop()!;
    if (++nodes > 100000 || item.depth > 64)
      return reject(
        "Native evidence nesting exceeds supported complete representation bounds.",
      );
    if (item.value && typeof item.value === "object")
      for (const child of Object.values(item.value))
        queue.push({ value: child, depth: item.depth + 1 });
  }
  try {
    return JSON.stringify(value);
  } catch {
    return reject(
      "Native evidence cannot be safely encoded. No partial representation was used.",
    );
  }
}
const bytes = (v: unknown) => Buffer.byteLength(safeJson(v), "utf8");
const limitations = [
  "Human observation, not a new execution or qualified sign-off.",
  "Saved run procedure only; current case content is not substituted.",
  "Unknown prior recorder/time remain unknown. Unsupported native JSON representations refuse editing, not evidence replacement.",
];
const digest = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const manualCaseReviewedRequestHash = (input: ManualCaseReviewedWrite) =>
  digest(manualCaseReviewedWriteKey(input));
const nativeCount = (n: unknown): n is number =>
  typeof n === "number" && Number.isSafeInteger(n) && n >= 0;
const nativeBytes = (n: unknown): n is bigint =>
  typeof n === "bigint" && n >= 0n;
function supported<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    return reject(
      "The complete native evidence representation is unsupported. No private validation details or partial evidence were returned.",
    );
  return parsed.data;
}
/** Authorization and native identity only. Never gate exact receipt recovery on later private bodies or run state. */
async function lockedScope(
  tx: Tx,
  actor: Actor,
  input: ManualCaseReviewedAccess,
  write: boolean,
) {
  const scope = await lockManualRetestAccess(
    tx,
    actor.id,
    {
      projectId: input.projectId,
      sourceRunId: input.testRunId,
      testCaseId: input.testCaseId,
      expectedScope: input.expectedScope,
    },
    write,
    actor.clerkUserId,
    write,
  );
  if (
    input.expectedNativeActorId !== undefined &&
    input.expectedNativeActorId !== scope.actorId
  )
    return reject(
      "The originally reviewed native author changed; the retained request was not rebound.",
      "FORBIDDEN",
    );
  const member = await tx.membership.findUniqueOrThrow({
    where: {
      organizationId_userId: {
        organizationId: scope.organizationId,
        userId: actor.id,
      },
    },
    select: { role: true, seatType: true },
  });
  return {
    scope,
    canRecover:
      member.seatType === "FULL" &&
      ["OWNER", "ADMIN", "EDITOR"].includes(member.role),
  };
}
const context = (
  input: ManualCaseReviewedAccess,
  access: Awaited<ReturnType<typeof lockedScope>>,
  projection: "ACCESS" | "PREVIEW" | "HISTORY",
) => ({
  requestId: input.readRequestId,
  projection,
  requested: manualCaseReviewedReadKey(input),
  scope: access.scope,
  canRecover: access.canRecover,
});
async function lockRunIdentity(
  tx: Tx,
  input: ManualCaseReviewedRead,
  write: boolean,
) {
  const [row] = await tx.$queryRaw<
    Array<{
      projectId: string;
      provider: string;
      status: string;
      planned: boolean;
    }>
  >(Prisma.sql`
    SELECT "projectId",left("ciProvider",256) AS provider,status::text AS status,${input.testCaseId}=ANY("manualTestCaseIds") AS planned
    FROM "TestRun" WHERE id=${input.testRunId} ${write ? Prisma.sql`FOR UPDATE` : Prisma.sql`FOR SHARE`}`);
  if (!row || row.projectId !== input.projectId)
    return reject(
      "This manual run is unavailable in the original project.",
      "NOT_FOUND",
    );
  if (row.provider !== "manual" || row.planned !== true)
    return reject(
      "Whole-case observations require an explicitly planned native manual case.",
    );
  return row;
}
/** Native size/relationship admission before JSON/ID materialization; 1000 aligns existing execution, not a new cap waiver. */
async function frozenRun(tx: Tx, input: ManualCaseReviewedRead) {
  const [admission] = await tx.$queryRaw<
    Array<{
      count: number;
      unique: number;
      idsBytes: bigint;
      graphBytes: bigint;
      runBytes: bigint;
      foreign: number;
      invalid: number;
    }>
  >`
    SELECT cardinality(r."manualTestCaseIds")::int AS count,
      (SELECT count(DISTINCT frozen_case.case_id)::int FROM unnest(r."manualTestCaseIds") AS frozen_case(case_id)) AS unique,
      octet_length(r."manualTestCaseIds"::text)::bigint AS "idsBytes",coalesce(octet_length(r."manualPrerequisites"::text),0)::bigint AS "graphBytes",
      octet_length(to_jsonb(r)::text)::bigint AS "runBytes",
      (SELECT count(*)::int FROM unnest(r."manualTestCaseIds") AS frozen_case(case_id) LEFT JOIN "TestCase" c ON c.id=frozen_case.case_id AND c."projectId"=${input.projectId} WHERE c.id IS NULL) AS foreign,
      (SELECT count(*)::int FROM unnest(r."manualTestCaseIds") AS frozen_case(case_id) WHERE frozen_case.case_id IS NULL OR length(frozen_case.case_id)=0 OR length(frozen_case.case_id)>200) AS invalid
    FROM "TestRun" r WHERE r.id=${input.testRunId} AND r."projectId"=${input.projectId}`;
  if (
    !admission ||
    !nativeCount(admission.count) ||
    !nativeCount(admission.unique) ||
    !nativeCount(admission.foreign) ||
    !nativeCount(admission.invalid) ||
    !nativeBytes(admission.idsBytes) ||
    !nativeBytes(admission.graphBytes) ||
    !nativeBytes(admission.runBytes) ||
    admission.count < 1 ||
    admission.count > 1000 ||
    admission.unique !== admission.count ||
    admission.foreign ||
    admission.invalid ||
    admission.idsBytes > 512n * 1024n ||
    admission.graphBytes > 512n * 1024n ||
    admission.runBytes > 4n * 1024n * 1024n
  )
    return reject(
      "The complete planned run identities, relationships or native payload exceed supported execution bounds. No smaller cohort was used.",
    );
  const run = await tx.testRun.findUniqueOrThrow({
    where: { id: input.testRunId },
    select: {
      id: true,
      manualPrerequisites: true,
      manualTestCaseIds: true,
      executionContext: true,
    },
  });
  const graph = admitWholeCaseFrozenGraph(
    run.manualTestCaseIds,
    run.manualPrerequisites,
  );
  if (
    Object.keys(graph).length > 1000 ||
    Object.values(graph).reduce((n, list) => n + list.length, 0) > 10000
  )
    return reject(
      "The complete frozen prerequisite graph exceeds supported bounds.",
    );
  // Complete graph admission above; shared helper derives only the selected closure.
  const closure = retestClosure(run.manualTestCaseIds, graph, input.testCaseId);
  const snapshot = run.executionContext;
  safeJson(snapshot);
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot))
    return reject(
      "This run has no supported saved procedure. Start a reviewed new run; current case content was not substituted.",
    );
  const record = snapshot as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Array.isArray(record.caseDefinitions) ||
    record.caseDefinitions.length !== run.manualTestCaseIds.length
  )
    return reject(
      "The saved procedure identities do not match the complete original run.",
    );
  const definitions = record.caseDefinitions as unknown[];
  const admitted = definitions.map((raw) => {
    const value = supported(runCaseDefinitionSchema, raw);
    if (qualityProfileHash(value) !== qualityProfileHash(raw))
      return reject(
        "A saved procedure contains unsupported fields or defaults. It was not silently normalized.",
      );
    return value;
  });
  if (
    new Set(admitted.map((c) => c.testCaseId)).size !==
      run.manualTestCaseIds.length ||
    admitted.some((c) => !run.manualTestCaseIds.includes(c.testCaseId)) ||
    admitted.reduce((n, c) => n + c.steps.length, 0) > 25000 ||
    bytes(definitions) > 8 * 1024 * 1024 ||
    admitted.some((c) => bytes(c) > 512 * 1024)
  )
    return reject(
      "The complete saved procedures exceed supported identities, count or byte bounds.",
    );
  const [roundTrip] = await tx.$queryRaw<
    Array<{ exact: boolean }>
  >`SELECT ("executionContext" IS NOT DISTINCT FROM ${safeJson(snapshot)}::jsonb AND "manualPrerequisites" IS NOT DISTINCT FROM ${safeJson(graph)}::jsonb) AS exact FROM "TestRun" WHERE id=${input.testRunId} AND "projectId"=${input.projectId}`;
  if (roundTrip?.exact !== true)
    return reject(
      "Saved native evidence cannot be safely represented by this client. No rounded snapshot was reviewed or written.",
    );
  const [nativeCase] = await tx.$queryRaw<
    Array<{ displayId: string }>
  >`SELECT "displayId" FROM "TestCase" WHERE id=${input.testCaseId} AND "projectId"=${input.projectId} FOR SHARE`;
  if (!nativeCase?.displayId || nativeCase.displayId.length > 200)
    return reject(
      "The selected case lacks a supported native public identity.",
    );
  const procedure = admitted.find((c) => c.testCaseId === input.testCaseId)!;
  const frozenEvidence = {
    procedure,
    prerequisites: Object.fromEntries(
      closure.ordered.map((id) => [id, graph[id] ?? []]),
    ),
    context: snapshot,
  };
  return {
    run,
    graph,
    displayId: nativeCase.displayId,
    frozenEvidence,
    frozenEvidenceHash: qualityProfileHash({
      executionContext: snapshot,
      manualPrerequisites: graph,
      manualTestCaseIds: run.manualTestCaseIds,
    }),
  };
}
async function currentState(tx: Tx, input: ManualCaseReviewedRead) {
  const head = await tx.manualCaseResultHead.findUnique({
    where: {
      testRunId_testCaseId: {
        testRunId: input.testRunId,
        testCaseId: input.testCaseId,
      },
    },
    select: {
      organizationId: true,
      projectId: true,
      testResultId: true,
      currentRevisionId: true,
      revisionCount: true,
      currentPayloadBytes: true,
    },
  });
  if (
    head &&
    (head.organizationId !== input.expectedScope.organizationId ||
      head.projectId !== input.projectId)
  )
    return reject(
      "The native result head belongs to another scope.",
      "FORBIDDEN",
    );
  const [size] = await tx.$queryRaw<
    Array<{ count: number; bytes: bigint }>
  >`SELECT count(*)::int AS count,coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint AS bytes FROM "TestResult" r WHERE "testRunId"=${input.testRunId} AND "testCaseId"=${input.testCaseId}`;
  if (
    !size ||
    !nativeCount(size.count) ||
    !nativeBytes(size.bytes) ||
    size.count > 1 ||
    size.bytes > 256n * 1024n
  )
    return reject(
      "Duplicate or oversized observations were not combined or clipped.",
    );
  const result = await tx.testResult.findFirst({
    where: { testRunId: input.testRunId, testCaseId: input.testCaseId },
    select: { id: true, status: true, note: true, observations: true },
  });
  if (
    head &&
    (!result ||
      result.id !== head.testResultId ||
      !nativeCount(head.revisionCount) ||
      !nativeCount(head.currentPayloadBytes) ||
      head.revisionCount < 1 ||
      head.revisionCount > 100 ||
      head.currentPayloadBytes > 256 * 1024)
  )
    return reject("The native history head is inconsistent.", "CONFLICT");
  if (result) {
    const [representation] = await tx.$queryRaw<
      Array<{ exact: boolean }>
    >`SELECT (observations IS NOT DISTINCT FROM ${safeJson(result.observations)}::jsonb) AS exact FROM "TestResult" WHERE id=${result.id} AND "testRunId"=${input.testRunId} AND "testCaseId"=${input.testCaseId}`;
    if (representation?.exact !== true)
      return reject(
        "Current native JSON evidence cannot be safely represented. No rounded facts were returned or replaced.",
      );
  }
  if (head) {
    const [revision] = await tx.$queryRaw<
      Array<{ exact: boolean }>
    >`SELECT (v."testResultId"=r.id AND v."revisionNumber"=${head.revisionCount} AND v.status=r.status AND v.note IS NOT DISTINCT FROM r.note AND v.observations IS NOT DISTINCT FROM r.observations AND octet_length(to_jsonb(v)::text)<=262144) AS exact
      FROM "ManualCaseResultRevision" v JOIN "TestResult" r ON r.id=v."testResultId" WHERE v.id=${head.currentRevisionId} AND v."projectId"=${input.projectId} AND v."organizationId"=${input.expectedScope.organizationId} AND v."testRunId"=${input.testRunId} AND v."testCaseId"=${input.testCaseId}`;
    if (revision?.exact !== true)
      return reject(
        "The native observation does not match its immutable head.",
        "CONFLICT",
      );
  }
  return {
    result,
    head,
    fingerprint: qualityProfileHash({
      projectId: input.projectId,
      testRunId: input.testRunId,
      testCaseId: input.testCaseId,
      result,
      head,
    }),
  };
}
export async function accessReviewedManualCaseResult(
  db: PrismaClient,
  actor: Actor,
  raw: ManualCaseReviewedAccess,
) {
  const input = manualCaseReviewedAccessSchema.parse(raw);
  return db.$transaction(
    async (tx) => {
      const access = await lockedScope(tx, actor, input, false);
      return manualCaseReviewedAccessOutputSchema.parse({
        readContext: context(input, access, "ACCESS"),
      });
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function previewReviewedManualCaseResult(
  db: PrismaClient,
  actor: Actor,
  raw: ManualCaseReviewedRead,
) {
  const input = manualCaseReviewedReadSchema.parse(raw);
  return db.$transaction(
    async (tx) => {
      const access = await lockedScope(tx, actor, input, false),
        identity = await lockRunIdentity(tx, input, false),
        frozen = await frozenRun(tx, input),
        state = await currentState(tx, input);
      const stepMode = await tx.manualStepResultHead.count({
        where: { testRunId: input.testRunId, testCaseId: input.testCaseId },
      });
      const response = supported(manualCaseReviewedPreviewOutputSchema, {
        readContext: context(input, access, "PREVIEW"),
        displayId: frozen.displayId,
        current: state.result
          ? {
              resultId: state.result.id,
              status: state.result.status,
              note: state.result.note,
              observations: state.result.observations,
            }
          : null,
        currentRevisionId: state.head?.currentRevisionId ?? null,
        revisionNumber: state.head?.revisionCount ?? 0,
        currentFingerprint: state.fingerprint,
        frozenEvidenceHash: frozen.frozenEvidenceHash,
        frozenEvidence: frozen.frozenEvidence,
        canWrite:
          access.canRecover &&
          identity.status === "RUNNING" &&
          !stepMode &&
          (!state.result ||
            manualCaseExactObservationsSchema.safeParse(
              state.result.observations,
            ).success),
        tracked: !!state.head,
        runStatus: identity.status,
        limitations,
      });
      if (bytes(response) > 4 * 1024 * 1024)
        return reject(
          "The complete frozen procedure review exceeds 4 MiB. No partial procedure or smaller evidence scope was returned.",
        );
      return response;
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function historyReviewedManualCaseResult(
  db: PrismaClient,
  actor: Actor,
  raw: z.infer<typeof manualCaseReviewedHistorySchema>,
) {
  const input = manualCaseReviewedHistorySchema.parse(raw);
  return db.$transaction(
    async (tx) => {
      const access = await lockedScope(tx, actor, input, false);
      await lockRunIdentity(tx, input, false);
      const [nativeCase] = await tx.$queryRaw<
        Array<{ projectId: string }>
      >`SELECT "projectId" FROM "TestCase" WHERE id=${input.testCaseId} AND "projectId"=${input.projectId} FOR SHARE`;
      if (nativeCase?.projectId !== input.projectId)
        return reject(
          "The selected case is unavailable in the current original project.",
          "NOT_FOUND",
        );
      const where = {
        organizationId: access.scope.organizationId,
        projectId: input.projectId,
        testRunId: input.testRunId,
        testCaseId: input.testCaseId,
      };
      const [historyAdmission] = await tx.$queryRaw<
        Array<{
          count: number;
          identityBytes: bigint;
          maxIdentity: number;
          invalid: number;
          foreign: number;
        }>
      >`
        SELECT count(*)::int AS count,coalesce(sum(octet_length(v.id)),0)::bigint AS "identityBytes",coalesce(max(length(v.id)),0)::int AS "maxIdentity",
          count(*) FILTER(WHERE v."revisionNumber"<1 OR v."revisionNumber">100 OR v."payloadBytes"<0 OR v."payloadBytes">262144)::int AS invalid,
          count(*) FILTER(WHERE r.id IS NULL)::int AS foreign
        FROM "ManualCaseResultRevision" v LEFT JOIN "TestResult" r ON r.id=v."testResultId" AND r."testRunId"=${input.testRunId} AND r."testCaseId"=${input.testCaseId}
        WHERE v."organizationId"=${access.scope.organizationId} AND v."projectId"=${input.projectId} AND v."testRunId"=${input.testRunId} AND v."testCaseId"=${input.testCaseId}`;
      if (
        !historyAdmission ||
        !nativeCount(historyAdmission.count) ||
        historyAdmission.count > 100 ||
        !nativeBytes(historyAdmission.identityBytes) ||
        historyAdmission.identityBytes > 20000n ||
        !nativeCount(historyAdmission.maxIdentity) ||
        historyAdmission.maxIdentity > 200 ||
        !nativeCount(historyAdmission.invalid) ||
        historyAdmission.invalid ||
        !nativeCount(historyAdmission.foreign) ||
        historyAdmission.foreign
      )
        return reject(
          "The complete native revision identities or relationships are unsupported. No historical body or cursor was projected.",
        );
      const cursor = input.before
        ? await tx.manualCaseResultRevision.findFirst({
            where: { ...where, id: input.before },
            select: { revisionNumber: true },
          })
        : null;
      if (input.before && !cursor)
        return reject(
          "The history cursor does not belong to this original case.",
        );
      const metadata = await tx.manualCaseResultRevision.findMany({
        where: {
          ...where,
          ...(cursor ? { revisionNumber: { lt: cursor.revisionNumber } } : {}),
        },
        orderBy: { revisionNumber: "desc" },
        take: input.limit + 1,
        select: { id: true, payloadBytes: true },
      });
      if (
        metadata.some(
          (r) =>
            !nativeCount(r.payloadBytes) ||
            r.payloadBytes > 256 * 1024 ||
            !r.id ||
            r.id.length > 200,
        )
      )
        return reject("Saved history size metadata is unsupported.");
      const ids = metadata.slice(0, input.limit).map((r) => r.id);
      if (ids.length) {
        const [size] = await tx.$queryRaw<
          Array<{ count: number; bytes: bigint; maxBytes: bigint }>
        >`SELECT count(*)::int AS count,coalesce(max(octet_length(to_jsonb(v)::text)),0)::bigint AS "maxBytes",coalesce(sum(octet_length(to_jsonb(v)::text)),0)::bigint AS bytes FROM "ManualCaseResultRevision" v WHERE id IN (${Prisma.join(ids)}) AND "organizationId"=${access.scope.organizationId} AND "projectId"=${input.projectId} AND "testRunId"=${input.testRunId} AND "testCaseId"=${input.testCaseId}`;
        if (
          size?.count !== ids.length ||
          !nativeCount(size?.count) ||
          !nativeBytes(size?.bytes) ||
          !nativeBytes(size?.maxBytes) ||
          size.bytes > 1024n * 1024n ||
          size.maxBytes > 256n * 1024n
        )
          return reject(
            "The complete native history page exceeds its 1 MiB bound. Choose fewer revisions.",
          );
      }
      const rows = ids.length
        ? await tx.manualCaseResultRevision.findMany({
            where: { ...where, id: { in: ids } },
            orderBy: { revisionNumber: "desc" },
          })
        : [];
      if (
        rows.length !== ids.length ||
        new Set(rows.map((r) => r.id)).size !== ids.length ||
        rows.some((r) => !ids.includes(r.id))
      )
        return reject(
          "The admitted history page changed; no partial page was returned.",
          "CONFLICT",
        );
      const nativePriorKinds = new Map<
        string,
        "SQL_NULL" | "JSON_NULL" | "VALUE"
      >();
      for (const r of rows) {
        const [representation] = await tx.$queryRaw<
          Array<{
            exact: boolean;
            legacySqlNull: boolean;
            legacyJsonNull: boolean | null;
          }>
        >`SELECT (observations IS NOT DISTINCT FROM ${safeJson(r.observations)}::jsonb AND ("legacyPrior" IS NULL OR "legacyPrior" IS NOT DISTINCT FROM ${safeJson(r.legacyPrior)}::jsonb)) AS exact,"legacyPrior" IS NULL AS "legacySqlNull",jsonb_typeof("legacyPrior")='null' AS "legacyJsonNull" FROM "ManualCaseResultRevision" WHERE id=${r.id} AND "organizationId"=${access.scope.organizationId} AND "projectId"=${input.projectId}`;
        if (
          representation?.exact !== true ||
          typeof representation.legacySqlNull !== "boolean" ||
          (representation.legacyJsonNull !== null &&
            typeof representation.legacyJsonNull !== "boolean")
        )
          return reject(
            "A native history representation is unsupported. No rounded or partial page was returned.",
          );
        nativePriorKinds.set(
          r.id,
          representation.legacySqlNull
            ? "SQL_NULL"
            : representation.legacyJsonNull
              ? "JSON_NULL"
              : "VALUE",
        );
      }
      const revisions = rows.map((r) => ({
        id: r.id,
        revisionNumber: r.revisionNumber,
        result: {
          resultId: r.testResultId,
          status: r.status,
          note: r.note,
          observations: r.observations,
        },
        actorLabel: r.actorLabel,
        recordedAt: r.recordedAt,
        correctionReason: r.correctionReason,
        previousRevisionId: r.previousRevisionId,
        legacyPrior: r.legacyPrior,
        legacyPriorKind: nativePriorKinds.get(r.id)!,
      }));
      const response = supported(manualCaseReviewedHistoryOutputSchema, {
        readContext: context(input, access, "HISTORY"),
        revisions,
        nextCursor: metadata.length > input.limit ? revisions.at(-1)!.id : null,
      });
      if (bytes(response) > 1024 * 1024)
        return reject(
          "The complete history response exceeds 1 MiB. No partial page was returned.",
        );
      return response;
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
export async function recordReviewedManualCaseResult(
  db: PrismaClient,
  actor: Actor,
  raw: ManualCaseReviewedWrite,
) {
  const envelope = manualCaseReviewedWriteSchema.parse(raw),
    input = envelope.mode === "EXACT" ? envelope : envelope.request,
    requestHash = manualCaseReviewedRequestHash(envelope);
  // Write nonce is retained UUID; it is not included in a fresh read activation.
  const read = {
    ...input,
    expectedNativeActorId: envelope.expectedNativeActorId,
    readRequestId: input.idempotencyKey,
  };
  try {
    return await db.$transaction(
      async (tx) => {
        const access = await lockedScope(tx, actor, read, true);
        const receipt = await tx.manualCaseResultRevision.findUnique({
          where: {
            organizationId_actorId_idempotencyKey: {
              organizationId: access.scope.organizationId,
              actorId: actor.id,
              idempotencyKey: input.idempotencyKey,
            },
          },
          select: {
            id: true,
            projectId: true,
            testRunId: true,
            testCaseId: true,
            testResultId: true,
            revisionNumber: true,
            requestHash: true,
            actorClerkUserId: true,
          },
        });
        const ack = (
          r: { id: string; testResultId: string; revisionNumber: number },
          recovered: boolean,
        ) =>
          manualCaseReviewedAckSchema.parse({
            scope: access.scope,
            testRunId: input.testRunId,
            testCaseId: input.testCaseId,
            resultId: r.testResultId,
            revisionId: r.id,
            revisionNumber: r.revisionNumber,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            recovered,
            mode: envelope.mode,
          });
        if (receipt) {
          if (
            receipt.projectId !== input.projectId ||
            receipt.testRunId !== input.testRunId ||
            receipt.testCaseId !== input.testCaseId ||
            receipt.actorClerkUserId !== actor.clerkUserId ||
            receipt.requestHash !== requestHash
          )
            return reject(
              "This UUID belongs to a different original observation.",
              "CONFLICT",
            );
          return ack(receipt, true);
        }
        if (envelope.mode !== "EXACT")
          return reject(
            "No accepted legacy receipt matches. Legacy recovery cannot create a new write; explicitly review current frozen evidence.",
          );
        if (bytes(envelope) > 256 * 1024)
          return reject("Entered observations exceed the bounded review.");
        const identity = await lockRunIdentity(tx, read, true);
        if (identity.status !== "RUNNING")
          return reject(
            "New observations require an active run. Exact accepted receipts remain recoverable.",
          );
        if (
          await tx.manualStepResultHead.count({
            where: { testRunId: input.testRunId, testCaseId: input.testCaseId },
          })
        )
          return reject(
            "This result is derived from immutable steps. Whole-case revisions cannot replace it.",
            "CONFLICT",
          );
        const [history] = await tx.$queryRaw<
          Array<{ count: number; bytes: bigint }>
        >`SELECT count(*)::int AS count,coalesce(sum(octet_length(concat(note,observations::text,"legacyPrior"::text,"actorLabel","correctionReason"))+2048),0)::bigint AS bytes FROM "ManualCaseResultRevision" WHERE "testRunId"=${input.testRunId}`;
        const [heads] = await tx.$queryRaw<
          Array<{
            count: number;
            bytes: bigint;
            foreign: number;
            invalid: number;
          }>
        >`SELECT count(*)::int AS count,coalesce(sum(greatest(h."currentPayloadBytes",octet_length(concat(v.note,v.observations::text,v."legacyPrior"::text,v."actorLabel",v."correctionReason"))+2048)),0)::bigint AS bytes,
          count(*) FILTER(WHERE h."projectId"<>${input.projectId} OR h."organizationId"<>${access.scope.organizationId} OR v.id IS NULL OR NOT(h."testCaseId"=ANY(t."manualTestCaseIds")))::int AS foreign,
          count(*) FILTER(WHERE h."currentPayloadBytes"<0 OR h."currentPayloadBytes">262144 OR h."revisionCount"<1 OR h."revisionCount">100 OR octet_length(to_jsonb(v)::text)>262144)::int AS invalid
          FROM "ManualCaseResultHead" h JOIN "TestRun" t ON t.id=h."testRunId" LEFT JOIN "ManualCaseResultRevision" v ON v.id=h."currentRevisionId" AND v."projectId"=${input.projectId} AND v."organizationId"=${access.scope.organizationId} AND v."testRunId"=h."testRunId" AND v."testCaseId"=h."testCaseId" AND v."testResultId"=h."testResultId" AND v."revisionNumber"=h."revisionCount" WHERE h."testRunId"=${input.testRunId}`;
        const [results] = await tx.$queryRaw<
          Array<{
            count: number;
            unique: number;
            bytes: bigint;
            maxBytes: bigint;
            foreign: number;
          }>
        >`SELECT count(*)::int AS count,count(DISTINCT r."testCaseId")::int AS unique,coalesce(max(octet_length(to_jsonb(r)::text)),0)::bigint AS "maxBytes",coalesce(sum(octet_length(to_jsonb(r)::text)),0)::bigint AS bytes,count(*) FILTER(WHERE c.id IS NULL OR NOT(r."testCaseId"=ANY(t."manualTestCaseIds")))::int AS foreign FROM "TestResult" r JOIN "TestRun" t ON t.id=r."testRunId" LEFT JOIN "TestCase" c ON c.id=r."testCaseId" AND c."projectId"=${input.projectId} WHERE r."testRunId"=${input.testRunId}`;
        if (
          !history ||
          !nativeCount(history.count) ||
          !nativeBytes(history.bytes) ||
          history.count >= 10000 ||
          history.bytes > 16n * 1024n * 1024n ||
          !heads ||
          !nativeCount(heads.count) ||
          !nativeCount(heads.foreign) ||
          !nativeCount(heads.invalid) ||
          heads.invalid ||
          !nativeBytes(heads.bytes) ||
          heads.count > 1000 ||
          heads.foreign ||
          heads.bytes > 4n * 1024n * 1024n ||
          !results ||
          !nativeCount(results.count) ||
          !nativeCount(results.unique) ||
          !nativeCount(results.foreign) ||
          !nativeBytes(results.bytes) ||
          !nativeBytes(results.maxBytes) ||
          results.maxBytes > 256n * 1024n ||
          results.count > 1000 ||
          results.count !== results.unique ||
          results.foreign ||
          results.bytes > 4n * 1024n * 1024n
        )
          return reject(
            "Complete current or cumulative evidence exceeds its native bounds or scope. No partial cohort was written.",
          );

        const frozen = await frozenRun(tx, read),
          state = await currentState(tx, read);
        if (
          frozen.frozenEvidenceHash !== envelope.expectedFrozenEvidenceHash ||
          (state.head?.currentRevisionId ?? null) !==
            envelope.expectedRevisionId ||
          state.fingerprint !== envelope.expectedCurrentFingerprint
        )
          return reject(
            "Frozen procedure or current observation changed. Retain and explicitly re-review your draft.",
            "CONFLICT",
          );
        if (
          state.result &&
          !manualCaseExactObservationsSchema.safeParse(
            state.result.observations,
          ).success
        )
          return reject(
            "Retained unknown or incompatible observation fields cannot be silently replaced.",
          );
        if (state.result && !envelope.correctionReason)
          return reject("A correction needs an explicit human reason.");
        if ((state.head?.revisionCount ?? 0) >= 100)
          return reject(
            "This case reached its 100 revision limit. Start a new run.",
          );
        await requirePassedPrerequisites(
          tx,
          frozen.run,
          input.testCaseId,
          input.status,
        );
        if (state.result?.status === "PASS" && input.status !== "PASS")
          await protectExecutedDependents(tx, frozen.run, input.testCaseId);
        if (
          input.status === "PASS" &&
          (envelope.observations.measurements ?? []).some(
            (m) =>
              measurementVerdict({ ...m, instrument: m.instrument ?? "" }) ===
              "OUT_OF_RANGE",
          )
        )
          return reject("Recorded measurement limits refuse Pass.");
        const legacyPrior =
          state.result && !state.head
            ? {
                basis: "UNVERSIONED_OBSERVATION_CAPTURED_NOW",
                originalRecorder: null,
                originalRecordedAt: null,
                captured: {
                  resultId: state.result.id,
                  status: state.result.status,
                  note: state.result.note,
                  observations: state.result.observations,
                },
              }
            : null;
        const actorRow = await tx.user.findUniqueOrThrow({
          where: { id: actor.id },
          select: { name: true },
        });
        let actorLabel = "";
        for (const character of actorRow.name?.trim() ?? "") {
          if (actorLabel.length + character.length > 200) break;
          actorLabel += character;
        }
        actorLabel ||= "Workspace member";
        const [incoming] = await tx.$queryRaw<
          Array<{ bytes: bigint }>
        >`SELECT (octet_length(concat(${input.note}::text,${JSON.stringify(envelope.observations)}::jsonb::text,${legacyPrior === null ? null : JSON.stringify(legacyPrior)}::jsonb::text,${actorLabel}::text,${input.correctionReason}::text))+2048)::bigint AS bytes`;
        if (
          !incoming ||
          !nativeBytes(incoming.bytes) ||
          incoming.bytes < 2048n ||
          incoming.bytes > 256n * 1024n ||
          history.bytes + incoming.bytes > 16n * 1024n * 1024n ||
          heads.bytes -
            BigInt(state.head?.currentPayloadBytes ?? 0) +
            incoming.bytes >
            4n * 1024n * 1024n
        )
          return reject(
            "The complete incoming revision exceeds retained evidence limits.",
          );
        const native =
          state.result ??
          (await tx.testResult.create({
            data: {
              testRunId: input.testRunId,
              testCaseId: input.testCaseId,
              status: input.status,
              note: input.note,
              observations: envelope.observations,
            },
          }));
        const revision = await tx.manualCaseResultRevision.create({
          data: {
            organizationId: access.scope.organizationId,
            projectId: input.projectId,
            testRunId: input.testRunId,
            testCaseId: input.testCaseId,
            testResultId: native.id,
            revisionNumber: (state.head?.revisionCount ?? 0) + 1,
            status: input.status,
            note: input.note,
            observations: envelope.observations,
            legacyPrior: legacyPrior ?? Prisma.DbNull,
            correctionReason: input.correctionReason,
            actorId: actor.id,
            actorClerkUserId: actor.clerkUserId,
            actorLabel,
            previousRevisionId: state.head?.currentRevisionId ?? null,
            idempotencyKey: input.idempotencyKey,
            requestHash,
            payloadBytes: Number(incoming.bytes),
          },
        });
        if (state.head)
          await tx.manualCaseResultHead.update({
            where: {
              testRunId_testCaseId: {
                testRunId: input.testRunId,
                testCaseId: input.testCaseId,
              },
            },
            data: {
              currentRevisionId: revision.id,
              revisionCount: revision.revisionNumber,
              currentPayloadBytes: Number(incoming.bytes),
            },
          });
        else
          await tx.manualCaseResultHead.create({
            data: {
              organizationId: access.scope.organizationId,
              projectId: input.projectId,
              testRunId: input.testRunId,
              testCaseId: input.testCaseId,
              testResultId: native.id,
              currentRevisionId: revision.id,
              revisionCount: revision.revisionNumber,
              currentPayloadBytes: Number(incoming.bytes),
            },
          });
        if (state.result)
          await tx.testResult.update({
            where: { id: native.id },
            data: {
              status: input.status,
              note: input.note,
              observations: envelope.observations,
            },
          });
        return ack(revision, false);
      },
      // Identity discovery precedes the namespace lock. A fresh statement snapshot
      // after waiting must see committed receipts/heads; the existing project/run
      // locks still serialize conforming writes. Read projections retain RR.
      { isolationLevel: "ReadCommitted", timeout: 20000 },
    );
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      ["P2034", "P2002"].includes(error.code)
    )
      return reject(
        "The native transaction conflicted. Retain and retry the exact UUID; no automatic new request was created.",
        "CONFLICT",
      );
    throw error;
  }
}
