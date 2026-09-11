export function canConfirmNamedAction(
  expected: string | undefined,
  entered: string,
  busy: boolean,
): boolean {
  return (
    !busy &&
    (expected === undefined || (expected.length > 0 && entered === expected))
  );
}

export function isNavigationActive(
  pathname: string,
  href: string,
  exact = false,
): boolean {
  return (
    pathname === href ||
    (!exact && href !== "/" && pathname.startsWith(href + "/"))
  );
}

export function isCurrentSearch(
  state: { projectId: string; query: string } | null,
  projectId: string,
  query: string,
): boolean {
  return state?.projectId === projectId && state.query === query.trim();
}
export function isConnectionFailure(error: string): boolean {
  return /^(failed to fetch|fetch failed|load failed|networkerror(?: when attempting to fetch resource\.?)?)$/i.test(
    error.trim(),
  );
}
