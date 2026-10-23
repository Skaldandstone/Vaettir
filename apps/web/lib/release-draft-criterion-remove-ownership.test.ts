import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { RunHistoryRenderGuard } from "./run-history-reader";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { retainAnalysisRequest } from "./analysis-request-recovery";
import * as planning from "./release-planning-draft";

const source = readFileSync(new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("release.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node))
  .map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+(?:default\s+)?/gm, "")).join("\n") +
  "\nthis.actual=ReleasesPage;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type Element = React.ReactElement<{
  children?: React.ReactNode; "aria-label"?: string; disabled?: boolean;
  onClick?: () => void; onChange?: (event: { target: { value: string } }) => void;
}>;
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
function harness(initial: string[]) {
  // Actual complete page JSX and local handlers, real draft helpers/owner class.
  // Synthetic hook state seeds only unsaved quality scope. Authorization is
  // deliberately unavailable and no submit/SDK/native/provider action executes.
  const hooks: unknown[] = [true, "Synthetic ordinary release", "", 1, [], [], "", null, false,
    "Synthetic quality plan", initial, "", null, null, null];
  let cursor = 0;
  const updateChecks: Array<{ before: string[]; after: string[]; repeated: string[] }> = [];
  const writes = vi.fn(() => { throw Error("External action forbidden in local draft model"); });
  const query = { data: [], isLoading: false, error: null };
  const context = vm.createContext({ React, currentSessionScope, sameAuthScope, RunHistoryRenderGuard, retainAnalysisRequest, ...planning,
    RepositoryReleaseDiscovery: () => null,
    useParams: () => ({ projectId: "synthetic-project" }), useAuth: () => ({ isLoaded: false, isSignedIn: false }),
    useProjectPermissions: () => ({ canEdit: true }), useManualExecutionAccess: () => ({ canWrite: false, ready: false, origin: null, refresh: writes }),
    useMemo: (make: () => unknown) => make(), useLayoutEffect: () => {},
    useState: (initialValue: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initialValue === "function" ? initialValue() : initialValue;
      return [hooks[index], (next: unknown) => {
        if (typeof next !== "function") { hooks[index] = next; return; }
        const before = hooks[index], after = next(before);
        if (index === 10) updateChecks.push({ before: before as string[], after, repeated: next(before) });
        hooks[index] = after;
      }];
    },
    Modal: () => null, CreationWizard: () => null, WizardChoices: () => null, ReleaseDraftEvidenceReview: () => null,
    trpcReact: { useUtils: () => ({}), releases: { list: { useQuery: () => query }, trend: { useQuery: () => query },
      create: { useMutation: () => ({ isPending: false, mutateAsync: writes }) } }, testPlans: { list: { useQuery: () => query } } },
  });
  vm.runInContext(code, context);
  const actual = (context as unknown as { actual(): React.ReactElement }).actual;
  let tree: React.ReactElement;
  const render = () => { cursor = 0; tree = actual(); return tree; };
  const find = (predicate: (node: Element) => boolean) => { const found = elements(tree).find(predicate); if (!found) throw Error("Missing actual quality-draft control"); return found; };
  const remove = (number: number) => find(node => node.props["aria-label"] === `Remove criterion ${number}`).props.onClick!;
  const edit = (number: number) => find(node => node.props["aria-label"] === `Edit draft criterion ${number}`).props.onClick!;
  const button = (label: string) => find(node => node.type === "button" && text(node.props.children) === label).props.onClick!;
  const draft = (value: string) => { find(node => node.type === "textarea").props.onChange!({ target: { value } }); render(); };
  const criteria = () => hooks[10] as string[];
  const assertPure = () => { for (const update of updateChecks) expect(update.repeated).toEqual(update.after); expect(writes).not.toHaveBeenCalled(); };
  render(); return { render, remove, edit, button, draft, criteria, assertPure };
}

