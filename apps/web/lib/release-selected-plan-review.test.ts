import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { RunHistoryRenderGuard } from "./run-history-reader";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { retainAnalysisRequest } from "./analysis-request-recovery";
import * as planning from "./release-planning-draft";
import type { RouterInputs, RouterOutputs } from "./trpcReact";

type Request = RouterInputs["releases"]["create"];
type Plan = RouterOutputs["testPlans"]["list"][number];
type Element = React.ReactElement<{ children?: React.ReactNode; "aria-label"?: string; href?: string; style?: React.CSSProperties }>;
const source = readFileSync(new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("release.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+(?:default\s+)?/gm, "")).join("\n") +
  "\nthis.actual=ReleasesPage;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const reviewSource = readFileSync(new URL("../components/ReleaseDraftEvidenceReview.tsx", import.meta.url), "utf8");
const reviewAst = ts.createSourceFile("review.tsx", reviewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const reviewCode = ts.transpileModule(reviewAst.statements.filter(ts.isFunctionDeclaration)
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, reviewAst).replace(/^export\s+/gm, "")).join("\n"),
  { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const plan = (id: string, name: string): Plan => ({ id, name, status: "DRAFT", releaseId: null, testPlanType: { id: "synthetic-type", name: "Regression" }, acceptanceCriteria: [{ id: `criterion-${id}` }] });
const retained = (testPlanIds: string[], projectId = "synthetic-project"): Request => ({
  requestId: "10000000-0000-4000-8000-000000000001", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk",
  projectId, name: "Original release", testPlanIds, goals: [],
});
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
function render({ ids, plans, request = null, projectId = "synthetic-project" }: { ids: string[]; plans: Plan[]; request?: Request | null; projectId?: string }) {
  // Complete actual release page plus actual proposed-plan renderer. Hook/query
  // state is synthetic final-step presentation only, with unavailable auth.
  // No creation, navigation, native evidence or current-access proof is claimed.
  const hooks: unknown[] = [true, "Synthetic release", "", 2, ids, [], "", null, false, "", [], "", null, null, request];
  let cursor = 0;
  const forbidden = vi.fn(() => { throw Error("External action forbidden in display fixture"); });
  const wrap = ({ children }: { children: React.ReactNode }) => React.createElement("section", null, children);
  const query = { data: [], isLoading: false, error: null };
  const context = vm.createContext({ React, currentSessionScope, sameAuthScope, RunHistoryRenderGuard, retainAnalysisRequest, ...planning,
    useParams: () => ({ projectId }), useAuth: () => ({ isLoaded: false, isSignedIn: false }), useProjectPermissions: () => ({ canEdit: true }),
    useManualExecutionAccess: () => ({ canWrite: false, ready: false, origin: null, refresh: forbidden }),
    useMemo: (make: () => unknown) => make(), useLayoutEffect: () => {},
    useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next: unknown) => { hooks[index] = typeof next === "function" ? next(hooks[index]) : next; }]; },
    Modal: wrap, CreationWizard: wrap, WizardChoices: () => null,
    trpcReact: { useUtils: () => ({}), releases: { list: { useQuery: () => query }, trend: { useQuery: () => query },
      create: { useMutation: () => ({ isPending: false, mutateAsync: forbidden }) } }, testPlans: { list: { useQuery: () => ({ ...query, data: plans }) } } },
  });
  vm.runInContext(reviewCode, context); vm.runInContext(code, context);
  const tree = (context as unknown as { actual(): React.ReactElement }).actual();
  const section = elements(tree).find(node => node.props["aria-label"] === "Selected existing quality plans");
  if (!section) throw Error("Missing actual selected-plan review");
  expect(forbidden).not.toHaveBeenCalled();
  return { section, pageHtml: renderToStaticMarkup(tree), html: renderToStaticMarkup(section), list: elements(section).filter(node => node.type === "li"), links: elements(section).filter(node => node.type === "a") };
}

