import { createHash } from "node:crypto";
import { captureAiUsage, recommendImportTypes, type ImportTypeCase, type ImportTypeRecommendation } from "@vaettir/ai-agent";
import type { MappedRow } from "./csvFieldMapping.js";
import { workbookCacheScope, type WorkbookReadScope } from "./xlsxWorkbookReads.js";

export function importTypeCase(id: string, row: MappedRow): ImportTypeCase {
  return { id, title: row.title, given: row.given, when: row.when, then: row.then, tags: row.tags,
    ...(row.background ? { background: row.background } : {}), ...(row.suitePath ? { suitePath: row.suitePath } : {}) };
}
export const importCaseId = (sheet: string, rowNumber: number) => JSON.stringify([sheet, rowNumber]);
export const importTypeFingerprint = (c: ImportTypeCase) => createHash("sha256").update(JSON.stringify(c)).digest("hex");
type Result = ImportTypeRecommendation & { fingerprint: string };
type AnalysisState = { status: "READING" | "READY" | "CANCELLED"; total: number; completed: number; results: Result[]; failed: number };
type Job = { digest: string; state: AnalysisState; controller: AbortController; finishedAt?: number; fingerprints: Map<string, string> };
const RETENTION = 30 * 60_000;

/** Platform-funded import assistance, explicitly not a customer-credit operation.
 * Process-local previews only: no case/ledger/source writes. Auth is refreshed
 * before EACH provider batch and on every poll/receipt use. Definitions are never
 * logged. Capacity/rate bounds prevent free inference from becoming an open relay.
 */
