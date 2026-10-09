// Actual case-form callbacks + installed React SSR + actual presentation/save
// helpers. Metadata/RPC and tag/shared-preview/design-guide/custom-field child
// boundaries are synthetic; this is not full mounted-tag or child auth proof.
// not authenticated browser/native acceptance or legacy save/UNKNOWN proof.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import * as core from "@vaettir/core";
import * as fields from "./case-authoring-fields";
import { freshCasePresentation } from "./case-presentation-read";
import { moveListItem } from "./move-list-item";
import vm from "node:vm";
function actualUiDeclaration(file: string, name: string) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  if (!declaration) throw Error(`Actual shared UI declaration missing: ${name}`);
  return ts.createPrinter().printNode(ts.EmitHint.Unspecified, declaration, ast).replace(/\bexport (?=function)/g, "");
}
// No direct TSX imports: transpile the genuine Icon then IconButton declarations.
// Installed React hooks run only when SSR renders the shared child. The form's
// own synthetic controller slots remain separate from the child's hook state.
const iconScope = vm.createContext({ React, useId: React.useId, useState: React.useState });
for (const [file, name] of [
  ["../components/ui/Workspace.tsx", "Icon"],
  ["../components/ui/IconButton.tsx", "IconButton"],
] as const) {
  vm.runInContext(ts.transpileModule(actualUiDeclaration(file, name), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText, iconScope);
}
const IconButton = (iconScope as unknown as { IconButton: React.ComponentType<Record<string, unknown>> }).IconButton;

const source = readFileSync(new URL("../components/TestCaseForm.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
type Element = React.ReactElement<Record<string, unknown>>;
function elements(value: unknown, all: Element[] = []): Element[] { if (React.isValidElement(value)) { const e = value as Element; all.push(e); elements(e.props.children, all); } else if (Array.isArray(value)) value.forEach(v => elements(v, all)); return all; }
function text(value: unknown): string { return typeof value === "string" || typeof value === "number" ? String(value) : React.isValidElement(value) ? text((value as Element).props.children) : Array.isArray(value) ? value.map(text).join("") : ""; }
function seed() { return { title: "Case\nExact", priority: "MEDIUM", testType: "FUNCTIONAL", validationDomain: "SOFTWARE", background: "", tags: [] as string[], suitePath: "suite/exact", testPlanId: "", sharedStepGroupId: "", stepRevision: "s".repeat(64), caseRevision: "c".repeat(64), given: ["", " Given\n raw "], when: [" When "], then: [" Then "], verificationProfile: { setup: "", safety: "", instruments: "", acceptanceCriteria: "" }, steps: [{ action: " Click\n button ", expectedActionOrData: null as string | null, expectedResult: "" as string | null, expectedResponse: null as string | null, mediaAttachmentIds: ["media-A", "media-B"] }, { action: " Second action ", expectedActionOrData: null as string | null, expectedResult: " Expected\n exact " as string | null, expectedResponse: null as string | null, mediaAttachmentIds: [] as string[] }] }; }
const labels = { action: "Human\n action", expectedActionOrData: "Engine / API\n behavior", expectedResult: "Visible outcome", expectedResponse: " Wire\n response " };
function harness(initial = seed(), automatic = false, mode: "create" | "edit" = "edit") {
  type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void; memo?: unknown };
  const slots: Slot[] = [], effects: Array<() => void> = [], sent: unknown[] = [], reads: string[] = [], settingsWrites: unknown[] = [], navigation: string[] = [];
  let cursor = 0, dirty = true, tree: React.ReactNode = null;
  const props = { mode, projectId: "p", testCaseId: mode === "edit" ? "case" : undefined, initial, stepFieldLabels: labels, active: true, locked: false };
  const presentation = core.defaultCasePresentation(null);
  if (!automatic) for (const key of core.CASE_PRESENTATION_FIELDS) presentation.fields[key] = "HIDE";
  const data = { projectId: "p", organizationId: "o", caseId: null, readScope: { projectId: "p", organizationId: "o", actorId: "N", actorClerkUserId: "cl" }, configuration: presentation, defaults: presentation };
  const same = (a: readonly unknown[] | undefined, b: readonly unknown[] | undefined) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  const hooks = { ...React,
    useState: (init: unknown) => { const id = cursor++; if (!slots[id]) slots[id] = { value: typeof init === "function" ? (init as () => unknown)() : init }; return [slots[id]!.value, (next: unknown) => { const slot = slots[id]!, value = typeof next === "function" ? (next as (v: unknown) => unknown)(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef: (init: unknown) => { const id = cursor++; slots[id] ??= { value: { current: init } }; return slots[id]!.value; },
    useId: () => { cursor++; return "synthetic-field"; },
    useMemo: (fn: () => unknown, deps: readonly unknown[]) => { const id = cursor++, slot = slots[id] ??= {}; if (!same(slot.deps, deps)) { slot.memo = fn(); slot.deps = deps; } return slot.memo; },
    useEffect: (fn: () => unknown, deps: readonly unknown[]) => { const id = cursor++, slot = slots[id] ??= {}; if (!same(slot.deps, deps)) effects.push(() => { slot.cleanup?.(); slot.deps = deps; const cleanup = fn(); slot.cleanup = typeof cleanup === "function" ? cleanup as () => void : undefined; }); },
  };
  const observed = new Set<string>();
  function query(path: string, value: unknown) { return { useQuery: (input?: unknown, options?: { enabled?: boolean }) => { const key = JSON.stringify([path, input, options?.enabled !== false]); if (options?.enabled !== false && !observed.has(key)) { observed.add(key); reads.push(key); } return { data: value, isFetchedAfterMount: true, isFetching: false, isPaused: false, error: null, refetch: async () => { reads.push(path + ":explicit-refetch"); return { data: value }; } }; } }; }
  let mutate: (body: unknown) => Promise<{ id: string }> = async () => ({ id: "case" });
  let upload: (body: unknown) => Promise<unknown> = async () => { throw Error("Synthetic upload never admitted"); };
  const mutation = () => ({ useMutation: () => ({ mutateAsync: (body: unknown) => { sent.push(body); return mutate(body); } }) });
  const mediaMutation = () => ({ useMutation: () => ({ mutateAsync: (body: unknown) => { reads.push("synthetic-upload-request"); return upload(body); } }) });
  const api = { useUtils: () => ({ testCases: { list: { invalidate: async () => {} }, byId: { invalidate: async () => {} } }, caseFields: { get: { invalidate: async () => {} } }, testCaseAttachments: { list: { invalidate: async () => {} }, getViewUrl: { fetch: async () => { throw Error("No source/file operation allowed"); } } } }), project: { experience: query("project.experience", { experience: null }) }, casePresentation: { get: query("casePresentation.get", data), configure: { useMutation: () => ({ mutateAsync: (value: unknown) => { settingsWrites.push(value); throw Error("No settings write allowed"); } }) } }, testCases: { list: query("testCases.list", []), create: mutation(), update: mutation() }, sharedStepGroups: { list: query("sharedStepGroups.list", []) }, testCaseAttachments: { list: query("testCaseAttachments.list", []), requestUpload: mediaMutation(), confirmUpload: mediaMutation(), delete: mediaMutation() } };
  const FieldBoundary = () => React.createElement("div", { "data-synthetic-fields-readiness": true });
  const modules: Record<string, unknown> = { react: hooks, "next/navigation": { useRouter: () => ({ push: (path: string) => navigation.push(path) }) }, "@vaettir/core": core, "@/lib/trpcReact": { trpcReact: api }, "@/components/TestCaseTree": { collectKnownSuitePaths: () => [] }, "@/lib/move-list-item": { moveListItem }, "@/lib/use-case-field-access": { useCaseFieldAccess: (_p: string, _id: string, active: boolean) => ({ origin: { projectId: "p", organizationId: "o", clerkActorId: "cl", caseId: "case" }, readable: active, current: active ? { projectId: "p", organizationId: "o", clerkActorId: "cl", caseId: "case" } : null }) }, "@/lib/case-presentation-read": { freshCasePresentation }, "@/lib/case-authoring-fields": fields, "./CaseDesignGuide": { CaseDesignGuide: () => null }, "./CaseProcedureColumns": { CaseProcedureColumns: () => null }, "./CaseTagEditor": { CaseTagEditor: (p: { tags: string[] }) => React.createElement("div", { "data-tag-chips": true }, p.tags.map((tag, i) => React.createElement("span", { key: i }, tag))) }, "./ui/IconButton": { IconButton }, "./CaseCustomFields": { CaseCustomFieldsForm: FieldBoundary } };
  const exports: Record<string, (p: typeof props) => React.ReactNode> = {};
  new Function("require", "exports", "React", compiled)((name: string) => { if (!(name in modules)) throw Error("Unexpected form import: " + name); return modules[name]; }, exports, React);
  function render(commit = true) { cursor = 0; dirty = false; effects.length = 0; tree = exports.default!(props); if (commit) effects.splice(0).forEach(fn => fn()); }
  function settle() { for (let i = 0; i < 30; i++) { render(); if (!dirty) return; } throw Error("Actual form render loop"); }
  // Execute the genuine nested scenario controller with its own stable hook
  // slots, rather than pretending its unrendered React element has buttons.
  // Parent callbacks still update the original form slots and save path.
  const scenarioSlots = new Map<string, number>();
  function controllerElements() {
    const nodes = elements(tree);
    for (const child of nodes.filter(e => typeof e.type === "function" && e.type.name === "StringListEditor")) {
      const label = String(child.props.label);
      if (!scenarioSlots.has(label)) scenarioSlots.set(label, 1000 + scenarioSlots.size * 10);
      const parentCursor = cursor;
      try {
        cursor = scenarioSlots.get(label)!;
        nodes.push(...elements((child.type as (props: Record<string, unknown>) => React.ReactNode)(child.props)));
      } finally { cursor = parentCursor; }
    }
    return nodes;
  }
  function button(name: string) { const value = controllerElements().find(e => (e.type === "button" && (e.props["aria-label"] === name || text(e.props.children) === name) || e.type === IconButton && e.props.label === name)); if (!value) throw Error(`Button absent: ${name}`); return value; }
  function click(name: string) { const b = button(name); expect(b.props.disabled).not.toBe(true); (b.props.onClick as () => void)(); settle(); }
  function ready() { const child = elements(tree).find(e => e.type === FieldBoundary); if (!child) throw Error("Actual metadata readiness callback missing"); (child.props.onChange as (value: unknown) => void)({ ready: true, customFields: { untouched: false, zero: 0, empty: "" }, expectedFieldSchemaHash: "f".repeat(64), expectedCustomFieldRevision: "m".repeat(64) }); settle(); }
  function textarea(label: string, occurrence = 0) { const parent = elements(tree).filter(e => e.type === "label" && text(e.props.children).startsWith(label))[occurrence]; if (!parent) throw Error(`Label absent: ${label}`); const child = elements(parent).find(e => e.type === "textarea"); if (!child) throw Error(`Textarea absent: ${label}`); return child; }
  settle();
  return { props, sent, reads, settingsWrites, navigation, button, click, ready, render, settle, textarea, get tree() { return tree; }, html: () => { settle(); return renderToStaticMarkup(tree); }, change: (label: string, value: string, occurrence = 0) => { (textarea(label, occurrence).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } }); settle(); }, save: async () => { const b = button(mode === "create" ? "Create test case" : "Save changes"); expect(b.props.disabled).not.toBe(true); await (b.props.onClick as () => Promise<void>)(); settle(); }, holdSave: () => { mutate = () => new Promise(() => {}); }, holdUpload: () => { upload = () => new Promise(() => {}); const input = elements(tree).find(e => e.type === "input" && e.props.type === "file"); if (!input) throw Error("Actual upload input missing"); (input.props.onChange as (event: { target: { files: File[]; value: string } }) => void)({ target: { files: [new File(["synthetic"], "synthetic.png", { type: "image/png" })], value: "synthetic" } }); settle(); } };
}
it.each(["Original background\nUseful prose", " \n\t "])("clearing saved Background %j sends explicit empty text and preserves every other save field", async background => {
  const initial = seed(); initial.background = background;
  const untouched = harness(initial), cleared = harness(initial);
  untouched.ready(); cleared.ready();
  cleared.change("Background", "");
  // HIDE may hide the now-empty control, but revealing it restores the same
  // deliberately cleared value without changing preference or saved content.
  cleared.click("Show Background / description for this draft");
  expect(cleared.textarea("Background").props.value).toBe("");
  await untouched.save(); await cleared.save();
  expect(untouched.sent).toHaveLength(1); expect(cleared.sent).toHaveLength(1);
  expect(untouched.sent[0]).toHaveProperty("background", background);
  expect(cleared.sent[0]).toEqual({ ...untouched.sent[0] as Record<string, unknown>, background: "" });
  expect(cleared.settingsWrites).toEqual([]);
  expect(cleared.navigation).toEqual(["/projects/p/test-cases/case"]);
});
it.each([null, ""])("initial saved Background %j projected to the empty editor retains omitted behavior on unrelated save", async background => {
  const initial = seed(); initial.background = background ?? "";
  // The real edit route projects native NULL with tc.background ?? "";
  // this remains a synthetic form payload test, not native NULL acceptance.
  const h = harness(initial); h.ready(); await h.save();
  expect(h.sent).toHaveLength(1); expect(h.sent[0]).toHaveProperty("background", undefined);
  expect(h.sent[0]).toMatchObject({ expectedCaseRevision: "c".repeat(64), expectedStepRevision: "s".repeat(64), expectedPriority: "MEDIUM", customFields: { untouched: false, zero: 0, empty: "" } });
});
it("new draft keeps initial blank or deliberately cleared template Background omitted", async () => {
  for (const background of ["", "Template background\nRaw prose"]) {
    const initial = seed(); initial.background = background;
    const h = harness(initial, false, "create"); h.ready();
    if (background !== "") h.change("Background", "");
    await h.save(); expect(h.sent).toHaveLength(1); expect(h.sent[0]).toHaveProperty("background", undefined);
    expect(h.sent[0]).toHaveProperty("projectId", "p"); expect(h.sent[0]).not.toHaveProperty("expectedCaseRevision"); expect(h.settingsWrites).toEqual([]);
  }
});
it("nonempty edited Background retains all raw whitespace, multiline and literal markup", async () => {
  const initial = seed(); initial.background = "Original";
  const h = harness(initial); h.ready(); const raw = ' \n<not HTML> & "literal"\n\tretained prose  ';
  h.change("Background", raw); await h.save(); expect(h.sent).toHaveLength(1); expect(h.sent[0]).toHaveProperty("background", raw); expect(initial.background).toBe("Original");
});
it("HIDE presents six explicit reveal controls and no compliance mapper/default/setting write", () => { const h = harness(), before = h.reads.length, html = h.html(); expect(html).toContain("Show optional fields for this draft"); expect(elements(h.tree).filter(e => e.type === "button" && String(e.props["aria-label"] ?? "").startsWith("Show "))).toHaveLength(6); expect(html).not.toContain("Compliance controls"); expect(html).toContain("Priority"); h.click("Show Engine / API\n behavior for this draft"); expect(h.reads).toHaveLength(before); expect(h.sent).toEqual([]); expect(h.settingsWrites).toEqual([]); expect(h.textarea(labels.expectedActionOrData).props.value).toBe(""); expect(h.html()).toContain("Not supplied"); });
it("hardware AUTO keeps expected response hidden by default but the same numbered row can explicitly reveal it", () => { const initial = seed(); initial.validationDomain = "HARDWARE"; const h = harness(initial, true); expect(h.html()).toContain("Show optional fields for this draft"); h.click("Show  Wire\n response  for this draft"); const list = elements(h.tree).find(e => e.props["aria-label"] === "Ordered test steps"); if (!list) throw Error("Actual step list missing"); const rows = elements(list).filter(e => e.props.role === "listitem"); expect(rows).toHaveLength(2); expect(text(rows[0])).toContain(labels.action); expect(text(rows[0])).toContain(labels.expectedResponse); expect(h.sent).toEqual([]); });
it("revealing ALL six fields alone leaves unrelated save shape, ordered raw/NULL/empty/media/phases/CAS exactly unchanged", async () => { const untouched = harness(), revealed = harness(); untouched.ready(); revealed.ready(); const before = revealed.reads.length; for (const label of ["Background / description", "Tag chips", "Fixture setup, instruments and measurement criteria", "Safety prerequisites / stop conditions", labels.expectedActionOrData, labels.expectedResponse]) revealed.click(`Show ${label} for this draft`); expect(revealed.reads).toHaveLength(before); expect(revealed.settingsWrites).toEqual([]); expect(revealed.sent).toEqual([]); await untouched.save(); await revealed.save(); expect(revealed.sent).toEqual(untouched.sent); expect(revealed.sent[0]).toMatchObject({ expectedStepRevision: "s".repeat(64), expectedCaseRevision: "c".repeat(64), expectedPriority: "MEDIUM", steps: [{ action: " Click\n button ", expectedActionOrData: null, expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["media-A", "media-B"] }, { action: " Second action ", expectedActionOrData: null, expectedResult: " Expected\n exact ", expectedResponse: null, mediaAttachmentIds: [] }], given: ["", " Given\n raw "], customFields: { untouched: false, zero: 0, empty: "" } }); });
it("explicit edits retain custom labels and complete multiline prose, without a dataset substitution", async () => { const h = harness(); h.ready(); h.click(`Show ${labels.expectedActionOrData} for this draft`); h.click(`Show ${labels.expectedResponse} for this draft`); h.click("Show Background / description for this draft"); h.change(labels.expectedActionOrData, "  onClick\n GET /api/details  "); h.change(labels.expectedResponse, "  200\n { payload }  "); h.change("Background", "  Purpose\n useful prose  "); await h.save(); expect(h.sent[0]).toMatchObject({ background: "  Purpose\n useful prose  ", steps: [{ action: " Click\n button ", expectedActionOrData: "  onClick\n GET /api/details  ", expectedResponse: "  200\n { payload }  " }, { expectedActionOrData: null, expectedResponse: null }] }); expect(h.html()).toContain("Parameter datasets are separate"); });
it("supplied empty/whitespace/custom values remain visible under HIDE before any local reveal", () => { const initial = seed(); initial.background = " \n "; initial.tags = [" exact, tag "]; initial.verificationProfile.setup = "Setup\n raw"; initial.verificationProfile.safety = " \n "; initial.steps[0]!.expectedActionOrData = ""; initial.steps[0]!.expectedResponse = " \n "; const h = harness(initial); expect(elements(h.tree).some(e => e.type === "button" && String(e.props["aria-label"] ?? "").startsWith("Show "))).toBe(false); expect(h.textarea(labels.expectedActionOrData).props.value).toBe(""); expect(h.textarea(labels.expectedResponse).props.value).toBe(" \n "); expect(h.html()).toContain("Explicit empty text"); expect(h.sent).toEqual([]); });
it.each(["Fixture setup, instruments and measurement criteria", "Safety prerequisites / stop conditions"])("explicit %s reveal opens the group in a software draft without entering any values", label => { const h = harness(), reads = h.reads.length; h.click(`Show ${label} for this draft`); const group = elements(h.tree).find(e => e.type === "details" && text(e.props.children).startsWith("Fixture, safety and measurement criteria")); expect(group?.props.open).toBe(true); expect(h.reads).toHaveLength(reads); expect(h.sent).toEqual([]); });
it.each(["inactive", "locked", "saving", "uploading"])("%s refuses even a captured old reveal callback, with no draft/default/write mutation", mode => { const h = harness(), old = h.button(`Show ${labels.expectedResponse} for this draft`); if (mode === "inactive") h.props.active = false; if (mode === "locked") h.props.locked = true; if (mode === "saving") { h.ready(); h.holdSave(); (h.button("Save changes").props.onClick as () => void)(); } if (mode === "uploading") h.holdUpload(); h.render(false); const reads = h.reads.length, writes = h.sent.length; (old.props.onClick as () => void)(); h.settle(); h.props.active = true; h.props.locked = false; if (mode === "inactive" || mode === "locked") { h.settle(); expect(h.button(`Show ${labels.expectedResponse} for this draft`).props.disabled).toBe(false); (old.props.onClick as () => void)(); h.settle(); } expect(h.reads).toHaveLength(reads); expect(h.sent).toHaveLength(writes); expect(h.settingsWrites).toEqual([]); expect(elements(h.tree).filter(e => e.type === "label" && text(e.props.children).startsWith(labels.expectedResponse))).toHaveLength(0); });
it("numbered optional editor names follow current position after reorder while description IDs and exact saved data retain row identity", async () => {
  const initial = seed(), control = harness(initial), reordered = harness(initial);
  control.ready(); reordered.ready();
  for (const form of [control, reordered]) {
    form.click(`Show ${labels.expectedActionOrData} for this draft`);
    form.click(`Show ${labels.expectedResponse} for this draft`);
  }
  const before = Object.values(labels).map(label => ({ label, editor: reordered.textarea(label) }));
  for (const { label, editor } of before) expect(editor.props["aria-label"]).toBe(`Step 1: ${label}`);
  const references = before.flatMap(({ editor }) => editor.props["aria-describedby"] ? [String(editor.props["aria-describedby"])] : []);
  expect(new Set(references).size).toBe(3);
  const reads = reordered.reads.length;
  reordered.click("Move step 1 down");
  expect(reordered.reads).toHaveLength(reads);
  expect(reordered.sent).toEqual([]);
  expect(reordered.settingsWrites).toEqual([]);
  for (const label of Object.values(labels)) {
    expect(reordered.textarea(label, 0).props["aria-label"]).toBe(`Step 1: ${label}`);
    const retained = reordered.textarea(label, 1), prior = before.find(row => row.label === label)!.editor;
    expect(retained.props["aria-label"]).toBe(`Step 2: ${label}`);
    expect(retained.props.value).toBe(prior.props.value);
    expect(retained.props["aria-describedby"]).toBe(prior.props["aria-describedby"]);
  }
  for (const reference of references) {
    const notice = elements(reordered.tree).find(element => element.props.id === reference);
    expect(notice).toBeDefined();
    expect(["Not supplied", "Explicit empty text"]).toContain(text(notice));
  }
  await control.save(); await reordered.save();
  const originalBody = control.sent[0] as { steps: unknown[] };
  expect(reordered.sent[0]).toEqual({ ...originalBody, steps: [...originalBody.steps].reverse() });
  expect(reordered.sent[0]).toMatchObject({ expectedStepRevision: "s".repeat(64), expectedCaseRevision: "c".repeat(64), steps: [
    { action: " Second action ", expectedActionOrData: null, expectedResult: " Expected\n exact ", expectedResponse: null, mediaAttachmentIds: [] },
    { action: " Click\n button ", expectedActionOrData: null, expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["media-A", "media-B"] },
  ] });
});

it("actual compact scenario and step tools keep original callbacks, exact prose and saved media identities", async () => {
  const initial = seed(), baseline = harness(initial), changed = harness(initial);
  baseline.ready(); changed.ready();
  const firstUp = changed.button("Move step 1 up");
  expect(firstUp.type).toBe(IconButton);
  expect(firstUp.props.icon).toBe("up");
  expect(firstUp.props.disabled).toBe(true);
  expect(changed.button("Move step 2 down").props.disabled).toBe(true);
  const reads = changed.reads.length;
  changed.click("Move step 2 up");
  changed.click("Move Given item 2 up");
  changed.click("Remove Given item 2");
  expect(changed.reads).toHaveLength(reads);
  expect(changed.sent).toEqual([]);
  expect(changed.settingsWrites).toEqual([]);
  expect(changed.button("Remove step 1").props.icon).toBe("delete");
  expect(changed.button("Move step 1 down").props.icon).toBe("down");
  await baseline.save(); await changed.save();
  const original = baseline.sent[0] as { steps: unknown[]; given: string[] };
  expect(changed.sent[0]).toEqual({ ...original, steps: [...original.steps].reverse(), given: [" Given\n raw "] });
  expect(changed.sent[0]).toMatchObject({
    expectedStepRevision: "s".repeat(64),
    expectedCaseRevision: "c".repeat(64),
    steps: [
      { action: " Second action ", expectedActionOrData: null, expectedResult: " Expected\n exact ", expectedResponse: null, mediaAttachmentIds: [] },
      { action: " Click\n button ", expectedActionOrData: null, expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["media-A", "media-B"] },
    ],
  });
});
