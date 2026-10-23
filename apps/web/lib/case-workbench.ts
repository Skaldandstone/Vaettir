export function caseLabel(value: string): string {
  const special: Record<string, string> = {
    E2E: "End-to-end",
    AI_REVERSE_ENGINEERED: "AI reverse-engineered",
    UNIT: "Unit",
    PENDING_REVIEW: "Pending review",
  };
  return (
    special[value] ??
    value
      .toLowerCase()
      .replaceAll("_", " ")
      .replace(/^./, (character) => character.toUpperCase())
  );
}

export function suiteChoices(
  cases: { suitePath: string | null; sourceFilePath: string | null }[],
): string[] {
  const choices = new Set<string>();
  for (const item of cases) {
    const location = item.suitePath || item.sourceFilePath;
    if (!location) continue;
    const segments = location.split("/");
    for (let index = 1; index <= segments.length; index++)
      choices.add(segments.slice(0, index).join("/"));
  }
  return [...choices].sort((left, right) =>
    left.localeCompare(right, undefined, {
      numeric: true,
      sensitivity: "base",
    }),
  );
}
