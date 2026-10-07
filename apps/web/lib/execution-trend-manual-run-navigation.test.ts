import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import Link from "next/link";
import { renderToStaticMarkup } from "react-dom/server";
import { TRPCError } from "@trpc/server";
import { Prisma } from "@vaettir/db";
import { describe, expect, it, vi } from "vitest";

// Actual day-drilldown row and installed Next Link SSR, with synthetic props.
// The native refusal fixture is already scoped; it is not DB/auth acceptance.
const source = readFileSync(new URL("../components/RecordedExecutionTrend.tsx", import.meta.url), "utf8"),
  ast = ts.createSourceFile("trend.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  printer = ts.createPrinter();
let row: ts.JsxElement | undefined;
function visit(node: ts.Node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === "data.runs.map") {
    const callback = node.arguments[0];
    if (!callback || !ts.isArrowFunction(callback)) throw Error("Actual drilldown callback required");
    let body = callback.body;
    while (ts.isParenthesizedExpression(body)) body = body.expression;
    if (!ts.isJsxElement(body)) throw Error("Actual run row required");
    if (row) throw Error("Ambiguous drilldown rows");
    row = body;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
type Run = {
  id: string; startedAt: string; finishedAt: string | null; status: string;
  provider: string; providerExcerpt: boolean;
  build: string | null; buildExcerpt: boolean;
  platform: string | null; platformExcerpt: boolean;
  environment: string | null; environmentExcerpt: boolean;
};
type RowProps = { children: React.ReactElement<{ children: React.ReactNode }>[] };
function render(run: Run, projectId = "project"): React.ReactElement<RowProps> {
  if (!row) throw Error("Actual row required");
  const context = vm.createContext({ React, Link, run, projectId });
  vm.runInContext(ts.transpileModule(`this.row=(${printer.printNode(ts.EmitHint.Unspecified, row, ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, context);
  return context.row as ReturnType<typeof render>;
}
function fixture(provider = "manual", id = "run-123"): Run {
  return { id, startedAt: "2026-10-06T17:25:37.000Z", finishedAt: null, status: "RUNNING", provider, providerExcerpt: false,
    build: "build-42", buildExcerpt: false, platform: "Windows", platformExcerpt: false, environment: "synthetic", environmentExcerpt: false };
}
function linkOf(element: ReturnType<typeof render>) {
  return element.props.children[0] as React.ReactElement<{ href: string; children: React.ReactNode }>;
}

describe("actual execution-trend manual run drilldown navigation", () => {
  it.each(["RUNNING", "PASSED", "FAILED", "PARTIAL"])("exact unexcerpted manual %s uses saved execution, not CI drawer", status => {
    const run = { ...fixture(), status }, before = structuredClone(run), element = render(run), html = renderToStaticMarkup(element);
    expect(linkOf(element).type).toBe(Link);
    expect(linkOf(element).props.href).toBe("/projects/project/test-runs/manual/run-123");
    expect(html).toContain('href="/projects/project/test-runs/manual/run-123"');
    expect(html).not.toContain("#run-");
    expect(linkOf(element).props.children).toEqual([run.startedAt, " · ", status]);
    expect(html).toContain(run.startedAt); expect(html).toContain(status);
    expect(html).toContain("manual"); expect(html).toContain(run.build!);
    expect(html).toContain(run.platform!); expect(html).toContain(run.environment!);
    expect(element.key).toBe(run.id); expect(run).toEqual(before);
  });
  it.each([
    { projectId: "project /?#+% λ🎮", id: "run /?#+% λ🎮" },
    { projectId: "project%2Fencoded", id: "run%2Fencoded" },
    { projectId: 'p"<script>synthetic</script>', id: 'javascript:synthetic()/../../r"#?&' },
  ])("manual path preserves each exact encoded identity $id", ({ projectId, id }) => {
    const run = fixture("manual", id), element = render(run, projectId), href = linkOf(element).props.href;
    expect(href).toBe(`/projects/${encodeURIComponent(projectId)}/test-runs/manual/${encodeURIComponent(id)}`);
    const parts = href.split("/"); expect(parts).toHaveLength(6);
    expect(decodeURIComponent(parts[2]!)).toBe(projectId); expect(decodeURIComponent(parts[5]!)).toBe(id);
    expect(href).not.toMatch(/[?#]/); expect(href).not.toContain("javascript:");
    expect(renderToStaticMarkup(element)).not.toContain("<script>");
    expect(element.key).toBe(id); expect(run.id).toBe(id);
  });
  it.each(["github", "gitlab", "Manual", "manual-extra", "unknown"])("%s retains existing CI hash without guessing provider identity", provider => {
    const run = fixture(provider), before = structuredClone(run), element = render(run), html = renderToStaticMarkup(element);
    expect(linkOf(element).props.href).toBe("/projects/project/test-runs#run-run-123");
    expect(html).toContain('href="/projects/project/test-runs#run-run-123"');
    expect(element.props.children[1]!.props.children).toEqual([provider, ""]);
    expect(html).toContain(run.startedAt); expect(run).toEqual(before);
  });
  it("an excerpt labeled manual cannot become a manual identity assertion", () => {
    const run = { ...fixture(), providerExcerpt: true }, before = structuredClone(run), element = render(run);
    expect(linkOf(element).props.href).toBe("/projects/project/test-runs#run-run-123");
    expect(element.props.children[1]!.props.children).toEqual(["manual", " (excerpt)"]);
    expect(renderToStaticMarkup(element)).toContain("manual (excerpt)"); expect(run).toEqual(before);
  });
  it.each([false, true])("null/empty/multiline configuration and excerpt metadata stay unchanged (%s)", excerpt => {
    const run = { ...fixture(), build: null, platform: "", environment: '<script>literal</script>\n  λ🎮', environmentExcerpt: excerpt }, before = structuredClone(run), element = render(run), html = renderToStaticMarkup(element);
    expect(html).toContain("Not recorded in supported context");
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;\n  λ🎮");
    expect(html).not.toContain("<script>");
    const fields = element.props.children[2]!.props.children as React.ReactElement<{ children: React.ReactElement<{ children: React.ReactNode }>[] }>[];
    expect(fields[0]!.props.children[1]!.props.children).toEqual(["Not recorded in supported context", ""]);
    expect(fields[1]!.props.children[1]!.props.children).toEqual(["", ""]);
    expect(fields[2]!.props.children[1]!.props.children).toEqual([run.environment, excerpt ? " (excerpt)" : ""]);
    expect(run).toEqual(before);
  });
  it("actual native CI detail still refuses a scoped manual run rather than substituting CI evidence", async () => {
    const native = readFileSync(new URL("../../api/src/services/ciRunDetailRead.ts", import.meta.url), "utf8"),
      nativeAst = ts.createSourceFile("native.ts", native, ts.ScriptTarget.Latest, true),
      declarations = nativeAst.statements.filter(node => ts.isFunctionDeclaration(node) && node.name?.text === "scopeAndRun" ||
        ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => ["foreign", "unsupported"].includes(declaration.name.getText(nativeAst))));
    expect(declarations).toHaveLength(3);
    const lock = vi.fn(async () => ({ projectId: "project", organizationId: "organization", actorId: "native", actorClerkUserId: "clerk" })),
      raw = vi.fn(async (_query: Prisma.Sql) => [{ id: "run", projectId: "project", manual: true }]),
      context = vm.createContext({ Prisma, TRPCError, lockCaseFieldReadScope: lock });
    vm.runInContext(ts.transpileModule(declarations.map(node => printer.printNode(ts.EmitHint.Unspecified, node, nativeAst)).join("\n") + "\nthis.read=scopeAndRun;",
      { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText, context);
    const read = context.read as (tx: { $queryRaw: typeof raw }, actor: string, input: { projectId: string; testRunId: string }, authorization: { clerkActorId: string }) => Promise<unknown>;
    await expect(read({ $queryRaw: raw }, "native", { projectId: "project", testRunId: "run" }, { clerkActorId: "clerk" }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: "Use the separately reviewed saved manual-execution workflow for this run. No CI planned scope was inferred." });
    expect(lock).toHaveBeenCalledOnce(); expect(raw).toHaveBeenCalledOnce();
    expect(raw.mock.calls[0]![0].sql).toContain("CI_DETAIL_RUN_SCOPE");
  });
});
