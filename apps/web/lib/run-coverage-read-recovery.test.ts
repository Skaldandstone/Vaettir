import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it, vi } from "vitest";
import { ActionButton } from "./test-support/action-button";

// Actual run-page CoverageSection with real shared controls. Query/refetch is a
// synthetic boundary; no native/browser/provider/database read is performed.
const ast = ts.createSourceFile("runs.tsx", readFileSync(new URL("../app/projects/[projectId]/test-runs/page.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const code = ts.transpileModule(ast.statements.filter(node => ts.isFunctionDeclaration(node) && ["CoverageSection", "coveragePct"].includes(node.name?.text ?? "")).map(node => node.getText(ast)).join("\n"), { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const row = { id: "synthetic-report", tool: "PRIVATE_CACHED_TOOL", branch: "main", commitSha: "abcdef123456", linesCovered: 2, linesTotal: 4, createdAt: "2026-11-05T12:00:00Z" };
function render(query: { data?: typeof row[]; error?: unknown; isLoading?: boolean; isFetching?: boolean; isPaused?: boolean }) {
  const refetch = vi.fn(async () => {}), useQuery = vi.fn(() => ({ ...query, refetch }));
  const Component = new Function("React", "ActionButton", "trpcReact", code + ";return CoverageSection;")(React, ActionButton, { coverage: { list: { useQuery } } }) as React.ComponentType<{ projectId: string }>;
  const tree = (Component as (props: { projectId: string }) => React.ReactElement | null)({ projectId: "synthetic-project" });
  const html = renderToStaticMarkup(tree);
  const children = (value: unknown): React.ReactElement<Record<string, unknown>>[] => Array.isArray(value) ? value.flatMap(children) : React.isValidElement(value) ? [value as React.ReactElement<Record<string, unknown>>, ...children((value.props as { children?: unknown }).children)] : [];
  return { html, refetch, buttons: children(tree).filter(node => node.type === ActionButton) };
}
it.each(["error", "paused"])("coverage %s is visible and recoverable without showing failed cached reports", mode => {
  for (const data of [undefined, [row]]) {
    const h = render({ data, error: mode === "error" ? Error("PRIVATE_FAILURE_MARKER") : undefined, isPaused: mode === "paused", isFetching: false });
    expect(h.html).toContain("Coverage unavailable"); expect(h.html).not.toContain("PRIVATE_FAILURE_MARKER"); expect(h.html).not.toContain("PRIVATE_CACHED_TOOL"); expect(h.html).not.toContain("<table");
    expect(h.buttons).toHaveLength(1); (h.buttons[0]!.props.onClick as () => void)(); expect(h.refetch).toHaveBeenCalledOnce();
  }
});
it("current coverage reports still show their recorded percentage", () => {
  const h = render({ data: [row] }); expect(h.html).toContain("50%"); expect(h.html).toContain("PRIVATE_CACHED_TOOL"); expect(h.html).not.toContain("Coverage unavailable"); expect(h.refetch).not.toHaveBeenCalled();
});
it("empty/loading reads stay empty, and an in-flight recovery disables Retry", () => {
  expect(render({ data: [] }).html).toBe(""); expect(render({ isLoading: true }).html).toBe("");
  const h = render({ error: Error("synthetic"), isFetching: true }); expect(h.buttons[0]?.props.disabled).toBe(true);
});
