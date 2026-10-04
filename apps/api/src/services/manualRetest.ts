import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { Prisma, type PrismaClient } from "@vaettir/db";
import { lockManualRetestAccess } from "./manualRetestScope.js";
import { manualRetestExpectedScopeSchema, manualRetestReadRequestKey, type ManualRetestReadScopeInput,
  type ManualRetestObservedScope } from "./manualRetestScopeSchema.js";
import {
  boundedRunSnapshot,
  qualityProfileHash,
} from "./qualityExperienceProfile.js";
import {
  manualRetestMetadataSchema,
  retestSourceResultSchema,
} from "./manualRetestSchema.js";
import { aggregateStepStatus } from "./manualStepExecution.js";

const identity = z.string().min(1).max(200);
export const retestPreviewInputSchema = z
  .object({
    projectId: identity,
    sourceRunId: identity,
    testCaseId: identity,
    expectedScope: manualRetestExpectedScopeSchema.optional(),
  })
  .strict();
export const retestStartInputSchema = retestPreviewInputSchema.extend({
  expectedReviewHash: z.string().regex(/^[a-f0-9]{64}$/),
  idempotencyKey: z.string().uuid(),
});
const fail = (
  message: string,
  code: "BAD_REQUEST" | "CONFLICT" = "BAD_REQUEST",
): never => {
  throw new TRPCError({ code, message });
};

export function retestClosure(scope: string[], value: unknown, caseId: string) {
  const parsed = z.record(z.array(identity).max(500)).safeParse(value);
  if (
    !parsed.success ||
    new Set(scope).size !== scope.length ||
    scope.length > 500 ||
    !scope.includes(caseId)
  )
    return fail(
      "This run's frozen prerequisite scope is invalid. No current graph was substituted.",
    );
  const graph = parsed.data;
  if (
    Object.keys(graph).length > 500 ||
    Object.values(graph).reduce((sum, ids) => sum + ids.length, 0) > 10000 ||
    Object.entries(graph).some(
      ([id, ids]) =>
        !scope.includes(id) ||
        new Set(ids).size !== ids.length ||
        ids.some((dep) => !scope.includes(dep)),
    )
  )
    return fail(
      "This run's frozen prerequisites leave its original scope. Nothing was started.",
    );
  const ordered: string[] = [],
    visiting = new Set<string>(),
    visited = new Set<string>();
  const stack = [{ id: caseId, next: 0 }];
  while (stack.length) {
    const current = stack[stack.length - 1]!;
    visiting.add(current.id);
    const next = (graph[current.id] ?? [])[current.next++];
    if (next) {
      if (visiting.has(next))
        return fail(
          "The frozen prerequisites contain a cycle. Nothing was started.",
        );
      if (!visited.has(next)) stack.push({ id: next, next: 0 });
    } else {
      stack.pop();
      visiting.delete(current.id);
      visited.add(current.id);
      ordered.push(current.id);
    }
  }
  return {
    ordered,
    prerequisites: Object.fromEntries(
      ordered.map((id) => [id, graph[id] ?? []]),
    ),
  };
}

