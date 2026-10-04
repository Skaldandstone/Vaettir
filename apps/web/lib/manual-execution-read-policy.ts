/** Response presentation only; server authorization remains the access authority. */
export function manualExecutionReadMatches(input: {
  projectId: string; testRunId: string; organizationId?: string; clerkActorId?: string;
  requestKey: string; ready: boolean; error: boolean; fetching: boolean; paused: boolean;
}, response?: {
  projectId: string; testRunId: string; organizationId: string; originalOrganizationId: string;
  clerkActorId: string; readRequestKey: string;
}) {
  return input.ready && !input.error && !input.fetching && !input.paused && !!input.organizationId && !!input.clerkActorId && !!input.requestKey && !!response &&
    response.projectId === input.projectId && response.testRunId === input.testRunId &&
    response.organizationId === input.organizationId && response.originalOrganizationId === input.organizationId &&
    response.clerkActorId === input.clerkActorId && response.readRequestKey === input.requestKey;
}
