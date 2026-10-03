/** Cached data surviving an unsuccessful refresh is not a new review baseline. */
export function currentCaseVersionPreview<T extends { versionNumber: number }>(
  query: {
    data: T | undefined;
    error: unknown;
    isFetching: boolean;
    isPaused: boolean;
  },
  requestedVersion: number | null,
): T | null {
  return requestedVersion !== null &&
    !query.error &&
    !query.isFetching &&
    !query.isPaused &&
    query.data?.versionNumber === requestedVersion
    ? query.data
    : null;
}
