// 2026-08-27 competitor parity audit: shared substitution logic for
// data-driven testing on the structured step-table format
// (TestCaseDataset). Same `<placeholder>` syntax gherkinImport.ts's
// Scenario Outline expansion already uses, kept here as a standalone,
// reusable function since it's genuinely the same operation independent
// of which authoring format calls it.
export function substituteDatasetPlaceholders(text: string, values: Record<string, string>): string {
  return text.replace(/<([^<>]+)>/g, (match, name) => {
    const key = (name as string).trim();
    return key in values ? values[key]! : match;
  });
}
