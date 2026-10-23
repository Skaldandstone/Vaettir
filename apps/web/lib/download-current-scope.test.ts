import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { downloadFile } from "./download";

afterEach(() => vi.unstubAllGlobals());

function browser() {
  const state = { allowed: true };
  const click = vi.fn();
  const anchor = { href: "", download: "", click };
  const createElement = vi.fn(() => anchor);
  const createObjectURL = vi.fn(() => "blob:synthetic-current-export");
  const revokeObjectURL = vi.fn();
  const blobs = vi.fn();
  vi.stubGlobal("Blob", class {
    constructor(parts: unknown[], options: { type: string }) { blobs(parts, options); }
  });
  vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });
  vi.stubGlobal("document", { createElement });
  return { state, click, anchor, createElement, createObjectURL, revokeObjectURL, blobs, guard: () => state.allowed };
}

describe("actual download mechanics at current-scope side-effect boundaries", () => {
  it("preserves ordinary three-argument callers and always releases their URL", () => {
    const b = browser();
    downloadFile("synthetic.csv", "full synthetic text\n", "text/csv");
    expect(b.blobs).toHaveBeenCalledWith(["full synthetic text\n"], { type: "text/csv;charset=utf-8" });
    expect(b.anchor.download).toBe("synthetic.csv");
    expect(b.click).toHaveBeenCalledOnce();
    expect(b.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-current-export");
  });
  it("refuses before constructing a Blob if the captured scope is gone", () => {
    const b = browser(); b.state.allowed = false;
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", b.guard)).toThrow("Original export scope changed");
    expect(b.blobs).not.toHaveBeenCalled();
    expect(b.createObjectURL).not.toHaveBeenCalled();
    expect(b.createElement).not.toHaveBeenCalled();
    expect(b.click).not.toHaveBeenCalled();
  });
  it("refuses if Blob construction revokes the scope before URL creation", () => {
    const b = browser(); b.blobs.mockImplementation(() => { b.state.allowed = false; });
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", b.guard)).toThrow("Original export scope changed");
    expect(b.createObjectURL).not.toHaveBeenCalled();
    expect(b.click).not.toHaveBeenCalled();
  });
  it("refuses after URL creation and releases it without creating an anchor", () => {
    const b = browser(); b.createObjectURL.mockImplementation(() => { b.state.allowed = false; return "blob:synthetic-current-export"; });
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", b.guard)).toThrow("Original export scope changed");
    expect(b.createElement).not.toHaveBeenCalled();
    expect(b.click).not.toHaveBeenCalled();
    expect(b.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("refuses immediately before click if anchor preparation revokes scope", () => {
    const b = browser();
    Object.defineProperty(b.anchor, "download", { set: () => { b.state.allowed = false; } });
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", b.guard)).toThrow("Original export scope changed");
    expect(b.click).not.toHaveBeenCalled();
    expect(b.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("releases the URL when anchor construction throws", () => {
    const b = browser(); b.createElement.mockImplementation(() => { throw new Error("synthetic anchor failure"); });
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", b.guard)).toThrow("synthetic anchor failure");
    expect(b.click).not.toHaveBeenCalled();
    expect(b.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("releases the URL when a click throws, without claiming cancellation of an already-started download", () => {
    const b = browser(); b.click.mockImplementation(() => { throw new Error("synthetic click failure"); });
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", b.guard)).toThrow("synthetic click failure");
    expect(b.click).toHaveBeenCalledOnce();
    expect(b.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("releases an allocated URL when the scope callback itself throws", () => {
    const b = browser(); let calls = 0;
    const guard = () => { if (++calls === 3) throw new Error("synthetic reader failure"); return true; };
    expect(() => downloadFile("synthetic.csv", "synthetic", "text/csv", guard)).toThrow("synthetic reader failure");
    expect(b.click).not.toHaveBeenCalled();
    expect(b.revokeObjectURL).toHaveBeenCalledOnce();
  });
  it("the actual manual-run summary supplies its guard to all three browser downloads", () => {
    const source = readFileSync(new URL("../components/RunExecutionSummary.tsx", import.meta.url), "utf8");
    const ast = ts.createSourceFile("RunExecutionSummary.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const calls: ts.CallExpression[] = [];
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "downloadFile") calls.push(node);
      ts.forEachChild(node, visit);
    }
    visit(ast);
    expect(calls).toHaveLength(3);
    for (const call of calls) {
      expect(call.arguments).toHaveLength(4);
      expect(call.arguments[3]?.getText(ast)).toBe("canExport");
    }
  });
});
