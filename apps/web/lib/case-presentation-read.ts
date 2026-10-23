import { caseFieldReadOrigin, sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin.ts";

type PresentationRead = { projectId: string; organizationId: string; caseId: null; readScope: { projectId: string; organizationId: string; actorId: string; actorClerkUserId: string } };
export function freshCasePresentation<T extends PresentationRead>(query: { data?: T; error?: unknown; isFetching: boolean; isPaused: boolean }, current: CaseFieldOrigin | null): T | undefined {
  if (!current || query.error || query.isFetching || query.isPaused) return undefined;
  const projectOrigin = { ...current, caseId: null };
  const echo = caseFieldReadOrigin(query.data, current.projectId, null, current.clerkActorId);
  return sameCaseFieldOrigin(projectOrigin, echo) ? query.data : undefined;
}
