import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { describe, expect, it, vi } from "vitest";
import { retainAnalysisRequest } from "./analysis-request-recovery";
import type { RouterInputs, RouterOutputs } from "./trpcReact";
type Props = Parameters<typeof import("../components/DurableCaseAnalysis").DurableCaseAnalysis>[0];
type Input = RouterInputs["caseAnalysisQueue"]["approve"];
type Queue = RouterOutputs["caseAnalysisQueue"]["byId"];
type Element = React.ReactElement<{ children?: React.ReactNode; onClick?: () => void; disabled?: boolean }>;
const source = readFileSync(new URL("../components/DurableCaseAnalysis.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("Analysis.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const compiled = ts.transpileModule(declarations + "\nthis.actual=Analysis;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const scope = { projectId: "synthetic-project", originalOrganizationId: "synthetic-org", expectedClerkActorId: "synthetic-clerk" };
const nativeScope = { projectId: scope.projectId, organizationId: scope.originalOrganizationId, actorClerkUserId: scope.expectedClerkActorId, actorId: "synthetic-native" };
function elements(node: React.ReactNode): Element[] {
  if (!React.isValidElement<{ children?: React.ReactNode }>(node)) return [];
  return [node as Element, ...React.Children.toArray(node.props.children).flatMap(elements)];
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function queue(id: string, count: number, letter: string): Queue {
  return {
    scope: nativeScope, requestId: `10000000-0000-4000-8000-${letter === "a" ? "000000000001" : "000000000002"}`,
    id, projectId: scope.projectId, action: "RISK", status: "REVIEW", scopeHash: letter.repeat(64), maximumCredits: count * 2,
    caseCount: count, reason: null, createdAt: "2026-10-06T12:00:00.000Z", approvedAt: null, cancelledAt: null,
    balance: 10000, canSpend: true, counts: { QUEUED: count }, offset: 0, hasMore: count > 50,
    items: Array.from({ length: Math.min(50, count) }, (_, position) => ({ position, displayId: `TC-${position + 1}`, caseId: `${id}-case-${position}`,
      status: "QUEUED", reason: null, maximumCredits: 2, charged: false, actualCredits: null, refund: null, excessNotCharged: null, meteredAt: null })),
  };
}
function harness() {
  // Actual component/handlers/helpers with synthetic hook/query/deferred RPC
  // boundaries. Typed queue samples are not authenticated/native receipts,
  // database execution, provider traffic, AI transmission or credit charging.
  const hooks: unknown[] = [scope, true, "RISK", "job-a", 0, null, null, null, null, "", true, false, "Synthetic reason", ""];
  let cursor = 0, dirty = false;
  const layoutSetups: Array<() => unknown> = [], layoutCleanups: Array<() => void> = [];
  const auth = { isLoaded: true, isSignedIn: true, userId: scope.expectedClerkActorId };
  const calls: Array<{ input: Input; reply: ReturnType<typeof deferred<Queue>> }> = [];
  const approval = { isPending: false, mutateAsync: vi.fn((input: Input) => { const reply = deferred<Queue>(); calls.push({ input, reply }); return reply.promise; }) };
  const unrelated = { isPending: false, mutateAsync: vi.fn(async () => { throw Error("Unrelated synthetic write forbidden"); }) };
  const query = <T,>(data: T) => ({ data, error: null, isFetching: false, isPaused: false, refetch: vi.fn(async () => ({ data })) });
  const project = query({ id: scope.projectId, organizationId: scope.originalOrganizationId });
  const organizations = query([{ id: scope.originalOrganizationId, role: "OWNER", seatType: "FULL" }]);
  const a = query(queue("job-a", 851, "a")), b = query(queue("job-b", 20, "b"));
  const history = query({ scope: nativeScope, items: [{ id: "job-b", action: "RISK", caseCount: 20, status: "REVIEW" }] });
  const completed = vi.fn(async () => {});
  const props: Props = { projectId: scope.projectId, selectedIds: Array.from({ length: 851 }, (_, index) => `selected-${index}`), onCompleted: completed };
  const randomUUID = vi.fn(() => { throw Error("Approval does not create a request UUID"); });
  const context = vm.createContext({ React, retainAnalysisRequest, useAuth: () => auth,
    useMemo: (callback: () => unknown) => callback(), useEffect: (callback: () => void) => callback(),
    useLayoutEffect: (callback: () => unknown) => { layoutSetups.push(callback); const cleanup = callback(); if (typeof cleanup === "function") layoutCleanups.push(cleanup as () => void); },
    useState: (initial: unknown) => { const index = cursor++; if (!(index in hooks)) hooks[index] = typeof initial === "function" ? initial() : initial;
      return [hooks[index], (next: unknown) => { const value = typeof next === "function" ? next(hooks[index]) : next; if (!Object.is(value, hooks[index])) { hooks[index] = value; dirty = true; } }]; },
    useRef: (initial: unknown) => { const index = cursor++; return hooks[index] ??= { current: initial }; },
    trpcReact: { project: { byId: { useQuery: () => project } }, organization: { mine: { useQuery: () => organizations } }, caseAnalysisQueue: {
      approve: { useMutation: () => approval }, review: { useMutation: () => unrelated }, cancel: { useMutation: () => unrelated }, requestAdmin: { useMutation: () => unrelated },
      mine: { useQuery: () => history }, byId: { useQuery: ({ id }: { id: string }) => id === "job-b" ? b : a },
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
    const found = elements(render()).find(node => node.type === "button" && React.Children.toArray(node.props.children).includes(20));
    if (!found) throw Error("Missing actual history navigation"); return found;
  }
  function ack(index = 0, patch: Partial<Queue> = {}): Queue {
    const input = calls[index]!.input;
    return { ...a.data, id: input.id, scopeHash: input.scopeHash, maximumCredits: input.maximumCredits, status: "QUEUED", approvedAt: "2026-10-06T12:01:00.000Z", ...patch };
  }
  const flush = async () => { for (let step = 0; step < 16; step++) await Promise.resolve(); };
  return { hooks, auth, props, calls, approval, unrelated, randomUUID, completed, a, b, organizations, history, render, button, historyButton, ack, flush,
    cleanup: () => layoutCleanups.at(-1)!(), strictSetupAgain: () => layoutSetups.at(-1)!(),
  };
}

describe("actual original-job approval event ownership (synthetic boundary only)", () => {
  it("same-tick approval and captured history/Back/cancel/admin actions keep one immutable original job intent", async () => {
    const h = harness();
    h.a.data.balance = 0; const admin = h.button("Make a request").props.onClick!;
    h.a.data.balance = 10000;
    const history = h.historyButton().props.onClick!, back = h.button("Back to selections").props.onClick!, cancel = h.button("Cancel remaining work").props.onClick!;
    const stale = h.button("Approve and queue").props.onClick!;
    stale(); stale(); history(); back(); cancel(); admin();
    expect(h.calls).toHaveLength(1); expect(h.hooks[3]).toBe("job-a"); expect(h.unrelated.mutateAsync).not.toHaveBeenCalled();
    const input = h.calls[0]!.input;
    expect(Object.isFrozen(input)).toBe(true); expect(input).toMatchObject({ ...scope, id: "job-a", scopeHash: "a".repeat(64), maximumCredits: 1702, approved: true, allowCaseProcessing: true });
    h.calls[0]!.reply.resolve(h.ack()); await h.flush(); h.render();
    expect(h.hooks[6]).toBeNull(); expect(h.hooks[3]).toBe("job-a"); expect(h.completed).toHaveBeenCalledTimes(1);
    stale(); expect(h.calls).toHaveLength(1); expect(h.randomUUID).not.toHaveBeenCalled();
    h.historyButton().props.onClick!(); h.render(); expect(h.hooks[3]).toBe("job-b");
    stale(); expect(h.calls).toHaveLength(1);
    h.hooks[10] = true; h.button("Approve and queue").props.onClick!();
    expect(h.calls[1]!.input.id).toBe("job-b"); h.calls[1]!.reply.reject(Error("Synthetic UNKNOWN")); await h.flush();
  });
  it("UNKNOWN and later typed refusal preserve the same object/hash/maximum/consent despite changed selection and action", async () => {
    const h = harness(), stale = h.button("Approve and queue").props.onClick!, oldHistory = h.historyButton().props.onClick!;
    stale(); const original = h.calls[0]!.input, body = JSON.stringify(original);
    h.calls[0]!.reply.reject(Error("Synthetic lost ACK")); await h.flush();
    h.props.selectedIds = []; h.hooks[2] = "TYPE_DESIGN"; h.render();
    stale(); oldHistory(); expect(h.calls).toHaveLength(1); expect(h.hooks[3]).toBe("job-a");
    const retry = h.button("Retry identical approval").props.onClick!; retry(); retry();
    expect(h.calls).toHaveLength(2); expect(h.calls[1]!.input).toBe(original);
    h.calls[1]!.reply.reject({ data: { code: "BAD_REQUEST" } }); await h.flush(); h.render();
    expect(h.hooks[6]).toBe(original); expect(h.hooks[10]).toBe(true); expect(JSON.stringify(original)).toBe(body);
    h.button("Retry identical approval").props.onClick!(); expect(h.calls[2]!.input).toBe(original);
    h.calls[2]!.reply.resolve(h.ack(2)); await h.flush();
    expect(h.hooks[6]).toBeNull(); expect(h.calls).toHaveLength(3); expect(h.unrelated.mutateAsync).not.toHaveBeenCalled();
  });
  it.each(["close", "access", "cleanup"])("later typed refusal during%s loss cannot release an earlier UNKNOWN identity or publish another job", async mode => {
    const h = harness(); h.button("Approve and queue").props.onClick!(); const original = h.calls[0]!.input;
    h.calls[0]!.reply.reject(Error("Synthetic earlier UNKNOWN")); await h.flush(); h.render();
    h.button("Retry identical approval").props.onClick!();
    if (mode === "close") { h.hooks[1] = false; h.render(); }
    else if (mode === "access") { h.auth.isSignedIn = false; h.render(); }
    else h.cleanup();
    h.calls[1]!.reply.reject({ data: { code: "CONFLICT" } }); await h.flush();
    expect(h.hooks[6]).toBe(original); expect(h.hooks[3]).toBe("job-a"); expect(h.hooks[10]).toBe(true);
    expect(h.completed).not.toHaveBeenCalled(); expect(h.a.refetch).not.toHaveBeenCalled(); expect(h.history.refetch).not.toHaveBeenCalled();
    if (mode === "close") h.hooks[1] = true; else h.auth.isSignedIn = true;
    h.render(); h.button("Retry identical approval").props.onClick!(); expect(h.calls[2]!.input).toBe(original);
    h.calls[2]!.reply.resolve(h.ack(2)); await h.flush(); expect(h.hooks[6]).toBeNull();
  });
  it.each(["close", "access", "actor"])("late ACK after observed%s loss retains same-job recovery and never publishes or refreshes the old view", async mode => {
    const h = harness(); h.button("Approve and queue").props.onClick!(); const original = h.calls[0]!.input;
    if (mode === "close") h.hooks[1] = false; else if (mode === "access") h.auth.isSignedIn = false; else h.auth.userId = "another-clerk";
    h.render();
    if (mode === "close") h.hooks[1] = true; else if (mode === "access") h.auth.isSignedIn = true; else h.auth.userId = scope.expectedClerkActorId;
    h.render(); h.calls[0]!.reply.resolve(h.ack()); await h.flush(); h.render();
    expect(h.hooks[6]).toBe(original); expect(h.hooks[3]).toBe("job-a"); expect(h.completed).not.toHaveBeenCalled();
    expect(h.a.refetch).not.toHaveBeenCalled(); expect(h.history.refetch).not.toHaveBeenCalled();
    h.button("Retry identical approval").props.onClick!(); expect(h.calls[1]!.input).toBe(original);
    h.calls[1]!.reply.resolve(h.ack(1)); await h.flush(); expect(h.hooks[6]).toBeNull(); expect(h.completed).toHaveBeenCalledTimes(1);
  });
  it.each([false, true])("actual layout cleanup%s/StrictMode setup withholds late ACK and preserves original immutable input", async strictRestart => {
    const h = harness(); h.button("Approve and queue").props.onClick!(); const original = h.calls[0]!.input;
    h.cleanup(); if (strictRestart) h.strictSetupAgain(); h.calls[0]!.reply.resolve(h.ack()); await h.flush();
    expect(h.hooks[6]).toBe(original); expect(h.completed).not.toHaveBeenCalled(); expect(h.a.refetch).not.toHaveBeenCalled(); expect(h.history.refetch).not.toHaveBeenCalled();
  });
  it.each(["id", "hash", "maximum", "actor", "no-approved-time"])("mismatched%s ACK cannot consume or publish another approval", async mode => {
    const h = harness(); h.button("Approve and queue").props.onClick!(); const original = h.calls[0]!.input;
    const patch: Partial<Queue> = mode === "id" ? { id: "job-b" } : mode === "hash" ? { scopeHash: "b".repeat(64) } : mode === "maximum" ? { maximumCredits: 40 } : mode === "actor" ? { scope: { ...nativeScope, actorClerkUserId: "another" } } : { approvedAt: null };
    h.calls[0]!.reply.resolve(h.ack(0, patch)); await h.flush(); h.render();
    expect(h.hooks[6]).toBe(original); expect(h.hooks[3]).toBe("job-a"); expect(h.completed).not.toHaveBeenCalled();
    h.button("Retry identical approval").props.onClick!(); expect(h.calls[1]!.input).toBe(original);
    h.calls[1]!.reply.resolve(h.ack(1)); await h.flush(); expect(h.hooks[6]).toBeNull();
  });
  it("consumed ACK is not reclassified by callback failure or resubmitted by a captured action", async () => {
    const h = harness(), stale = h.button("Approve and queue").props.onClick!;
    h.completed.mockRejectedValue(Error("Synthetic callback failure"));
    stale(); h.calls[0]!.reply.resolve(h.ack()); await h.flush(); h.render();
    expect(h.hooks[6]).toBeNull(); expect(h.hooks[3]).toBe("job-a"); stale(); expect(h.calls).toHaveLength(1);
  });
  it("observed cleanup during an accepted callback prevents subsequent private reads without recreating an UNKNOWN write", async () => {
    const h = harness(), waiting = deferred<void>(); h.completed.mockImplementation(() => waiting.promise);
    const stale = h.button("Approve and queue").props.onClick!; stale(); h.calls[0]!.reply.resolve(h.ack()); await h.flush();
    expect(h.hooks[6]).toBeNull(); expect(h.completed).toHaveBeenCalledTimes(1);
    h.cleanup(); waiting.resolve(); await h.flush();
    expect(h.a.refetch).not.toHaveBeenCalled(); expect(h.history.refetch).not.toHaveBeenCalled(); stale(); expect(h.calls).toHaveLength(1);
  });
  it("first preacceptance refusal requires fresh explicit consent and does not let captured old action resubmit", async () => {
    const h = harness(), stale = h.button("Approve and queue").props.onClick!;
    stale(); h.calls[0]!.reply.reject({ data: { code: "BAD_REQUEST" } }); await h.flush();
    expect(h.hooks[6]).toBeNull(); expect(h.hooks[10]).toBe(false); stale(); expect(h.calls).toHaveLength(1);
    h.render(); expect(h.button("Approve and queue").props.disabled).toBe(true);
    h.hooks[10] = true; h.button("Approve and queue").props.onClick!(); expect(h.calls).toHaveLength(2);
    h.calls[1]!.reply.reject(Error("Synthetic UNKNOWN")); await h.flush();
  });
  it("fresh approval still requires existing consent, credit coverage and full editor seat", () => {
    for (const mode of ["consent", "credits", "seat", "role"] as const) {
      const h = harness();
      if (mode === "consent") h.hooks[10] = false;
      if (mode === "credits") h.a.data.balance = 0;
      if (mode === "seat") h.organizations.data[0]!.seatType = "READ_ONLY";
      if (mode === "role") h.organizations.data[0]!.role = "VIEWER";
      const tree = h.render();
      if (mode !== "seat" && mode !== "role") {
        const button = h.button("Approve and queue"); expect(button.props.disabled).toBe(true); button.props.onClick!();
      } else expect(elements(tree).some(node => node.props.children === "Approve and queue")).toBe(false);
      expect(h.calls).toEqual([]); expect(h.unrelated.mutateAsync).not.toHaveBeenCalled();
    }
  });
});
