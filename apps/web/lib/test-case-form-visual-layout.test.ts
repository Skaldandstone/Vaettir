// Installed React SSR of the actual form and its real presentation/authoring
// helpers. RPC/access and child components are explicitly synthetic boundaries.
// This checks rendered structure, not CSS geometry, authentication or deployment.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import * as core from "@vaettir/core";
import * as authoring from "./case-authoring-fields";
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
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React },
}).outputText;
const labels = { action: "Tester action", expectedActionOrData: "On-click / API behavior", expectedResult: "Visible result", expectedResponse: "API response" };
const initial = {
  title: " Exact case title ", background: " Context\nkept as prose ", suitePath: "suite/exact",
  tags: [" exact tag ", "", "duplicate", "duplicate"], given: ["", " Exact\nprecondition "], when: [" Act "], then: [" Observe "],
  steps: [
    { action: " Click this button\nthen wait ", expectedActionOrData: " OnclickFunction triggers API GET\n/apiURL ", expectedResult: "", expectedResponse: " 200\n{\"ok\":true} ", mediaAttachmentIds: ["synthetic-file-A", "synthetic-file-B"] },
    { action: " Second action ", expectedActionOrData: "", expectedResult: null, expectedResponse: null, mediaAttachmentIds: [] },
  ],
};

function render(options: { locked?: boolean; active?: boolean; hide?: boolean; shared?: boolean; stepLabels?: typeof labels } = {}) {
  const presentation = core.defaultCasePresentation(null);
  for (const key of core.CASE_PRESENTATION_FIELDS) presentation.fields[key] = options.hide ? "HIDE" : "SHOW";
  const data = { projectId: "synthetic-p", organizationId: "synthetic-o", caseId: null,
    readScope: { projectId: "synthetic-p", organizationId: "synthetic-o", actorId: "synthetic-N", actorClerkUserId: "synthetic-C" },
    configuration: presentation, defaults: presentation };
  const query = (value: unknown) => ({ useQuery: () => ({ data: value, error: null, isFetching: false, isPaused: false, isFetchedAfterMount: true }) });
  const refuse = () => { throw Error("No transport allowed in visual SSR test"); };
  const mutation = { useMutation: () => ({ mutateAsync: refuse }) };
  const origin = { projectId: "synthetic-p", organizationId: "synthetic-o", caseId: "synthetic-case", clerkActorId: "synthetic-C" };
  const modules: Record<string, unknown> = {
    react: React, "next/navigation": { useRouter: () => ({ push: refuse }) }, "@vaettir/core": core,
    "@/lib/trpcReact": { trpcReact: {
      useUtils: () => ({}), project: { experience: query({ experience: null }) }, casePresentation: { get: query(data) },
      testCases: { list: query([]), create: mutation, update: mutation }, sharedStepGroups: { list: query([]) },
      testCaseAttachments: { list: query([]), requestUpload: mutation, confirmUpload: mutation, delete: mutation },
    } },
    "@/components/TestCaseTree": { collectKnownSuitePaths: () => [] },
    "@/lib/use-case-field-access": { useCaseFieldAccess: () => ({ origin, readable: options.active !== false, current: options.active === false ? null : origin }) },
    "@/lib/case-presentation-read": { freshCasePresentation }, "@/lib/case-authoring-fields": authoring,
    "@/lib/move-list-item": { moveListItem },
    "./CaseDesignGuide": { CaseDesignGuide: () => React.createElement("div", { "data-synthetic-guide-boundary": true }) },
    "./CaseProcedureColumns": { CaseProcedureColumns: () => React.createElement("div", { "data-synthetic-procedure-boundary": true }) },
    "./CaseTagEditor": { CaseTagEditor: () => React.createElement("div", { "data-synthetic-tag-boundary": true }) },
    "./ui/IconButton": { IconButton }, "./CaseCustomFields": { CaseCustomFieldsForm: () => React.createElement("div", { "data-synthetic-fields-boundary": true }) },
  };
  const exports: { default?: React.ComponentType<Record<string, unknown>> } = {};
  new Function("require", "exports", "React", compiled)((name: string) => {
    if (!(name in modules)) throw Error("Unreviewed form dependency: " + name);
    return modules[name];
  }, exports, React);
  if (!exports.default) throw Error("Actual form export missing");
  return renderToStaticMarkup(React.createElement(exports.default, {
    mode: "edit", projectId: "synthetic-p", testCaseId: "synthetic-case", initial: { ...initial, sharedStepGroupId: options.shared ? "synthetic-shared" : "" },
    stepFieldLabels: options.stepLabels ?? labels, locked: options.locked ?? false, active: options.active ?? true,
  }));
}
function pairs(html: string) {
  return [...html.matchAll(/<div data-step-pair="([^"]+)"[^>]*>([\s\S]*?)<\/div>/g)].map(match => ({ kind: match[1], body: match[2]! }));
}

