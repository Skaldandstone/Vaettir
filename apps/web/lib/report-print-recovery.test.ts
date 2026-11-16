import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { controllerTranspile } from "./controller-transpile.fixture";

// Actual nested print handler; synthetic browser load/print and committed-scope
// boundaries. Does not invoke a native print dialog or authenticated report.
const ast = ts.createSourceFile("report.tsx", readFileSync(new URL("../components/FrozenReport.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "FrozenReport") as ts.FunctionDeclaration;
const handler = component.body!.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "print")!;
const code = controllerTranspile(ts.createPrinter().printNode(ts.EmitHint.Unspecified, handler, ast) + ";this.printReport=print", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function harness() {
  const captured = { ready: true }, exportScope = { current: captured };
  const frame = { title: "", style: { cssText: "" }, srcdoc: "", onload: null as null | (() => void), setAttribute: vi.fn(), remove: vi.fn(), contentWindow: { addEventListener: vi.fn(), focus: vi.fn(), print: vi.fn() } };
  const create = vi.fn(() => frame), append = vi.fn();
  const render = vi.fn(() => "<!doctype html><title>Synthetic report</title>");
  const context = vm.createContext({ exportAllowed: true, reviewed: true, exportScope, report: {}, renderFrozenReportHtml: render,
    document: { createElement: create, body: { append } }, window: { setTimeout: vi.fn() } });
  vm.runInContext(code, context);
  return { captured, exportScope, frame, create, append, render, print: context.printReport as () => void };
}
it.each(["revoked", "replaced"] as const)("a delayed print frame cannot print after its review scope is %s", change => {
  const h = harness(); h.print(); expect(h.append).toHaveBeenCalledOnce();
  if (change === "revoked") h.captured.ready = false;
  else h.exportScope.current = { ready: true };
  h.frame.onload!();
  expect(h.frame.contentWindow.print).not.toHaveBeenCalled();
  expect(h.frame.contentWindow.focus).not.toHaveBeenCalled();
  expect(h.frame.remove).toHaveBeenCalledOnce();
});
it("a captured print click cannot create a frame after review is withdrawn", () => {
  const h = harness(); h.captured.ready = false; h.print();
  expect(h.create).not.toHaveBeenCalled(); expect(h.render).not.toHaveBeenCalled();
});
it("a current reviewed report prints and removes its frame after printing", () => {
  const h = harness(); h.print(); h.frame.onload!();
  expect(h.frame.contentWindow.print).toHaveBeenCalledOnce();
  expect(h.frame.srcdoc).toContain("Synthetic report");
  const [event, cleanup, options] = h.frame.contentWindow.addEventListener.mock.calls[0]!;
  expect(event).toBe("afterprint"); expect(options).toEqual({ once: true });
  (cleanup as () => void)(); expect(h.frame.remove).toHaveBeenCalledOnce();
});
