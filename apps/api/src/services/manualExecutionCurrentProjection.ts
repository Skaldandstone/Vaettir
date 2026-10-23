import { z } from "zod";
import type { Prisma } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { resolveStepFieldLabels } from "@vaettir/core";
import { lockManualExecutionReadScope } from "./manualExecutionReadScope.js";
import type { ManualExecutionReadScopeInput } from "./manualExecutionReadScopeSchema.js";
import { readRunExperienceSnapshot } from "./qualityExperienceProfile.js";
import { manualRunScopeAvailability } from "./manualRunScopeAvailability.js";
import {
  validationDomainSchema,
  verificationProfileSchema,
  observationsSchema,
} from "./physicalValidation.js";
import {
  boundedCurrentStepBytes,
  stepRevisionOutput,
} from "./manualStepExecution.js";

/** Sole unchanged supported-view projection shared by legacy and additive reads.
 * Caller owns its RR transaction; no nested transaction or legacy router call.
 * This preserves existing normalization, not raw native JSON audit fidelity. */
export async function readManualExecutionCurrentProjection(
  tx: Prisma.TransactionClient,
  actorId: string,
  clerkActorId: string,
  input: ManualExecutionReadScopeInput,
  expectedNativeActorId?: string,
) {
  if (expectedNativeActorId !== undefined && expectedNativeActorId !== actorId)
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Current original native actor access is required. No run view was rebound.",
    });
  const access = await lockManualExecutionReadScope(
    tx,
    actorId,
    clerkActorId,
    input,
  );
  if (
    expectedNativeActorId !== undefined &&
    access.actorId !== expectedNativeActorId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Current original native actor access is required. No run view was rebound.",
    });
  const run = await tx.testRun.findUniqueOrThrow({
    where: { id: input.testRunId },
    include: {
      project: {
        select: { organization: { select: { stepFieldLabels: true } } },
      },
    },
  });

  const [cases, results] = await Promise.all([
    tx.testCase.findMany({
      where: {
        id: { in: run.manualTestCaseIds },
        projectId: run.projectId,
      },
      include: {
        steps: { orderBy: { order: "asc" } },
        sharedStepGroup: true,
      },
    }),
    tx.testResult.findMany({
      where: {
        testRunId: run.id,
        testCaseId: { in: run.manualTestCaseIds },
      },
    }),
  ]);
  const casesById = new Map(cases.map((c) => [c.id, c]));
  const resultByCase = new Map(
    results.map((r) => [r.testCaseId as string, r]),
  );
  const prerequisites = z
    .record(z.array(z.string()))
    .parse(run.manualPrerequisites);
  const executionContext = readRunExperienceSnapshot(
    run.executionContext,
  );
  if (
    executionContext &&
    (executionContext.caseDefinitions.length !== run.manualTestCaseIds.length ||
      new Set(executionContext.caseDefinitions.map(c => c.testCaseId)).size !== executionContext.caseDefinitions.length ||
      executionContext.caseDefinitions.some(
        (c) => !run.manualTestCaseIds.includes(c.testCaseId),
      ))
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The saved procedure does not uniquely cover this exact manual run. No current case wording was substituted.",
    });
  const frozenCases = new Map(
    executionContext?.caseDefinitions.map((c) => [c.testCaseId, c]) ??
      [],
  );
  const availability = manualRunScopeAvailability(
    run.manualTestCaseIds,
    cases.map((testCase) => testCase.id),
    executionContext?.caseDefinitions.map(
      (testCase) => testCase.testCaseId,
    ) ?? null,
  );
  const datasetScope = executionContext?.datasetExecution;
  const datasetBatchRuns = [];
  if (datasetScope) {
    if (run.id !== `${datasetScope.batchId}_${datasetScope.rowIndex}`)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "This row's frozen batch identity is inconsistent.",
      });
    const siblings = await tx.testRun.findMany({
      where: {
        projectId: run.projectId,
        id: {
          in: Array.from(
            { length: datasetScope.rowCount },
            (_, index) => `${datasetScope.batchId}_${index}`,
          ),
        },
      },
      select: { id: true, status: true, executionContext: true },
    });
    if (siblings.length !== datasetScope.rowCount)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message:
          "Some saved batch rows are unavailable. Existing execution evidence has not been replaced.",
      });
    for (const sibling of siblings) {
      const receipt = readRunExperienceSnapshot(
        sibling.executionContext,
      )?.datasetExecution;
      if (
        !receipt ||
        receipt.batchId !== datasetScope.batchId ||
        receipt.expansionHash !== datasetScope.expansionHash ||
        receipt.testCaseId !== datasetScope.testCaseId ||
        receipt.configurationHash !== datasetScope.configurationHash ||
        receipt.rowCount !== datasetScope.rowCount ||
        sibling.id !== `${receipt.batchId}_${receipt.rowIndex}`
      )
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Saved batch row provenance is inconsistent. No unrelated run was linked.",
        });
      datasetBatchRuns.push({
        testRunId: sibling.id,
        rowIndex: receipt.rowIndex,
        rowName: receipt.rowName,
        status: sibling.status,
      });
    }
    datasetBatchRuns.sort((a, b) => a.rowIndex - b.rowIndex);
  }
  await boundedCurrentStepBytes(tx, run.id);
  const stepHeads = await tx.manualStepResultHead.findMany({
    where: {
      testRunId: run.id,
      testCaseId: { in: run.manualTestCaseIds },
    },
    include: { currentRevision: true },
  });
  const stepsByCase = new Map<string, typeof stepHeads>();
  for (const head of stepHeads)
    stepsByCase.set(head.testCaseId, [
      ...(stepsByCase.get(head.testCaseId) ?? []),
      head,
    ]);

  const overrides =
    (run.project.organization.stepFieldLabels as Partial<
      Record<string, string>
    > | null) ?? {};

  const response = {
    ...access,
    testRunId: run.id,
    projectId: run.projectId,
    status: run.status,
    stepFieldLabels:
      executionContext?.stepFieldLabels ??
      resolveStepFieldLabels(overrides as never),
    executionContext,
    datasetBatchRuns,
    plannedCaseIds: availability.plannedCaseIds,
    unavailableCases: availability.unavailableCases,
    scopeAvailability: availability.scopeAvailability,
    cases: availability.availableCaseIds
      .map((id) => {
        const c = casesById.get(id);
        const frozen = frozenCases.get(id);
        if (!c && !frozen)
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "The admitted procedure partition is unavailable. No saved planned identity was dropped.",
          });
        const result = resultByCase.get(id);
        const heads = stepsByCase.get(id) ?? [];
        return {
          testCaseId: id,
          displayId: c?.displayId ?? null,
          title: frozen ? frozen.title : c!.title,
          background: frozen ? frozen.background : c!.background,
          prerequisiteIds: prerequisites[id] ?? [],
          validationDomain: frozen
            ? validationDomainSchema.parse(frozen.validationDomain)
            : c!.validationDomain,
          verificationProfile: frozen
            ? frozen.verificationProfile
            : verificationProfileSchema.parse(c!.verificationProfile),
          given: frozen ? frozen.given : c!.given,
          when: frozen ? frozen.when : c!.when,
          then: frozen ? frozen.then : c!.then,
          stepExecutionAvailable:
            !!frozen?.steps.length && (!result || heads.length > 0),
          stepResults:
            frozen?.steps.map((_, stepIndex) => {
              const head = heads.find((h) => h.stepIndex === stepIndex);
              return {
                stepIndex,
                current: head
                  ? stepRevisionOutput(head.currentRevision)
                  : null,
                revisionCount: head?.revisionCount ?? 0,
              };
            }) ?? [],
          // Same shared-step-group resolution as testCases.ts's byId -
          // a case deferring to a group has no steps of its own.
          steps: frozen
            ? frozen.steps
            : c!.sharedStepGroup
              ? (c!.sharedStepGroup.steps as Array<{
                  order: number;
                  action: string;
                  expectedActionOrData: string | null;
                  expectedResult: string | null;
                  expectedResponse: string | null;
                  mediaAttachmentIds: string[];
                }>)
              : c!.steps.map((s) => ({
                  order: s.order,
                  action: s.action,
                  expectedActionOrData: s.expectedActionOrData,
                  expectedResult: s.expectedResult,
                  expectedResponse: s.expectedResponse,
                  mediaAttachmentIds: s.mediaAttachmentIds,
                })),
          currentResult: result
            ? {
                status: result.status,
                note: result.note,
                observations: observationsSchema.parse(
                  result.observations,
                ),
              }
            : null,
        };
      }),
  };
  if (
    Buffer.byteLength(JSON.stringify(response), "utf8") > 16 * 1024 * 1024
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message:
        "This complete execution view exceeds its response bound. No partial procedure or evidence was substituted.",
    });
  return response;
}
