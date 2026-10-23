import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { RouterOutputs } from "./trpcReact";

type Plan = RouterOutputs["testPlans"]["byId"];
type SectionPlan = Pick<Plan, "id" | "strategyName" | "linkedPlans"> & { testPlanType: Pick<Plan["testPlanType"], "category"> };
type Candidates = RouterOutputs["testPlans"]["strategiesInProject"];
type Element = React.ReactElement<{ children?: React.ReactNode; role?: string; disabled?: boolean; value?: string; onClick?: () => void; onChange?: (event: { target: { value: string } }) => void }>;
type ReadState = { data?: Candidates; error: Error | null; isPending: boolean; isLoading: boolean; isFetching: boolean; isPaused: boolean };
const source = readFileSync(new URL("../components/TestPlanDetailContent.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("plan.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "StrategyLinkSection");
if (!declaration) throw Error("Missing actual strategy link section");
const code = ts.transpileModule(ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast) + "\nthis.actual=StrategyLinkSection;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
function elements(node: React.ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...elements(node.props.children)];
}
function text(node: React.ReactNode): string {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (React.isValidElement<{ children?: React.ReactNode }>(node)) return text(node.props.children);
  return React.Children.toArray(node).map(text).join("");
}
function harness(patch: Partial<ReadState> = {}, propsPatch: { readOnly?: boolean; plan?: Partial<SectionPlan> } = {}) {
  // Complete actual section JSX/hooks. Synthetic candidates contain only the
  // current native route's id/name fields; no linkage, server authorization,
  // browser interaction, provider activity or production acceptance is proven.
  const state: ReadState = { data: [], error: null, isPending: false, isLoading: false, isFetching: false, isPaused: false, ...patch };
  const hooks: unknown[] = []; let cursor = 0;
  const refetch = vi.fn(async () => ({ data: state.data })), nativeWrite = vi.fn(async () => { throw Error("Native write forbidden in read-state fixture"); }), onChanged = vi.fn();
  const query = { ...state, refetch }, useQuery = vi.fn(() => query);
  const props = { projectId: "synthetic-project", plan: { id: "synthetic-plan", testPlanType: { category: "TEST_PLAN" }, strategyName: null, linkedPlans: [], ...propsPatch.plan }, readOnly: propsPatch.readOnly ?? false, onChanged };
  const context = vm.createContext({ React,
    useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (next: unknown) => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }]; },
    trpcReact: { testPlans: { strategiesInProject: { useQuery }, setStrategyLink: { useMutation: () => ({ mutateAsync: nativeWrite }) } } },
  });
  vm.runInContext(code, context);
  const actual = (context as unknown as { actual(input: typeof props): React.ReactElement }).actual;
  const render = () => { cursor = 0; return actual(props); };
  const tree = render(), html = renderToStaticMarkup(tree);
  const button = (label: string) => elements(tree).find(node => node.type === "button" && text(node.props.children) === label);
  return { tree, html, button, refetch, nativeWrite, onChanged, useQuery, props, render };
}
const cached: Candidates = [{ id: "strategy-one", name: "Existing QA strategy" }];
const falseEmpty = "No QA strategy plans exist in this project yet.";

