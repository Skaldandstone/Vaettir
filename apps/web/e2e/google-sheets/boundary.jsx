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
let jobs = [], queues = [];
const batches = new Map(), fieldAccess = new Map();
const listeners = new Set();
const invalidateJobs = async () => { jobs = [...jobs]; queues = [...queues]; listeners.forEach(listener => listener()); };
function querySnapshot(read) { return { useQuery() { const data = useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, read); return { data, isFetching: false, isPaused: false, error: null, refetch: invalidateJobs }; } }; }
const utils = { importJobs: { list: { invalidate: invalidateJobs }, mappingQueues: { invalidate: invalidateJobs } }, testRuns: { list: { invalidate: async () => {} } }, client: { importJobs: { startTypeAnalysis: { mutate() { window.sheetFixture.ai++; throw new Error("Sheets must not trigger AI"); } } } } };
export const trpcReact = {
  useUtils: () => utils,
  project: { byId: { useQuery: () => ({ data: { defaultBranch: "main" } }) } },
  caseFields: { get: { useQuery({projectId,caseId}) { const key=JSON.stringify([projectId,caseId??null]); if(!fieldAccess.has(key))fieldAccess.set(key,{projectId,caseId:caseId??null,organizationId:"synthetic-org",canEdit:true,canConfigure:true,readScope:{projectId,organizationId:"synthetic-org",actorId:"synthetic-native-actor",actorClerkUserId:"synthetic-actor"}}); return { data:fieldAccess.get(key),isFetching:false,isPaused:false,error:null,refetch:async()=>{} }; } } },
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
    mappingQueues: querySnapshot(() => queues),
    mappingQueue: { useQuery({batchId}) { const data=useSyncExternalStore(listener=>{listeners.add(listener);return()=>listeners.delete(listener)},()=>batches.get(batchId));return {data,isFetching:false,isPaused:false,error:null,refetch:invalidateJobs}; } },
    prepareMapping: mutation(input => {
      window.sheetFixture.prepares.push(structuredClone(input));
      if(input.expectedClerkActorId!=="synthetic-actor"||input.originalOrganizationId!=="synthetic-org")throw Error("Wrong synthetic original scope");
      const rows=input.source.sheets.flatMap(sheet=>{const table=splitCsvRows(sheet.csvText,true),headers=table.shift();const mapped=sheet.mapping.title?mapCsvRows(sheet.csvText,sheet.mapping,undefined,sheet.overrides??[]):{rows:[],incompleteRows:[]};return table.filter(cells=>cells.some(cell=>cell.trim())).map((cells,index)=>{const candidate=[...mapped.rows,...mapped.incompleteRows].find(row=>row.rowNumber===index+2)??{rowNumber:index+2,title:"",given:[],when:[],then:[],priority:"MEDIUM",tags:[],testType:"FUNCTIONAL",automationStatus:"MANUAL"};return {id:sheet.name+":"+(index+2),sheet:sheet.name,originalRowNumber:index+2,state:sheet.mapping.title&&candidate.title?"READY":"MAPPING",candidate,original:{headers,cells},reasons:[]};});});
      const data={id:input.requestId,sourceLabel:input.sourceLabel,state:"DRAFT",readyCount:rows.filter(r=>r.state==="READY").length,pendingCount:rows.filter(r=>r.state==="MAPPING").length,contextCount:0,historyCount:0,importedCount:0,digest:"a".repeat(64),rows};
      batches.set(data.id,data);return structuredClone(data);
    }),
    confirmMapping: mutation(input => {
      window.sheetFixture.commits.push(structuredClone(input));
      const batch=batches.get(input.batchId);if(!batch||input.expectedDigest!==batch.digest)throw Error("Wrong synthetic import receipt");
      const conflict=new URLSearchParams(location.search).has("conflict");
      const reason="Case changed since its last import; source updates were not applied. Review the human edits and source changes.";
      const rows=batch.rows.flatMap(row=>row.state!=="READY"?[row]:conflict?[{...row,state:"MAPPING",reasons:[reason]}]:[]);
      const createdCount=conflict?0:batch.readyCount;
      const next={...batch,state:"CONFIRMED",readyCount:0,pendingCount:rows.length,importedCount:createdCount,digest:"b".repeat(64),rows};batches.set(batch.id,next);
      queues=rows.length?[{id:batch.id,sourceLabel:batch.sourceLabel,createdAt:"2026-10-18T12:00:00Z"}]:[];
      jobs=[{id:"synthetic-job",source:"GOOGLE_SHEETS",status:"SUCCEEDED",statusLabel:conflict?"Needs review":"Completed",skippedRows:[],sourceLabel:"Synthetic workbook",createdCount,updatedCount:0,skippedCount:rows.length,createdByName:"Synthetic actor",createdAt:"2026-10-18T12:00:00Z"}];
      return {batchId:batch.id,createdCount,updatedCount:0,pendingCount:rows.length,historyCount:0,importedCount:createdCount};
    }),
    cancelMapping: mutation(() => ({cancelled:true})), resolveMapping: mutation(fail),
    list: { useQuery() { return { data: useSyncExternalStore(listener => { listeners.add(listener); return () => listeners.delete(listener); }, () => jobs) }; } },
    historicalWorkbook: mutation(() => ({ sheets: [{ name: "Old results", csvText: "ID,Result\nold-1,pass", headers: ["ID", "Result"], rowCount: 1, originalRowNumbers: [5,9] }] })),
    ...endpoints, previewCsv: mutation(preview), previewWithMapping: mutation(preview),
    googleSheetsConfig: { useQuery: () => ({ data: new URLSearchParams(location.search).has("unconfigured") ? null : { clientId: "synthetic-client", apiKey: "synthetic-public-key", appId: "123456789" }, isLoading: false, error: null }) },
    commitGoogleSheets: mutation(fail),
  },
};
