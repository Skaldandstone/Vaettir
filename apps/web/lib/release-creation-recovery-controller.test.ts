import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { releaseCreationIdentity } from "@vaettir/api/src/services/releaseCreationSchema";
import type { RouterInputs } from "./trpcReact";
import { currentSessionScope, sameAuthScope } from "./auth-query-cache";
import { RunHistoryRenderGuard } from "./run-history-reader";
import { retainAnalysisRequest } from "./analysis-request-recovery";
import * as planning from "./release-planning-draft";

// Actual page/helpers/submit and real request identity hashing; synthetic
// hook commits/RPC responses only, not server writes or native SDK acceptance.
const source = readFileSync(new URL("../app/projects/[projectId]/releases/page.tsx", import.meta.url), "utf8"),
  ast = ts.createSourceFile("release.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  code = ts.transpileModule(ast.statements.filter(node => !ts.isImportDeclaration(node)).map(node =>
    ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export\s+(?:default\s+)?/gm, "")).join("\n") +
    "\nthis.page=ReleasesPage;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type Input = RouterInputs["releases"]["create"];
type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"], reject!: Deferred<T>["reject"];
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; }); return { promise, resolve, reject };
}
function ack(input: Input) {
  return { id: releaseCreationIdentity(input, "native-synthetic").releaseId, name: input.name, requestId: input.requestId,
    projectId: input.projectId, originalOrganizationId: input.originalOrganizationId, expectedClerkActorId: input.expectedClerkActorId };
}
type Props = { children?: React.ReactNode; onClick?: () => void; onChange?: (event: { target: { value: string; checked?: boolean } }) => void;
  onSubmit?: () => Promise<void>; onStepChange?: (step: number) => void; onCancel?: () => void; onClose?: () => void;
  onToggle?: (value: string) => void; retainedRequest?: Input | null; open?: boolean; placeholder?: string; type?: string; value?: string; title?: string; step?: number; canContinue?: boolean };
