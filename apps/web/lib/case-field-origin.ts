import {
  retainedTraceabilityReceipt,
  type TraceabilityReceipt,
} from "./traceability-receipt.ts";

export type CaseFieldOrigin = Readonly<{
  projectId: string;
  organizationId: string;
  clerkActorId: string;
  caseId: string | null;
}>;

type CaseFieldReadScope = Readonly<{
  projectId: string;
  organizationId: string;
  actorId: string;
  actorClerkUserId: string;
}>;

// Bootstrap from an authenticated server echo, never attach the current Clerk
// actor to a cached body that did not identify its own authorized reader.
export function caseFieldReadOrigin(
  data: {
    projectId: string;
    caseId: string | null;
    organizationId?: string;
    readScope?: CaseFieldReadScope;
  } | null | undefined,
  projectId: string,
  caseId: string | null,
  clerkActorId: string | null | undefined,
): CaseFieldOrigin | null {
  const scope = data?.readScope;
  if (
    !projectId || !clerkActorId || (caseId !== null && !caseId) ||
    !data || data.projectId !== projectId || data.caseId !== caseId ||
    !scope?.organizationId || !scope.actorId ||
    scope.projectId !== projectId || scope.actorClerkUserId !== clerkActorId ||
    (data.organizationId !== undefined && data.organizationId !== scope.organizationId)
  ) return null;
  return { projectId, caseId, organizationId: scope.organizationId, clerkActorId: scope.actorClerkUserId };
}

export function caseFieldReadPins(origin: CaseFieldOrigin | null): {
  originalOrganizationId?: string;
  expectedClerkActorId?: string;
} {
  return origin ? { originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId } : {};
}

export function sameCaseFieldOrigin(
  original: CaseFieldOrigin | null,
  current: CaseFieldOrigin | null,
) {
  return (
    !!original &&
    !!current &&
    !!original.projectId &&
    !!original.organizationId &&
    !!original.clerkActorId &&
    (original.caseId === null || !!original.caseId) &&
    original.projectId === current.projectId &&
    original.organizationId === current.organizationId &&
    original.caseId === current.caseId &&
    original.clerkActorId === current.clerkActorId
  );
}

export type CaseFieldReceipt<T> = TraceabilityReceipt<T> & {
  origin: CaseFieldOrigin;
};

export function retainedCaseFieldReceipt<T>(
  receipt: CaseFieldReceipt<T>,
  cause: unknown,
): CaseFieldReceipt<T> | null {
  const retained = retainedTraceabilityReceipt(receipt, cause);
  return retained ? { ...retained, origin: receipt.origin } : null;
}

export function assertCaseFieldAcknowledgement(
  result: { requestId: string; replayed: boolean },
  requestId: string,
) {
  if (result.requestId !== requestId || typeof result.replayed !== "boolean")
    throw new Error(
      "The acknowledgement did not match the retained field request. Retry its exact identity after restoring original access.",
    );
}
