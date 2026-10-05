import {
  QueryClient,
  hashKey,
  type QueryKey,
  type QueryFilters,
  type InvalidateQueryFilters,
  type InvalidateOptions,
  type RefetchQueryFilters,
  type RefetchOptions,
} from "@tanstack/react-query";
import type { AuthTransportScope } from "./auth-transport";

export type AuthQueryGeneration = Readonly<{
  number: number;
  identity: string;
  scope: AuthTransportScope | null;
}>;
export function authQueryIdentity(scope: AuthTransportScope | null) {
  return hashKey([scope?.userId ?? null, scope?.sessionId ?? null]);
}
function generationPrefix(generation: AuthQueryGeneration) {
  return (
    hashKey([
      "vaettir-auth-generation",
      generation.number,
      generation.identity,
    ]).slice(0, -1) + ","
  );
}
export function belongsToAuthGeneration(
  hash: string,
  generation: AuthQueryGeneration,
) {
  return hash.startsWith(generationPrefix(generation));
}

// useBaseQuery retains its original QueryObserver/client. Keep that client
// stable, and change its query namespace before descendant hooks render.
// Generations prevent A -> B -> A from resurrecting the first A's private data.
export class AuthQueryClient extends QueryClient {
  private generation: AuthQueryGeneration | null = null;
  private committedGeneration: AuthQueryGeneration | null = null;
  async commitGeneration(generation: AuthQueryGeneration) {
    if (
      this.committedGeneration?.number === generation.number &&
      this.committedGeneration.identity === generation.identity
    )
      return;
    const prior = this.committedGeneration;
    this.committedGeneration = generation;
    if (prior) await cancelAuthGeneration(this, prior);
  }
  selectGeneration(generation: AuthQueryGeneration) {
    if (
      !Number.isSafeInteger(generation.number) ||
      generation.number < 0 ||
      generation.identity !== authQueryIdentity(generation.scope)
    )
      throw Error("Invalid authenticated query generation");
    this.generation = generation;
    const defaults = this.getDefaultOptions();
    this.setDefaultOptions({
      ...defaults,
      queries: {
        ...defaults.queries,
        queryKeyHashFn: (key) =>
          hashKey([
            "vaettir-auth-generation",
            generation.number,
            generation.identity,
            key,
          ]),
      },
    });
  }
  private currentFilters<T extends QueryFilters>(filters?: T) {
    const generation = this.generation;
    const predicate = filters?.predicate;
    return {
      ...filters,
      predicate: (
        query: Parameters<NonNullable<QueryFilters["predicate"]>>[0],
      ) =>
        !!generation &&
        belongsToAuthGeneration(query.queryHash, generation) &&
        (!predicate || predicate(query)),
    };
  }
  override invalidateQueries<T extends QueryKey = QueryKey>(
    filters?: InvalidateQueryFilters<T>,
    options?: InvalidateOptions,
  ) {
    return super.invalidateQueries(this.currentFilters(filters), options);
  }
  override refetchQueries<T extends QueryKey = QueryKey>(
    filters?: RefetchQueryFilters<T>,
    options?: RefetchOptions,
  ) {
    return super.refetchQueries(this.currentFilters(filters), options);
  }
}

export function cancelAuthGeneration(
  client: QueryClient,
  generation: AuthQueryGeneration,
) {
  // Deliberately does not touch mutations or the current/new generation.
  return client.cancelQueries({
    predicate: (query) => belongsToAuthGeneration(query.queryHash, generation),
  });
}

export function currentSessionScope(
  session: { id: string; user: { id: string } } | null | undefined,
): AuthTransportScope | null {
  return session?.id && session.user?.id
    ? Object.freeze({ userId: session.user.id, sessionId: session.id })
    : null;
}
export function sameAuthScope(
  expected: AuthTransportScope | null,
  actual: AuthTransportScope | null,
) {
  return (
    !!expected &&
    !!actual &&
    expected.userId === actual.userId &&
    expected.sessionId === actual.sessionId
  );
}
