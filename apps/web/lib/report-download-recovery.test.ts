import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { controllerTranspile } from "./controller-transpile.fixture";

// Actual HTML/CSV click handler with synthetic committed scope, serializers and
// browser download boundary. No native download or authenticated report proof.
const ast = ts.createSourceFile("report.tsx", readFileSync(new URL("../components/FrozenReport.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const component = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "FrozenReport") as ts.FunctionDeclaration;
const handler = component.body!.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "download")!;
const code = controllerTranspile(ts.createPrinter().printNode(ts.EmitHint.Unspecified, handler, ast) + ";this.downloadReport=download", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function harness() {
  const report = { asOf: "2026-11-05", title: "Synthetic report" }, presentation = {};
  const captured = { ready: true, report, presentation, projectId: "p", snapshotId: "s" }, exportScope = { current: captured };
  const anchor = { href: "", download: "", click: vi.fn(), remove: vi.fn() };
  const create = vi.fn(() => anchor), url = vi.fn(() => "blob:synthetic"), render = vi.fn(() => "synthetic content");
  const context = vm.createContext({ exportAllowed: true, reviewed: true, exportScope, report, presentation, projectId: "p", snapshotId: "s", setExportMessage: vi.fn(),
    renderFrozenReportHtml: render, renderFrozenReportCsv: render, Blob,
    URL: { createObjectURL: url, revokeObjectURL: vi.fn() }, document: { createElement: create, body: { append: vi.fn() } }, window: { setTimeout: vi.fn() } });
  vm.runInContext(code, context);
  return { captured, exportScope, anchor, url, render, download: context.downloadReport as (format: string) => void };
}
it.each(["html", "csv"])("an old %s click cannot export after review withdrawal or a new reviewed report", format => {
  for (const changed of ["withdrawn", "report", "style", "snapshot"]) {
    const h = harness();
    if (changed === "withdrawn") h.captured.ready = false;
    else h.exportScope.current = { ...h.captured, ...(changed === "report" ? { report: { ...h.captured.report } } : changed === "style" ? { presentation: {} } : { snapshotId: "another" }) };
    h.download(format);
    expect(h.render).not.toHaveBeenCalled(); expect(h.url).not.toHaveBeenCalled(); expect(h.anchor.click).not.toHaveBeenCalled();
  }
});
it.each(["html", "csv"])("current reviewed %s export still downloads the captured report", format => {
  const h = harness(); h.download(format);
  expect(h.render).toHaveBeenCalledExactlyOnceWith(h.captured.report);
  expect(h.url).toHaveBeenCalledOnce(); expect(h.anchor.click).toHaveBeenCalledOnce();
  expect(h.anchor.download).toBe(`vaettir-report-2026-11-05.${format}`);
});
