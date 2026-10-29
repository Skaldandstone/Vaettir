import { useState, useSyncExternalStore } from "react";
import { inspectCsv, mapCsvRows, splitCsvRows } from "../../../api/src/services/csvFieldMapping";
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
export const useParams = () => ({ projectId: "synthetic-project" });
export const useSession = () => ({ isLoaded: true, session: { id: "synthetic-session", user: { id: "synthetic-actor" } } });
export const useAuth = () => ({ isLoaded: true, isSignedIn: true, userId: "synthetic-actor", sessionId: "synthetic-session" });
export const useProjectPermissions = () => ({ loaded: true, canEdit: true });
let jobs = [];
const listeners = new Set();
const invalidateJobs = async () => { jobs = [...jobs]; listeners.forEach(listener => listener()); };
const utils = { importJobs: { list: { invalidate: invalidateJobs } }, testRuns: { list: { invalidate: async () => {} } }, client: { importJobs: { startTypeAnalysis: { mutate() { window.sheetFixture.ai++; throw new Error("Sheets must not trigger AI"); } } } } };
export const trpcReact = {
  useUtils: () => utils,
  project: { byId: { useQuery: () => ({ data: { defaultBranch: "main" } }) } },
  testRuns: {
    ingestJUnit: mutation(fail),
    previewHistorical: mutation(input => {
      window.sheetFixture.previews.push(input);
      // Synthetic transport exercises the UI; real matching, dates, tenant
      // access and transaction behavior have separate API/DB tests.
      const table = splitCsvRows(input.csvText, true), headers = table.shift();
      const rows = table.map((cells, index) => { const rawStatus = cells[headers.indexOf(input.mapping.result)] ?? ""; const key = cells[headers.indexOf(input.mapping.caseId)] ?? "";
        return { rowNumber: index + 2, originalWorksheetRow: input.sourceRowNumbers?.[index+1] ?? null, key, title: "", rawStatus, status: rawStatus === "" ? "IGNORE" : input.statusMap[rawStatus] ?? null,
          date: input.runDate, caseId: "synthetic-case", caseTitle: "Synthetic case", note: "", candidates: [], issues: input.statusMap[rawStatus] || rawStatus === "" ? [] : ["Choose how to handle this result value."] };
      });
      return { rows, matchedCount: rows.filter(r => r.status && r.status !== "IGNORE" && !r.issues.length).length, ignoredCount: rows.filter(r => r.status === "IGNORE").length, blockedCount: rows.filter(r => r.issues.length).length, runCount: 1, fingerprint: "a".repeat(64) };
    }),
    commitHistorical: mutation(input => { window.sheetFixture.commits.push(input); return { importedCount: 2, replayedCount: 0, runs: [{ id: "synthetic-run", date: input.runDate, results: 2, replayed: false }] }; }),
  },
  importJobs: {
    list: { useQuery() { return { data: useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => jobs) }; } },
    historicalWorkbook: mutation(() => ({ sheets: [{ name: "Old results", csvText: "ID,Result\nold-1,pass", headers: ["ID", "Result"], rowCount: 1, originalRowNumbers: [5,9] }] })),
    ...endpoints, previewCsv: mutation(preview), previewWithMapping: mutation(preview),
    googleSheetsConfig: { useQuery: () => ({ data: new URLSearchParams(location.search).has("unconfigured") ? null : { clientId: "synthetic-client", apiKey: "synthetic-public-key", appId: "123456789" }, isLoading: false, error: null }) },
    commitGoogleSheets: mutation(input => {
      window.sheetFixture.commits.push(input);
      const conflict = new URLSearchParams(location.search).has("conflict");
      const skipped = conflict ? [{ rowNumber: 2, reason: "Case changed since its last import; source updates were not applied. Review the human edits and source changes." }] : [];
      jobs = [{ id: "synthetic-job", source: "GOOGLE_SHEETS", status: "SUCCEEDED", statusLabel: conflict ? "Needs review" : "Completed", skippedRows: skipped, sourceLabel: "Synthetic workbook", createdCount: conflict ? 0 : 2, updatedCount: 0, skippedCount: skipped.length, createdByName: "Synthetic actor", createdAt: "2026-10-18T12:00:00Z" }];
      return { importJobId: "synthetic-job", createdCount: conflict ? 0 : 2, updatedCount: 0, skipped };
    }),
  },
};