type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
function nodes(node: unknown): React.ReactElement<Props>[] {
  if (Array.isArray(node)) return node.flatMap(nodes);
  if (!React.isValidElement<Props>(node)) return []; return [node, ...nodes(node.props.children)];
}
function harness() {
  const auth = { isLoaded: true, isSignedIn: true, userId: "clerk", sessionId: "A" }, params = { projectId: "project-A" },
    access = { canWrite: true, ready: true, origin: { organizationId: "organization", clerkActorId: "clerk" }, refresh: vi.fn() },
    sdkListeners = new Set<() => void>(), sdk = { loaded: true, session: { id: "A", user: { id: "clerk" } } as null | { id: string; user: { id: string } },
      addListener: (listener: () => void) => { sdkListeners.add(listener); return () => sdkListeners.delete(listener); } },
    requests: { input: Input; deferred: Deferred<ReturnType<typeof ack>> }[] = [], invalidated = vi.fn();
  const slots: Slot[] = [], effects = new Map<number, () => void>();
  let cursor = 0, dirty = false, unmounted = false, lateSetters = 0, uuid = 0, tree: React.ReactElement;
  const same = (a: unknown[], b?: unknown[]) => !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const Modal = ({ children, open }: Props) => React.createElement("section", { hidden: !open }, children),
    CreationWizard = ({ children }: Props) => React.createElement("section", null, children),
    ReleaseDraftEvidenceReview = () => null, WizardChoices = () => null;
  const mutateAsync = vi.fn((input: Input) => { const request = { input, deferred: deferred<ReturnType<typeof ack>>() }; requests.push(request); return request.deferred.promise; });
  const context = vm.createContext({ React, Date, window: { Clerk: sdk }, crypto: { randomUUID: () => `6ee2ec04-4d34-40bf-b0e9-${String(++uuid).padStart(12, "0")}` },
    useParams: () => params, useAuth: () => auth, useProjectPermissions: () => ({ canEdit: true }), useManualExecutionAccess: () => access,
    currentSessionScope, sameAuthScope, RunHistoryRenderGuard, retainAnalysisRequest, ...planning,
    Modal, CreationWizard, ReleaseDraftEvidenceReview, WizardChoices,
    ReadinessBadge: () => null, TrendChart: () => null, ScoreRing: () => null, DistributionBar: () => null, RepositoryReleaseDiscovery: () => null,
    trpcReact: { useUtils: () => ({ releases: { list: { invalidate: invalidated }, trend: { invalidate: invalidated } }, testPlans: { list: { invalidate: invalidated } } }),
      releases: { create: { useMutation: () => ({ mutateAsync, isPending: false }) }, list: { useQuery: () => ({ data: [], isLoading: false, error: null }) }, trend: { useQuery: () => ({ data: [] }) } },
      testPlans: { list: { useQuery: () => ({ data: [{ id: "plan", name: "Existing synthetic plan", releaseId: null, acceptanceCriteria: [] }], isLoading: false }) } } },
    useState: (initial: unknown) => { const at = cursor++; if (!slots[at]) slots[at] = { value: typeof initial === "function" ? initial() : initial };
      return [slots[at]!.value, (next: unknown) => { if (unmounted) lateSetters++; const value = typeof next === "function" ? next(slots[at]!.value) : next;
        if (!Object.is(value, slots[at]!.value)) { slots[at]!.value = value; dirty = true; } }]; },
    useMemo: (make: () => unknown, deps: unknown[]) => { const at = cursor++; if (!slots[at] || !same(deps, slots[at]!.deps)) slots[at] = { value: make(), deps }; return slots[at]!.value; },
    useLayoutEffect: (effect: () => (() => void) | void, deps: unknown[]) => { const at = cursor++; if (!slots[at] || !same(deps, slots[at]!.deps)) {
      const prior = slots[at]; slots[at] = { ...prior, deps }; effects.set(at, () => { prior?.cleanup?.(); slots[at]!.cleanup = effect() || undefined; });
    } },
  });
  vm.runInContext(code, context); const page = context.page as () => React.ReactElement;
  function render(commit = true): string {
    cursor = 0; dirty = false; tree = page(); if (dirty) return render(commit);
    if (commit) { const pending = [...effects.values()]; effects.clear(); for (const effect of pending) effect(); }
    return renderToStaticMarkup(tree);
  }
  function find(predicate: (node: React.ReactElement<Props>) => boolean) {
    const node = nodes(tree).find(predicate); if (!node) throw Error("Missing actual page control"); return node;
  }
  const wizard = () => find(node => node.type === CreationWizard).props,
    modal = () => find(node => node.type === Modal).props,
    button = (text: string) => find(node => node.type === "button" && renderToStaticMarkup(node).includes(text)).props.onClick!,
    setName = (value: string) => { find(node => node.type === "input" && node.props.placeholder === "For example: Release 1.2").props.onChange!({ target: { value } }); render(); },
    retained = () => find(node => node.type === ReleaseDraftEvidenceReview).props.retainedRequest;
  function open() { button("New release")(); render(); }
  function step(value: number) { wizard().onStepChange!(value); render(); }
  function configure(name = "Ordinary release") {
    open(); setName(name);
    find(node => node.type === "input" && node.props.type === "date").props.onChange!({ target: { value: "2026-10-17" } });
    find(node => node.type === WizardChoices).props.onToggle!("Regular release"); render(); step(1);
    find(node => node.type === "input" && node.props.placeholder?.endsWith("quality plan") === true).props.onChange!({ target: { value: "Exact checks" } }); render();
    find(node => node.type === "input" && node.props.type === "checkbox").props.onChange!({ target: { value: "", checked: true } }); render();
    for (let i = 0; i < 2; i++) {
      find(node => node.type === "textarea").props.onChange!({ target: { value: " \n Exact duplicate criterion \t" } }); render(); button("Add criterion")(); render();
    }
    step(2);
  }
  function sdkChange(id: string | null) { sdk.session = id ? { id, user: { id: auth.userId } } : null; for (const listener of sdkListeners) listener(); }
  function abandon(change: () => void, restore: () => void) {
    const committed = slots.map(slot => ({ ...slot })); change(); render(false); restore(); slots.splice(0, slots.length, ...committed); effects.clear();
  }
  function unmount() { unmounted = true; for (const slot of slots) slot.cleanup?.(); }
  render(); configure();
  return { auth, access, params, requests, mutateAsync, invalidated, render, wizard, modal, button, retained, setName, open, step, configure, sdkChange, abandon, unmount, get lateSetters() { return lateSetters; } };
}
async function reject(h: ReturnType<typeof harness>, index: number, task: Promise<void>, error: unknown = Error("synthetic uncertain transport")) {
  h.requests[index]!.deferred.reject(error); await task;
}
async function confirm(h: ReturnType<typeof harness>, index: number, task: Promise<void>) {
  h.requests[index]!.deferred.resolve(ack(h.requests[index]!.input)); await task;
}

