import { createHash } from "node:crypto";
import { parseXlsxWorkbookIsolated } from "./xlsxImportIsolation.js";
import { previewXlsxSheet, type ParsedWorkbookSheet } from "./xlsxImport.js";

export function workbookPreview(sheets: ParsedWorkbookSheet[]) {
  return {
    sheets: sheets.map((sheet) => {
      const preview = sheet.suggestedMapping.title
        ? previewXlsxSheet(sheet)
        : { rows: [], skipped: [], incompleteRows: [], nonCaseRows: [], rowMappingSuggestions: [], recommendations: [] };
      return {
        name: sheet.name,
        headerRow: sheet.headerRow,
        headers: sheet.headers,
        rowCount: sheet.rowCount,
        suggestedMapping: sheet.suggestedMapping,
        previewRows: preview.rows,
        incompleteRows: preview.incompleteRows,
        nonCaseRows: preview.nonCaseRows ?? [],
        rowMappingSuggestions: preview.rowMappingSuggestions ?? [],
        recommendations: preview.recommendations ?? [],
        skippedCount: preview.skipped.length,
        warning: sheet.warning,
      };
    }),
  };
}

export type WorkbookReadScope = {
  actorId: string;
  clerkSubject: string | null;
  organizationId: string;
  projectId: string;
};
export function workbookCacheScope(scope: WorkbookReadScope) {
  return JSON.stringify([
    scope.clerkSubject,
    scope.actorId,
    scope.organizationId,
    scope.projectId,
  ]);
}
type ReadState = {
  status: "READING" | "READY" | "FAILED" | "CANCELLED";
  checkpoints: number;
  preview?: ReturnType<typeof workbookPreview>;
  error?: string;
};
type Read = {
  digest: string;
  state: ReadState;
  controller: AbortController;
  finishedAt?: number;
};
export const WORKBOOK_READ_RETENTION_MS = 10 * 60_000;

/** Short-lived, process-local read sessions, not committed ImportJobs. No case,
 * source upload, credential or provider operation is written. A restart safely
 * expires a preview; it can never create cases or resume an uncertain commit.
 * Polling is a new authenticated request so long parsing does not hold an HTTP
 * connection open or depend on a gateway's response timeout.
 */
export function createWorkbookReadManager(parse = parseXlsxWorkbookIsolated) {
  const reads = new Map<string, Read>();
  const key = (scope: WorkbookReadScope, requestId: string) =>
    JSON.stringify([workbookCacheScope(scope), requestId]);
  function expire() {
    for (const [id, read] of reads) {
      if (
        read.finishedAt !== undefined &&
        read.finishedAt + WORKBOOK_READ_RETENTION_MS <= Date.now()
      )
        reads.delete(id);
    }
  }
  function find(scope: WorkbookReadScope, requestId: string) {
    expire();
    const read = reads.get(key(scope, requestId));
    if (!read)
      throw new Error(
        "This workbook preview expired. Upload the same workbook again.",
      );
    return read;
  }
  return {
    start(scope: WorkbookReadScope, requestId: string, bytes: Buffer) {
      expire();
      const id = key(scope, requestId);
      const digest = createHash("sha256").update(bytes).digest("hex");
      const existing = reads.get(id);
      if (existing) {
        if (existing.digest !== digest)
          throw new Error(
            "This preview request belongs to a different workbook.",
          );
        return { requestId };
      }
      // Bound retained previews separately from the single parser worker. No
      // queue of large upload buffers and no unbounded cross-tenant cache.
      if (reads.size >= 2) {
        const finished = [...reads.entries()].find(
          ([, read]) => read.finishedAt !== undefined,
        );
        if (finished) reads.delete(finished[0]);
        else
          throw new Error(
            "Another Excel import is being processed. Try again shortly.",
          );
      }
      const read: Read = {
        digest,
        state: { status: "READING", checkpoints: 0 },
        controller: new AbortController(),
      };
      reads.set(id, read);
      void parse(
        bytes,
        read.controller.signal,
        workbookCacheScope(scope),
        (sequence) => {
          read.state.checkpoints = sequence;
        },
      )
        .then((sheets) => {
          if (!read.controller.signal.aborted)
            read.state = {
              status: "READY",
              checkpoints: read.state.checkpoints,
              preview: workbookPreview(sheets),
            };
        })
        .catch(() => {
          if (!read.controller.signal.aborted)
            read.state = {
              status: "FAILED",
              checkpoints: read.state.checkpoints,
              error:
                "Excel processing could not complete. Retry the same workbook. No cases were imported.",
            };
        })
        .finally(() => {
          read.finishedAt = Date.now();
          const timer = setTimeout(() => {
            if (reads.get(id) === read) reads.delete(id);
          }, WORKBOOK_READ_RETENTION_MS);
          timer.unref();
        });
      return { requestId };
    },
    status(scope: WorkbookReadScope, requestId: string): ReadState {
      return structuredClone(find(scope, requestId).state);
    },
    cancel(scope: WorkbookReadScope, requestId: string) {
      const read = find(scope, requestId);
      if (read.state.status === "READING") {
        read.state = {
          status: "CANCELLED",
          checkpoints: read.state.checkpoints,
        };
        read.controller.abort();
      }
      return { cancelled: read.state.status === "CANCELLED" };
    },
  };
}

export const workbookReads = createWorkbookReadManager();
