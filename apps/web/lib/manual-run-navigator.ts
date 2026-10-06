export type ManualRunCaseFilter =
  "ALL" | "UNTESTED" | "FAILED" | "BLOCKED" | "RECORDED";
export type NavigableManualCase = {
  testCaseId: string;
  displayId: string | null;
  title: string;
  currentResult: { status: string } | null;
};
export function manualRunCaseMatches(
  testCase: NavigableManualCase,
  search: string,
  filter: ManualRunCaseFilter,
): boolean {
  const status = testCase.currentResult?.status ?? null;
  if (filter === "UNTESTED" && status !== null) return false;
  if (filter === "FAILED" && status !== "FAIL") return false;
  if (filter === "BLOCKED" && status !== "BLOCKED") return false;
  if (filter === "RECORDED" && status === null) return false;
  return `${testCase.displayId ?? ""} ${testCase.title}`
    .toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase());
}
/** Explicit navigation only. This never changes an outcome or run scope. */
export function nextUntestedManualCase(
  cases: readonly NavigableManualCase[],
  currentId: string | null,
): string | null {
  const index = cases.findIndex(
    (testCase) => testCase.testCaseId === currentId,
  );
  for (let offset = 1; offset <= cases.length; offset++) {
    const candidate = cases[(index + offset) % cases.length];
    if (candidate && !candidate.currentResult) return candidate.testCaseId;
  }
  return null;
}
