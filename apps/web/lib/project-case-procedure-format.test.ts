import { controllerTranspile } from "./controller-transpile.fixture";
// Genuine complete component with synthetic hook/RPC/Modal boundaries. This
// models retained preferences and callbacks, not native or browser acceptance.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import * as core from "@vaettir/core";
import { freshCasePresentation } from "./case-presentation-read";
import { sameCaseFieldOrigin, type CaseFieldOrigin } from "./case-field-origin";
import { manualStartDefinitivelyRejected } from "./manual-run-start";

type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown, list: Element[] = []): Element[] {
  if (React.isValidElement(value)) { const element = value as Element; list.push(element); elements(element.props.children, list); }
  else if (Array.isArray(value)) value.forEach(item => elements(item, list));
  return list;
}
function text(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? text((value as Element).props.children) : Array.isArray(value) ? value.map(text).join("") : "";
}
const source = readFileSync(new URL("../components/ProjectCasePresentation.tsx", import.meta.url), "utf8");
const compiled = controllerTranspile(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
type Request = { projectId: string; originalOrganizationId: string; expectedClerkActorId: string; expectedProfileHash: string; configuration: core.CasePresentation; reason: string; confirmed: true; requestId: string };
function harness() {
  const origin: CaseFieldOrigin = { projectId: "p", organizationId: "o", caseId: null, clerkActorId: "cl" };
  const baseline = core.casePresentationPreset("SOFTWARE"), slots: unknown[] = [], sent: Request[] = [];
  let cursor = 0, tree: React.ReactNode, sequence = 0;
  const access = { origin, current: origin as CaseFieldOrigin | null, readable: true, canConfigure: true, owns: (original: CaseFieldOrigin) => access.canConfigure && sameCaseFieldOrigin(original, access.current) };
  const query = { data: { projectId: "p", organizationId: "o", caseId: null, readScope: { projectId: "p", organizationId: "o", actorId: "native", actorClerkUserId: "cl" }, configuration: baseline, defaults: baseline, canConfigure: true, profileHash: "h".repeat(64) }, error: null as unknown, isFetching: false, isPaused: false, refetch: async () => {} };
  let outcome: "ack" | "unknown" | "refused" = "ack";
  const hooks = { ...React, useState: (initial: unknown) => {
    const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === "function" ? (initial as () => unknown)() : initial;
    return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? (next as (value: unknown) => unknown)(slots[index]) : next; }];
  } };
  const Modal = (props: Record<string, unknown>) => props.open ? React.createElement("section", { "aria-label": props.title as string }, props.children as React.ReactNode) : null;
  const api = { useUtils: () => ({ casePresentation: { get: { invalidate: async () => {} } }, project: { experience: { invalidate: async () => {} } } }), casePresentation: {
    get: { useQuery: () => query }, configure: { useMutation: () => ({ isPending: false, mutateAsync: async (request: Request) => {
      sent.push(request);
      if (outcome === "unknown") throw Error("Synthetic uncertain response");
      if (outcome === "refused") throw { data: { code: "FORBIDDEN" } };
      return { requestId: request.requestId, projectId: request.projectId, organizationId: request.originalOrganizationId, actorClerkUserId: request.expectedClerkActorId, replayed: sent.length > 1 };
    } }) },
  } };
  const modules: Record<string, unknown> = { react: hooks, "@vaettir/core": core, "@/lib/trpcReact": { trpcReact: api }, "@/lib/use-case-field-access": { useCaseFieldAccess: () => access }, "@/lib/case-presentation-read": { freshCasePresentation }, "@/lib/manual-run-start": { manualStartDefinitivelyRejected }, "./Modal": { Modal } };
  const exports: { ProjectCasePresentation?: (props: { projectId: string }) => React.ReactNode } = {};
  new Function("require", "exports", "React", "crypto", compiled)((name: string) => { if (!(name in modules)) throw Error("Unexpected dependency: " + name); return modules[name]; }, exports, React, { randomUUID: () => `synthetic-uuid-${++sequence}` });
  function render() { cursor = 0; tree = exports.ProjectCasePresentation!({ projectId: "p" }); }
  function find(type: string, label: string) { const result = elements(tree).find(element => element.type === type && text(element.props.children).includes(label)); if (!result) throw Error(`Absent ${type}: ${label}`); return result; }
  function event(element: Element, value: string | boolean) { (element.props.onChange as (event: { target: { value: string; checked: boolean } }) => void)({ target: { value: String(value), checked: Boolean(value) } }); render(); }
  function button(label: string) { return find("button", label); }
  async function click(label: string) { const element = button(label); expect(element.props.disabled).not.toBe(true); (element.props.onClick as () => void)(); await new Promise<void>(resolve => setImmediate(resolve)); render(); }
  function format(value: core.CasePresentation["procedureFormat"]) { const label = find("label", "Preferred procedure layout"), select = elements(label).find(element => element.type === "select")!; event(select, value!); }
  function review() { event(elements(find("label", "Reason for changing preferences")).find(element => element.type === "textarea")!, " Reason\nreviewed "); event(elements(find("label", "I reviewed these project preferences")).find(element => element.type === "input")!, true); }
  render();
  return { access, query, baseline, sent, button, click, format, review, render, html: () => renderToStaticMarkup(tree), get tree() { return tree; }, outcome: (value: typeof outcome) => { outcome = value; } };
}
it("offers all five layouts, defaults omitted legacy preferences visually to steps, and does not write on opening", async () => {
  const h = harness(); await h.click("Configure built-in case fields");
  const select = elements(h.tree).find(element => element.type === "select" && element.props.value === "STEPS")!;
  expect(elements(select).filter(element => element.type === "option").map(element => element.props.value)).toEqual([...core.CASE_PROCEDURE_FORMATS]);
  expect(h.html()).toContain("Given/When/Then is optional");
  expect(h.baseline).not.toHaveProperty("procedureFormat"); expect(h.sent).toEqual([]);
});
it.each(core.CASE_PROCEDURE_FORMATS)("%s requires renewed review and saves only the selected project preference with original scope/hash", async format => {
  const h = harness(); await h.click("Configure built-in case fields"); h.review(); h.format(format);
  expect(h.button("Save reviewed preferences").props.disabled).toBe(true); expect(h.sent).toEqual([]);
  h.review(); await h.click("Save reviewed preferences");
  expect(h.sent).toHaveLength(1);
  expect(h.sent[0]).toEqual({ projectId: "p", originalOrganizationId: "o", expectedClerkActorId: "cl", expectedProfileHash: "h".repeat(64), configuration: { ...h.baseline, procedureFormat: format }, reason: "Reason\nreviewed", confirmed: true, requestId: "synthetic-uuid-1" });
  expect(h.baseline).not.toHaveProperty("procedureFormat");
});
it("unrelated reviewed saves preserve legacy omitted procedureFormat", async () => {
  const h = harness(); await h.click("Configure built-in case fields"); h.review(); await h.click("Save reviewed preferences");
  expect(h.sent[0]!.configuration).toEqual(h.baseline); expect(h.sent[0]!.configuration).not.toHaveProperty("procedureFormat");
});
it("UNKNOWN retains exact format/body/UUID through original-access loss and later definite refusal", async () => {
  const h = harness(); await h.click("Configure built-in case fields"); h.format("NARRATIVE"); h.review(); h.outcome("unknown"); await h.click("Save reviewed preferences");
  const original = h.sent[0]!;
  expect(h.html()).toContain("synthetic-uuid-1"); expect(h.html()).toContain("Synthetic uncertain response");
  expect(elements(h.tree).some(element => element.type === "fieldset" && element.props.disabled)).toBe(true);
  h.access.current = { ...h.access.origin, clerkActorId: "other" }; h.render();
  expect(h.html()).not.toContain("Narrative procedure"); expect(h.html()).not.toContain("synthetic-uuid-1"); expect(h.html()).toContain("stay retained but private");
  expect(h.sent).toHaveLength(1);
  h.access.current = h.access.origin; h.render(); h.outcome("refused"); await h.click("Retry same preferences");
  expect(h.sent[1]).toBe(original); expect(h.html()).toContain("synthetic-uuid-1");
  h.outcome("ack"); await h.click("Retry same preferences");
  expect(h.sent).toHaveLength(3); expect(h.sent.every(request => request === original)).toBe(true);
  expect(h.html()).toContain("Saved built-in field preferences"); expect(h.html()).not.toContain("Retry same preferences");
});
it("fresh context loss refuses a new preference write without discarding the draft", async () => {
  const h = harness(); await h.click("Configure built-in case fields"); h.format("CHECKLIST"); h.review();
  const retained = h.button("Save reviewed preferences").props.onClick as () => void;
  h.access.canConfigure = false; h.render(); retained(); await new Promise<void>(resolve => setImmediate(resolve)); h.render();
  expect(h.sent).toEqual([]); expect(h.html()).not.toContain("Preferred procedure layout");
  h.access.canConfigure = true; h.render(); expect(h.html()).toContain('<option value="CHECKLIST" selected=""');
});
