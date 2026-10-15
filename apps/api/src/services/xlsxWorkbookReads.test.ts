import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createWorkbookReadManager,
  WORKBOOK_READ_RETENTION_MS,
} from "./xlsxWorkbookReads.js";
import type { parseXlsxWorkbookIsolated } from "./xlsxImportIsolation.js";
import type { ParsedWorkbookSheet } from "./xlsxImport.js";

const scope = {
  actorId: "actor",
  clerkSubject: "clerk",
  projectId: "project",
  organizationId: "org",
};
const sheets: ParsedWorkbookSheet[] = [
  {
    name: "Cases",
    headerRow: 1,
    csvText: "Title\r\nLogin",
    headers: ["Title"],
    rowCount: 1,
    suggestedMapping: { title: "Title" },
  },
];
function fixture() {
  let complete!: (sheets: ParsedWorkbookSheet[]) => void;
  let fail!: (error: Error) => void;
  const parse = vi.fn<typeof parseXlsxWorkbookIsolated>(
    () =>
      new Promise((resolve, reject) => {
        complete = resolve;
        fail = reject;
      }),
  );
  return {
    parse,
    manager: createWorkbookReadManager(parse),
    complete: () => complete(structuredClone(sheets)),
    fail,
  };
}
afterEach(() => vi.useRealTimers());

describe("background workbook previews", () => {
  it("returns immediately, accepts slow progress, and produces a preview without a commit", async () => {
    vi.useFakeTimers();
    const f = fixture();
    expect(f.manager.start(scope, "read", Buffer.from("workbook"))).toEqual({
      requestId: "read",
    });
    expect(f.manager.status(scope, "read")).toEqual({
      status: "READING",
      checkpoints: 0,
    });
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    f.parse.mock.calls[0]![3]!(3);
    expect(f.manager.status(scope, "read").checkpoints).toBe(3);
    f.complete();
    await vi.waitFor(() =>
      expect(f.manager.status(scope, "read").status).toBe("READY"),
    );
    const result = f.manager.status(scope, "read");
    expect(result.preview?.sheets[0]!.previewRows[0]!.title).toBe("Login");
    result.preview!.sheets[0]!.name = "mutated";
    expect(f.manager.status(scope, "read").preview!.sheets[0]!.name).toBe(
      "Cases",
    );
    expect(f.parse.mock.calls[0]![2]).toBe(
      JSON.stringify(["clerk", "actor", "org", "project"]),
    );
  });
  it.each(["actorId", "clerkSubject", "projectId", "organizationId"] as const)(
    "does not reveal or cancel another %s's read",
    (field) => {
      const f = fixture();
      f.manager.start(scope, "scoped", Buffer.from("workbook"));
      expect(() =>
        f.manager.status({ ...scope, [field]: "other" }, "scoped"),
      ).toThrow("expired");
      expect(() =>
        f.manager.cancel({ ...scope, [field]: "other" }, "scoped"),
      ).toThrow("expired");
      f.manager.cancel(scope, "scoped");
      f.complete();
    },
  );
  it("replays only an identical read request and rejects a changed workbook", () => {
    const f = fixture();
    f.manager.start(scope, "same", Buffer.from("first"));
    f.manager.start(scope, "same", Buffer.from("first"));
    expect(f.parse).toHaveBeenCalledOnce();
    expect(() =>
      f.manager.start(scope, "same", Buffer.from("different")),
    ).toThrow("different workbook");
    f.manager.cancel(scope, "same");
    expect(f.parse.mock.calls[0]![1]!.aborted).toBe(true);
    f.complete();
  });
  it("does not adopt a late success after cancellation", async () => {
    const f = fixture();
    f.manager.start(scope, "cancel", Buffer.from("workbook"));
    expect(f.manager.cancel(scope, "cancel")).toEqual({ cancelled: true });
    f.complete();
    await Promise.resolve();
    expect(f.manager.status(scope, "cancel")).toEqual({
      status: "CANCELLED",
      checkpoints: 0,
    });
  });
  it("bounds retained sessions and expires finished previews, not active reads", async () => {
    vi.useFakeTimers();
    const f = fixture();
    f.manager.start(scope, "one", Buffer.from("workbook"));
    f.manager.start(scope, "two", Buffer.from("workbook"));
    expect(() =>
      f.manager.start(scope, "three", Buffer.from("workbook")),
    ).toThrow("Another Excel");
    await vi.advanceTimersByTimeAsync(WORKBOOK_READ_RETENTION_MS + 1);
    expect(f.manager.status(scope, "one").status).toBe("READING");
    f.complete(); // the last injected read
    await vi.waitFor(() =>
      expect(f.manager.status(scope, "two").status).toBe("READY"),
    );
    await vi.advanceTimersByTimeAsync(WORKBOOK_READ_RETENTION_MS + 1);
    expect(() => f.manager.status(scope, "two")).toThrow("expired");
    f.manager.cancel(scope, "one");
  });
  it("never returns private parser exception text", async () => {
    const parse = vi
      .fn<typeof parseXlsxWorkbookIsolated>()
      .mockRejectedValue(new Error("private source data"));
    const manager = createWorkbookReadManager(parse);
    manager.start(scope, "failure", Buffer.from("workbook"));
    await vi.waitFor(() =>
      expect(manager.status(scope, "failure").status).toBe("FAILED"),
    );
    expect(JSON.stringify(manager.status(scope, "failure"))).not.toContain(
      "private source data",
    );
  });
});
