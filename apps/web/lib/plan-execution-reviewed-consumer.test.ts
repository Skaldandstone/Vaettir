// Actual component functions and installed React SSR, actual controller/helper;
// current reader completions, SDK, RPC and router are synthetic boundaries.
// Does not certify browser/native transactions or customer execution.
import { readFileSync } from "node:fs";
import { createHash, webcrypto } from "node:crypto";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PlanExecutionReviewedController } from "./plan-execution-reviewed-controller";
import { admitPlanExecutionRead, planExecutionReviewedReadKey, planExecutionCandidateBrowserKey, type PlanExecutionReadSnapshot } from "./plan-execution-reviewed-reader";
import { admitRunStartRead, runStartReviewedReadKey, type RunStartReadSnapshot } from "./manual-run-start-reviewed-reader";
import type { ReviewedRunStartEnvelope } from "./run-start-reviewed-write";
const source = readFileSync(new URL("../components/PlanExecutionReviewed.tsx", import.meta.url), "utf8");
const legacy = readFileSync(new URL("../components/PlanExecutionModal.tsx", import.meta.url), "utf8");
const compile = (text: string) => ts.transpileModule(text, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
const key = "00000000-0000-4000-8000-000000000001", config = "00000000-0000-4000-8000-000000000002";
function planSnapshot(projection: "ACCESS" | "PAGE" = "PAGE", state: "AVAILABLE" | "MISSING" | "ARCHIVED" = "AVAILABLE", candidates = false): PlanExecutionReadSnapshot {
  const scope = { projectId: "p", testPlanId: "plan", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key };
  const input = projection === "PAGE" ? { ...scope, search: "", limit: 50 } : scope;
  const readContext = { projection, requestId: key, requestedKey: planExecutionReviewedReadKey(input, projection), scope: { projectId: "p", testPlanId: "plan", organizationId: "o", actorClerkUserId: "cl", actorId: "n" } };
  const context = { configuration: "Rig\nA", platform: "", build: "", hardwareRevision: "", firmwareVersion: "", rig: "", batchOrLot: "", environment: "", calibrationReference: "", protocolReference: "" };
  const template = { version: 1, testCaseIds: ["second", "first"], configurations: [{ id: config, name: "Rig\nA", context }] };
  const metadata = { id: "candidate", title: "Candidate\n title", displayId: "TC-7", reviewStatus: "APPROVED", archived: false };
  const scopeKey = planExecutionCandidateBrowserKey({ ...scope, search: "", limit: 50 });
  const wire = projection === "ACCESS" ? { readContext, hasFullEditorAccess: true } : { readContext, hasFullEditorAccess: true, plan: { id: "plan", projectId: "p", name: "PRIVATE Plan\n name", status: "ACTIVE" }, rawTemplate: { sqlNull: false, jsonText: JSON.stringify(template) }, template, templateHash: "b".repeat(64), interpretation: "EXACT_SUPPORTED", selected: template.testCaseIds.map(testCaseId => ({ testCaseId, state, metadata: state === "MISSING" ? null : { id: testCaseId, title: "PRIVATE Case\n title", displayId: "", reviewStatus: "APPROVED", archived: state === "ARCHIVED" } })), candidates: candidates ? [metadata] : [], search: "", limit: 50, candidateScopeKey: scopeKey, nextCursor: candidates ? { scopeKey, lastId: "candidate" } : null, limitations: [] };
  const value = admitPlanExecutionRead(wire, input, projection, "cl"); if (!value) throw Error("Complete synthetic plan DTO refused");
  return Object.freeze({ origin: value.origin, observedSessionId: "A", projection, epoch: 1, revision: 1, receivedAt: "2026-10-06T00:00:00.000Z", data: value.data });
}
function profileSnapshot(projection: "ACCESS" | "PREVIEW" = "PREVIEW"): RunStartReadSnapshot {
  const input = { projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedNativeActorId: "n", requestId: key };
  const readContext = { requestId: key, requestedKey: runStartReviewedReadKey(input, projection), projection, scope: { projectId: "p", organizationId: "o", actorId: "n", actorClerkUserId: "cl" } };
  const wire = projection === "ACCESS" ? { readContext, canConfigure: true, canRecover: true } : { readContext, canConfigure: true, canRecover: true, canStart: true, profile: { kind: "SUPPORTED", experience: null, profileHash: "a".repeat(64) }, limitations: [] };
  const value = admitRunStartRead(wire, input, projection, "cl"); if (!value) throw Error("Complete synthetic profile DTO refused");
  return Object.freeze({ origin: value.origin, observedSessionId: "A", projection, epoch: 1, revision: 1, receivedAt: "2026-10-06T00:00:00.000Z", data: value.data });
}
type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown, all: Element[] = []): Element[] { if (React.isValidElement(value)) { const e = value as Element; all.push(e); elements(e.props.children, all); } else if (Array.isArray(value)) value.forEach(v => elements(v, all)); return all; }
function label(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? label((value as Element).props.children) : Array.isArray(value) ? value.map(label).join("") : ""; }
function harness(mode: "PAGE" | "ACCESS" | "legacy" = "PAGE", state: "AVAILABLE" | "MISSING" | "ARCHIVED" = "AVAILABLE") {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; memo?: unknown };
  const slots: Slot[] = [], layouts: Array<() => void> = [], effects: Array<() => void> = [], sent: ReviewedRunStartEnvelope[] = [], reads: unknown[] = [], nativePins: Array<string | null> = [], navigate: string[] = [];
  let cursor = 0, dirty = true, tree: React.ReactNode = null, generation = 0, life = true, sdk = "A", saved = 0;
  let plan: PlanExecutionReadSnapshot | null = planSnapshot(mode === "ACCESS" ? "ACCESS" : "PAGE", state, true), profile: RunStartReadSnapshot | null = profileSnapshot(mode === "ACCESS" ? "ACCESS" : "PREVIEW");
  let planOrigin: PlanExecutionReadSnapshot["origin"] | null = plan.origin;
  const props = { projectId: "p", testPlanId: "plan", id: "plan", organizationId: "o", open: true, onClose: () => { props.open = false; dirty = true; }, onSaved: () => { saved++; }, legacyBlocked: false, legacyHasDraft: false };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  function effect(fn: () => unknown, deps: readonly unknown[] | undefined, layout: boolean) { const id = cursor++, slot = slots[id] ??= {}; if (!same(slot.deps, deps)) (layout ? layouts : effects).push(() => { slot.cleanup?.(); slot.deps = deps; const cleanup = fn(); slot.cleanup = typeof cleanup === "function" ? cleanup as () => void : undefined; }); }
  const hooks = { ...React,
    useState: (init: unknown) => { const id = cursor++; if (!slots[id]) slots[id] = { value: typeof init === "function" ? (init as () => unknown)() : init }; return [slots[id]!.value, (next: unknown) => { const slot = slots[id]!, v = typeof next === "function" ? (next as (x: unknown) => unknown)(slot.value) : next; if (!Object.is(v, slot.value)) { slot.value = v; dirty = true; } }]; },
    useRef: (init: unknown) => { const id = cursor++; slots[id] ??= { value: { current: init } }; return slots[id]!.value; },
    useId: () => { cursor++; return "legacy-id"; },
    useMemo: (fn: () => unknown, deps: readonly unknown[]) => { const id = cursor++, slot = slots[id] ??= {}; if (!same(slot.deps, deps)) { slot.memo = fn(); slot.deps = deps; } return slot.memo; },
    useEffect: (fn: () => unknown, deps: readonly unknown[] | undefined) => effect(fn, deps, false), useLayoutEffect: (fn: () => unknown, deps: readonly unknown[] | undefined) => effect(fn, deps, true),
  };
  const ack = (input: ReviewedRunStartEnvelope) => ({ mode: "START", currentScope: { projectId: "p", organizationId: "o", actorId: input.expectedNativeActorId, actorClerkUserId: "cl" }, idempotencyKey: input.request.idempotencyKey, legacyAck: { testRunId: `manual_${createHash("sha256").update(JSON.stringify(["p", input.expectedNativeActorId, input.request.idempotencyKey])).digest("hex")}`, originalOrganizationId: "o", expectedClerkActorId: "cl", idempotencyKey: input.request.idempotencyKey }, historicalOuterProvenance: "UNRECORDED", interpretation: "LEGACY_NORMALIZED_NOT_RAW_LOSSLESS" });
  let send: (input: ReviewedRunStartEnvelope) => Promise<unknown> = async input => ack(input);
  const utils = { planExecutionReads: { access: { fetch: () => { throw Error("Unexpected non-synthetic transport"); } }, page: { fetch: () => { throw Error("Unexpected non-synthetic transport"); } } }, manualRunStartReviewed: { access: { fetch: () => {} }, preview: { fetch: () => {} } } };
  const inert = () => ({ mutateAsync: () => { throw Error("Legacy mutation must remain inert"); } });
  const oldQuery = (_input: unknown, options: { enabled: boolean }) => { expect(options.enabled).toBe(false); return { data: { PRIVATE: "must not seed" } }; };
  const api = { useUtils: () => utils, testPlans: { executionTemplate: { useQuery: oldQuery }, saveExecutionTemplate: { useMutation: inert } }, project: { experience: { useQuery: oldQuery } }, manualExecution: { start: { useMutation: inert } }, manualRunStartReviewed: { start: { useMutation: () => ({ mutateAsync: (input: ReviewedRunStartEnvelope) => { sent.push(input); return send(input); } }) } } };
  const planReader = () => { const captured = plan, stamp = generation; const current = () => life && props.open && !props.legacyBlocked && stamp === generation && captured === plan && sdk === captured?.observedSessionId ? captured : null;
    return { origin: planOrigin, snapshot: captured, current, refresh: () => { reads.push("planACCESS"); plan = null; generation++; dirty = true; return true; }, readPage: (input: unknown) => { if (!current()) return false; reads.push(input); plan = null; generation++; dirty = true; return true; }, error: null };
  };
  const profileReader = (_p: string, _o: string, _adapter: unknown, options: { originalNativeActorId: string | null }) => { nativePins.push(options.originalNativeActorId); const captured = profile, stamp = generation;
    const current = () => life && props.open && !props.legacyBlocked && stamp === generation && captured === profile && sdk === captured?.observedSessionId && options.originalNativeActorId === captured?.origin.nativeActorId ? captured : null;
    return { origin: captured?.origin ?? null, snapshot: captured, current, refresh: () => { reads.push("profileACCESS"); profile = null; generation++; dirty = true; return true; }, readPreview: () => { if (!current()) return false; reads.push("profilePREVIEW"); profile = null; generation++; dirty = true; return true; }, error: null };
  };
  const modules: Record<string, unknown> = { react: hooks, "next/navigation": { useRouter: () => ({ push: (path: string) => navigate.push(path) }) }, "@/lib/trpcReact": { trpcReact: api }, "@/lib/use-project-permissions": { useProjectPermissions: () => ({ canEdit: true }) }, "@/lib/use-plan-execution-reviewed-access": { usePlanExecutionReviewedAccess: planReader }, "@/lib/use-manual-run-start-reviewed-access": { useManualRunStartReviewedAccess: profileReader }, "@/lib/plan-execution-reviewed-controller": { PlanExecutionReviewedController }, "./Modal": { Modal: (p: { open: boolean; children: React.ReactNode }) => p.open ? React.createElement("div", {}, p.children) : null }, "./PlanExecutionReviewed": { PlanExecutionReviewed: (p: { legacyBlocked: boolean; legacyHasDraft: boolean }) => React.createElement("div", {}, p.legacyBlocked ? "Opaque retained legacy request" : p.legacyHasDraft ? "Opaque retained legacy draft" : "Reviewed child") } };
  const exports: Record<string, (p: typeof props) => React.ReactNode> = {};
  new Function("require", "exports", "React", compile(mode === "legacy" ? legacy : source))((name: string) => { if (!(name in modules)) throw Error(`Unexpected production import ${name}`); return modules[name]; }, exports, React);
  function render(commit = true) { cursor = 0; dirty = false; layouts.length = 0; effects.length = 0; tree = exports[mode === "legacy" ? "PlanExecutionModal" : "PlanExecutionReviewed"]!(props); if (commit) { layouts.splice(0).forEach(fn => fn()); effects.splice(0).forEach(fn => fn()); } }
  function settle() { for (let i = 0; i < 40; i++) { render(); if (!dirty) return; } throw Error("Actual consumer render/layout loop"); }
  function button(text: string) { const b = elements(tree).find(e => e.type === "button" && label(e.props.children).includes(text)); if (!b) throw Error(`Missing ${text}: ${label(tree)}`); return b; }
  function click(text: string) { const b = button(text); expect(b.props.disabled).not.toBe(true); if (b.props.type === "submit") { const form = elements(tree).find(e => e.type === "form"); if (!form) throw Error("Actual submit form absent"); (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: () => {} }); } else (b.props.onClick as () => void)(); settle(); }
  async function flush() { for (let i = 0; i < 25; i++) { await new Promise(resolve => setTimeout(resolve, 2)); settle(); } }
  settle();
  return { props, sent, reads, nativePins, navigate, render, settle, button, click, flush, get tree() { return tree; }, html: () => renderToStaticMarkup(tree), get saved() { return saved; }, ack, setSend: (fn: typeof send) => { send = fn; }, sdk: (id: string) => { sdk = id; }, complete: (p: "ACCESS" | "PAGE", role: "ACCESS" | "PREVIEW" = "PREVIEW") => { plan = planSnapshot(p); planOrigin = plan.origin; profile = profileSnapshot(role); generation++; dirty = true; settle(); }, revoke: () => { plan = null; profile = null; generation++; dirty = true; }, clearBootstrap: () => { planOrigin = null; plan = null; profile = null; generation++; dirty = true; }, recoverAccess: () => { plan = null; profile = profileSnapshot("ACCESS"); generation++; dirty = true; settle(); }, select: () => { const input = elements(tree).find(e => e.type === "input" && e.props.type === "radio"); if (!input) throw Error("No configuration choice"); (input.props.onChange as () => void)(); settle(); }, seed: (body: unknown, receipt: string | null = null) => { slots[13]!.value = body; slots[14]!.value = receipt; settle(); }, get legacyBody() { return slots[13]?.value; }, unmount: () => { life = false; slots.forEach(slot => slot?.cleanup?.()); } };
}
beforeEach(() => vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID: () => key }));
afterEach(() => vi.unstubAllGlobals());
it("ACCESS is nonprivate and never silently fetches template/profile or approves a new run", () => { const h = harness("ACCESS"); expect(h.html()).not.toContain("PRIVATE"); expect(h.reads).toEqual([]); expect(h.button("Review this saved").props.disabled).toBe(true); h.click("Read saved template"); expect(h.reads).toEqual([{ search: "", limit: 50 }]); });
it("actual renderer preserves ordered full saved identities, multiline/explicit empty context and collapsed exact raw disclosure", () => { const h = harness(), html = h.html(); expect(html).toContain("PRIVATE Plan\n name"); expect(html.indexOf("second</code>")).toBeLessThan(html.indexOf("first</code>")); expect(html).toContain("Rig\nA"); expect(html).toContain("explicit empty text"); expect(html).toContain("no display ID"); expect(html).not.toContain("<details open"); expect(html).toContain("Save reusable template (reviewed native-save protocol unavailable)"); expect(h.sent).toEqual([]); });
it.each(["MISSING", "ARCHIVED"] as const)("%s remains a stable selected identity, not a smaller executable denominator", state => { const h = harness("PAGE", state); expect(h.html()).toContain(state); expect(h.html()).toContain("Complete saved selection (2)"); h.select(); expect(h.button("Review this saved").props.disabled).toBe(true); expect(h.sent).toEqual([]); });
it("initial native pin is explicit null before Plan ACCESS and N only after completed original scope", () => { const h = harness(); h.clearBootstrap(); h.settle(); expect(h.nativePins.at(-1)).toBe(null); h.complete("ACCESS", "ACCESS"); expect(h.nativePins.at(-1)).toBe("n"); expect(h.html()).not.toContain("PRIVATE"); });
it("actual explicit review freezes exact saved order/body; duplicate click cannot send twice; known receipt never auto-navigates", async () => { const h = harness(); h.select(); h.click("Review this saved"); expect(h.sent).toEqual([]); const old = h.button("Confirm and start"); (old.props.onClick as () => void)(); (old.props.onClick as () => void)(); await h.flush(); expect(h.sent).toHaveLength(1); expect(h.sent[0]).toMatchObject({ expectedNativeActorId: "n", request: { testCaseIds: ["second", "first"], planReference: { testPlanId: "plan", configurationId: config } } }); expect(Object.isFrozen(h.sent[0]!.request)).toBe(true); expect(h.navigate).toEqual([]); expect(h.saved).toBe(1); h.click("Open the confirmed"); expect(h.navigate).toHaveLength(1); });
it("UNKNOWN survives close/reopen; current original FULL ACCESS replays the same outer object without a new template/cohort", async () => { const h = harness(); h.setSend(async () => { throw Error("PRIVATE provider error"); }); h.select(); h.click("Review this saved"); h.click("Confirm and start"); await h.flush(); const held = h.sent[0]; h.props.open = false; h.settle(); expect(h.html()).toBe(""); h.props.open = true; h.recoverAccess(); h.click("Retry exact held"); await h.flush(); expect(h.sent[1]).toBe(held); expect(h.html()).not.toContain("PRIVATE"); expect(h.html()).not.toContain("provider error"); expect(h.button("Discard unsent").props.disabled).toBe(true); });
it("SDK change before hook commit blocks old send/navigation and withholds private fields", async () => { const h = harness(); h.select(); h.click("Review this saved"); const old = h.button("Confirm and start"); h.sdk("B"); (old.props.onClick as () => void)(); await h.flush(); expect(h.sent).toEqual([]); expect(h.html()).not.toContain("PRIVATE"); h.sdk("A"); h.revoke(); h.settle(); expect(h.html()).not.toContain("PRIVATE"); });
it("late exact ACK after close settles privately without parent refresh and needs completed current original read to publish", async () => { const h = harness(); let finish!: () => void; h.setSend(input => new Promise(resolve => { finish = () => resolve(h.ack(input)); })); h.select(); h.click("Review this saved"); h.click("Confirm and start"); h.props.open = false; h.revoke(); h.settle(); finish(); await h.flush(); expect(h.saved).toBe(0); expect(h.html()).toBe(""); h.props.open = true; h.complete("PAGE", "ACCESS"); expect(h.sent).toHaveLength(1); expect(h.button("Retry exact held").props.disabled).toBe(true); h.click("Open the confirmed"); expect(h.navigate).toHaveLength(1); });
it("close before layout and old posted page handler cannot dispatch, select, or read another page", () => { const h = harness(), old = h.button("Next candidate"); h.props.open = false; h.render(false); (old.props.onClick as () => void)(); expect(h.reads).toEqual([]); expect(h.sent).toEqual([]); expect(h.html()).toBe(""); });
it("candidate paging sends exact cursor and no automatic case-selection mutation", () => { const h = harness(); h.click("Next candidate"); expect(h.reads[0]).toMatchObject({ search: "", limit: 50, cursor: { lastId: "candidate" } }); expect(h.sent).toEqual([]); });
it.each([false, true])("original legacy UNKNOWN/known=%s owner slots remain byte-for-byte opaque across close", known => { const h = harness("legacy"), body = { idempotencyKey: key, projectId: "p", testCaseIds: ["first"], executionContext: { environment: "PRIVATE\n exact " } }, before = JSON.stringify(body); h.seed(body, known ? "PRIVATE_old_target" : null); expect(h.legacyBody).toBe(body); expect(h.html()).toContain("Opaque retained legacy request"); expect(h.html()).not.toContain("PRIVATE"); h.props.open = false; h.settle(); h.props.open = true; h.settle(); expect(JSON.stringify(h.legacyBody)).toBe(before); expect(Object.hasOwn(body, "expectedNativeActorId")).toBe(false); expect(h.sent).toEqual([]); });
it("original hook/state prefix AST is retained; all old private reads/dispatches/seeds are inert", () => {
  // Independently captured ORIGINAL bfad309 ordered hook slots/initializers.
  // Never read current HEAD: after cutover that would compare the new shell to
  // itself and stop protecting original held legacy state.
  const original = [
    ["permission", "useProjectPermissions", ""],
    ["[serverSearch,setServerSearch]", "useState", '""'],
    ["[cursor,setCursor]", "useState", "undefined"],
    ["[previousCursors,setPreviousCursors]", "useState", "[]"],
    ["query", "trpcReact.testPlans.executionTemplate.useQuery", ""],
    ["profileQuery", "trpcReact.project.experience.useQuery", ""],
    ["saveMutation", "trpcReact.testPlans.saveExecutionTemplate.useMutation", ""],
    ["startMutation", "trpcReact.manualExecution.start.useMutation", ""],
    ["[baseline,setBaseline]", "useState", "null"],
    ["[profileBaseline,setProfileBaseline]", "useState", "null"],
    ["[draft,setDraft]", "useState", "emptyTemplate"],
    ["[screen,setScreen]", "useState", '"cases"'],
    ["[search,setSearch]", "useState", '""'],
    ["[activeId,setActiveId]", "useState", '""'],
    ["[selectedConfiguration,setSelectedConfiguration]", "useState", '""'],
    ["[error,setError]", "useState", "null"],
    ["[busy,setBusy]", "useState", "false"],
    ["[saved,setSaved]", "useState", "false"],
    ["[runAttempt,setRunAttempt]", "useState", "null"],
    ["[startedRunId,setStartedRunId]", "useState", "null"],
    ["[definitiveRejection,setDefinitiveRejection]", "useState", "false"],
    ["[everAmbiguous,setEverAmbiguous]", "useState", "false"],
    ["[selectedCaseLabels,setSelectedCaseLabels]", "useState", "{}"],
    ["[refreshCandidate,setRefreshCandidate]", "useState", "null"],
    ["prefix", "useId", ""],
    ["heading", "useRef", "null"],
  ].map(([name, call, initial]) => ({ name, call, initial }));
  function prefix(text: string) { const file = ts.createSourceFile("modal.tsx", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), fn = file.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === "PlanExecutionModal"); if (!fn?.body) throw Error("Original owner absent"); return fn.body.statements.filter(ts.isVariableStatement).flatMap(s => [...s.declarationList.declarations]).filter(d => d.initializer && ts.isCallExpression(d.initializer) && /^(useState|useId|useRef|useProjectPermissions|trpcReact\.)/.test(d.initializer.expression.getText(file))).map(d => ({ name: d.name.getText(file).replace(/\s+/g, ""), call: (d.initializer as ts.CallExpression).expression.getText(file), initial: /use(State|Id|Ref)/.test((d.initializer as ts.CallExpression).expression.getText(file)) ? (d.initializer as ts.CallExpression).arguments.map(a => a.getText(file).replace(/\s+/g, "")).join(",") : "" })); }
  expect(prefix(legacy)).toEqual(original);
  expect(legacy.match(/enabled: false/g)).toHaveLength(2); expect(legacy).not.toMatch(/\.mutateAsync\(|\.refetch\(|query\.data|profileQuery\.data/); expect(legacy).not.toContain("setRunAttempt(null)"); expect(legacy).not.toContain("setStartedRunId(null)");
});
