import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { controllerTranspile } from "./controller-transpile.fixture";
const source = readFileSync(new URL("../components/CiRunDetail.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("actual.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewer = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "CiArtifactViewer")!;
const code = controllerTranspile(ts.createPrinter().printNode(ts.EmitHint.Unspecified, viewer, ast) + ";this.component=CiArtifactViewer", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown): Element[] {
  return Array.isArray(value) ? value.flatMap(elements) : React.isValidElement(value)
    ? [value as Element, ...elements((value as Element).props.children)] : [];
}
function harness(type: "SCREENSHOT" | "VIDEO") {
  const slots: unknown[] = []; let cursor = 0, tree: unknown; const cleanups: Array<() => void> = [];
  const query = vi.fn().mockResolvedValueOnce({ viewUrl: "https://synthetic.invalid/old" }).mockResolvedValueOnce({ viewUrl: "https://synthetic.invalid/new" });
  const context = vm.createContext({ React,
    useState: (initial: unknown) => { const id = cursor++; if (!(id in slots)) slots[id] = initial; return [slots[id], (value: unknown) => { slots[id] = value; }]; },
    useRef: (initial: unknown) => { const id = cursor++; if (!(id in slots)) slots[id] = { current: initial }; return slots[id]; },
    useEffect: (effect: () => (() => void) | undefined) => { const id = cursor++; if (!(id in slots)) { slots[id] = true; const cleanup = effect(); if (cleanup) cleanups.push(cleanup); } },
    trpcReact: { useUtils: () => ({ client: { testRuns: { getArtifactViewUrl: { query } } } }) },
  });
  vm.runInContext(code, context);
  const component = context.component as (props: { id: string; type: string }) => unknown;
  function render() { cursor = 0; tree = component({ id: "synthetic-artifact", type }); }
  render();
  return { query, render,
    async click() { const button = elements(tree).find(node => node.type === "button")!; (button.props.onClick as () => void)(); await new Promise<void>(resolve => setImmediate(resolve)); render(); },
    media: () => elements(tree).find(node => node.type === "img" || node.type === "video"),
    unmount: () => cleanups.forEach(fn => fn()),
  };
}
it.each(["SCREENSHOT", "VIDEO"] as const)("an old %s error cannot dismiss a newer successfully opened preview", async type => {
  const h = harness(type); expect(h.query).not.toHaveBeenCalled();
  await h.click(); const oldError = h.media()!.props.onError as () => void;
  await h.click(); expect(h.media()).toBeUndefined();
  await h.click(); expect(h.media()!.props.src).toBe("https://synthetic.invalid/new");
  oldError(); h.render();
  expect(h.media()?.props.src).toBe("https://synthetic.invalid/new");
  expect(h.query).toHaveBeenCalledTimes(2);
  (h.media()!.props.onError as () => void)(); h.render();
  expect(h.media()).toBeUndefined();
});
it("a signing response completed after unmount cannot restore private media", async () => {
  const h = harness("SCREENSHOT"); let complete!: (value: { viewUrl: string }) => void;
  h.query.mockReset().mockReturnValue(new Promise(resolve => { complete = resolve; }));
  await h.click(); h.unmount(); complete({ viewUrl: "https://synthetic.invalid/late" });
  await new Promise<void>(resolve => setImmediate(resolve)); h.render();
  expect(h.media()).toBeUndefined(); expect(h.query).toHaveBeenCalledTimes(1);
});
