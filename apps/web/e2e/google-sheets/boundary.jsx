import { useState } from "react";
import { inspectCsv, mapCsvRows } from "../../../api/src/services/csvFieldMapping";
function previewResult(input) {
  const inspected = inspectCsv(input.csvText);
  const mapping = input.mapping ?? inspected.suggestedMapping;
  const mapped = mapping.title ? mapCsvRows(input.csvText, mapping, undefined, input.overrides ?? []) : { rows: [], incompleteRows: [], skipped: [] };
  return { ...inspected, previewRows: mapped.rows.slice(0, 10), incompleteRows: mapped.incompleteRows, previewSkipped: mapped.skipped, recommendations: mapped.recommendations ?? [], nonCaseRows: mapped.nonCaseRows ?? [], rowMappingSuggestions: mapped.rowMappingSuggestions ?? [] };
}
function preview(input) {
  window.sheetFixture.previews.push(input);
  if (window.sheetFixture.delayPreview && window.sheetFixture.previews.length === 1)
    return new Promise(resolve => { window.sheetFixture.resolvePreview = () => resolve(previewResult(input)); });
  return previewResult(input);
}
function mutation(handler) {
  return { useMutation() { const [isPending, setPending] = useState(false); return { isPending, mutateAsync: async input => { setPending(true); try { return await handler(input); } finally { setPending(false); } } }; } };
}
const fail = () => { throw new Error("Unexpected fixture endpoint"); };
const endpoints = Object.fromEntries(["commitCsv", "commitXlsx", "commitXray", "commitTestRail", "commitQTest", "commitZephyr", "previewXlsxSheet", "previewXray", "previewTestRail", "previewQTest", "previewZephyr"].map(name => [name, mutation(fail)]));
const utils = { client: { importJobs: { startTypeAnalysis: { mutate() { window.sheetFixture.ai++; throw new Error("Sheets must not trigger AI"); } } } } };
export const trpcReact = {
  useUtils: () => utils,
  importJobs: {
    ...endpoints, previewCsv: mutation(preview), previewWithMapping: mutation(preview),
    googleSheetsConfig: { useQuery: () => ({ data: new URLSearchParams(location.search).has("unconfigured") ? null : { clientId: "synthetic-client", apiKey: "synthetic-public-key", appId: "123456789" }, isLoading: false, error: null }) },
    commitGoogleSheets: mutation(input => { window.sheetFixture.commits.push(input); return { importJobId: "synthetic-job", createdCount: 2, updatedCount: 0, skipped: [] }; }),
  },
};
