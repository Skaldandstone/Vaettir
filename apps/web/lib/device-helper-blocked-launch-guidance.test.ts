import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

const source = readFileSync(new URL("../components/DeviceHelperBlockedLaunchGuidance.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("DeviceHelperBlockedLaunchGuidance.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const code = ts.transpileModule(functions + "\nthis.render=DeviceHelperBlockedLaunchGuidance;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type Button = React.ReactElement<{ "aria-expanded": boolean; "aria-controls": string; onClick(): void }>;
function descendants(node: unknown): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants((node.props as { children?: unknown }).children)];
}
function renderer() {
  let expanded = false;
  const context = vm.createContext({ React, useId: () => "synthetic-public-guidance",
    useState: () => [expanded, (next: boolean | ((current: boolean) => boolean)) => { expanded = typeof next === "function" ? next(expanded) : next; }] });
  vm.runInContext(code, context);
  return { render: (context as unknown as { render(props: { reportedBlocked: boolean }): React.ReactElement }).render, expanded: () => expanded };
}

describe("actual public blocked-helper guidance renderer: no native or device acceptance", () => {
  it.each([true, false])("distinguishes reported OS refusal from a missing paired response: %s", reportedBlocked => {
    const html = renderToStaticMarkup(renderer().render({ reportedBlocked }));
    expect(html).toContain(reportedBlocked ? "Windows refused launch (reported by you)" : "No paired helper response yet");
    expect(html).toContain(reportedBlocked ? "blocking policy or product is unknown" : "timeout does not prove that Windows blocked");
    expect(html).toContain("exact filename"); expect(html).toContain("displayed error"); expect(html).toContain("time of the attempt");
    expect(html).toContain("Internet download marker"); expect(html).toContain("review policy history");
  });
  it("renders the actual unsigned delivery requirement, no signing guarantee and explicit no-bypass guidance", () => {
    const html = renderToStaticMarkup(renderer().render({ reportedBlocked: true }));
    for (const text of ["unsigned script", ".cmd on Windows", ".command on macOS", ".sh on Linux", "Node.js 22 or newer", "No signed installer", "Do not disable protection", "unblock files", "add exclusions", "change ExecutionPolicy", "run as administrator", "only when policy permits, not a bypass"]) expect(html).toContain(text);
    expect(html).not.toMatch(/href=|download=|<input|<textarea|<form/);
  });
  it("actual functional disclosure remains controlled, default closed and repeatedly toggles without an external action", () => {
    const h = renderer(); const initial = h.render({ reportedBlocked: true });
    const button = descendants(initial).find(node => node.type === "button") as Button;
    expect(button.props["aria-expanded"]).toBe(false); expect(button.props["aria-controls"]).toBe("synthetic-public-guidance-checks");
    expect(renderToStaticMarkup(initial)).toContain('<div id="synthetic-public-guidance-checks" hidden="">');
    button.props.onClick(); expect(h.expanded()).toBe(true);
    expect(renderToStaticMarkup(h.render({ reportedBlocked: true }))).not.toContain('<div id="synthetic-public-guidance-checks" hidden="">');
    // Two same-event clicks use the latest state, not a render-captured toggle.
    button.props.onClick(); expect(h.expanded()).toBe(false); button.props.onClick(); expect(h.expanded()).toBe(true);
  });
  it("names the independent approvals without implying semantic redaction, authorization or spending permission", () => {
    const html = renderToStaticMarkup(renderer().render({ reportedBlocked: true }));
    for (const text of ["OS launch acceptance", "Paired liveness", "Device and foreground target", "Capture-source consent", "Paid AI processing", "Named controls can still contain sensitive text", "setup is not spending approval", "supplies none"]) expect(html).toContain(text);
  });
  it("actual source imports only presentation hooks and has no transport/private-data/OS or default external action", () => {
    const imports = ast.statements.filter(ts.isImportDeclaration).map(node => (node.moduleSpecifier as ts.StringLiteral).text);
    expect(imports).toEqual(["react"]);
    const identifiers: string[] = [];
    // The only callback is a functional local visibility change.
    const calls: string[] = [];
    function visit(node: ts.Node) { if (ts.isIdentifier(node)) identifiers.push(node.text); if (ts.isCallExpression(node)) calls.push(node.expression.getText(ast)); ts.forEachChild(node, visit); }
    visit(ast); expect(calls.sort()).toEqual(["setExpanded", "useId", "useState"]);
    for (const denied of ["fetch", "XMLHttpRequest", "navigator", "window", "trpcReact", "useAuth", "useEffect", "useLayoutEffect", "downloadFile", "clipboard", "pairingCode", "dangerouslySetInnerHTML", "href", "onCopy", "onUpload"]) expect(identifiers).not.toContain(denied);
  });
  it("the real capture page mounts reported-blocked guidance without changing its explicit policy-permitted manual action", () => {
    const page = readFileSync(new URL("../app/projects/[projectId]/live-app-generation/page.tsx", import.meta.url), "utf8");
    expect(page).toContain('import { DeviceHelperBlockedLaunchGuidance } from "@/components/DeviceHelperBlockedLaunchGuidance"');
    expect(page).toContain('connectorStatus === "blocked" && <div role="status"><DeviceHelperBlockedLaunchGuidance reportedBlocked={true} />');
    expect(page).toContain('onClick={showPolicyPermittedManualSetup}>Show manual instructions only if policy permits');
    expect(page).toContain("Your private pairing draft remains retained");
    expect(page).toContain("launch outcome remains unverified");
    expect(page).not.toContain("not started. Do not disable");
  });
});
