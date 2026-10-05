import { caseFieldReadOrigin, sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin.ts";
type ReadEcho = Parameters<typeof caseFieldReadOrigin>[0];
export function currentCollaborationRead<T extends NonNullable<ReadEcho>>(
  query: { data?: T; error?: unknown; isFetching: boolean; isPaused: boolean },
  origin: CaseFieldOrigin | null,
): T | undefined {
  if (!origin || !origin.caseId || query.error || query.isFetching || query.isPaused) return undefined;
  const echo = caseFieldReadOrigin(query.data, origin.projectId, origin.caseId, origin.clerkActorId);
  return sameCaseFieldOrigin(origin, echo) ? query.data : undefined;
}