it("same-tick competing callbacks own exactly one original UUID/body and uncertain stale closure retries that same body", async () => {
  const h = harness(), old = h.wizard().onSubmit!, first = old(); await old();
  expect(h.requests).toHaveLength(1);
  const request = h.requests[0]!.input, original = releaseCreationIdentity(request, "native-synthetic");
  await reject(h, 0, first); const retry = old(); expect(h.requests).toHaveLength(2);
  expect(h.requests[1]!.input).toBe(request);
  expect(releaseCreationIdentity(h.requests[1]!.input, "native-synthetic")).toEqual(original);
  expect(request.testPlanIds).toEqual(["plan"]); expect(request.goals).toEqual(["Regular release"]);
  expect(request.newPlan).toEqual({ name: "Exact checks", criteria: [" \n Exact duplicate criterion \t", " \n Exact duplicate criterion \t"], wordingMode: "EXACT" });
  expect(request.targetDate).toBeInstanceOf(Date); expect(Object.isFrozen(request)).toBe(true); expect(Object.isFrozen(request.newPlan?.criteria)).toBe(true);
  await confirm(h, 1, retry); await old(); expect(h.requests).toHaveLength(2); expect(h.invalidated).toHaveBeenCalledTimes(3); h.unmount();
});
it("success consumes old Submit and Close, clears only owned draft, and a new current draft can create a fresh request", async () => {
  const h = harness(), old = h.wizard().onSubmit!, close = h.modal().onClose!, task = old();
  await confirm(h, 0, task); await old(); expect(h.requests).toHaveLength(1); h.render();
  h.open(); h.step(0); h.setName("Next release"); h.step(2); close(); h.render(); expect(h.modal().open).toBe(true);
  const next = h.wizard().onSubmit!(); expect(h.requests).toHaveLength(2); expect(h.requests[1]!.input.requestId).not.toBe(h.requests[0]!.input.requestId);
  await confirm(h, 1, next); h.unmount();
});
it("first definitive refusal releases only its owned request and stale Submit cannot mint its replacement", async () => {
  const h = harness(), old = h.wizard().onSubmit!, task = old();
  await reject(h, 0, task, { data: { code: "BAD_REQUEST" } }); await old(); expect(h.requests).toHaveLength(1);
  h.render(); expect(h.retained()).toBeNull(); const fresh = h.wizard().onSubmit!();
  expect(h.requests[1]!.input.requestId).not.toBe(h.requests[0]!.input.requestId); await confirm(h, 1, fresh); h.unmount();
});
it.each(["BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"])("uncertain original survives later %s forever until exact receipt recovery", async code => {
  const h = harness(), old = h.wizard().onSubmit!, first = old(); await reject(h, 0, first); h.render();
  const second = h.wizard().onSubmit!(); await reject(h, 1, second, { data: { code } }); h.render();
  expect(h.retained()).toBe(h.requests[0]!.input); const third = old();
  expect(h.requests.map(request => request.input.requestId)).toEqual(Array(3).fill(h.requests[0]!.input.requestId));
  await confirm(h, 2, third); h.unmount();
});
it("same-organization project switch with a valid old ACK cannot clear the currently displayed draft or publish invalidations", async () => {
  const h = harness(), old = h.wizard().onSubmit!, first = old();
  h.params.projectId = "project-B"; h.render(); h.step(0); h.setName("B draft retained"); h.step(2);
  await confirm(h, 0, first); expect(h.invalidated).not.toHaveBeenCalled(); expect(h.render()).toContain("B draft retained");
  expect(h.retained()).toBe(h.requests[0]!.input); await h.wizard().onSubmit!(); expect(h.requests).toHaveLength(1);
  h.params.projectId = "project-A"; h.render(); const retry = h.wizard().onSubmit!();
  expect(h.requests[1]!.input).toBe(h.requests[0]!.input); await confirm(h, 1, retry); h.unmount();
});
it("close/reopen preserves original receipt and cannot let the old ACK reset the reopened draft", async () => {
  const h = harness(), first = h.wizard().onSubmit!(); h.modal().onClose!(); h.render(); h.open();
  await confirm(h, 0, first); expect(h.invalidated).not.toHaveBeenCalled(); expect(h.render()).toContain("Ordinary release");
  expect(h.retained()).toBe(h.requests[0]!.input); const recovery = h.wizard().onSubmit!();
  expect(h.requests[1]!.input.requestId).toBe(h.requests[0]!.input.requestId); await confirm(h, 1, recovery); h.unmount();
});
it("SDK A-B-A observed without hook updates retires ACK publication, not the original request", async () => {
  const h = harness(), first = h.wizard().onSubmit!(); h.sdkChange("B"); h.sdkChange("A"); await confirm(h, 0, first);
  expect(h.invalidated).not.toHaveBeenCalled(); h.render(); const recovery = h.wizard().onSubmit!();
  expect(h.requests[1]!.input).toBe(h.requests[0]!.input); await confirm(h, 1, recovery); h.unmount();
});
it("abandoned changed-project render rollback cannot restore an old ACK publication token", async () => {
  const h = harness(), first = h.wizard().onSubmit!();
  h.abandon(() => { h.params.projectId = "project-B"; }, () => { h.params.projectId = "project-A"; }); h.render(); await confirm(h, 0, first);
  expect(h.invalidated).not.toHaveBeenCalled(); expect(h.render()).toContain("Ordinary release"); const recovery = h.wizard().onSubmit!();
  expect(h.requests[1]!.input).toBe(h.requests[0]!.input); await confirm(h, 1, recovery); h.unmount();
});
it("access loss and first refusal remain unknown after observed loss rather than releasing the receipt", async () => {
  const h = harness(), first = h.wizard().onSubmit!(); h.access.canWrite = false; h.render();
  await reject(h, 0, first, { data: { code: "CONFLICT" } }); h.access.canWrite = true; h.render();
  expect(h.retained()).toBe(h.requests[0]!.input); const recovery = h.wizard().onSubmit!();
  expect(h.requests[1]!.input).toBe(h.requests[0]!.input); await confirm(h, 1, recovery); h.unmount();
});
it("wrong ACK retains original identity, and unmount prevents late reset or state/error publication", async () => {
  const h = harness(), first = h.wizard().onSubmit!(); h.requests[0]!.deferred.resolve({ ...ack(h.requests[0]!.input), projectId: "foreign" }); await first;
  h.render(); expect(h.retained()).toBe(h.requests[0]!.input); const recovery = h.wizard().onSubmit!(); h.unmount();
  await confirm(h, 1, recovery); expect(h.invalidated).not.toHaveBeenCalled(); expect(h.lateSetters).toBe(0);
});
it("unavailable browser session explains the blocked creation action without minting a UUID or losing local drafts", async () => {
  const h = harness(), old = h.wizard().onSubmit!();
  // Finish the first admitted request; the next current draft has no receipt.
  await confirm(h, 0, old); h.render(); h.open(); h.step(0); h.setName("Waiting draft"); h.step(2);
  h.sdkChange(null); expect(h.render()).toContain("active browser session must match");
  expect(h.wizard().canContinue).toBe(false); await h.wizard().onSubmit!(); expect(h.requests).toHaveLength(1);
  h.sdkChange("A"); h.render(); expect(h.wizard().canContinue).toBe(true);
  const current = h.wizard().onSubmit!(); expect(h.requests[1]!.input.name).toBe("Waiting draft"); await confirm(h, 1, current); h.unmount();
});
