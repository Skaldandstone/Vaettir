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
type Element = React.ReactElement<{ children?: React.ReactNode; "aria-label"?: string; href?: string; target?: string; rel?: string; onClick?: () => void; onChange?: (event: { target: { checked: boolean } }) => void; type?: string; checked?: boolean; disabled?: boolean; style?: React.CSSProperties }>;
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
function renderPage({ ids, plans, request = null, projectId = "synthetic-project", step = 2 }: { ids: string[]; plans: Plan[]; request?: Request | null; projectId?: string; step?: number }) {
  // Complete actual release page plus actual proposed-plan renderer. Hook/query
  // state is synthetic wizard presentation only, with unavailable auth.
  // No creation, navigation, native evidence or current-access proof is claimed.
  const hooks: unknown[] = [true, "Synthetic release", "", step, ids, [], "", null, false, "", [], "", null, null, request];
  let cursor = 0;
  const forbidden = vi.fn(() => { throw Error("External action forbidden in display fixture"); });
  const wrap = ({ children }: { children: React.ReactNode }) => React.createElement("section", null, children);
  const query = { data: [], isLoading: false, error: null };
  const context = vm.createContext({ React, currentSessionScope, sameAuthScope, RunHistoryRenderGuard, retainAnalysisRequest, ...planning,
    RepositoryReleaseDiscovery: () => null,
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
  const rerender = () => { cursor = 0; return (context as unknown as { actual(): React.ReactElement }).actual(); };
  const tree = rerender();
  expect(forbidden).not.toHaveBeenCalled();
  return { tree, rerender, selected: () => hooks[4] as string[], forbidden };
}
function render(props: Parameters<typeof renderPage>[0]) {
  const { tree } = renderPage(props);
  const section = elements(tree).find(node => node.props["aria-label"] === "Selected existing quality plans");
  if (!section) throw Error("Missing actual selected-plan review");
  return { section, pageHtml: renderToStaticMarkup(tree), html: renderToStaticMarkup(section), list: elements(section).filter(node => node.type === "li"), links: elements(section).filter(node => node.type === "a") };
}

function planChoices(tree: React.ReactNode) {
  return elements(tree).filter(node => node.type === "label")
    .map(label => ({ label, input: elements(label).find(node => node.type === "input" && node.props.type === "checkbox") }))
    .filter(choice => choice.input && text(choice.label).includes("acceptance criteria"));
}

describe("actual release wizard existing-plan lifecycle admission (synthetic events)", () => {
  it("offers editable lifecycle plans but refuses selecting approved or archived plans when their handler is invoked directly", () => {
    const statuses = ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED", "ARCHIVED"];
    const plans = statuses.map(status => ({ ...plan(status, `Synthetic ${status}`), status }));
    const fixture = renderPage({ ids: [], plans, step: 1 });
    const choices = planChoices(fixture.tree);
    expect(choices).toHaveLength(5);
    for (const [index, choice] of choices.entries()) {
      const locked = index >= 3;
      expect(choice.input!.props.disabled).toBe(locked);
      expect(text(choice.label).includes("Reopen the plan before linking it.")).toBe(locked);
      choice.input!.props.onChange!({ target: { checked: true } });
    }
    expect(fixture.selected()).toEqual(["DRAFT", "ACTIVE", "IN_REVIEW"]);
    expect(plans.map(item => item.status)).toEqual(statuses);
    expect(fixture.forbidden).not.toHaveBeenCalled();
  });

  it("retains a lifecycle-changed selected identity until deliberate removal, without accepting it again", () => {
    for (const status of ["APPROVED", "ARCHIVED"]) {
      const plans = [{ ...plan("changed", "Changed lifecycle plan"), status }, plan("kept", "Retained editable plan")];
      const fixture = renderPage({ ids: ["changed", "kept"], plans, step: 1 });
      const choice = planChoices(fixture.tree)[0]!;
      expect(choice.input!.props.checked).toBe(true);
      expect(choice.input!.props.disabled).toBe(false);
      expect(fixture.selected()).toEqual(["changed", "kept"]);
      expect(text(choice.label)).toContain("it was not removed from your draft automatically");
      choice.input!.props.onChange!({ target: { checked: false } });
      expect(fixture.selected()).toEqual(["kept"]);
      expect(planChoices(fixture.rerender())[0]!.input!.props.disabled).toBe(true);
      choice.input!.props.onChange!({ target: { checked: true } });
      expect(fixture.selected()).toEqual(["kept"]);
      expect(fixture.forbidden).not.toHaveBeenCalled();
    }
  });

  it("explains a lifecycle-locked-only inventory without treating assigned plans as available", () => {
    const locked = [{ ...plan("approved", "Approved plan"), status: "APPROVED" }, { ...plan("archived", "Archived plan"), status: "ARCHIVED" }];
    const assigned = { ...plan("assigned", "Already assigned plan"), releaseId: "synthetic-release" };
    const fixture = renderPage({ ids: [], plans: [...locked, assigned], step: 1 });
    const html = renderToStaticMarkup(fixture.tree);
    expect(planChoices(fixture.tree)).toHaveLength(2);
    expect(html).toContain("No linkable unassigned plans.");
    expect(html).not.toContain("Already assigned plan");
    const editable = renderPage({ ids: [], plans: [...locked, plan("draft", "Draft plan")], step: 1 });
    expect(renderToStaticMarkup(editable.tree)).not.toContain("No linkable unassigned plans.");
  });

  it("does not reinterpret a historical retained request when its selected plan is now archived", () => {
    const request = retained(["original"]), bytes = JSON.stringify(request);
    const result = render({ ids: ["changed"], plans: [{ ...plan("original", "Original plan"), status: "ARCHIVED" }], request });
    expect(result.list.map(node => text(node))).toEqual(["Original plan original"]);
    expect(JSON.stringify(request)).toBe(bytes);
  });
});

describe("actual release selected-plan review (synthetic final-step presentation)", () => {
  it("shows the exact selected identities and loaded names, not unselected plans or invented criteria", () => {
    const result = render({ ids: ["checkout"], plans: [plan("checkout", "Checkout regression"), plan("playback", "Playback regression")] });
    expect(result.list).toHaveLength(1); expect(text(result.list[0])).toContain("Checkout regression"); expect(text(result.list[0])).toContain("checkout");
    expect(result.links[0]!.props.href).toBe("/projects/synthetic-project/test-plans/checkout");
    expect(result.html).not.toContain("Playback regression"); expect(result.html).not.toContain("criterion-checkout");
    expect(result.html).toContain("Selected quality plans (current names)");
    expect(result.html).toContain("Open a plan in a new tab to review its current criteria without leaving this draft. Creating this release links these plans without editing them.");
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
  it("plan inspection is a disclosed isolated user-click new-tab link, never an implicit handler or write", () => {
    const request = retained(["original", "missing"]), bytes = JSON.stringify(request);
    const cases = [
      { ids: ["current"], plans: [plan("current", "Current plan")] },
      { ids: ["changed"], plans: [plan("original", "Original plan")], request },
      { ids: ["changed"], plans: [plan("original", "Unrelated current plan")], request, projectId: "different-project" },
    ];
    for (const props of cases) {
      const result = render(props);
      expect(result.links.length).toBeGreaterThan(0);
      for (const link of result.links) {
        expect(link.props.target).toBe("_blank"); expect(link.props.rel).toBe("noopener noreferrer"); expect(link.props.onClick).toBeUndefined();
      }
      expect(result.html).toContain("in a new tab"); expect(result.html).toContain("without leaving this draft");
    }
    expect(JSON.stringify(request)).toBe(bytes);
  });
});