/** Current source evidence is reviewed; current case bodies are never substituted. */
export async function prepareManualRetest(
  tx: Prisma.TransactionClient,
  actorId: string,
  input: z.infer<typeof retestPreviewInputSchema>,
  lock = false,
  authenticatedClerkActorId?: string,
) {
  const access = await lockManualRetestAccess(tx, actorId, input, true, authenticatedClerkActorId, lock);
  if (lock)
    await tx.$queryRaw`SELECT id FROM "TestRun" WHERE id=${input.sourceRunId} AND "projectId"=${input.projectId} FOR UPDATE`;
  const [scopeSize] = await tx.$queryRaw<Array<{ count: number; bytes: bigint }>>`SELECT cardinality("manualTestCaseIds")::int AS count,octet_length("manualTestCaseIds"::text)::bigint AS bytes FROM "TestRun" WHERE id=${input.sourceRunId} AND "projectId"=${input.projectId}`;
  if (scopeSize && (scopeSize.count > 500 || scopeSize.bytes > 512n * 1024n))
    return fail("The original case scope exceeds the bounded retest review. No procedure was loaded or started.");
  const source = await tx.testRun.findFirst({
    where: { id: input.sourceRunId, projectId: input.projectId },
    select: {
      id: true,
      ciProvider: true,
      status: true,
      manualTestCaseIds: true,
    },
  });
  if (!source)
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Original execution not found in this project.",
    });
  if (source.ciProvider !== "manual")
    return fail(
      "Explicit retesting currently requires an original manual execution with frozen instructions.",
    );
  const [size] = await tx.$queryRaw<
    Array<{ bytes: bigint }>
  >`SELECT (octet_length("executionContext"::text)+octet_length("manualPrerequisites"::text))::bigint AS bytes FROM "TestRun" WHERE id=${source.id} AND "projectId"=${input.projectId}`;
  if (!size || size.bytes > 2n * 1024n * 1024n)
    return fail(
      "The original frozen evidence exceeds the 2 MiB retest limit. Nothing was loaded or started.",
    );
  const original = await tx.testRun.findUniqueOrThrow({
    where: { id: source.id },
    select: { executionContext: true, manualPrerequisites: true },
  });
  const snapshot = boundedRunSnapshot(original.executionContext);
  const closure = retestClosure(
    source.manualTestCaseIds,
    original.manualPrerequisites,
    input.testCaseId,
  );
  if (lock)
    await tx.$queryRaw`SELECT id FROM "TestCase" WHERE "projectId"=${input.projectId} AND id IN (${Prisma.join(closure.ordered)}) ORDER BY id FOR SHARE`;
  const cases = await tx.testCase.findMany({
    where: {
      projectId: input.projectId,
      id: { in: closure.ordered },
      archived: false,
    },
    select: { id: true, displayId: true },
  });
  if (cases.length !== closure.ordered.length)
    return fail(
      "An original case or prerequisite is missing, archived or outside this project. Historical evidence is retained; nothing was started.",
    );
  const definitions = closure.ordered.map((id) => {
    const matching = snapshot.caseDefinitions.filter(
      (c) => c.testCaseId === id,
    );
    if (matching.length !== 1)
      return fail(
        "An original frozen procedure is missing or ambiguous. Current case content cannot replace it.",
      );
    const c = matching[0]!;
    if (!c.steps.length && !(c.given.length && c.when.length && c.then.length))
      return fail(
        "An original procedure is incomplete. Review its evidence; no missing instructions were invented.",
      );
    const texts = [
      c.title,
      c.background ?? "",
      ...c.given,
      ...c.when,
      ...c.then,
      ...Object.values(c.verificationProfile),
      ...c.steps.flatMap((s) => [
        s.action,
        s.expectedActionOrData ?? "",
        s.expectedResult ?? "",
        s.expectedResponse ?? "",
      ]),
    ];
    if (texts.some((text) => /<[^<>]+>/.test(text)))
      return fail(
        "The original procedure has unresolved parameters. No row or configuration was guessed.",
      );
    return c;
  });
  const [evidenceSize] = await tx.$queryRaw<
    Array<{ bytes: bigint; count: number }>
  >`SELECT coalesce(sum(octet_length(concat(id,status::text,note,"errorMessage",observations::text))),0)::bigint AS bytes,count(*)::int AS count FROM "TestResult" WHERE "testRunId"=${source.id} AND "testCaseId" IN (${Prisma.join(closure.ordered)})`;
  if (
    !evidenceSize ||
    evidenceSize.bytes > 256n * 1024n ||
    evidenceSize.count > 500
  )
    return fail(
      "Original observations exceed the bounded retest review. Nothing was loaded or started.",
    );
  const rawResults = await tx.testResult.findMany({
    where: { testRunId: source.id, testCaseId: { in: closure.ordered } },
    orderBy: { id: "asc" },
    select: {
      id: true,
      testCaseId: true,
      status: true,
      note: true,
      errorMessage: true,
      observations: true,
    },
  });
  const parsedResults = z
    .array(retestSourceResultSchema)
    .max(500)
    .safeParse(rawResults);
  if (!parsedResults.success)
    return fail(
      "Original observations are unsupported or incomplete. They were not replaced by inferred evidence.",
    );
  const results = parsedResults.data;
  if (new Set(results.map((r) => r.testCaseId)).size !== results.length)
    return fail(
      "Multiple original results cannot be assigned to one retest. Select an independently identified execution.",
    );
  const selected = results.find((r) => r.testCaseId === input.testCaseId);
  if (
    !selected ||
    (selected.status !== "FAIL" && selected.status !== "BLOCKED")
  )
    return fail(
      "Retesting requires a recorded Failed or Blocked outcome for this case, not the overall run status.",
    );
  const heads = await tx.manualStepResultHead.findMany({
    where: { testRunId: source.id, testCaseId: { in: closure.ordered } },
    take: 501,
    orderBy: [{ testCaseId: "asc" }, { stepIndex: "asc" }],
    select: {
      testCaseId: true,
      stepIndex: true,
      currentRevisionId: true,
      revisionCount: true,
      currentRevision: {
        select: {
          status: true,
          testRunId: true,
          testCaseId: true,
          stepIndex: true,
          revisionNumber: true,
        },
      },
    },
  });
  if (heads.length > 500)
    return fail(
      "Original step observations exceed the 500-step retest review limit.",
    );
  for (const c of definitions) {
    const recorded = heads.filter((h) => h.testCaseId === c.testCaseId);
    if (
      recorded.length &&
      (recorded.length !== c.steps.length ||
        recorded.some(
          (h, index) =>
            h.stepIndex !== index ||
            h.currentRevision.testRunId !== source.id ||
            h.currentRevision.testCaseId !== c.testCaseId ||
            h.currentRevision.stepIndex !== index ||
            h.currentRevision.revisionNumber !== h.revisionCount,
        ))
    )
      return fail(
        "Original step evidence is incomplete or inconsistent. Complete or review that execution before retesting.",
      );
    if (
      recorded.length &&
      results.find((r) => r.testCaseId === c.testCaseId)?.status !==
        aggregateStepStatus(recorded.map((h) => h.currentRevision.status))
    )
      return fail(
        "Original case and step outcomes disagree. Nothing was inferred or started.",
      );
  }
  const sourceEvidenceHash = qualityProfileHash({
    status: source.status,
    results: rawResults,
    heads,
  });
  const sourceDefinitionHash = qualityProfileHash({
    snapshot,
    prerequisites: original.manualPrerequisites,
    scope: source.manualTestCaseIds,
  });
  const configurationHash = qualityProfileHash(snapshot.configuration);
  const sourceDataset =
    snapshot.datasetExecution ?? snapshot.retest?.sourceDatasetExecution;
  if (
    snapshot.datasetExecution &&
    (source.id !==
      `${snapshot.datasetExecution.batchId}_${snapshot.datasetExecution.rowIndex}` ||
      snapshot.datasetExecution.configurationHash !== configurationHash)
  )
    return fail(
      "Original dataset row identity is inconsistent. No other row was substituted.",
    );
  const retest = manualRetestMetadataSchema.parse({
    version: 1,
    sourceRunId: source.id,
    sourceCaseId: input.testCaseId,
    sourceDisplayId: cases.find((c) => c.id === input.testCaseId)!.displayId,
    sourceOutcome: selected.status,
    sourceEvidenceHash,
    sourceDefinitionHash,
    configurationHash,
    sourceResults: results,
    sourceStepRevisions: heads.map((h) => ({
      testCaseId: h.testCaseId,
      stepIndex: h.stepIndex,
      revisionId: h.currentRevisionId,
      revisionNumber: h.revisionCount,
    })),
    ...(sourceDataset
      ? {
          sourceDatasetExecution: {
            batchId: sourceDataset.batchId,
            datasetId: sourceDataset.datasetId,
            datasetHash: sourceDataset.datasetHash,
            rowIndex: sourceDataset.rowIndex,
            rowName: sourceDataset.rowName,
            values: sourceDataset.values,
          },
        }
      : {}),
  });
  // Deliberately do not copy native dataset batch identity into a different run.
  const frozen = boundedRunSnapshot({
    version: 1,
    experience: snapshot.experience,
    profileHash: snapshot.profileHash,
    configuration: snapshot.configuration,
    stepFieldLabels: snapshot.stepFieldLabels,
    caseDefinitions: definitions,
    ...(snapshot.plan ? { plan: snapshot.plan } : {}),
    retest,
  });
  const reviewHash = qualityProfileHash({
    projectId: input.projectId,
    sourceRunId: source.id,
    testCaseId: input.testCaseId,
    frozen,
    prerequisites: closure.prerequisites,
  });
  return {
    ...(input.expectedScope ? { scope: access, requested: manualRetestReadRequestKey(input), stepFieldLabels: frozen.stepFieldLabels } : {}),
    projectId: input.projectId,
    sourceRunId: source.id,
    testCaseId: input.testCaseId,
    displayId: retest.sourceDisplayId,
    reviewHash,
    sourceOutcome: retest.sourceOutcome,
    configuration: frozen.configuration,
    caseDefinitions: definitions,
    sourceResults: results,
    prerequisiteCount: closure.ordered.length - 1,
    credits: 0 as const,
    sourceDatasetExecution: retest.sourceDatasetExecution ?? null,
    frozen,
    ...closure,
  };
}

