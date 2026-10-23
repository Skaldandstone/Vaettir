"use client";
import { useState } from "react";
import { useAuth } from "@clerk/nextjs";
import type { UseQueryResult } from "@tanstack/react-query";
import { trpcReact, type RouterOutputs } from "./trpcReact";
import { sameCommentReader, type CommentOrigin } from "./case-comment-draft";
export type CommentAccessState = RouterOutputs["caseComments"]["access"];
export type CommentAccess = { origin: CommentOrigin | null; fresh: CommentAccessState | null; readable: boolean; activation: string; refresh: () => void; query: UseQueryResult<CommentAccessState, NonNullable<ReturnType<typeof trpcReact.caseComments.access.useQuery>["error"]>> };
/** A completed nonce/session-bound native bootstrap pins the author once;
 * custom-field schemas and private case bodies are not permission inputs. */
export function useCaseCommentAccess(projectId: string, caseId: string, active = true): CommentAccess {
  const auth = useAuth();
  const [origin, setOrigin] = useState<CommentOrigin | null>(null), [refresh, setRefresh] = useState(0);
  const clerk = origin?.clerkActorId ?? auth.userId ?? "";
  const ready = active && !!projectId && !!caseId && auth.isLoaded && auth.isSignedIn && !!auth.sessionId && auth.userId === clerk && (!origin || origin.projectId === projectId && origin.caseId === caseId);
  const binding = JSON.stringify([!!ready, active, projectId, caseId, origin, auth.sessionId, refresh]);
  const [cycle, setCycle] = useState({ binding: "", requestId: crypto.randomUUID() });
  if (cycle.binding !== binding) setCycle({ binding, requestId: crypto.randomUUID() });
  const query = trpcReact.caseComments.access.useQuery({ projectId, caseId, requestId: cycle.requestId, ...(origin ? { originalOrganizationId: origin.organizationId, expectedClerkActorId: origin.clerkActorId } : {}) }, { enabled: !!ready && cycle.binding === binding, retry: false, staleTime: 0, refetchOnWindowFocus: false });
  const candidate = ready && cycle.binding === binding && query.isFetchedAfterMount && !query.error && !query.isFetching && !query.isPaused && query.data?.requestId === cycle.requestId && query.data.projectId === projectId && query.data.caseId === caseId && query.data.readScope.projectId === projectId && query.data.readScope.actorClerkUserId === clerk && !!query.data.readScope.actorId && !!query.data.readScope.organizationId && query.data.canComment ? query.data : null;
  if (!origin && candidate) setOrigin(Object.freeze({ projectId, caseId, organizationId: candidate.readScope.organizationId, clerkActorId: candidate.readScope.actorClerkUserId, nativeActorId: candidate.readScope.actorId }));
  const fresh = origin && candidate && sameCommentReader(candidate.readScope, origin) ? candidate : null;
  return { query, origin, fresh, readable: !!fresh, activation: cycle.requestId, refresh: () => setRefresh(value => value + 1) };
}
