type Scope = {
  projectId: string;
  organizationId: string;
  clerkActorId: string;
};
type Filters = { search: string; collection: string; sort: string };
type Catalog = Scope & {
  offset: number;
  catalogKey?: string;
  catalog?: Filters;
};
/** Metadata echoes cannot grant access. Caller first requires fresh authenticated
 * project/member scope and rejects query error/fetch/pause states. */
export function savedQueryCatalogEchoMatches(
  data: Catalog | undefined,
  scope: Scope | null,
  offset: number,
  filters: Filters,
  key: string,
) {
  return (
    !!scope &&
    !!data &&
    data.projectId === scope.projectId &&
    data.organizationId === scope.organizationId &&
    data.clerkActorId === scope.clerkActorId &&
    data.offset === offset &&
    data.catalogKey === key &&
    data.catalog?.search === filters.search &&
    data.catalog.collection === filters.collection &&
    data.catalog.sort === filters.sort
  );
}
export function reachableSavedQueryPage(nextOffset: unknown, offset: number) {
  return (
    typeof nextOffset === "number" &&
    Number.isInteger(nextOffset) &&
    nextOffset === offset + 50 &&
    nextOffset <= 150
  );
}
