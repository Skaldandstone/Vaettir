import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { retainAnalysisRequest } from "./analysis-request-recovery";
type Props = Parameters<typeof import("../components/DurableCaseAnalysis").DurableCaseAnalysis>[0];
type Request = import("./trpcReact").RouterInputs["caseAnalysisQueue"]["review"];
type Element = React.ReactElement<{ children?: React.ReactNode; onClick?: () => void; disabled?: boolean }>;
const source = readFileSync(new URL("../components/DurableCaseAnalysis.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Analysis.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const compiled = ts.transpileModule(declarations + "\nthis.actual=Analysis;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const scope = { projectId: "synthetic-project", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk" };
const ids = (count: number, prefix = "original") => Array.from({ length: count }, (_, index) => `${prefix}-${index}`);
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function harness() {
  // Actual component handlers/helpers, synthetic hook and deferred RPC model.
  // Minimal ACK fields are only what this handler reads, not a native DTO or
  // evidence of a server queue, provider operation, approval or credit charge.
  const hooks: unknown[] = [scope, true, "RISK", null, 0, null, null, null, null, "", false, false, "", ""];
  let cursor = 0, dirty = false, uuid = 0;
  const layoutSetups: Array<() => unknown> = [], layoutCleanups: Array<() => void> = [];
  const auth = { isLoaded: true, isSignedIn: true, userId: scope.expectedClerkActorId };
  const calls: Array<{ input: Request; resolve: (value: unknown) => void; reject: (error: unknown) => void }> = [];
  const review = { isPending: false, mutateAsync: vi.fn((input: Request) => new Promise<unknown>((resolve, reject) => calls.push({ input, resolve, reject }))) };
  const unrelated = { isPending: false, mutateAsync: vi.fn(async () => { throw Error("Unrelated synthetic write forbidden"); }) };
  const nativeScope = { projectId: scope.projectId, organizationId: scope.originalOrganizationId, actorClerkUserId: scope.expectedClerkActorId, actorId: "synthetic-native" };
  const query = <T,>(data: T) => ({ data, error: null, isFetching: false, isPaused: false, refetch: vi.fn(async () => ({ data })) });
  const project = query({ id: scope.projectId, organizationId: scope.originalOrganizationId });
  const organizations = query([{ id: scope.originalOrganizationId, role: "OWNER", seatType: "FULL" }]);
  const history = query({ scope: nativeScope, items: [{ id: "older-job", action: "RISK", caseCount: 20, status: "COMPLETE" }] });
  const state = query(null);
  const completed = vi.fn();
  const props: Props = { projectId: scope.projectId, selectedIds: ids(851), onCompleted: completed };
  const randomUUID = vi.fn(() => `70000000-0000-4000-8000-${String(++uuid).padStart(12, "0")}`);
  const context = vm.createContext({ React, retainAnalysisRequest, useAuth: () => auth,
    useMemo: (callback: () => unknown) => callback(), useEffect: (callback: () => void) => callback(),
    useLayoutEffect: (callback: () => unknown) => {
      layoutSetups.push(callback); const cleanup = callback();
      if (typeof cleanup === "function") layoutCleanups.push(cleanup as () => void);
    },
    useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next: unknown) => { const value = typeof next === "function" ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    trpcReact: { project: { byId: { useQuery: () => project } }, organization: { mine: { useQuery: () => organizations } }, caseAnalysisQueue: {
      review: { useMutation: () => review }, approve: { useMutation: () => unrelated }, cancel: { useMutation: () => unrelated }, requestAdmin: { useMutation: () => unrelated },
      mine: { useQuery: () => history }, byId: { useQuery: () => state },
    } },
    Modal: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children),
    Link: ({ children }: { children: React.ReactNode }) => React.createElement("span", null, children),
    readableMetric: (value: string) => value, crypto: { randomUUID },
  });
  vm.runInContext(compiled, context);
  const actual = (context as unknown as { actual(props: Props): React.ReactElement }).actual;
  function render() {
    for (let attempt = 0; attempt < 10; attempt++) { cursor = 0; dirty = false; const tree = actual(props); if (!dirty) return tree; }
    throw Error("Synthetic hook model did not settle");
  }
  function button(label: string) {
    const found = elements(render()).find(node => node.type === "button" && node.props.children === label);
    if (!found) throw Error(`Missing actual button ${label}`); return found;
  }
  function historyButton() {
    const found = elements(render()).find(node => node.type === "button" && React.Children.toArray(node.props.children).includes("older-job"));
    // Job label is text, not the private native id; identify the sole history
    // button by its actual numeric count and status children instead.
    return found ?? elements(render()).find(node => node.type === "button" && React.Children.toArray(node.props.children).includes(20))!;
  }
  const ack = (index = 0, id = "original-job") => ({ id, projectId: scope.projectId, requestId: calls[index]!.input.requestId, scope: nativeScope });
  const flush = async () => { for (let step = 0; step < 12; step++) await Promise.resolve(); };
  return { hooks, auth, props, calls, review, unrelated, randomUUID, completed, history, render, button, historyButton, ack, flush,
    cleanup: () => layoutCleanups.at(-1)!(), strictSetupAgain: () => layoutSetups.at(-1)!(),
  };
}

describe("actual durable review event ownership (synthetic handlers, no native/provider/spend proof)", () => {
  it("same-tick captured clicks create one UUID/intent and consumed ACK blocks stale callbacks until explicit Back", async () => {
    const h = harness(), stale = h.button("Review selection and cost").props.onClick!;
    stale(); stale();
    expect(h.calls).toHaveLength(1); expect(h.randomUUID).toHaveBeenCalledTimes(1);
    h.calls[0]!.resolve(h.ack()); await h.flush(); h.render();
    expect(h.hooks[3]).toBe("original-job"); expect(h.hooks[5]).toBeNull();
    stale(); expect(h.calls).toHaveLength(1);
    const back = h.button("Back to selections").props.onClick!;
    back(); back(); h.render();
    expect(h.hooks[3]).toBeNull(); stale(); expect(h.calls).toHaveLength(1);
    h.button("Review selection and cost").props.onClick!();
    expect(h.calls).toHaveLength(2); expect(h.calls[1]!.input.requestId).not.toBe(h.calls[0]!.input.requestId);
    h.calls[1]!.reject(Error("Synthetic pending recovery")); await h.flush();
    expect(h.unrelated.mutateAsync).not.toHaveBeenCalled(); expect(h.completed).not.toHaveBeenCalled();
  });
  it("UNKNOWN retries keep original object/UUID/body across selection/action changes and typed later refusal", async () => {
    const h = harness(), stale = h.button("Review selection and cost").props.onClick!;
    stale(); const original = h.calls[0]!.input, body = JSON.stringify(original);
    h.calls[0]!.reject(Error("Synthetic lost ACK")); await h.flush();
    h.props.selectedIds = ids(20, "changed"); h.hooks[2] = "TYPE_DESIGN"; h.render();
    stale(); expect(h.calls).toHaveLength(1);
    const retry = h.button("Retry saved scope").props.onClick!; retry(); retry();
    expect(h.calls).toHaveLength(2); expect(h.calls[1]!.input).toBe(original);
    h.calls[1]!.reject({ data: { code: "BAD_REQUEST" } }); await h.flush(); h.render();
    expect(h.hooks[5]).toBe(original); expect(JSON.stringify(original)).toBe(body);
    h.button("Retry saved scope").props.onClick!(); expect(h.calls[2]!.input).toBe(original);
    h.calls[2]!.resolve(h.ack(2)); await h.flush();
    expect(h.hooks[3]).toBe("original-job"); expect(h.randomUUID).toHaveBeenCalledTimes(1);
  });
  it.each(["close", "access"])("an original ACK after transient%s loss is retained but withheld until explicit same-request recovery", async mode => {
    const h = harness(); h.button("Review selection and cost").props.onClick!(); const original = h.calls[0]!.input;
    if (mode === "close") h.hooks[1] = false; else h.auth.isSignedIn = false;
    h.render();
    if (mode === "close") h.hooks[1] = true; else h.auth.isSignedIn = true;
    h.render(); h.calls[0]!.resolve(h.ack()); await h.flush(); h.render();
    expect(h.hooks[3]).toBeNull(); expect(h.hooks[5]).toBe(original);
    h.button("Retry saved scope").props.onClick!(); expect(h.calls[1]!.input).toBe(original);
    h.calls[1]!.resolve(h.ack(1)); await h.flush(); h.render();
    expect(h.hooks[3]).toBe("original-job"); expect(h.hooks[5]).toBeNull(); expect(h.randomUUID).toHaveBeenCalledTimes(1);
  });
  it("captured history navigation cannot replace a synchronous in-flight review or its eventual ACK", async () => {
    const h = harness(), oldHistory = h.historyButton().props.onClick!;
    h.button("Review selection and cost").props.onClick!(); oldHistory();
    expect(h.hooks[3]).toBeNull(); h.calls[0]!.resolve(h.ack()); await h.flush();
    expect(h.hooks[3]).toBe("original-job");
  });
  it("preacceptance refusal advances ownership before a fresh intent and refuses captured old callbacks", async () => {
    const h = harness(), stale = h.button("Review selection and cost").props.onClick!;
    stale(); h.calls[0]!.reject({ data: { code: "BAD_REQUEST" } }); await h.flush();
    expect(h.hooks[5]).toBeNull(); stale(); expect(h.calls).toHaveLength(1);
    h.button("Review selection and cost").props.onClick!(); expect(h.calls).toHaveLength(2);
    expect(h.calls[1]!.input.requestId).not.toBe(h.calls[0]!.input.requestId);
    h.calls[1]!.reject(Error("Synthetic unknown")); await h.flush();
  });
  it("a mismatched ACK keeps exact recovery ownership instead of publishing an unrelated saved job", async () => {
    const h = harness(); h.button("Review selection and cost").props.onClick!(); const original = h.calls[0]!.input;
    h.calls[0]!.resolve({ ...h.ack(), requestId: "different-request" }); await h.flush(); h.render();
    expect(h.hooks[3]).toBeNull(); expect(h.hooks[5]).toBe(original);
    h.button("Retry saved scope").props.onClick!(); expect(h.calls[1]!.input).toBe(original);
    h.calls[1]!.resolve(h.ack(1)); await h.flush();
    expect(h.hooks[3]).toBe("original-job"); expect(h.randomUUID).toHaveBeenCalledTimes(1);
  });
  it("read refresh failure after a consumed ACK does not reclassify or automatically resubmit the write", async () => {
    const h = harness(), stale = h.button("Review selection and cost").props.onClick!;
    h.history.refetch.mockRejectedValue(Error("Synthetic read-only refresh failure"));
    stale(); h.calls[0]!.resolve(h.ack()); await h.flush(); h.render();
    expect(h.hooks[3]).toBe("original-job"); expect(h.hooks[5]).toBeNull();
    stale(); expect(h.calls).toHaveLength(1); expect(h.randomUUID).toHaveBeenCalledTimes(1);
    expect(h.unrelated.mutateAsync).not.toHaveBeenCalled(); expect(h.completed).not.toHaveBeenCalled();
  });
  it("captured current-ready action refuses actual access loss/closed state before dispatch", () => {
    for (const mode of ["close", "access"] as const) {
      const h = harness(), old = h.button("Review selection and cost").props.onClick!;
      if (mode === "close") h.hooks[1] = false; else h.auth.isSignedIn = false;
      h.render(); old(); expect(h.calls).toEqual([]); expect(h.randomUUID).not.toHaveBeenCalled();
    }
  });
  it.each([false, true])("actual layout cleanup%s withholds late ACK/private refresh and never clears original request", async strictRestart => {
    const h = harness(); h.button("Review selection and cost").props.onClick!(); const original = h.calls[0]!.input;
    h.cleanup(); if (strictRestart) h.strictSetupAgain();
    h.calls[0]!.resolve(h.ack()); await h.flush();
    expect(h.hooks[3]).toBeNull(); expect(h.hooks[5]).toBe(original);
    expect(h.history.refetch).not.toHaveBeenCalled(); expect(h.completed).not.toHaveBeenCalled();
    expect(h.randomUUID).toHaveBeenCalledTimes(1); expect(h.unrelated.mutateAsync).not.toHaveBeenCalled();
  });
});
