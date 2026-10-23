import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ManualRunComparison } from "@vaettir/api/src/services/manualRunComparisonSchema";

// Extract the actual comparison card callback, label declaration and
// real DistributionBar. These synthetic SSR checks are not native/read proof.
const source = readFileSync(new URL("../components/ManualRunComparison.tsx", import.meta.url), "utf8"),
  ast = ts.createSourceFile("comparison.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
let card: ts.ArrowFunction | undefined;
function visit(node: ts.Node) {
  if (ts.isArrowFunction(node) && ts.isBlock(node.body) && node.body.getText(ast).includes("const run = value[side], summary")) {
    if (card) throw Error("Ambiguous actual comparison card");
    card = node;
  }
  ts.forEachChild(node, visit);
}
visit(ast);
const labels = ast.statements.filter(node => ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(ast) === "label"));
if (!card || labels.length !== 1) throw Error("Actual card and label declaration required");
const visuals = ts.createSourceFile("visuals.tsx", readFileSync(new URL("../components/MetricVisuals.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  visualCode = visuals.statements.filter(ts.isFunctionDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, visuals).replace(/\bexport\s+(?=function)/, "")).join("\n"),
  code = ts.transpileModule(`${visualCode}\n${labels.map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n")}\nthis.card=(${printer.printNode(ts.EmitHint.Unspecified, card, ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type Side = "baseline" | "candidate";
type Value = Pick<ManualRunComparison, "baseline" | "candidate" | "baselineSummary" | "candidateSummary">;
type Props = { children?: unknown; value?: number; max?: number; href?: string; dateTime?: string; "aria-label"?: string };
function elements(node: unknown): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function render(value: Value, side: Side) {
  const context = vm.createContext({ React, Date, value, projectId: "synthetic-project" });
  vm.runInContext(code, context);
  const element = (context.card as (side: Side) => React.ReactElement<Props>)(side);
  return { element, html: renderToStaticMarkup(element), nodes: elements(element) };
}
function summary(total = 0, recorded = 0): ManualRunComparison["baselineSummary"] {
  return { pass: recorded, fail: 0, blocked: 0, skip: 0, flaky: 0, total, recorded, remaining: total - recorded,
    percentComplete: total ? Math.round(recorded / total * 10000) / 100 : 0, ignoredOutsideScopeResults: 3 };
}
function fixture(left = summary(), right = summary()): Value {
  const run: ManualRunComparison["baseline"] = { id: "synthetic-baseline", status: "RUNNING", startedAt: "2026-10-06T17:25:37.000Z", finishedAt: null,
    plannedCases: left.total, scopeUnsupported: false, versionOneSnapshotPresent: true };
  return { baseline: run, candidate: { ...run, id: "synthetic-candidate", plannedCases: right.total }, baselineSummary: left, candidateSummary: right };
}

describe("actual manual comparison planned-case progress display", () => {
  it.each(["baseline", "candidate"] as const)("supported empty %s is explicitly not applicable, without a fabricated gauge", side => {
    const value = fixture(), before = structuredClone(value), { element, html, nodes } = render(value, side);
    expect(html).toContain("No planned cases"); expect(html).toContain("Recorded percentage not applicable");
    expect(html).not.toContain("% with recorded verdicts"); expect(html).not.toContain("<progress");
    expect(nodes.filter(node => node.type === "progress")).toHaveLength(0);
    expect(html).toContain("0/0 planned cases have a recorded verdict");
    expect(html).toContain("3 unmatched/out-of-scope observations excluded");
    expect(html).toContain(`${side} recorded verdicts: Passed 0, Failed 0, Blocked 0, Skipped 0, Flaky 0, No verdict 0`);
    expect(html).toContain(`/projects/synthetic-project/test-runs/manual/synthetic-${side}`);
    expect(element.key).toBe(side); expect(value).toEqual(before);
  });
  it.each([
    { total: 4, recorded: 1 }, { total: 851, recorded: 1 }, { total: 851, recorded: 850 },
    { total: 1000, recorded: 0 }, { total: 1000, recorded: 1000 },
  ])("positive $recorded/$total keeps the exact native percentage and gauge on both sides", ({ total, recorded }) => {
    const counts = summary(total, recorded), value = fixture(counts, { ...counts }), before = structuredClone(value);
    for (const side of ["baseline", "candidate"] as const) {
      const { html, nodes } = render(value, side), progress = nodes.filter(node => node.type === "progress");
      expect(html).toContain(`${counts.percentComplete}% with recorded verdicts`);
      expect(html).toContain(`${counts.remaining} cases without a verdict`);
      expect(html).toContain(`${recorded}/${total} planned cases have a recorded verdict`);
      expect(html).not.toContain("No planned cases"); expect(html).not.toContain("not applicable");
      expect(progress).toHaveLength(1);
      expect(progress[0]!.props.max).toBe(total); expect(progress[0]!.props.value).toBe(recorded);
      expect(progress[0]!.props["aria-label"]).toBe(`${side} planned case verdict progress`);
    }
    expect(value).toEqual(before);
  });
  it.each(["baseline", "candidate"] as const)("mixed pair decides empty display independently for %s", emptySide => {
    const positive = summary(4, 1), value = emptySide === "baseline" ? fixture(summary(), positive) : fixture(positive, summary()), before = structuredClone(value),
      other: Side = emptySide === "baseline" ? "candidate" : "baseline";
    expect(render(value, emptySide).html).toContain("Recorded percentage not applicable");
    expect(render(value, emptySide).nodes.filter(node => node.type === "progress")).toHaveLength(0);
    expect(render(value, other).html).toContain("25% with recorded verdicts");
    expect(render(value, other).nodes.find(node => node.type === "progress")!.props.max).toBe(4);
    expect(value).toEqual(before);
  });
  it("positive outcome distribution retains exact distinct verdicts and ignored observations", () => {
    const counts = { ...summary(20, 15), pass: 5, fail: 4, blocked: 3, skip: 2, flaky: 1, ignoredOutsideScopeResults: 7 },
      value = fixture(counts), before = structuredClone(value), { html } = render(value, "baseline");
    expect(html).toContain("75% with recorded verdicts");
    expect(html).toContain("baseline recorded verdicts: Passed 5, Failed 4, Blocked 3, Skipped 2, Flaky 1, No verdict 5");
    expect(html).toContain("7 unmatched/out-of-scope observations excluded"); expect(value).toEqual(before);
  });
  it.each(["RUNNING", "PASSED", "FAILED", "PARTIAL"] as const)("status %s never fabricates completion for an empty side and metadata remains exact", status => {
    const value = fixture(); value.baseline.status = status; value.baseline.finishedAt = "2026-10-07T00:05:00.000Z";
    const before = structuredClone(value), { html, nodes } = render(value, "baseline");
    expect(html).toContain(`Baseline · ${status.toLowerCase()}`);
    expect(nodes.find(node => node.type === "time")!.props.dateTime).toBe(value.baseline.startedAt);
    expect(html).toContain(new Date(value.baseline.startedAt).toLocaleString());
    expect(html).toContain(`Finished ${new Date(value.baseline.finishedAt).toLocaleString()}`);
    expect(html).toContain("Recorded percentage not applicable"); expect(html).not.toContain("<progress");
    expect(value).toEqual(before);
  });
  it("literal side IDs and missing finish metadata remain untouched and HTML escaped", () => {
    const value = fixture(); value.baseline.id = 'synthetic-<script>literal</script>&"';
    const before = structuredClone(value), { html, nodes } = render(value, "baseline");
    expect(html).toContain("No finish time recorded"); expect(html).not.toContain("<script>");
    expect(nodes.find(node => node.type === "a")!.props.href).toBe(`/projects/synthetic-project/test-runs/manual/${value.baseline.id}`);
    expect(html).toContain("&lt;script&gt;literal&lt;/script&gt;&amp;&quot;"); expect(value).toEqual(before);
  });
});
