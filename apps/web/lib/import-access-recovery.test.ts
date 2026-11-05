// Actual component handlers with synthetic hooks/RPC; no browser, AI or customer writes.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import ts from "typescript";
import { it, expect } from "vitest";

type Element = React.ReactElement<Record<string, unknown>>;
function nodes(value: unknown): Element[] {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!React.isValidElement(value)) return [];
  const element = value as Element;
  return [element, ...nodes(element.props.children)];
}
function text(value: unknown): string {
  if (Array.isArray(value)) return value.map(text).join("");
  if (React.isValidElement(value)) return text((value as Element).props.children);
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}
function mount(file: string, name: string, imports: Record<string, unknown>, props: Record<string, unknown>) {
  let cursor = 0, tree: React.ReactNode;
  const values: unknown[] = [];
  const effects: { deps: unknown[]; cleanup?: () => void }[] = [];
  let pending: (() => void)[] = [];
  const state = (initial: unknown) => {
    const index = cursor++;
    if (!(index in values)) values[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [values[index], (next: unknown) => { values[index] = typeof next === "function" ? (next as (before: unknown) => unknown)(values[index]) : next; }];
  };
  const effect = (callback: () => void | (() => void), deps: unknown[] = []) => {
    const index = cursor++, previous = effects[index];
    if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) {
      previous?.cleanup?.();
      effects[index] = { deps };
      pending.push(() => { const cleanup = callback(); if (cleanup) effects[index]!.cleanup = cleanup; });
    }
  };
  const hooks = { ...React, useState: state,
    useRef: (initial: unknown) => state(() => ({ current: initial }))[0], useEffect: effect, useLayoutEffect: effect };
  const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { jsx: ts.JsxEmit.React, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exported: Record<string, (p: Record<string, unknown>) => React.ReactNode> = {};
  new Function("require", "exports", "React", "crypto", compiled)((dependency: string) => {
    if (dependency === "react") return hooks;
    if (dependency.endsWith("/ActionButton")) return { ActionButton: ({ tooltip, ...button }: Record<string, unknown>) => React.createElement("button", { ...button, "data-tooltip": tooltip }) };
    if (dependency in imports) return imports[dependency];
    throw Error(`Unexpected dependency: ${dependency}`);
  }, exported, React, { randomUUID });
  const render = () => {
    cursor = 0; tree = exported[name]!(props);
    const current = pending; pending = []; current.forEach(run => run());
    return renderToStaticMarkup(tree);
  };
  const settle = async () => { for (let i = 0; i < 8; i++) { await Promise.resolve(); render(); } };
  const find = (type: string, label?: string) => {
    const match = nodes(tree).find(node => (node.type === type || (type === "button" && typeof node.type === "function")) && (label === undefined || text(node.props.children) === label));
    if (!match) throw Error(`Missing ${type}: ${label}`);
    return match;
  };
  const click = async (label: string) => { const button = find("button", label); expect(button.props.disabled).not.toBe(true); (button.props.onClick as () => void)(); await settle(); };
  render();
  return { render, settle, find, click };
}

function importFixture() {
  let reject = true, allowed = true, back = 0, committed = 0;
  let confirmError: Error | undefined;
  let release: (() => void) | undefined;
  let held: Promise<void> | undefined;
  const calls: { kind: string; input: unknown }[] = [];
  const summary = { id: "batch", digest: "digest", sourceLabel: "Synthetic", readyCount: 1, pendingCount: 1, contextCount: 0, historyCount: 0 };
  const origin = { organizationId: "org", clerkActorId: "actor" };
  const access = { origin, get canEdit() { return allowed; }, owns: () => allowed, query: { isFetching: false, refetch: async () => undefined } };
  const mutation = (kind: string) => ({ useMutation: () => ({ mutateAsync: async (input: unknown) => {
    calls.push({ kind, input: structuredClone(input) });
    if (held) await held;
    if (reject) throw Error('The "title" field must be mapped to a CSV column');
    if (kind === "confirm" && confirmError) throw confirmError;
    return kind === "prepare" ? summary : { createdCount: 1, updatedCount: 0, pendingCount: 1, historyCount: 0 };
  } }) });
  const fixture = mount("ImportMappingReview", "ImportMappingReview", {
    "@/lib/use-case-field-access": { useCaseFieldAccess: () => access },
    "@/lib/trpcReact": { trpcReact: { importJobs: { prepareMapping: mutation("prepare"), confirmMapping: mutation("confirm"), cancelMapping: mutation("cancel") } } },
  }, { projectId: "project", sourceLabel: "Synthetic", source: { format: "CSV", sheets: [{ name: "", csvText: "Unknown\nSynthetic", mapping: {} }] }, onBack: () => back++, onCommitted: () => committed++ });
  return { ...fixture, calls, back: () => back, committed: () => committed,
    confirmFailure: (error?: Error) => { confirmError = error; },
    allow: (value: boolean) => { allowed = value; }, succeed: () => { reject = false; },
    hold: () => { held = new Promise<void>(resolve => { release = resolve; }); }, release: () => { held = undefined; release?.(); } };
}
it("failed review offers Back without confirming or cancelling a batch; Retry retains exact source/request", async () => {
  const f = importFixture(); await f.settle();
  expect(f.render()).toContain('The &quot;title&quot; field');
  await f.click("Retry");
  expect(f.calls).toHaveLength(2); expect(f.calls[1]).toEqual(f.calls[0]);
  await f.click("Back"); expect(f.back()).toBe(1); expect(f.committed()).toBe(0);
  expect(f.calls.every(call => call.kind === "prepare")).toBe(true);
});
it("Back cannot navigate during an in-flight preparation or after access is lost", async () => {
  const f = importFixture(); await f.settle();
  const back = f.find("button", "Back").props.onClick as () => void;
  f.hold(); (f.find("button", "Retry").props.onClick as () => void)(); f.render();
  expect(f.find("button", "Back").props.disabled).toBe(true); back(); expect(f.back()).toBe(0);
  f.release(); await f.settle(); f.allow(false); back(); expect(f.back()).toBe(0);
  expect(f.render()).toContain("Import details are hidden");
});
it("once preparation succeeds, Back still uses the durable cancellation path", async () => {
  const f = importFixture(); await f.settle(); f.succeed(); await f.click("Retry");
  expect(f.render()).toContain("1 ready"); await f.click("Back");
  expect(f.calls.at(-1)).toMatchObject({ kind: "cancel", input: { batchId: "batch", expectedDigest: "digest" } });
  expect(f.back()).toBe(1); expect(f.committed()).toBe(0);
});

function suggestionsFixture(name: "SmartCaseSuggestions" | "SmartColumnMapping", initiallyAllowed = false) {
  let allowed = initiallyAllowed, failed = false, version = 1, actor = "actor", requests = 0, checks = 0;
  const utils = { client: { caseSuggestions: {
    configuration: { query: async () => { checks++; if (failed) throw Error("synthetic denial"); return { enabled: true, canAnalyze: allowed, policyVersion: version, reason: allowed ? null : "Review the project's classification in AI sharing first." }; } },
    recommend: { mutate: async () => { requests++; throw Error("Unexpected AI call"); } },
    mapping: { mutate: async () => { requests++; throw Error("Unexpected AI call"); } },
  } } };
  const f = mount("SmartCaseSuggestions", name, {
    "@clerk/nextjs": { useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: actor, sessionId: actor }) },
    "@/lib/trpcReact": { trpcReact: { useUtils: () => utils, project: { byId: { useQuery: () => ({ data: { organizationId: "org" } }) } } } },
    "@/lib/smart-suggestion-errors": { definitiveSuggestionRefusal: () => false },
    "@/lib/reassign-import-column": { suggestedImportMapping: () => ({}) },
  }, { projectId: "project", ...(name === "SmartCaseSuggestions" ? { cases: Array.from({ length: 978 }, (_, i) => ({ id: String(i), title: "Synthetic", given: [], when: [], then: [] })) } : { csvText: "Unknown\nSynthetic", currentMapping: {}, onApply: async () => undefined }) });
  const approve = async () => { (f.find("input").props.onChange as (event: unknown) => void)({ target: { checked: true } }); await f.settle(); };
  return { ...f, approve, requests: () => requests, checks: () => checks,
    changePolicy: () => { allowed = true; version++; }, fail: () => { failed = true; }, changeActor: () => { actor = "other"; allowed = false; } };
}
it.each(["SmartCaseSuggestions", "SmartColumnMapping"] as const)("%s explains the actual block and refresh requires renewed consent without sending content", async name => {
  const f = suggestionsFixture(name); await f.settle(); await f.approve();
  const label = name === "SmartCaseSuggestions" ? "Generate suggestions" : "Suggest mappings";
  const button = f.find("button", label);
  expect(button.props.disabled).toBe(true); expect(button.props.tooltip).toContain("classification");
  expect(f.find("a", "AI sharing").props.href).toBe("/projects/project/settings/integrations#ai-sharing");
  (button.props.onClick as () => void)(); await f.settle(); expect(f.requests()).toBe(0);
  f.changePolicy(); await f.click("Refresh");
  expect(f.checks()).toBe(2); expect(f.find("button", label).props.disabled).toBe(true);
  expect(f.find("button", label).props.tooltip).toContain("Approve AI analysis");
  await f.approve(); expect(f.find("button", label).props.disabled).toBe(false); expect(f.requests()).toBe(0);
  f.changeActor(); await f.settle(); expect(f.find("button", label).props.disabled).toBe(true); expect(f.find("input").props.checked).toBe(false);
});
it("a failed AI access refresh cannot reuse earlier permission or consent", async () => {
  const f = suggestionsFixture("SmartCaseSuggestions"); await f.settle(); f.fail(); await f.click("Refresh");
  await f.approve(); const button = f.find("button", "Generate suggestions");
  expect(button.props.disabled).toBe(true); expect(button.props.tooltip).toContain("Could not verify AI access");
  (button.props.onClick as () => void)(); await f.settle(); expect(f.requests()).toBe(0);
});


