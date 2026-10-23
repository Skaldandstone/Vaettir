/** Browser selection intent only, never native authorization or saved run scope.
 * Native null, an empty saved path and ALL are deliberately different values. */
export type RunSuiteScope =
  | Readonly<{ kind: "ALL" }>
  | Readonly<{ kind: "UNASSIGNED" }>
  | Readonly<{ kind: "PATH"; path: string }>;
export type RunSuiteOption = Readonly<{
  value: string;
  label: string;
  scope: RunSuiteScope;
}>;
export const RUN_SUITE_SCOPE_WIRE_BYTES = 65536;
export const RUN_SUITE_ALL_VALUE = JSON.stringify({ kind: "ALL" });

export function parseRunSuiteScope(value: unknown): RunSuiteScope | null {
  if (
    typeof value !== "string" ||
    value.length > RUN_SUITE_SCOPE_WIRE_BYTES ||
    new TextEncoder().encode(value).length > RUN_SUITE_SCOPE_WIRE_BYTES
  )
    return null;
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return null;
    const descriptors = Object.getOwnPropertyDescriptors(parsed),
      keys = Reflect.ownKeys(descriptors);
    if (keys.some((key) => typeof key !== "string")) return null;
    const kind = descriptors.kind?.value;
    if (keys.length === 1 && (kind === "ALL" || kind === "UNASSIGNED"))
      return Object.freeze({ kind });
    if (
      kind === "PATH" &&
      keys.length === 2 &&
      keys.includes("path") &&
      typeof descriptors.path?.value === "string"
    )
      return Object.freeze({ kind: "PATH", path: descriptors.path.value });
  } catch {
    // Unsupported selectors are unavailable; never substitute ALL.
  }
  return null;
}
export function encodeRunSuiteScope(scope: RunSuiteScope): string {
  const value = JSON.stringify(scope);
  if (!parseRunSuiteScope(value))
    throw Error(
      "This exact suite selector is unsupported. No suite was substituted.",
    );
  return value;
}
export function runSuiteScopeLabel(scope: RunSuiteScope): string {
  if (scope.kind === "ALL") return "All suites";
  if (scope.kind === "UNASSIGNED") return "Unassigned";
  if (scope.path === "") return "Saved empty suite path";
  return `Suite: ${JSON.stringify(scope.path)}`;
}
export function runSuiteScopeMatches(
  scope: RunSuiteScope | null,
  nativePath: unknown,
) {
  if (!scope) return false;
  if (scope.kind === "ALL") return true; // No suite metadata is asserted.
  if (scope.kind === "UNASSIGNED") return nativePath === null;
  return typeof nativePath === "string" && nativePath === scope.path;
}
/** The caller supplies only its already admitted eligible rows. Unsupported
 * metadata is disclosed, not interpreted as unassigned or normalized away. */
export function runSuiteScopeOptions(nativePaths: readonly unknown[]) {
  const scopes: RunSuiteScope[] = [Object.freeze({ kind: "ALL" })],
    paths = new Set<string>();
  let unassigned = false,
    unsupportedCount = 0;
  for (const value of nativePaths) {
    if (value === null) unassigned = true;
    else if (typeof value === "string") paths.add(value);
    else unsupportedCount++;
  }
  if (unassigned) scopes.push(Object.freeze({ kind: "UNASSIGNED" }));
  scopes.push(
    ...[...paths]
      .sort()
      .map((path) => Object.freeze({ kind: "PATH" as const, path })),
  );
  const options: RunSuiteOption[] = [];
  for (const scope of scopes) {
    try {
      options.push(
        Object.freeze({
          value: encodeRunSuiteScope(scope),
          label: runSuiteScopeLabel(scope),
          scope,
        }),
      );
    } catch {
      // Every affected eligible identity is disclosed. ALL still means ALL.
      unsupportedCount += nativePaths.filter(
        (value) => scope.kind === "PATH" && value === scope.path,
      ).length;
    }
  }
  return Object.freeze({ options: Object.freeze(options), unsupportedCount });
}
export function resolveRunSuiteScope(
  value: unknown,
  options: readonly RunSuiteOption[],
) {
  const scope = parseRunSuiteScope(value),
    option =
      typeof value === "string"
        ? options.find((row) => row.value === value)
        : undefined;
  return Object.freeze({
    scope: option ? scope : null,
    available: !!scope && !!option,
    specific: !!scope && !!option && scope.kind !== "ALL",
    label: option?.label ?? "Suite scope unavailable",
  });
}