describe("actual release draft criterion removal ownership (synthetic local hooks only)", () => {
  it("two rapid captured indices cannot delete a different shifted row, and a fresh render still removes its chosen row", () => {
    const original = ["First exact criterion", "Second exact criterion", "Third exact criterion"], h = harness(original);
    const first = h.remove(1), second = h.remove(2);
    first(); const afterFirst = h.criteria(); second();
    expect(h.criteria()).toBe(afterFirst); expect(h.criteria()).toEqual(original.slice(1)); expect(original).toHaveLength(3);
    h.render(); h.remove(1)(); expect(h.criteria()).toEqual(["Third exact criterion"]); h.assertPure();
  });
  it("repeated captured removal is consumed by its exact array without deleting the next criterion", () => {
    const h = harness(["First", "Second"]), old = h.remove(1); old(); const after = h.criteria(); old(); old();
    expect(h.criteria()).toBe(after); expect(h.criteria()).toEqual(["Second"]); h.assertPure();
  });
  it("a captured removal after actual Add criterion retains the new collection and exact wording", () => {
    const original = ["First", "Second"], h = harness(original), old = h.remove(1);
    h.draft(" \n Third exact criterion\t"); h.button("Add criterion")(); const added = h.criteria();
    old(); expect(h.criteria()).toBe(added); expect(h.criteria()).toEqual([...original, " \n Third exact criterion\t"]);
    h.render(); h.remove(1)(); expect(h.criteria()).toEqual(["Second", " \n Third exact criterion\t"]); h.assertPure();
  });
  it("a captured removal after an actual draft edit cannot erase replacement wording", () => {
    const h = harness(["First", "Second"]), old = h.remove(1); h.edit(1)(); h.render();
    h.draft(" \n Revised\t第一 \n"); h.button("Save draft edit")(); const replaced = h.criteria();
    old(); expect(h.criteria()).toBe(replaced); expect(h.criteria()).toEqual([" \n Revised\t第一 \n", "Second"]);
    h.render(); h.remove(2)(); expect(h.criteria()).toEqual([" \n Revised\t第一 \n"]); h.assertPure();
  });
  it("a captured callback after the collection is cleared stays a no-op rather than changing the empty draft", () => {
    const h = harness(["First", "Second"]), old = h.remove(2); h.remove(1)(); h.render(); h.remove(1)();
    const empty = h.criteria(); old(); expect(h.criteria()).toBe(empty); expect(empty).toEqual([]); h.assertPure();
  });
  it("duplicate, multiline, whitespace and Unicode criteria keep their exact multiplicity and order", () => {
    const exact = " \n Duplicate criterion\t第一 \n", original = [exact, exact, "Third\nline", " \t Fourth \t"], h = harness(original);
    const oldFirst = h.remove(1), oldSecond = h.remove(2); oldFirst(); oldSecond();
    expect(h.criteria()).toEqual([exact, "Third\nline", " \t Fourth \t"]); expect(original).toEqual([exact, exact, "Third\nline", " \t Fourth \t"]);
    h.render(); h.remove(2)(); expect(h.criteria()).toEqual([exact, " \t Fourth \t"]); h.assertPure();
  });
  it("clearing only the unsaved text draft does not invalidate an unchanged criterion collection", () => {
    const h = harness(["First", "Second"]), old = h.remove(1); h.draft("Unsaved extra wording"); h.button("Clear draft")();
    old(); expect(h.criteria()).toEqual(["Second"]); h.assertPure();
  });
  it("the existing maximum 50-criterion collection remains removable without fabricated oversized workload", () => {
    const original = Array.from({ length: 50 }, (_, index) => `Criterion ${index + 1}`), h = harness(original);
    const oldFirst = h.remove(1), oldLast = h.remove(50); oldFirst(); oldLast(); expect(h.criteria()).toEqual(original.slice(1));
    h.render(); h.remove(49)(); expect(h.criteria()).toEqual(original.slice(1, -1)); h.assertPure();
  });
});