it("keeps the exact confirmation after an HTML gateway response", async () => {
  const f = importFixture(); await f.settle(); f.succeed(); await f.click("Retry");
  f.confirmFailure(new SyntaxError("Unexpected token '<', \"<!DOCTYPE \" is not valid JSON"));
  await f.click("Import");
  expect(f.render()).toContain("The result is unconfirmed");
  expect(f.render()).not.toContain("DOCTYPE");
  expect(f.find("button", "Back").props.disabled).toBe(true);
  f.confirmFailure();
  await f.click("Retry");
  const writes = f.calls.filter(call => call.kind === "confirm");
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect(f.committed()).toBe(1);
});

it("analyzes 981 saved cases in bounded requests and applies only after review", async () => {
  const ids = Array.from({ length: 981 }, (_, i) => `case-${i}`);
  const batches: string[][] = [];
  const writes: unknown[] = [];
  const utils = { client: { caseSuggestions: {
    configuration: { query: async () => ({ enabled: true, canAnalyze: true, policyVersion: 1, reason: null }) },
    recommend: { mutate: async ({ caseIds }: { caseIds: string[] }) => {
      batches.push(caseIds);
      return {
        reviewId: `review-${batches.length}`, knownSuites: [], legacySuitePaths: [],
        before: caseIds.map(id => ({ id, title: id, suitePath: null, priority: "MEDIUM", testType: "FUNCTIONAL" })),
        suggestions: caseIds.map(id => ({ id, suitePath: null, priority: "HIGH", testType: null, confidence: "HIGH", reason: "Synthetic", evidence: [] })),
      };
    } },
    applyReviewed: { mutate: async (input: { selections: unknown[] }) => {
      writes.push(input); return { changed: input.selections.length };
    } },
  } } };
  const f = mount("SmartCaseSuggestions", "SmartCaseSuggestions", {
    "@clerk/nextjs": { useAuth: () => ({ isLoaded: true, isSignedIn: true, userId: "actor", sessionId: "session" }) },
    "@/lib/trpcReact": { trpcReact: { useUtils: () => utils, project: { byId: { useQuery: () => ({ data: { organizationId: "org" } }) } } } },
    "@/lib/smart-suggestion-errors": { definitiveSuggestionRefusal: () => false },
    "@/lib/reassign-import-column": { suggestedImportMapping: () => ({}) },
  }, { projectId: "project", caseIds: ids });
  await f.settle();
  expect(f.find("button", "Generate suggestions").props.disabled).toBe(true);
  (f.find("input").props.onChange as (e: unknown) => void)({ target: { checked: true } });
  f.render();
  await f.click("Generate suggestions");
  await new Promise(resolve => setImmediate(resolve));
  expect(f.render()).toContain("Review 981 cases");
  expect(batches).toHaveLength(50);
  expect(batches.every(batch => batch.length <= 20)).toBe(true);
  expect(batches.flat()).toEqual(ids);
  expect(writes).toHaveLength(0);
  await f.click("Apply changes");
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ approved: true, reviewIds: Array.from({ length: 50 }, (_, i) => `review-${i + 1}`) });
  expect(f.render()).toContain("Reviewed changes confirmed for 981 cases.");
});
