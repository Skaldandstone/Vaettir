import { afterEach, describe, expect, it, vi } from "vitest";

// Deterministic inert worker stub: no unusual input or costly parsing required
// to verify wall-clock termination, cancellation, and concurrency bounds.
const state = vi.hoisted(() => ({ workers: [] as {
  options: { resourceLimits: object; execArgv: string[] };
  emit: (event: string, value?: unknown) => void;
  terminate: ReturnType<typeof vi.fn>;
}[] }));
vi.mock("node:worker_threads", () => ({
  Worker: class {
    handlers = new Map<string, (value?: unknown) => void>();
    terminate = vi.fn(() => {
      queueMicrotask(() => this.emit("exit", 1));
      return Promise.resolve(1);
    });
    constructor(_bootstrap: string, public options: { resourceLimits: object; execArgv: string[] }) {
      state.workers.push(this);
    }
    once(event: string, callback: (value?: unknown) => void) {
      this.handlers.set(event, callback);
      return this;
    }
    emit = (event: string, value?: unknown) => this.handlers.get(event)?.(value);
  },
}));
import { parseXlsxWorkbookIsolated, XLSX_PARSE_TIMEOUT_MS } from "./xlsxImportIsolation.js";

afterEach(() => { vi.useRealTimers(); state.workers.length = 0; });

describe("Excel worker bounds", () => {
  it("terminates on the fixed deadline, rejects, and recovers the worker slot", async () => {
    vi.useFakeTimers();
    const parse = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"));
    const rejection = expect(parse).rejects.toThrow("time limit");
    expect(state.workers[0]?.options).toMatchObject({
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    await vi.advanceTimersByTimeAsync(XLSX_PARSE_TIMEOUT_MS);
    await rejection;
    expect(state.workers[0]?.terminate).toHaveBeenCalledOnce();
    const next = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"));
    state.workers[1]?.emit("message", { ok: true, sheets: [] });
    await expect(next).resolves.toEqual([]);
  });

  it("rejects concurrent work without queueing another retained upload", async () => {
    const first = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"));
    await expect(parseXlsxWorkbookIsolated(Buffer.from("second fixture")))
      .rejects.toThrow("Another Excel import");
    expect(state.workers).toHaveLength(1);
    state.workers[0]?.emit("message", { ok: true, sheets: [] });
    await expect(first).resolves.toEqual([]);
  });

  it("terminates on cancellation and hides unexpected worker failures", async () => {
    const controller = new AbortController();
    const cancelled = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"), controller.signal);
    const rejection = expect(cancelled).rejects.toThrow("cancelled");
    controller.abort();
    await rejection;
    await Promise.resolve();
    expect(state.workers[0]?.terminate).toHaveBeenCalledOnce();

    const failed = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"));
    const safeFailure = expect(failed).rejects.toThrow("Workbook could not be read safely");
    state.workers[1]?.emit("error", new Error("private parser details"));
    await safeFailure;
    await Promise.resolve();
  });
});
