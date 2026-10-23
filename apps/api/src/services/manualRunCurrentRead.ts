import { Prisma, type PrismaClient } from "@vaettir/db";
import { TRPCError } from "@trpc/server";
import { readManualExecutionCurrentProjection } from "./manualExecutionCurrentProjection.js";
import {
  manualRunCurrentReadInput,
  manualRunCurrentReadOutput,
  manualRunCurrentReadKey,
  type ManualRunCurrentReadInput,
} from "./manualRunCurrentReadSchema.js";
import type { CaseFieldReadAuthorization } from "./caseFieldReadScope.js";

/** Independent JWT authority is mandatory on this additive path. Original
 * intent pins are comparisons only; none grants private read access. */
export async function readManualRunCurrent(
  db: PrismaClient,
  actorId: string,
  raw: ManualRunCurrentReadInput,
  authorized: CaseFieldReadAuthorization,
) {
  if (
    !authorized ||
    typeof authorized.clerkActorId !== "string" ||
    authorized.clerkActorId.length === 0
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Independent current Clerk authorization is required.",
    });
  const input = manualRunCurrentReadInput.parse(raw);
  // Shared read admission also validates bounded private graph/library data.
  // Reject the original native pin before entering even that admission.
  if (
    input.expectedNativeActorId !== undefined &&
    input.expectedNativeActorId !== actorId
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Current original native actor access is required. No run view was rebound.",
    });
  return db.$transaction(
    async (tx) => {
      const view = await readManualExecutionCurrentProjection(
        tx,
        actorId,
        authorized.clerkActorId,
        {
          projectId: input.projectId,
          testRunId: input.testRunId,
          originalOrganizationId: input.originalOrganizationId,
          expectedClerkActorId: input.expectedClerkActorId,
        },
        input.expectedNativeActorId,
      );
      if (
        view.projectId !== input.projectId ||
        view.testRunId !== input.testRunId ||
        view.organizationId !== input.originalOrganizationId ||
        view.originalOrganizationId !== input.originalOrganizationId ||
        view.actorId !== actorId ||
        view.clerkActorId !== authorized.clerkActorId ||
        view.clerkActorId !== input.expectedClerkActorId ||
        (input.expectedNativeActorId !== undefined &&
          view.actorId !== input.expectedNativeActorId)
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The current native whole-run view does not match this exact original request. No replacement scope was published.",
        });
      const parsed = manualRunCurrentReadOutput.safeParse({
        readContext: {
          requestId: input.requestId,
          requestedKey: manualRunCurrentReadKey(input),
          projection: "CURRENT_WHOLE_MANUAL_RUN_VIEW",
          scope: {
            projectId: view.projectId,
            testRunId: view.testRunId,
            organizationId: view.organizationId,
            actorId: view.actorId,
            actorClerkUserId: view.clerkActorId,
          },
        },
        view,
        provenance: {
          procedures: view.scopeAvailability.procedureBasis,
          observations: "CURRENT_SUPPORTED_API_VIEW_NOT_RAW_NATIVE_JSON",
          history: "CURRENT_HEADS_NOT_COMPLETE_REVISION_HISTORY",
          media: "IDENTIFIER_REFERENCES_NO_FILES_FETCHED",
        },
      });
      if (
        !parsed.success ||
        Buffer.byteLength(JSON.stringify(parsed.data), "utf8") >
          16 * 1024 * 1024
      )
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message:
            "The whole current manual-run view or its scope echo is unsupported. No smaller, normalized replacement or raw audit claim was returned.",
        });
      return parsed.data;
    },
    {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      timeout: 20000,
    },
  );
}