describe("actual release selected-plan review (synthetic final-step presentation)", () => {
  it("shows the exact selected identities and loaded names, not unselected plans or invented criteria", () => {
    const result = render({ ids: ["checkout"], plans: [plan("checkout", "Checkout regression"), plan("playback", "Playback regression")] });
    expect(result.list).toHaveLength(1); expect(text(result.list[0])).toContain("Checkout regression"); expect(text(result.list[0])).toContain("checkout");
    expect(result.links[0]!.props.href).toBe("/projects/synthetic-project/test-plans/checkout");
    expect(result.html).not.toContain("Playback regression"); expect(result.html).not.toContain("criterion-checkout");
    expect(result.html).toContain("Selected quality plans (current names)");
    expect(result.html).toContain("Open a plan to review its current criteria. Creating this release links these plans without editing them.");
  });
  it("retained original IDs and order override changed current draft selections", () => {
    const request = retained(["original-b", "original-a"]), bytes = JSON.stringify(request);
    const result = render({ ids: ["changed"], plans: [plan("original-a", "Original A"), plan("original-b", "Original B"), plan("changed", "Changed plan")], request });
    expect(result.list.map(node => text(node))).toEqual(["Original B original-b", "Original A original-a"]);
    expect(result.pageHtml).toContain("2 test plan(s)"); expect(result.pageHtml).not.toContain("1 test plan(s)");
    expect(result.html).not.toContain("Changed plan"); expect(JSON.stringify(request)).toBe(bytes);
  });
  it("retained explicit empty scope cannot be replaced by nonempty current draft", () => {
    const result = render({ ids: ["changed"], plans: [plan("changed", "Changed plan")], request: retained([]) });
    expect(result.list).toHaveLength(0); expect(result.html).toContain("No existing quality plans are selected."); expect(result.html).not.toContain("Changed plan");
    expect(result.pageHtml).toContain("0 test plan(s)"); expect(result.pageHtml).not.toContain("1 test plan(s)");
  });
  it("an ordinary empty selection is explicit instead of a blank review", () => {
    const result = render({ ids: [], plans: [plan("unselected", "Unselected")] });
    expect(result.list).toHaveLength(0); expect(result.html).toContain("No existing quality plans are selected.");
  });
  it("unavailable metadata does not drop the selected ID or its exact existing detail route", () => {
    const result = render({ ids: ["available", "missing"], plans: [plan("available", "Loaded name")] });
    expect(result.list).toHaveLength(2); expect(text(result.list[1])).toBe("Plan metadata unavailable missing");
    expect(result.links[1]!.props.href).toBe("/projects/synthetic-project/test-plans/missing");
  });
  it("same-name plans remain distinguishable by their exact identities without changing wording", () => {
    const name = " \n Regression 第一\t";
    const result = render({ ids: ["one", "two"], plans: [plan("one", name), plan("two", name)] });
    expect(result.links.map(node => node.props.children)).toEqual([name, name]);
    expect(result.links.map(node => node.props.style?.whiteSpace)).toEqual(["pre-wrap", "pre-wrap"]);
    expect(result.list.map(node => elements(node).find(child => child.type === "code")!.props.children)).toEqual(["one", "two"]);
  });
  it("escapes identity/name text and percent-encodes project and plan route segments", () => {
    const id = "plan/<script>?&第一", projectId = "project/path?&", name = "<img src=x onerror=evil()> & Review";
    const result = render({ ids: [id], plans: [plan(id, name)], projectId });
    expect(result.links[0]!.props.href).toBe(`/projects/${encodeURIComponent(projectId)}/test-plans/${encodeURIComponent(id)}`);
    expect(result.html).toContain("&lt;img"); expect(result.html).toContain("&lt;script&gt;"); expect(result.html).not.toContain("<img"); expect(result.html).not.toContain("<script");
  });
  it("retained scope in another current project links the original project and never borrows its current plan name", () => {
    const result = render({ ids: ["changed"], plans: [plan("original", "Current project metadata")], projectId: "current-project", request: retained(["original"], "original/project") });
    expect(result.links[0]!.props.href).toBe("/projects/original%2Fproject/test-plans/original");
    expect(text(result.list[0])).toBe("Plan metadata unavailable original"); expect(result.html).not.toContain("Current project metadata");
  });
});
