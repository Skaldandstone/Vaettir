import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Actual release criterion JSX with synthetic text, not a browser/native read.
const source = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("release.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
const spans: ts.JsxElement[] = [];
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "span" &&
    node.children.some(child => ts.isJsxExpression(child) && child.expression?.getText(ast) === "c.description")) spans.push(node);
  ts.forEachChild(node, visit);
}
visit(ast);
function render(description: string): React.ReactElement<{ children: string; style: React.CSSProperties }> {
  if (spans.length !== 1) throw Error("Exactly one actual acceptance criterion description span is required");
  const context = vm.createContext({ React, c: { description } });
  vm.runInContext(ts.transpileModule(`this.element=(${printer.printNode(ts.EmitHint.Unspecified, spans[0]!, ast)});`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return (context as unknown as { element: ReturnType<typeof render> }).element;
}

describe("actual saved release criterion wording display, source/SSR only", () => {
  it.each([" \t First line\n  Second line \n", "Verify λ🎮\n次の手順", "", " \n \t", "Long line ".repeat(195) + "\nLAST EXACT LINE"])(
    "retains exact literal children and pre-wrap for %j",
    description => {
      const element = render(description), html = renderToStaticMarkup(element);
      expect(element.type).toBe("span");
      expect(element.props.children).toBe(description);
      expect(element.props.style).toEqual({ whiteSpace: "pre-wrap" });
      expect(html).toContain("white-space:pre-wrap");
      expect(html).not.toMatch(/line-clamp|text-overflow|overflow:\s*hidden/);
    },
  );
  it("keeps duplicate wording as independent exact literal renderings and distinguishes empty from whitespace", () => {
    const raw = "\n  Keep both identical rows \t";
    const descriptions = [raw, raw, "", " \n "];
    expect(descriptions.map(description => render(description).props.children)).toEqual(descriptions);
    expect(renderToStaticMarkup(render(raw))).toBe(renderToStaticMarkup(render(raw)));
    expect(renderToStaticMarkup(render(""))).not.toBe(renderToStaticMarkup(render(" \n ")));
  });
  it("escapes criterion markup as text without adding controls or processing it", () => {
    const raw = '<script>synthetic</script>\n<img src=x onerror="synthetic"> & next';
    const element = render(raw), html = renderToStaticMarkup(element);
    expect(element.props.children).toBe(raw);
    expect(html).toContain("&lt;script&gt;synthetic&lt;/script&gt;");
    expect(html).toContain("&lt;img src=x onerror=&quot;synthetic&quot;&gt; &amp; next");
    expect(html).not.toMatch(/<(?:script|img|button|input|textarea|form)\b/);
    expect(html).not.toContain("dangerouslySetInnerHTML");
  });
  it("remains in the original acceptance-criteria row beside both unchanged governed editors", () => {
    expect(spans).toHaveLength(1);
    const row = spans[0]!.parent?.parent;
    expect(row && ts.isJsxElement(row)).toBe(true);
    expect(row?.getText(ast)).toContain("<CriterionDescriptionEditor");
    expect(row?.getText(ast)).toContain("<CriterionVerdictEditor");
    let parent: ts.Node | undefined = row, mapped = false;
    while (parent) {
      if (ts.isCallExpression(parent) && parent.expression.getText(ast) === "p.acceptanceCriteria.map") mapped = true;
      parent = parent.parent;
    }
    expect(mapped).toBe(true);
    expect(spans[0]!.parent?.getText(ast)).toContain('overflowWrap: "anywhere"');
  });
});