describe("actual strategy linkage candidate reads (synthetic complete section)", () => {
  it.each(["isPending", "isLoading", "isFetching"] as const)("%s is explicitly loading, never an empty-project claim or cached picker", flag => {
    for (const data of [undefined, cached]) {
      const h = harness({ data, [flag]: true });
      expect(h.html).toContain("Loading available strategies"); expect(h.html).toContain('role="status"');
      expect(h.html).not.toContain(falseEmpty); expect(h.html).not.toContain("<select"); expect(h.html).not.toContain("Existing QA strategy");
      expect(h.nativeWrite).not.toHaveBeenCalled(); expect(h.refetch).not.toHaveBeenCalled();
    }
  });
  it.each([undefined, cached])("failed read with %s data explains outage generically and retries only that query", data => {
    const h = harness({ data, error: Error("Private synthetic transport text must not be shown") });
    expect(h.html).toContain('role="alert"'); expect(h.html).toContain("Available strategies could not be refreshed");
    expect(h.html).not.toContain(falseEmpty); expect(h.html).not.toContain("<select"); expect(h.html).not.toContain("Private synthetic");
    h.button("Retry strategies")!.props.onClick!();
    expect(h.refetch).toHaveBeenCalledOnce(); expect(h.nativeWrite).not.toHaveBeenCalled(); expect(h.onChanged).not.toHaveBeenCalled();
    expect(h.useQuery).toHaveBeenCalledExactlyOnceWith({ projectId: "synthetic-project", excludeId: "synthetic-plan" }, { enabled: true });
  });
  it("error while refreshing keeps its retry disabled and still refuses the cached picker", () => {
    const h = harness({ data: cached, error: Error("Synthetic outage"), isFetching: true });
    expect(h.button("Retry strategies")!.props.disabled).toBe(true); expect(h.html).not.toContain("<select"); expect(h.nativeWrite).not.toHaveBeenCalled();
  });
  it("paused metadata is explained separately and a deliberate retry never writes linkage", () => {
    const h = harness({ data: cached, isPaused: true }); expect(h.html).toContain("Strategy listing is paused."); expect(h.html).not.toContain(falseEmpty); expect(h.html).not.toContain("<select");
    h.button("Retry strategies")!.props.onClick!(); expect(h.refetch).toHaveBeenCalledOnce(); expect(h.nativeWrite).not.toHaveBeenCalled();
  });
  it("a settled empty result remains the original genuine-empty message", () => {
    const h = harness({ data: [] }); expect(h.html).toContain(falseEmpty); expect(h.button("Retry strategies")).toBeUndefined(); expect(h.html).not.toContain("<select"); expect(h.nativeWrite).not.toHaveBeenCalled();
  });
  it("a settled nonempty result preserves exact IDs/names and the original local selection affordance", () => {
    const name = " \n Strategy 第一 <script>\t", h = harness({ data: [{ id: "exact-strategy", name }] });
    const options = elements(h.tree).filter(node => node.type === "option"); expect(options.map(node => node.props.value)).toEqual(["", "exact-strategy"]);
    expect(options[1]!.props.children).toBe(name); expect(h.html).toContain("&lt;script&gt;"); expect(h.button("Link")!.props.disabled).toBe(true);
    elements(h.tree).find(node => node.type === "select")!.props.onChange!({ target: { value: "exact-strategy" } });
    expect(elements(h.render()).find(node => node.type === "button" && text(node.props.children) === "Link")!.props.disabled).toBe(false);
    expect(h.nativeWrite).not.toHaveBeenCalled(); expect(h.refetch).not.toHaveBeenCalled();
  });
  it("read-only unlinked plans keep their existing display, regardless of candidate failure", () => {
    const h = harness({ error: Error("Synthetic outage"), isFetching: true }, { readOnly: true });
    expect(h.html).toContain("Not linked to a strategy."); expect(h.html).not.toContain("Retry strategies"); expect(h.html).not.toContain("<select"); expect(h.nativeWrite).not.toHaveBeenCalled();
  });
  it("an already linked plan keeps its saved link and unlink control, without an unrelated candidate-read gate", () => {
    const h = harness({ error: Error("Synthetic outage") }, { plan: { strategyName: "Saved strategy" } });
    expect(h.html).toContain("Saved strategy"); expect(h.button("Unlink")).toBeDefined(); expect(h.html).not.toContain("Retry strategies"); expect(h.nativeWrite).not.toHaveBeenCalled();
  });
  it("strategy plans keep their linked-plan section and disabled candidate query", () => {
    const h = harness({ error: Error("Synthetic ignored read") }, { plan: { testPlanType: { category: "QUALITY_STRATEGY" }, linkedPlans: [{ id: "child", name: "Saved concrete plan", status: "DRAFT" }] } });
    expect(h.html).toContain("Plans supporting this strategy"); expect(h.html).toContain("Saved concrete plan"); expect(h.html).not.toContain("Retry strategies");
    expect(h.useQuery).toHaveBeenCalledExactlyOnceWith({ projectId: "synthetic-project", excludeId: "synthetic-plan" }, { enabled: false }); expect(h.nativeWrite).not.toHaveBeenCalled();
  });
});