/** Bounded direct relationships, not a claim of resolution or a transitive defect graph. */
export async function listManualRetestLinks(
  db: PrismaClient,
  actorId: string,
  input: ManualRetestReadScopeInput,
  authenticatedClerkActorId?: string,
) {
  return db.$transaction(
    async (tx) => {
      const access = await lockManualRetestAccess(tx, actorId, input, false, authenticatedClerkActorId);
      const scope = {
        projectId: input.projectId,
        id: input.sourceRunId,
        manualTestCaseIds: { has: input.testCaseId },
      };
      if (!(await tx.testRun.findFirst({ where: scope, select: { id: true } })))
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Execution not found in this project case.",
        });
      const where = {
        projectId: input.projectId,
        ciProvider: "manual",
        AND: [
          {
            executionContext: {
              path: ["retest", "sourceRunId"],
              equals: input.sourceRunId,
            },
          },
          {
            executionContext: {
              path: ["retest", "sourceCaseId"],
              equals: input.testCaseId,
            },
          },
        ],
      };
      const anchor = input.before
        ? await tx.testRun.findFirst({
            where: { ...where, id: input.before },
            select: { id: true, startedAt: true },
          })
        : null;
      if (input.before && !anchor)
        return fail("Retest link cursor does not belong to this execution.");
      const children = await tx.testRun.findMany({
        where: {
          ...where,
          ...(anchor
            ? {
                OR: [
                  { startedAt: { lt: anchor.startedAt } },
                  { startedAt: anchor.startedAt, id: { lt: anchor.id } },
                ],
              }
            : {}),
        },
        orderBy: [{ startedAt: "desc" }, { id: "desc" }],
        take: 11,
        select: { id: true, startedAt: true, status: true },
      });
      // Project the direct ancestor identity only, never materialize procedure bodies.
      const [ancestor] = await tx.$queryRaw<
        Array<{
          sourceRunId: string | null;
          sourceCaseId: string | null;
          sourceOutcome: string | null;
        }>
      >`SELECT left("executionContext"->'retest'->>'sourceRunId',201) AS "sourceRunId",left("executionContext"->'retest'->>'sourceCaseId',201) AS "sourceCaseId",left("executionContext"->'retest'->>'sourceOutcome',20) AS "sourceOutcome" FROM "TestRun" WHERE id=${input.sourceRunId} AND "projectId"=${input.projectId}`;
      let original: null | {
        testRunId: string;
        capturedOutcome: "FAIL" | "BLOCKED";
      } = null;
      if (ancestor?.sourceRunId && ancestor.sourceCaseId === input.testCaseId) {
        if (
          ancestor.sourceCaseId === input.testCaseId &&
          (ancestor.sourceOutcome === "FAIL" ||
            ancestor.sourceOutcome === "BLOCKED") &&
          (await tx.testRun.findFirst({
            where: {
              id: ancestor.sourceRunId,
              projectId: input.projectId,
              manualTestCaseIds: { has: input.testCaseId },
            },
            select: { id: true },
          }))
        )
          original = {
            testRunId: ancestor.sourceRunId,
            capturedOutcome: ancestor.sourceOutcome,
          };
        else
          return fail(
            "Original retest relationship is unavailable or inconsistent. No foreign execution was linked.",
          );
      }
      return {
        ...(input.expectedScope ? { scope: access, requested: manualRetestReadRequestKey(input) } : {}),
        original,
        retests: children
          .slice(0, 10)
          .map((run) => ({
            testRunId: run.id,
            startedAt: run.startedAt,
            status: run.status,
          })),
        nextCursor: children.length > 10 ? children[9]!.id : null,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}

export async function startManualRetest(
  db: PrismaClient,
  actorId: string,
  raw: z.infer<typeof retestStartInputSchema>,
  authenticatedClerkActorId?: string,
) {
  const input = retestStartInputSchema.parse(raw);
  const testRunId = `retest_${createHash("sha256")
    .update(JSON.stringify([input.projectId, actorId, input.idempotencyKey]))
    .digest("hex")}`;
  const requestHash = manualRetestRequestHash(input);
  const response = (access: ManualRetestObservedScope, recovered: boolean) => ({ testRunId, recovered,
    ...(input.expectedScope ? { scope: { ...access, sourceRunId: input.sourceRunId, testCaseId: input.testCaseId,
      idempotencyKey: input.idempotencyKey, reviewHash: input.expectedReviewHash } } : {}) });
  const execute = () =>
    db.$transaction(
      async (tx) => {
        const access = await lockManualRetestAccess(tx, actorId, input, true, authenticatedClerkActorId, true);
        // Receipt owner/byte preflight precedes snapshot materialization. Successful
        // historical replay does not re-prepare subsequently changed source evidence.
        const [previousOwner] = await tx.$queryRaw<Array<{ projectId: string; startedById: string | null }>>`SELECT "projectId","startedById" FROM "TestRun" WHERE id=${testRunId} FOR SHARE`;
        if (previousOwner && (previousOwner.projectId !== input.projectId || previousOwner.startedById !== actorId))
          return fail("This retest key belongs to a different request. Nothing was replaced.", "CONFLICT");
        if (previousOwner) {
          const size = await tx.$queryRaw<Array<{ bytes: bigint }>>`SELECT octet_length("executionContext"::text)::bigint AS bytes FROM "TestRun" WHERE id=${testRunId} AND "projectId"=${input.projectId} AND "startedById"=${actorId}`;
          if (!size[0] || size[0].bytes > 2097152n) return fail("The retained retest receipt exceeds the bounded snapshot limit. It was not substituted.");
        }
        const previous = previousOwner ? await tx.testRun.findUnique({ where: { id: testRunId }, select: { projectId: true, startedById: true, executionContext: true } }) : null;
        if (previous) {
          const snapshot = boundedRunSnapshot(previous.executionContext);
          if (previous.projectId !== input.projectId || previous.startedById !== actorId || snapshot.startRequestHash !== requestHash ||
            snapshot.retest?.sourceRunId !== input.sourceRunId || snapshot.retest.sourceCaseId !== input.testCaseId)
            return fail("This retest key belongs to a different request. Nothing was replaced.", "CONFLICT");
          return response(access, true);
        }
        const prepared = await prepareManualRetest(tx, actorId, input, true, authenticatedClerkActorId);
        if (prepared.reviewHash !== input.expectedReviewHash)
          return fail("Original execution evidence changed. Refresh and review it again before starting; nothing was created.", "CONFLICT");
        await tx.testRun.create({ data: { id: testRunId, projectId: input.projectId, ciProvider: "manual", commitSha: "manual", branch: "manual",
          startedById: actorId, startedAt: new Date(), status: "RUNNING", manualTestCaseIds: prepared.ordered,
          manualPrerequisites: prepared.prerequisites, executionContext: boundedRunSnapshot({ ...prepared.frozen, startRequestHash: requestHash }) } });
        return response(access, false);
      },
      { timeout: 20000, isolationLevel: "RepeatableRead" },
    );
  try { return await execute(); }
  catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code)) return execute();
    throw error;
  }
}
/** Omission keeps the exact historical hash projection. Scope never grants permissions. */
export function manualRetestRequestHash(input: z.infer<typeof retestStartInputSchema>) {
  return qualityProfileHash({
    projectId: input.projectId,
    sourceRunId: input.sourceRunId,
    testCaseId: input.testCaseId,
    expectedReviewHash: input.expectedReviewHash,
    ...(input.expectedScope === undefined ? {} : { expectedScope: { projectId: input.expectedScope.projectId,
      organizationId: input.expectedScope.organizationId, clerkActorId: input.expectedScope.clerkActorId } }),
  });
}
