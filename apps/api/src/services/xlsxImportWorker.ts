import { parentPort, workerData } from "node:worker_threads";
import { parseXlsxWorkbook } from "./xlsxImport.js";

// This worker runs only Vaettir's parser. Workbook content is data, never code.
if (!parentPort) throw new Error("Excel parser requires an isolated worker");
try {
  const sheets = parseXlsxWorkbook(Buffer.from(workerData.bytes as Uint8Array));
  parentPort.postMessage({ ok: true, sheets });
} catch {
  // Never return parser internals, file contents, or third-party error text.
  parentPort.postMessage({ ok: false });
}
