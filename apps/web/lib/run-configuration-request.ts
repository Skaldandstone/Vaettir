export type RunExecutionContext = {
  configuration: string;
  platform: string;
  build: string;
  hardwareRevision: string;
  firmwareVersion: string;
  rig: string;
  batchOrLot: string;
  environment: string;
  calibrationReference: string;
  protocolReference: string;
};
export type ReviewedRunConfiguration = {
  projectId: string;
  testCaseIds: string[];
  expectedProfileHash: string;
  executionContext: RunExecutionContext;
  idempotencyKey: string;
  originalOrganizationId: string;
  expectedClerkActorId: string;
};
export const MAX_MANUAL_CASES = 1000;
export function reviewedRunCasesMatch(
  reviewed: readonly string[] | null,
  current: readonly string[],
) {
  return (
    reviewed !== null &&
    reviewed.length === current.length &&
    reviewed.every((id, index) => id === current[index])
  );
}
export function freezeRunConfiguration(
  input: Omit<ReviewedRunConfiguration, "idempotencyKey">,
  idempotencyKey: string,
): ReviewedRunConfiguration {
  if (
    !input.testCaseIds.length ||
    input.testCaseIds.length > MAX_MANUAL_CASES ||
    new Set(input.testCaseIds).size !== input.testCaseIds.length
  )
    throw Error(
      "Review between 1 and 1,000 distinct cases. Required prerequisites also count toward the server limit.",
    );
  const request: ReviewedRunConfiguration = {
    ...input,
    idempotencyKey,
    testCaseIds: [...input.testCaseIds],
    executionContext: Object.fromEntries(
      Object.entries(input.executionContext).map(([key, value]) => [
        key,
        value.trim(),
      ]),
    ) as RunExecutionContext,
  };
  Object.freeze(request.testCaseIds);
  Object.freeze(request.executionContext);
  return Object.freeze(request);
}
export function runConfigurationScopeMatches(
  request: ReviewedRunConfiguration,
  scope:
    | { projectId: string; organizationId: string; clerkActorId: string }
    | null
    | undefined,
) {
  return (
    !!scope &&
    request.projectId === scope.projectId &&
    request.originalOrganizationId === scope.organizationId &&
    request.expectedClerkActorId === scope.clerkActorId
  );
}

export function verifiedRunConfigurationAck(
  request: ReviewedRunConfiguration,
  value: unknown,
): value is {
  testRunId: string;
  originalOrganizationId: string;
  expectedClerkActorId: string;
  idempotencyKey: string;
} {
  if (!value || typeof value !== "object") return false;
  const ack = value as Record<string, unknown>;
  return (
    typeof ack.testRunId === "string" &&
    /^manual_[a-f0-9]{64}$/.test(ack.testRunId) &&
    ack.originalOrganizationId === request.originalOrganizationId &&
    ack.expectedClerkActorId === request.expectedClerkActorId &&
    ack.idempotencyKey === request.idempotencyKey
  );
}
