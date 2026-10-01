import { Worker } from "node:worker_threads";
import type { ParsedWorkbookSheet } from "./xlsxImport.js";

export const XLSX_PARSE_TIMEOUT_MS = 8_000;
const MAX_XLSX_BYTES = 10 * 1024 * 1024;
const MAX_ACTIVE_WORKERS = 1;
let activeWorkers = 0;

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
 * buffers are outside V8's heap. Termination bounds synchronous inflate/XML work.
 */
export async function parseXlsxWorkbookIsolated(
  buffer: Buffer,
  signal?: AbortSignal,
): Promise<ParsedWorkbookSheet[]> {
  if (buffer.byteLength > MAX_XLSX_BYTES)
    throw new Error("Excel file is too large (maximum 10 MB)");
  if (signal?.aborted) throw new Error("Excel processing was cancelled.");
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
    const timer = setTimeout(() => {
      fail("Excel processing exceeded the time limit. Use a smaller workbook.");
    }, XLSX_PARSE_TIMEOUT_MS);
    signal?.addEventListener("abort", onAbort, { once: true });

    worker.once("message", (message: unknown) => {
      if (settled) return;
      const response = message as { ok?: boolean; sheets?: ParsedWorkbookSheet[] };
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
      else resolve(result);
    });
    // Abort may race worker construction/listener installation.
    if (signal?.aborted) onAbort();
  });
}
