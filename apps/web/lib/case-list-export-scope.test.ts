import { readFileSync } from "node:fs";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { encodeCaseProcedureExport, decodeCaseProcedureExport, type CaseProcedureExport } from "@vaettir/core";
import { currentSessionScope } from "./auth-query-cache";
import { caseExportIds, scopeCaseExport, spreadsheetText } from "./test-case-export";

// Actual handlers + CSV and JSON serializers. Read, committed-scope and final
// browser-download boundaries are synthetic; no API/file/provider operation.
const ast = ts.createSourceFile("page.tsx", readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "TestCasesPage") as ts.FunctionDeclaration;
const names = ["exportCsv", "exportProcedure", "currentViewFrame", "currentExportFrame"];
const compiled = ts.transpileModule(page.body!.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text ?? "")).map(node => node.getText(ast)).join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
const fixtures = ts.createSourceFile("fixture.ts", readFileSync(new URL("../../../packages/core/src/caseProcedureExport.test.ts", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
const fixture = fixtures.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "fixture")!;
const makeBundle = new Function(ts.transpileModule(fixture.getText(fixtures), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText + ";return fixture;")() as () => CaseProcedureExport;
type Format = "csv" | "json";
function harness(format: Format, scope: "selected" | "filtered" = "selected") {
  const bundle = makeBundle(); bundle.project.id = "p"; bundle.scope.kind = scope;
  const cases = ["b", "a", "c"].map((id, index) => ({ ...structuredClone(bundle.cases[0]!), id, displayId: `CASE-${index + 1}`, caseNumber: index + 1 }));
  const selected = new Set(["a", "b"]), ids = caseExportIds(cases, selected, scope);
  bundle.cases = cases.filter(row => ids.includes(row.id));
  let resolve!: (value: unknown) => void, reject!: (value: unknown) => void;
  const waiting = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; });
  const read = vi.fn((_input: unknown) => waiting), writes: unknown[][] = [];
  const viewFrame = { userId: "u", sessionId: "s" }, activeViewFrame = { current: viewFrame };
  const exportFrame = { viewFrame, selected, visibleCases: cases }, activeExportFrame = { current: exportFrame };
  const state = { error: null as string | null, afterSerialize: null as null | (() => void) };
  const download = (name: string, content: string, mime: string, allowed?: () => boolean) => {
    state.afterSerialize?.(); if (allowed && !allowed()) throw Error("Export scope changed");
    writes.push([name, content, mime]);
  };
  const csvExports: { downloadCsv?: unknown } = {};
  const csv = ts.transpileModule(readFileSync(new URL("./csv.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  new Function("require", "exports", csv)((name: string) => { if (name !== "./download") throw Error("Unreviewed CSV dependency"); return { downloadFile: download }; }, csvExports);
  const bindings = { exporting: false, visibleCases: cases, selected, projectId: "p", project: { name: "Synthetic" }, showArchived: false,
    viewFrame, activeViewFrame, exportFrame, activeExportFrame, currentSessionScope, caseExportIds, scopeCaseExport, spreadsheetText,
    window: { Clerk: { loaded: true, session: { id: "s", user: { id: "u" } } } },
    utils: { testCases: { exportCsv: { fetch: read }, exportProcedure: { fetch: read } } },
    setError: (value: string | null) => { state.error = value; }, setExporting: vi.fn(), downloadCsv: csvExports.downloadCsv, downloadFile: download,
    encodeCaseProcedureExport: (value: CaseProcedureExport) => { const encoded = encodeCaseProcedureExport(value); state.afterSerialize?.(); return encoded; } };
  const handlers = new Function(...Object.keys(bindings), compiled + ";return {csv:exportCsv,json:exportProcedure};")(...Object.values(bindings)) as Record<Format, (scope: string) => Promise<void>>;
  return { ids, cases, bundle, read, writes, state, run: () => handlers[format](scope), reject,
    resolve: () => resolve(format === "csv" ? [...cases, { ...cases[0]!, id: "not-reviewed", title: "Must stay out" }] : bundle),
    switch: (kind = "selection") => { if (kind === "view") activeViewFrame.current = { ...viewFrame }; activeExportFrame.current = { ...exportFrame }; state.error = "New view notice"; } };
}
it.each(["csv", "json"] as const)("late %s success/refusal cannot download or replace the notice after view/selection changes", async format => {
  for (const kind of ["view", "selection"]) for (const result of ["success", "refusal"]) {
    const h = harness(format), done = h.run(); h.switch(kind);
    if (result === "success") h.resolve(); else h.reject(Error("synthetic read refusal"));
    await done; expect(h.writes).toEqual([]); expect(h.state.error).toBe("New view notice");
  }
});
it.each(["csv", "json"] as const)("current %s keeps exact visible identity order and original procedure content", async format => {
  for (const scope of ["selected", "filtered"] as const) {
    const h = harness(format, scope), done = h.run(); h.resolve(); await done;
    expect(h.read).toHaveBeenCalledOnce(); expect(h.writes).toHaveLength(1); expect(h.state.error).toBeNull();
    const content = h.writes[0]![1] as string;
    if (format === "json") { expect(decodeCaseProcedureExport(content)).toEqual(h.bundle); expect(h.read.mock.calls[0]![0]).toMatchObject({ ids: h.ids }); }
    else { expect(content).not.toContain("Must stay out"); expect(content).toContain("'=literal title"); expect(content.indexOf("CASE-1")).toBeLessThan(content.indexOf("CASE-2")); expect(content.includes("CASE-3")).toBe(scope === "filtered"); }
  }
});
it.each(["csv", "json"] as const)("obsolete %s click cannot start a read", async format => {
  const h = harness(format); h.switch(); const done = h.run(); h.resolve(); await done;
  expect(h.read).not.toHaveBeenCalled(); expect(h.writes).toEqual([]); expect(h.state.error).toBe("New view notice");
});
it.each(["csv", "json"] as const)("%s rechecks scope at the final download boundary after real serialization", async format => {
  const h = harness(format); h.state.afterSerialize = () => h.switch();
  const done = h.run(); h.resolve(); await done; expect(h.writes).toEqual([]); expect(h.state.error).toBe("New view notice");
});