it("gives the genuine editor a bounded full-width canvas and adaptive prose pairs", () => {
  const html = render();
  expect(html).toContain("width:100%;max-width:1120px;min-width:0");
  expect(html).toContain("minmax(min(280px, 100%), 1fr)");
  expect(html).toContain("minmax(min(180px, 100%), 1fr)");
  expect(html).toContain("minmax(min(240px, 100%), 1fr)");
  expect(html).not.toContain("minmax(155px");
  expect(pairs(html).map(pair => pair.kind)).toEqual(["action-technical", "result-response", "action-technical", "result-response"]);
});
it("keeps customized tester/API labels and exact multiline prose in the same numbered step", () => {
  const paired = pairs(render());
  expect(paired[0]!.body).toContain("Tester action");
  expect(paired[0]!.body).toContain("On-click / API behavior");
  expect(paired[0]!.body).toContain(" Click this button\nthen wait ");
  expect(paired[0]!.body).toContain(" OnclickFunction triggers API GET\n/apiURL ");
  expect(paired[0]!.body).not.toContain("Visible result");
  expect(paired[1]!.body).toContain("Visible result");
  expect(paired[1]!.body).toContain("API response");
  expect(paired[1]!.body).toContain(" 200\n{&quot;ok&quot;:true} ");
  for (const pair of paired) expect(pair.body).toContain('rows="4"');
});
it("retains explicit empty versus NULL labels, supplied hidden fields and unavailable media warnings", () => {
  const html = render({ hide: true }), paired = pairs(html);
  expect(paired[1]!.body).toContain("Explicit empty text");
  expect(paired[2]!.body).toContain("Explicit empty text");
  expect(paired[3]!.body.match(/Not supplied/g)).toHaveLength(2);
  expect(html).toContain(" Context\nkept as prose ");
  expect(html).toContain("Retained empty entry.");
  expect(html).toContain("Step images and video (2)");
  expect(html.match(/A previously linked file is unavailable/g)).toHaveLength(2);
  expect(html).toContain("Fields hidden for empty cases remain visible here");
});
it("uses secondary reorder/remove controls and restrained theme-aware sections", () => {
  const html = render();
  for (const label of ["Move step 1 up", "Move step 1 down", "Remove step 1", "Move Given item 1 up", "Remove Given item 1"]) {
    expect(html).toMatch(new RegExp(`<button[^>]*class="ui-icon-button [^"]*"[^>]*aria-label="${label}"`));
  }
  expect(html).toContain("font-size:16px;margin:24px 0 6px;padding-top:18px;border-top:1px solid var(--line)");
  expect(html).toContain("background:var(--panel)");
  expect(html).toContain("resize:vertical;line-height:1.55");
  expect(html).toContain("padding:6px 10px;min-height:36px;font-size:12px;border-radius:3px");
});
it("does not conceal shared-procedure failure, bypass locked fields or make SSR metadata save-ready", () => {
  const shared = render({ shared: true });
  expect(shared).toContain("Its reference is retained; no empty or action-only replacement is shown.");
  expect(shared).not.toContain('data-step-pair="');
  expect(render({ locked: true })).toMatch(/^<fieldset disabled=""/);
  const inactive = render({ active: false });
  expect(inactive).not.toContain("data-synthetic-guide-boundary");
  expect(inactive).toContain("Show optional fields for this draft");
  expect(inactive).toMatch(/<button[^>]*disabled=""[^>]*>Save changes<\/button>/);
});
it("numbers all eight actual editor names with their customized visible labels and describes NULL versus explicit empty", () => {
  const html = render();
  const editors = [...html.matchAll(/<textarea([^>]*)>/g)].map(match => match[1]!);
  const named = editors.filter(attributes => attributes.includes('aria-label="Step '));
  expect(named).toHaveLength(8);
  const names = named.map(attributes => /aria-label="([^"]+)"/.exec(attributes)![1]);
  expect(names).toEqual([1, 2].flatMap(position => Object.values(labels).map(label => `Step ${position}: ${label}`)));
  expect(new Set(names).size).toBe(8);
  const notices = new Map([...html.matchAll(/<span id="([^"]+)" class="text-muted">(Not supplied|Explicit empty text)<\/span>/g)].map(match => [match[1]!, match[2]!]));
  expect(notices.size).toBe(4);
  for (const attributes of named) {
    const described = /aria-describedby="([^"]+)"/.exec(attributes)?.[1];
    if (described) expect(notices.has(described)).toBe(true);
  }
  const described = named.flatMap(attributes => /aria-describedby="([^"]+)"/.exec(attributes)?.[1] ?? []);
  expect(new Set(described).size).toBe(4);
  expect(described.map(id => notices.get(id))).toEqual(["Explicit empty text", "Explicit empty text", "Not supplied", "Not supplied"]);
});
it("keeps multiline and quoted custom labels literal in numbered accessible names", () => {
  const stepLabels = { action: ' Human\n"action" ', expectedActionOrData: " Engine / API\nbehavior ", expectedResult: " Visible\n<outcome> ", expectedResponse: " Wire\nresponse " };
  const html = render({ stepLabels });
  for (const position of [1, 2]) for (const label of Object.values(stepLabels)) {
    const escaped = label.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    expect(html).toContain(`aria-label="Step ${position}: ${escaped}"`);
  }
  expect(html).toContain(" OnclickFunction triggers API GET\n/apiURL ");
  expect(html).toContain("A previously linked file is unavailable");
});

