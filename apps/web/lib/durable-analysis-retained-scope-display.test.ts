import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { retainAnalysisRequest } from "./analysis-request-recovery";

type Props = Parameters<typeof import("../components/DurableCaseAnalysis").DurableCaseAnalysis>[0];
type ReviewRequest = import("./trpcReact").RouterInputs["caseAnalysisQueue"]["review"];
type Element = React.ReactElement<{ children?: React.ReactNode; disabled?: boolean; onClick?: () => void }>;
const source = readFileSync(new URL("../components/DurableCaseAnalysis.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("DurableCaseAnalysis.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node =>
  printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, ""),
).join("\n");
const compiled = ts.transpileModule(functions + "\nthis.actualAnalysis=Analysis;", {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
}).outputText;
const originalScope = { projectId: "synthetic-project", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk" };
const ids = (count: number, prefix = "original") => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
const retained = (): ReviewRequest => ({ ...originalScope, action: "RISK", ids: ids(851), requestId: "d40cbd8a-d9b7-4810-9e89-6c9dd407ad1e" });
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function harness({ selectedIds = ids(1001, "new"), request = null, action = "RISK" }: {
  selectedIds?: string[]; request?: ReviewRequest | null; action?: "RISK" | "TYPE_DESIGN";
} = {}) {
  // Synthetic hook slots and RPC boundaries only. The real Analysis function,
  // JSX, prepare handler and scope/recovery helpers execute; no provider/queue
  // or authenticated React/browser lifecycle is exercised.
  const hooks: unknown[] = [originalScope, true, action, null, 0, request, null, null, null, "", false, false, "", ""];
  let cursor = 0, dirty = false;
  const auth = { isLoaded: true, isSignedIn: true, userId: originalScope.expectedClerkActorId };
  const review = { isPending: false, mutateAsync: vi.fn(async (_input: ReviewRequest) => { throw Error("Synthetic unknown review acknowledgement"); }) };
  const unusedWrite = { isPending: false, mutateAsync: vi.fn(async () => { throw Error("Synthetic forbidden unrelated write"); }) };
  const query = <T,>(data: T) => ({ data, error: null, isFetching: false, isPaused: false, refetch: vi.fn(async () => ({ data })) });
  const project = query({ id: originalScope.projectId, organizationId: originalScope.originalOrganizationId });
  const organizations = query([{ id: originalScope.originalOrganizationId, role: "OWNER", seatType: "FULL" }]);
  const history = query({ scope: { projectId: originalScope.projectId, organizationId: originalScope.originalOrganizationId,
    actorClerkUserId: originalScope.expectedClerkActorId, actorId: "synthetic-native-actor" }, items: [] });
  const state = query(null);
  const onCompleted = vi.fn();
  const props: Props = { projectId: originalScope.projectId, selectedIds, onCompleted };
  const randomUUID = vi.fn(() => { throw Error("A retained review must not allocate a new UUID"); });
  const context = vm.createContext({
    React, retainAnalysisRequest, useAuth: () => auth,
    useMemo: (callback: () => unknown) => callback(),
    useEffect: (callback: () => void) => callback(), useLayoutEffect: (callback: () => void) => callback(),
    useState: (initial: unknown) => {
      const index = cursor++;
      if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next: unknown) => {
        const value = typeof next === "function" ? next(hooks[index]) : next;
        if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; }
      }];
    },
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    trpcReact: {
      project: { byId: { useQuery: () => project } }, organization: { mine: { useQuery: () => organizations } },
      caseAnalysisQueue: {
        review: { useMutation: () => review }, approve: { useMutation: () => unusedWrite },
        cancel: { useMutation: () => unusedWrite }, requestAdmin: { useMutation: () => unusedWrite },
        mine: { useQuery: () => history }, byId: { useQuery: () => state },
      },
    },
    Modal: ({ children, open }: { children: React.ReactNode; open: boolean }) => React.createElement("div", { hidden: !open }, children),
    Link: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
    readableMetric: (value: string) => value, crypto: { randomUUID },
  });
  vm.runInContext(compiled, context);
  const actual = (context as unknown as { actualAnalysis(props: Props): React.ReactElement }).actualAnalysis;
  let tree: React.ReactElement;
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) {
      cursor = 0; dirty = false; tree = actual(props);
      if (!dirty) return tree;
    }
    throw Error("Synthetic hook model did not settle");
  }
  function button(label: string) {
    const found = elements(render()).find(node => node.type === "button" && node.props.children === label);
    if (!found) throw Error(`Missing actual button ${label}`);
    return found;
  }
  return { render, html: () => renderToStaticMarkup(render()), button, hooks, auth, props, review, unusedWrite, randomUUID, onCompleted };
}
describe("actual durable retained review display, synthetic boundary only", () => {
  it("fresh1001 selection keeps the bounded alert and disables preparing a new review", () => {
    const h = harness();
    expect(h.html()).toMatch(/1001 selected\s*cases/);
    expect(h.html()).toContain("Select at most 1,000 cases.");
    expect(h.button("Review selection and cost").props.disabled).toBe(true);
    expect(h.review.mutateAsync).not.toHaveBeenCalled(); expect(h.unusedWrite.mutateAsync).not.toHaveBeenCalled();
  });
  it.each([1001, 0, 20])("retained851 uses the original displayed scope despite current%ipicked and a changed analysis action", async count => {
    const request = retained(), before = JSON.stringify(request);
    const h = harness({ request, selectedIds: ids(count, "different"), action: "TYPE_DESIGN" });
    expect(h.html()).toMatch(/851 selected\s*cases/);
    expect(h.html()).not.toContain("Select at most 1,000 cases.");
    expect(h.button("Retry saved scope").props.disabled).toBe(false);
    h.button("Retry saved scope").props.onClick!();
    await Promise.resolve(); await Promise.resolve();
    expect(h.review.mutateAsync).toHaveBeenCalledTimes(1);
    expect(h.review.mutateAsync.mock.calls[0]![0]).toBe(request);
    expect(h.review.mutateAsync.mock.calls[0]![0]).toMatchObject({ action: "RISK", requestId: request.requestId, ids: request.ids });
    expect(JSON.stringify(request)).toBe(before); expect(h.hooks[5]).toBe(request);
    expect(h.randomUUID).not.toHaveBeenCalled(); expect(h.unusedWrite.mutateAsync).not.toHaveBeenCalled();
    expect(h.onCompleted).not.toHaveBeenCalled();
  });
  it("access loss conceals private scope and controls but preserves the exact unknown request for restoration", () => {
    const request = retained(), h = harness({ request });
    expect(h.html()).toMatch(/851 selected\s*cases/);
    h.auth.isSignedIn = false;
    const lost = h.html();
    expect(lost).toContain("Private saved scopes, balances and controls are hidden");
    expect(lost).not.toMatch(/851 selected|Retry saved scope|Select at most 1,000/);
    expect(h.hooks[5]).toBe(request);
    h.auth.isSignedIn = true;
    expect(h.html()).toMatch(/851 selected\s*cases/); expect(h.button("Retry saved scope").props.disabled).toBe(false);
    expect(h.hooks[5]).toBe(request); expect(h.review.mutateAsync).not.toHaveBeenCalled();
  });
});
