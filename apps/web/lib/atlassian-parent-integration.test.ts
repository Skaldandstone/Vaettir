import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { expect, it } from "vitest";
import { controllerTranspile } from "./controller-transpile.fixture";

// Actual parent JSX/handlers; child transport components and hooks are synthetic.
// The separate mounted OAuth runner verifies the real child interaction contract.
type Element = React.ReactElement<Record<string, unknown> & { children?: React.ReactNode }>;
function nodes(value: React.ReactNode): Element[] {
  return Array.isArray(value) ? value.flatMap(nodes) : React.isValidElement(value)
    ? [value as Element, ...nodes((value as Element).props.children)] : [];
}
function text(value: React.ReactNode): string {
  return typeof value === "string" || typeof value === "number" ? String(value)
    : Array.isArray(value) ? value.map(text).join("")
    : React.isValidElement(value) ? text((value as Element).props.children) : "";
}
function parent(name: string, extras: Record<string, unknown>) {
  const source = readFileSync(new URL(`../components/${name}.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("parent.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const body = ast.statements.filter(n => ts.isFunctionDeclaration(n) || ts.isVariableStatement(n))
    .map(n => ts.createPrinter().printNode(ts.EmitHint.Unspecified, n, ast).replace(/^export /, "")).join("\n");
  const slots: unknown[] = []; let cursor = 0;
  const context = vm.createContext({ React,
    useState(initial: unknown) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? initial() : initial;
      return [slots[index], (value: unknown) => { slots[index] = typeof value === "function" ? value(slots[index]) : value; }]; },
    useRef(initial: unknown) { const index = cursor++; return slots[index] ??= { current: initial }; },
    useCallback(callback: unknown) { const index = cursor++; return slots[index] ??= callback; },
    useLayoutEffect() {}, useIsMutating: () => 0,
    ...extras,
  });
  vm.runInContext(controllerTranspile(`${body}\nthis.actual=${name};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText, context);
  return (props: Record<string, unknown>) => { cursor = 0; return context.actual(props) as React.ReactNode; };
}

it("requirements source dialog retains Jira while working, including a captured close before rerender", () => {
  const render = parent("SourceConnectionChips", {
    trpcReact: { useUtils: () => ({}) }, isConnectionMutation: () => false,
    Modal: "modal-boundary", JiraSourceConnection: "jira-boundary", PopulationDocuments: "documents-boundary", repositoryProviders: [],
    cancelRepositoryAuthorization() {},
  });
  const props = { projectId: "synthetic-project", only: ["jira"] };
  const open = nodes(render(props)).find(n => n.type === "button" && text(n.props.children).includes("Jira"))!;
  (open.props.onClick as () => void)();
  const current = nodes(render(props)), modal = current.find(n => n.type === "modal-boundary" && n.props.title === "Connect Jira" && n.props.keepMounted === true)!;
  const jira = current.find(n => n.type === "jira-boundary")!;
  expect(jira.props.projectId).toBe(props.projectId);
  const close = modal.props.onClose as () => void;
  const working = jira.props.onDefectWorkingChange as (value: boolean) => void;
  working(true); close(); // The original callback must observe the live write fence.
  const held = nodes(render(props));
  expect(held.find(n => n.type === "modal-boundary" && n.props.title === "Connect Jira" && n.props.keepMounted === true)!.props).toMatchObject({ open: true, dismissible: false, keepMounted: true });
  expect(held.find(n => n.type === "jira-boundary")).toBeDefined();
  expect(held.filter(n => n.type === "button").every(n => n.props.disabled === true)).toBe(true);
  working(false);
  const released = nodes(render(props)).find(n => n.type === "modal-boundary" && n.props.title === "Connect Jira" && n.props.keepMounted === true)!;
  (released.props.onClose as () => void)();
  expect(nodes(render(props)).find(n => n.type === "modal-boundary" && n.props.title === "Connect Jira" && n.props.keepMounted === true)!.props.open).toBe(false);
  expect(nodes(render(props)).find(n => n.type === "jira-boundary")).toBeDefined();
  (open.props.onClick as () => void)();
  expect(nodes(render(props)).find(n => n.type === "modal-boundary" && n.props.title === "Connect Jira" && n.props.keepMounted === true)!.props.open).toBe(true);
});

it("Confluence browser access remains separate and mounted through a Forge metadata outage", () => {
  const query = { data: null, error: null as Error | null, isFetching: false, isPaused: false };
  const render = parent("AtlassianQualitySettings", {
    useAuth: () => ({ userId: "synthetic-actor", isLoaded: true, isSignedIn: true }),
    AtlassianOAuthConnection: "oauth-boundary",
    trpcReact: { atlassianQuality: { settings: { useQuery: () => query },
      publish: { useMutation: () => ({}) }, revoke: { useMutation: () => ({}) } } },
  });
  const props = { projectId: "synthetic-project", organizationId: "synthetic-org", canConfigure: true };
  const connection = () => nodes(render(props)).filter(n => n.type === "oauth-boundary");
  expect(connection()).toHaveLength(1);
  expect(connection()[0]!.props).toEqual({ projectId: props.projectId, product: "confluence" });
  query.error = Error("Synthetic sharing metadata unavailable");
  expect(connection()).toHaveLength(1);
  expect(text(render(props))).toContain("Connecting does not publish reports");
  expect(render({ ...props, canConfigure: false })).toBeNull();
});
