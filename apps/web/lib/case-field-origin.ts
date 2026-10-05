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
