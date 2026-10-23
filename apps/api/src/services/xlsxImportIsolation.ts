import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";
import type { ParsedWorkbookSheet } from "./xlsxImport.js";
import { XLSX_MAX_UPLOAD_BYTES } from "./xlsxImportLimits.js";

// No eight-second (or other fixed total) workbook deadline. Only stop a parser
// that makes no real progress for two minutes, or is explicitly cancelled.
export const XLSX_PARSE_STALL_TIMEOUT_MS = 120_000;
export const XLSX_CACHE_TTL_MS = 10 * 60_000;
const MAX_ACTIVE_WORKERS = 1;
let activeWorkers = 0;
let cached: { key: string; expiresAt: number; sheets: ParsedWorkbookSheet[] } | undefined;
let cacheExpiry: ReturnType<typeof setTimeout> | undefined;

const FAILURE_MESSAGE = "Workbook could not be read safely. Check the file and supported import limits.";
const BOOTSTRAP = `
  const { workerData } = require("node:worker_threads");
  (async () => {
    if (workerData.moduleUrl.endsWith(".ts")) {
      const { tsImport } = await import("tsx/esm/api");
      await tsImport(workerData.moduleUrl, workerData.moduleUrl);
    } else {
      await import(workerData.moduleUrl);
    }
  })().catch(() => { process.exitCode = 1; });
`;

/** No queue: busy requests fail closed instead of retaining more upload buffers.
 * Heap limits supplement (not replace) compressed/expanded parser limits: native
 * buffers are outside V8's heap. A progress watchdog bounds stuck inflate/XML
 * work without charging ordinary workbooks for CPU contention or prior sheets.
 * One actor/project-scoped parsed workbook is cached briefly, not its upload.
 * Mapping and commit still perform their independent fresh access checks.
 */
export async function parseXlsxWorkbookIsolated(
  buffer: Buffer,
  signal?: AbortSignal,
  cacheScope?: string,
  onProgress?: (sequence: number) => void,
  purpose: "cases" | "results" = "cases",
): Promise<ParsedWorkbookSheet[]> {
  if (buffer.byteLength > XLSX_MAX_UPLOAD_BYTES)
    throw new Error("Excel file exceeds the current 32 MB upload capacity");
  if (signal?.aborted) throw new Error("Excel processing was cancelled.");
  const cacheKey = cacheScope ? createHash("sha256").update(JSON.stringify([cacheScope, purpose, createHash("sha256").update(buffer).digest("hex")])).digest("hex") : undefined;
  if (cached && cached.expiresAt <= Date.now()) cached = undefined;
  if (cacheKey && cached?.key === cacheKey) return structuredClone(cached.sheets);
  if (activeWorkers >= MAX_ACTIVE_WORKERS)
    throw new Error("Another Excel import is being processed. Try again shortly.");

  activeWorkers += 1;
  let worker: Worker;
  try {
    // Use the same source tree in tsx/Vitest and compiled JS in production.
    // Never load a stale dist artifact during source checks, or inherit test
    // runner/inspector loaders in the worker.
    const extension = import.meta.url.endsWith(".ts") ? "ts" : "js";
    worker = new Worker(BOOTSTRAP, {
      eval: true,
      execArgv: [],
      workerData: {
        moduleUrl: new URL(`./xlsxImportWorker.${extension}`, import.meta.url).href,
        bytes: Uint8Array.from(buffer),
        purpose,
      },
      resourceLimits: {
        maxOldGenerationSizeMb: 128,
        maxYoungGenerationSizeMb: 16,
        stackSizeMb: 4,
      },
    });
  } catch {
    activeWorkers -= 1;
    throw new Error(FAILURE_MESSAGE);
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let result: ParsedWorkbookSheet[] | undefined;
    let failure: Error | undefined;
    const fail = (message: string) => {
      if (settled) return;
      settled = true;
      failure = new Error(message);
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(failure);
      void worker.terminate().catch(() => undefined);
    };
    const onAbort = () => fail("Excel processing was cancelled.");
    const stalled = () => fail("Excel processing stopped responding. Retry the same workbook; you do not need to split it.");
    let timer = setTimeout(stalled, XLSX_PARSE_STALL_TIMEOUT_MS);
    let sequence = 0;
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.on("message", (message: unknown) => {
      if (settled || result) return;
      const response = message as { kind?: string; sequence?: number; ok?: boolean; sheets?: ParsedWorkbookSheet[] };
      if (response?.kind === "progress") {
        // At most three metadata checkpoints and two per supported worksheet.
        // Duplicate/forged heartbeats cannot keep a failed worker alive.
        if (response.sequence !== sequence + 1 || response.sequence > 103) {
          fail(FAILURE_MESSAGE);
          return;
        }
        sequence = response.sequence;
        onProgress?.(sequence);
        clearTimeout(timer);
        timer = setTimeout(stalled, XLSX_PARSE_STALL_TIMEOUT_MS);
        return;
      }
      if (response?.ok !== true || !Array.isArray(response.sheets)) {
        fail(FAILURE_MESSAGE);
        return;
      }
      result = response.sheets;
      // Keep the slot until the worker exits. Otherwise quick repeated requests
      // can overlap workers still retaining parser allocations.
      void worker.terminate().catch(() => fail(FAILURE_MESSAGE));
    });
    worker.once("error", () => fail(FAILURE_MESSAGE));
    worker.once("exit", () => {
      activeWorkers -= 1;
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      if (settled) return;
      settled = true;
      if (failure || !result) reject(failure ?? new Error(FAILURE_MESSAGE));
      else {
        // Only successful, completely exited workers enter the single-slot
        // cache. Clone both directions so a caller cannot mutate later reads.
        if (cacheKey) {
          cached = { key: cacheKey, expiresAt: Date.now() + XLSX_CACHE_TTL_MS, sheets: structuredClone(result) };
          clearTimeout(cacheExpiry);
          cacheExpiry = setTimeout(() => { cached = undefined; }, XLSX_CACHE_TTL_MS);
          cacheExpiry.unref();
        }
        resolve(result);
      }
    });
    // Abort may race worker construction/listener installation.
    if (signal?.aborted) onAbort();
  });
}