it("renders named compact SVG tools with unchanged boundary refusal and visible Add/Save labels", () => {
  const html = render();
  const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/g)];
  const tool = (name: string) => {
    const button = buttons.find(match => match[1]!.includes(`aria-label="${name}"`));
    expect(button).toBeDefined();
    expect(button![1]).toContain('class="ui-icon-button ');
    expect(button![2]).toContain('<svg');
    expect(button![2]).toContain('aria-hidden="true"');
    return button!;
  };
  expect(buttons.filter(match => match[1]!.includes('class="ui-icon-button '))).toHaveLength(18);
  for (const name of ["Move step 1 up", "Move step 2 down", "Move Given item 1 up", "Move Given item 2 down", "Move When item 1 up", "Move When item 1 down"]) {
    expect(tool(name)[1]).toContain('disabled=""');
  }
  for (const name of ["Move step 1 down", "Move step 2 up", "Remove step 1", "Move Given item 1 down", "Remove Given item 1"]) {
    expect(tool(name)[1]).not.toContain('disabled=""');
  }
  expect(tool("Move step 1 up")[2]).toContain('d="M12 20V4m-6 6 6-6 6 6"');
  expect(tool("Move step 1 down")[2]).toContain('d="M12 4v16m-6-6 6 6 6-6"');
  expect(tool("Remove step 1")[2]).toContain('d="M4 7h16M9 7V3h6v4M6 7l1 14h10l1-14M10 11v6M14 11v6"');
  expect(html).not.toMatch(/>Move up<|>Move down<|>Remove step</);
  expect(html).not.toContain('role="tooltip"');
  for (const label of ["+ Add Given item", "+ Add When item", "+ Add Then item", "+ Add step", "Save changes"]) {
    expect(html).toContain(`>${label}</button>`);
  }
});
