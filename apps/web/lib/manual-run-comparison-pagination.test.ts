import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ManualRunComparison } from "@vaettir/api/src/services/manualRunComparisonSchema";

// Actual navigation JSX/callbacks with functional React setter semantics.
// No mocked replacement navigation or native query/database acceptance.
const source = readFileSync(new URL("../components/ManualRunComparison.tsx", import.meta.url), "utf8"),
  ast = ts.createSourceFile("comparison.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const navigation = new Map<string, ts.JsxElement>();
function visit(node: ts.Node) {
  if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "nav") {
    const label = node.openingElement.attributes.properties.find(attribute => ts.isJsxAttribute(attribute) && attribute.name.getText(ast) === "aria-label");
    if (label && ts.isJsxAttribute(label) && label.initializer && ts.isStringLiteral(label.initializer) && ["Comparison case pages", "Manual catalogue pages"].includes(label.initializer.text)) {
      if (navigation.has(label.initializer.text)) throw Error("Ambiguous actual navigation");
      navigation.set(label.initializer.text, node);
    }
  }
  ts.forEachChild(node, visit);
}
visit(ast);
if (navigation.size !== 2) throw Error("Both actual navigation elements required");
type CaseCursor = NonNullable<ManualRunComparison["nextCursor"]>;
type CatalogCursor = { id: string; startedAt: string };
type Props = { children?: unknown; onClick?: () => void; disabled?: boolean };
const hash = "a".repeat(64);
function elements(node: unknown): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<Props>(node)) return [];
  return [node, ...elements(node.props.children)];
}
function harness() {
  let pages: CaseCursor[] = [], catalogPages: CatalogCursor[] = [], expectedPairHash: string | undefined;
  const effects = vi.fn(), context = vm.createContext({ React,
    setPages: (next: CaseCursor[] | ((current: CaseCursor[]) => CaseCursor[])) => { pages = typeof next === "function" ? next(pages) : next; },
    setCatalogPages: (next: CatalogCursor[] | ((current: CatalogCursor[]) => CatalogCursor[])) => { catalogPages = typeof next === "function" ? next(catalogPages) : next; },
    setExpectedPairHash: (next: string) => { expectedPairHash = next; },
    downloadFile: effects, fetch: effects, mutate: effects,
  });
  const code = (label: string) => ts.transpileModule(`this.tree=(${printer.printNode(ts.EmitHint.Unspecified, navigation.get(label)!, ast)});`,
    { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  const comparisonCode = code("Comparison case pages"), catalogCode = code("Manual catalogue pages");
  function render(kind: "comparison" | "catalog", next: CaseCursor | CatalogCursor | null, fresh = true) {
    Object.assign(context, { pages, catalogPages, value: { pairHash: hash, nextCursor: next }, catalogFresh: fresh, catalog: { data: { nextCursor: next } } });
    vm.runInContext(kind === "comparison" ? comparisonCode : catalogCode, context);
    const tree = context.tree as React.ReactElement<Props>, buttons = elements(tree).filter(node => node.type === "button");
    if (buttons.length !== 2) throw Error("Actual previous/next buttons required");
    return { tree, html: renderToStaticMarkup(tree), previous: buttons[0]!, next: buttons[1]! };
  }
  return { render, effects, get pages() { return pages; }, get catalogPages() { return catalogPages; }, get expectedPairHash() { return expectedPairHash; } };
}
function cursor(index: number): CaseCursor { return { caseId: `synthetic-case-${index}`, expectedPairHash: hash }; }
function catalogCursor(index: number): CatalogCursor { return { id: `synthetic-run-${index}`, startedAt: `2026-10-06T00:${String(index).padStart(2, "0")}:00.000Z` }; }

describe("actual manual comparison navigation preserves exact cursor history", () => {
  it("repeated current Next adds one exact case cursor, and one fresh Previous returns to the real first page", () => {
    const h = harness(), next = cursor(50), before = structuredClone(next), rendered = h.render("comparison", next);
    expect(rendered.previous.props.disabled).toBe(true); expect(rendered.next.props.disabled).toBe(false);
    rendered.next.props.onClick!(); rendered.next.props.onClick!();
    expect(h.pages).toHaveLength(1); expect(h.pages[0]).toBe(next); expect(h.expectedPairHash).toBe(hash);
    const second = h.render("comparison", cursor(100)); expect(second.previous.props.disabled).toBe(false);
    second.previous.props.onClick!();
    expect(h.pages).toEqual([]); expect(h.expectedPairHash).toBe(hash); expect(next).toEqual(before); expect(h.effects).not.toHaveBeenCalled();
  });
  it("repeated current Previous removes one case cursor, not two, and fresh Previous removes the next exact cursor", () => {
    const h = harness(), first = cursor(50), second = cursor(100);
    h.render("comparison", first).next.props.onClick!(); h.render("comparison", second).next.props.onClick!();
    const third = h.render("comparison", cursor(150)); third.previous.props.onClick!(); third.previous.props.onClick!();
    expect(h.pages).toHaveLength(1); expect(h.pages[0]).toBe(first);
    h.render("comparison", second).previous.props.onClick!(); expect(h.pages).toEqual([]); expect(h.expectedPairHash).toBe(hash);
  });
  it("all forty synthetic case pages preserve their exact fifty-case boundary and reverse without phantom pages", () => {
    const h = harness(), boundaries = Array.from({ length: 39 }, (_, index) => cursor((index + 1) * 50));
    for (const boundary of boundaries) {
      const page = h.render("comparison", boundary); page.next.props.onClick!(); page.next.props.onClick!();
      expect(h.pages.at(-1)).toBe(boundary); expect(h.expectedPairHash).toBe(hash);
    }
    expect(h.pages).toHaveLength(39); expect(h.pages).toEqual(boundaries);
    expect(h.render("comparison", null).next.props.disabled).toBe(true);
    for (let index = boundaries.length - 1; index >= 0; index--) {
      const page = h.render("comparison", null); page.previous.props.onClick!(); page.previous.props.onClick!();
      expect(h.pages).toHaveLength(index); expect(h.pages.at(-1)).toBe(boundaries[index - 1]);
    }
    expect(h.render("comparison", cursor(50)).previous.props.disabled).toBe(true); expect(h.effects).not.toHaveBeenCalled();
  });
  it("repeated catalogue Older adds one exact cursor, and Newer returns to the actual first catalogue", () => {
    const h = harness(), next = catalogCursor(1), before = structuredClone(next), first = h.render("catalog", next);
    expect(first.html).toContain("Catalogue page 1"); expect(first.previous.props.disabled).toBe(true);
    first.next.props.onClick!(); first.next.props.onClick!();
    expect(h.catalogPages).toHaveLength(1); expect(h.catalogPages[0]).toBe(next);
    const second = h.render("catalog", catalogCursor(2)); expect(second.html).toContain("Catalogue page 2");
    second.previous.props.onClick!(); expect(h.catalogPages).toEqual([]); expect(next).toEqual(before);
    expect(h.expectedPairHash).toBeUndefined(); expect(h.effects).not.toHaveBeenCalled();
  });
  it("repeated catalogue Newer removes one cursor and fresh navigation can continue normally", () => {
    const h = harness(), first = catalogCursor(1), second = catalogCursor(2);
    h.render("catalog", first).next.props.onClick!(); h.render("catalog", second).next.props.onClick!();
    const third = h.render("catalog", catalogCursor(3)); expect(third.html).toContain("Catalogue page 3");
    third.previous.props.onClick!(); third.previous.props.onClick!();
    expect(h.catalogPages).toHaveLength(1); expect(h.catalogPages[0]).toBe(first);
    const fresh = h.render("catalog", second); expect(fresh.html).toContain("Catalogue page 2");
    fresh.previous.props.onClick!(); expect(h.catalogPages).toEqual([]); expect(h.expectedPairHash).toBeUndefined();
  });
  it("twenty successive fresh catalogue pages retain exact ID/time boundaries and reverse one at a time", () => {
    const h = harness(), boundaries = Array.from({ length: 19 }, (_, index) => catalogCursor(index + 1)), before = structuredClone(boundaries);
    for (const boundary of boundaries) {
      const page = h.render("catalog", boundary); page.next.props.onClick!(); page.next.props.onClick!();
      expect(h.catalogPages.at(-1)).toBe(boundary);
    }
    expect(h.catalogPages).toEqual(boundaries); expect(h.render("catalog", null).html).toContain("Catalogue page 20");
    expect(h.render("catalog", null).next.props.disabled).toBe(true);
    for (let index = boundaries.length - 1; index >= 0; index--) {
      const page = h.render("catalog", null); page.previous.props.onClick!(); page.previous.props.onClick!();
      expect(h.catalogPages).toHaveLength(index); expect(h.catalogPages.at(-1)).toBe(boundaries[index - 1]);
    }
    expect(boundaries).toEqual(before); expect(h.expectedPairHash).toBeUndefined(); expect(h.effects).not.toHaveBeenCalled();
  });
  it("current disabled boundaries for absent cursors and unavailable catalogue evidence remain unchanged", () => {
    const h = harness();
    expect(h.render("comparison", null).next.props.disabled).toBe(true);
    expect(h.render("comparison", null).previous.props.disabled).toBe(true);
    expect(h.render("catalog", null).next.props.disabled).toBe(true);
    expect(h.render("catalog", catalogCursor(1), false).next.props.disabled).toBe(true);
    h.render("catalog", catalogCursor(1)).next.props.onClick!();
    expect(h.render("catalog", catalogCursor(2), false).previous.props.disabled).toBe(true);
    expect(h.catalogPages).toHaveLength(1); expect(h.pages).toEqual([]); expect(h.effects).not.toHaveBeenCalled();
  });
});
