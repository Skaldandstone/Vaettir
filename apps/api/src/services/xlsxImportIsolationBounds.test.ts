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
    on(event: string, callback: (value?: unknown) => void) { return this.once(event, callback); }
    emit = (event: string, value?: unknown) => this.handlers.get(event)?.(value);
  },
}));
import { parseXlsxWorkbookIsolated, XLSX_PARSE_STALL_TIMEOUT_MS, XLSX_CACHE_TTL_MS } from "./xlsxImportIsolation.js";

afterEach(() => { vi.useRealTimers(); state.workers.length = 0; });

describe("Excel worker bounds", () => {
  it("stops a genuinely stalled worker and recovers its slot", async () => {
    vi.useFakeTimers();
    const parse = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"));
    const rejection = expect(parse).rejects.toThrow("stopped responding");
    expect(state.workers[0]?.options).toMatchObject({
      execArgv: [],
      resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
    });
    await vi.advanceTimersByTimeAsync(XLSX_PARSE_STALL_TIMEOUT_MS);
    await rejection;
    expect(state.workers[0]?.terminate).toHaveBeenCalledOnce();
    const next = parseXlsxWorkbookIsolated(Buffer.from("ordinary fixture"));
    state.workers[1]?.emit("message", { ok: true, sheets: [] });
    await expect(next).resolves.toEqual([]);
  });

  it("does not reject a legitimate parse after eight seconds or a fixed total duration", async () => {
    vi.useFakeTimers();
    const parse = parseXlsxWorkbookIsolated(Buffer.from("slow ordinary fixture"));
    const worker = state.workers[0]!;
    for (let sequence = 1; sequence <= 15; sequence++) {
      await vi.advanceTimersByTimeAsync(XLSX_PARSE_STALL_TIMEOUT_MS - 1);
      expect(worker.terminate).not.toHaveBeenCalled();
      worker.emit("message", { kind: "progress", sequence });
    }
    worker.emit("message", { ok: true, sheets: [] });
    await expect(parse).resolves.toEqual([]);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it.each([0, 2, 104, NaN])("rejects invalid progress sequence %s", async (sequence) => {
    const parse = parseXlsxWorkbookIsolated(Buffer.from("progress fixture"));
    const rejection = expect(parse).rejects.toThrow("Workbook could not be read safely");
    state.workers[0]!.emit("message", { kind: "progress", sequence });
    await rejection;
    await Promise.resolve();
  });

  it("does not let repeated progress hide a stalled parser", async () => {
    const parse = parseXlsxWorkbookIsolated(Buffer.from("duplicate progress"));
    const rejection = expect(parse).rejects.toThrow("Workbook could not be read safely");
    state.workers[0]!.emit("message", { kind: "progress", sequence: 1 });
    state.workers[0]!.emit("message", { kind: "progress", sequence: 1 });
    await rejection;
    await Promise.resolve();
  });

  it("reuses an unchanged workbook only for the same scope, without exposing mutable cached records", async () => {
    vi.useFakeTimers();
    const bytes = Buffer.from("cache workbook"), scope = "same actor/project";
    const sheets = [{ name: "Cases", headerRow: 1, csvText: "Title\r\nLogin", headers: ["Title"], rowCount: 1, suggestedMapping: { title: "Title" } }];
    const first = parseXlsxWorkbookIsolated(bytes, undefined, scope);
    state.workers[0]!.emit("message", { ok: true, sheets });
    const parsed = await first;
    parsed[0]!.name = "changed by caller";
    const fromCache = await parseXlsxWorkbookIsolated(bytes, undefined, scope);
    expect(fromCache[0]!.name).toBe("Cases");
    fromCache[0]!.headers.push("not persisted");
    expect((await parseXlsxWorkbookIsolated(bytes, undefined, scope))[0]!.headers).toEqual(["Title"]);
    expect(state.workers).toHaveLength(1);
    const other = parseXlsxWorkbookIsolated(bytes, undefined, "other actor/project");
    state.workers[1]!.emit("message", { ok: true, sheets });
    await other;
    const changed = parseXlsxWorkbookIsolated(Buffer.from("changed workbook"), undefined, "other actor/project");
    state.workers[2]!.emit("message", { ok: true, sheets });
    await changed;
    await vi.advanceTimersByTimeAsync(XLSX_CACHE_TTL_MS);
    const expired = parseXlsxWorkbookIsolated(Buffer.from("changed workbook"), undefined, "other actor/project");
    state.workers[3]!.emit("message", { ok: true, sheets });
    await expired;
    expect(state.workers).toHaveLength(4);
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
