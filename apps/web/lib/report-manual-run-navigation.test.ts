import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";

// Actual report row + installed Next Link SSR; native run discriminator uses
// a synthetic already-admitted scope/SQL row. No browser, SDK or DB proof.
const source = readFileSync(new URL("../app/projects/[projectId]/reports/page.tsx", import.meta.url), "utf8"),
  ast = ts.createSourceFile("reports.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
let row: ts.Node | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "data.recentRuns.map") {
    const callback = node.arguments[0];
    if (!callback || !ts.isArrowFunction(callback) || !ts.isJsxElement(callback.body)) throw Error("Actual recent-run JSX required");
    if (row) throw Error("Ambiguous recent-run rows"); row = callback.body;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const helpers = ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["dateTime", "readable"].includes(node.name?.text ?? ""))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n");
type Run = { id: string; ciProvider: string; startedAt: string; status: string; resultCount: number; commitSha: string; branch: string };
type RowProps = { children: React.ReactElement<{ children: React.ReactNode }>[] };
function render(run: Run, projectId = "project"): React.ReactElement<RowProps> {
  if (!row) throw Error("Actual recent-run row required");
  const context = vm.createContext({ React, Link, Date, run, projectId });
  vm.runInContext(ts.transpileModule(`${helpers}\nthis.row=(${printer.printNode(ts.EmitHint.Unspecified, row, ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, context);
  return context.row as ReturnType<typeof render>;
}
function fixture(ciProvider = "manual", id = "run-123"): Run {
  return { id, ciProvider, startedAt: "2026-10-06T17:25:37.000Z", status: "RUNNING", resultCount: 5, commitSha: "0123456789abcdef", branch: "feature/synthetic" };
}
function linkOf(element: ReturnType<typeof render>) {
  return element.props.children[0]!.props.children as React.ReactElement<{ href: string; children: string }>;
}

describe("actual report recent-run navigation, synthetic SSR only", () => {
  it.each(["RUNNING", "COMPLETED", "FAILED", "PARTIAL"])("manual %s row reaches existing execution route, not CI drawer", status => {
    const run = { ...fixture(), status }, before = structuredClone(run), element = render(run), html = renderToStaticMarkup(element);
    expect(linkOf(element).type).toBe(Link);
    expect(linkOf(element).props.href).toBe("/projects/project/test-runs/manual/run-123");
    expect(html).toContain('href="/projects/project/test-runs/manual/run-123"');
    expect(html).not.toContain("#run-"); expect(html).toContain("Manual execution");
    expect(linkOf(element).props.children).toBe(new Date(run.startedAt).toLocaleString());
    expect(element.props.children[2]!.props.children).toBe(status.toLowerCase().replace(/^./, first => first.toUpperCase()));
    expect(element.props.children[3]!.props.children).toBe(5); expect(run).toEqual(before);
  });
  it.each([
    { projectId: "project /?#+% λ🎮", id: "run /?#+% λ🎮" },
    { projectId: "project%2Fencoded", id: "run%2Fencoded" },
    { projectId: 'p"<script>synthetic</script>', id: 'javascript:synthetic()/../../r"#?&' },
  ])("manual identifiers remain exact encoded path segments for $id", ({ projectId, id }) => {
    const run = fixture("manual", id), element = render(run, projectId), href = linkOf(element).props.href;
    expect(href).toBe(`/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(id)}`);
    const parts = href.split("/"); expect(parts).toHaveLength(6);
    expect(decodeURIComponent(parts[2]!)).toBe(projectId); expect(decodeURIComponent(parts[5]!)).toBe(id);
    expect(href).not.toMatch(/[?#]/); expect(href).not.toContain("javascript:");
    const html = renderToStaticMarkup(element); expect(html).not.toContain("<script>");
    expect(run.id).toBe(id); expect(element.key).toBe(id);
  });
  it.each(["github", "gitlab", "Manual", "manual-extra", "unknown"])("%s source preserves the existing CI hash and reference fields", ciProvider => {
    const run = fixture(ciProvider), before = structuredClone(run), element = render(run), html = renderToStaticMarkup(element);
    expect(linkOf(element).props.href).toBe("/projects/project/test-runs#run-run-123");
    expect(html).toContain('href="/projects/project/test-runs#run-run-123"');
    expect(html).toContain(run.branch); expect(html).toContain(`title="${run.commitSha}"`);
    expect(html).toContain(run.commitSha.slice(0, 9)); expect(html).not.toContain("Manual execution");
    expect(element.props.children[1]!.props.children).toBe(ciProvider);
    expect(element.props.children[3]!.props.children).toBe(run.resultCount); expect(run).toEqual(before);
  });
  it.each([0, 1, 100000])("UTC instant/date formatting and exact result count %i remain untouched by manual navigation", resultCount => {
    const run = { ...fixture(), resultCount, startedAt: "2026-10-07T00:05:00.000Z" }, before = structuredClone(run), element = render(run);
    expect(linkOf(element).props.children).toBe(new Date(run.startedAt).toLocaleString());
    expect(element.props.children[3]!.props.children).toBe(resultCount); expect(run).toEqual(before);
    expect(helpers).toContain("new Date(value).toLocaleString()");
  });
  it("actual native CI discriminator still refuses manual IDs and never substitutes a CI planned cohort", async () => {
    const service = readFileSync(new URL("../../api/src/services/ciRunDetailRead.ts", import.meta.url), "utf8"),
      nativeAst = ts.createSourceFile("native.ts", service, ts.ScriptTarget.Latest, true),
      functions = nativeAst.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "scopeAndRun" ||
        ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["foreign", "unsupported"].includes(declaration.name.getText(nativeAst))));
    expect(functions).toHaveLength(3);
    const lock = vi.fn(async () => ({ projectId: "project", organizationId: "organization", actorId: "native", actorClerkUserId: "clerk" })),
      raw = vi.fn(async (_query: Prisma.Sql) => [{ id: "run", projectId: "project", manual: true }]),
      context = vm.createContext({ Prisma, TRPCError, lockCaseFieldReadScope: lock });
    vm.runInContext(ts.transpileModule(functions.map(node => printer.printNode(ts.EmitHint.Unspecified, node, nativeAst)).join("\n") + "\nthis.read=scopeAndRun;",
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
    const read = context.read as (tx: { $queryRaw: typeof raw }, actor: string, input: { projectId: string; testRunId: string }, authorization: { clerkActorId: string }) => Promise<unknown>;
    await expect(read({ $queryRaw: raw }, "native", { projectId: "project", testRunId: "run" }, { clerkActorId: "clerk" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Use the separately reviewed saved manual-execution workflow for this run. No CI planned scope was inferred." });
    expect(lock).toHaveBeenCalledOnce(); expect(raw).toHaveBeenCalledOnce();
    expect(raw.mock.calls[0]![0].sql).toContain("CI_DETAIL_RUN_SCOPE");
  });
});