export function createImportTypeAnalysis(analyze = recommendImportTypes) {
  const jobs = new Map<string, Job>();
  const recentStarts = new Map<string, number[]>();
  let runningCalls = 0;
  const waiting: (() => void)[] = [];
  const key = (scope: WorkbookReadScope, requestId: string) => JSON.stringify([workbookCacheScope(scope), requestId]);
  function expire() {
    for (const [id, job] of jobs) if (job.finishedAt && job.finishedAt + RETENTION <= Date.now()) jobs.delete(id);
    for (const [id, starts] of recentStarts) {
      const current = starts.filter(t => t > Date.now() - 3600_000);
      if (current.length) recentStarts.set(id, current); else recentStarts.delete(id);
    }
  }
  function find(scope: WorkbookReadScope, requestId: string) {
    expire(); const job = jobs.get(key(scope, requestId));
    if (!job) throw new Error("Type-analysis preview expired. Review types again before importing.");
    return job;
  }
  async function slot() {
    if (runningCalls >= 2) await new Promise<void>(resolve => waiting.push(resolve));
    else runningCalls++;
    return () => { const next = waiting.shift(); if (next) next(); else runningCalls--; };
  }
  function unresolved(c: ImportTypeCase, reason: string): Result {
    return { id: c.id, fingerprint: importTypeFingerprint(c), testType: null, confidence: "LOW", objective: "Type not established", reason, evidence: [] };
  }
  return {
    start(scope: WorkbookReadScope, requestId: string, cases: ImportTypeCase[], authorize: () => Promise<unknown>) {
      expire(); const id = key(scope, requestId), digest = createHash("sha256").update(JSON.stringify(cases)).digest("hex");
      const existing = jobs.get(id);
      if (existing) { if (existing.digest !== digest) throw new Error("Type-analysis request belongs to a different preview."); return { requestId }; }
      if (!cases.length || cases.length > 15_000 || JSON.stringify(cases).length > 8_000_000 || new Set(cases.map(c => c.id)).size !== cases.length)
        throw new Error("Type analysis needs distinct cases within the supported preview capacity.");
      const scopeKey = workbookCacheScope(scope);
      const same = [...jobs.entries()].filter(([k]) => k.startsWith(JSON.stringify([scopeKey]).slice(0, -1)));
      const reused = same.find(([, j]) => j.digest === digest && j.state.status !== "CANCELLED");
      if (reused) return { requestId: JSON.parse(reused[0])[1] as string };
      const starts = recentStarts.get(scopeKey) ?? [];
      if (starts.length >= 12 || [...jobs.values()].filter(j => !j.finishedAt).length >= 8 || jobs.size >= 32)
        throw new Error("Import type review is busy. Your preview is preserved; retry shortly.");
      if (same.some(([, j]) => !j.finishedAt)) throw new Error("Another type review is still finishing for this project. Retry shortly.");
      recentStarts.set(scopeKey, [...starts, Date.now()]);
      const job: Job = { digest, controller: new AbortController(), fingerprints: new Map(cases.map(c => [c.id, importTypeFingerprint(c)])),
        state: { status: "READING", total: cases.length, completed: 0, results: [], failed: 0 } };
      jobs.set(id, job);
      void (async () => {
        // Pack whole cases by both count and actual serialized length. Oversized
        // definitions remain explicitly unclassified; no partial-text analysis.
        const batches: ImportTypeCase[][] = []; let batch: ImportTypeCase[] = [], size = 0;
        for (const c of cases) {
          const cached = same.flatMap(([, j]) => j.state.results).find(r => r.fingerprint === importTypeFingerprint(c) && r.evidence.length > 0);
          if (cached) { job.state.results.push(cached); job.state.completed++; continue; }
          const length = JSON.stringify(c).length + 1;
          if (length > 85_000) { job.state.results.push(unresolved(c, "This complete definition exceeds the model batch capacity. No partial-text classification was attempted; review its type.")); job.state.failed++; job.state.completed++; continue; }
          if (batch.length && (batch.length >= 20 || size + length > 85_000)) { batches.push(batch); batch = []; size = 0; }
          batch.push(c); size += length;
        }
        if (batch.length) batches.push(batch);
        let nextBatch = 0;
        const worker = async () => { while (nextBatch < batches.length) {
          const chunk = batches[nextBatch++]!;
          if (job.controller.signal.aborted) break;
          const release = await slot();
          try {
            if (job.controller.signal.aborted) break;
            await authorize();
            const { result } = await captureAiUsage(() => analyze(chunk, job.controller.signal));
            if (job.controller.signal.aborted) break;
            job.state.results.push(...result.map(r => ({ ...r, fingerprint: job.fingerprints.get(r.id)! })));
          } catch {
            if (!job.controller.signal.aborted) {
              job.state.failed += chunk.length;
              job.state.results.push(...chunk.map(c => unresolved(c, "AI type review could not verify this case. No type was guessed. Review manually or retry analysis.")));
            }
          } finally { release(); }
          if (!job.controller.signal.aborted) job.state.completed += chunk.length;
        } };
        await Promise.all([worker(), worker()]);
        if (!job.controller.signal.aborted) job.state.status = "READY";
      })().catch(() => {
        if (!job.controller.signal.aborted) {
          const done = new Set(job.state.results.map(r => r.id));
          const remaining = cases.filter(c => !done.has(c.id));
          job.state.results.push(...remaining.map(c => unresolved(c, "Type review could not finish. No classification was guessed.")));
          job.state.failed += remaining.length; job.state.completed = cases.length; job.state.status = "READY";
        }
      }).finally(() => { job.finishedAt = Date.now(); });
      return { requestId };
    },
    status(scope: WorkbookReadScope, requestId: string): AnalysisState { return structuredClone(find(scope, requestId).state); },
    cancel(scope: WorkbookReadScope, requestId: string) {
      const job = find(scope, requestId); job.controller.abort(); job.state.status = "CANCELLED"; job.finishedAt = Date.now(); return { cancelled: true };
    },
    apply(scope: WorkbookReadScope, requestId: string | undefined, sheet: string, rows: MappedRow[]): MappedRow[] {
      if (!requestId) return rows;
      const job = find(scope, requestId);
      if (job.state.status !== "READY") throw new Error("Wait for type review to finish or clear its recommendations before importing.");
      const results = new Map(job.state.results.map(r => [r.id, r]));
      return rows.map(row => {
        if (row.typeOrigin === "SOURCE" || row.typeOrigin === "REVIEWER") return row;
        const c = importTypeCase(importCaseId(sheet, row.rowNumber), row), result = results.get(c.id);
        if (!result || result.fingerprint !== importTypeFingerprint(c)) throw new Error("Case definition changed since type review. Review the updated preview before importing.");
        return { ...row, testType: result.testType ?? "OTHER", typeOrigin: "SEMANTIC" as const,
          typeRecommendation: `${result.confidence} confidence. ${result.objective}: ${result.reason}`,
          reviewReasons: [...(row.reviewReasons ?? []), `AI type recommendation requires review: ${result.reason}`] };
      });
    },
  };
}
export const importTypeAnalysis = createImportTypeAnalysis();
