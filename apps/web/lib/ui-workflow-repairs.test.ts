import { controllerTranspile } from "./controller-transpile.fixture";
// Actual React component declarations with synthetic RPC/access/controller
// boundaries. These tests do not establish browser geometry or live acceptance.
import { readFileSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { expect, it } from "vitest";
import * as core from "@vaettir/core";
import { inspectorLabel } from "./case-inspector";

function compile(file: string, dependencies: Record<string, unknown>) {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const code = controllerTranspile(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React,
  } }).outputText;
  const exports: Record<string, (props: Record<string, unknown>) => React.ReactElement> = {};
  new Function("require", "exports", "React", code)((name: string) => {
    if (!(name in dependencies)) throw Error(`Unreviewed dependency: ${name}`);
    return dependencies[name];
  }, exports, React);
  return exports;
}
function nodes(root: React.ReactNode): React.ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(root)) return root.flatMap(nodes);
  if (!React.isValidElement<Record<string, unknown>>(root)) return [];
  return [root, ...nodes(root.props.children as React.ReactNode)];
}
function button(root: React.ReactNode, text: string) {
  const result = nodes(root).find(node => node.type === "button" && node.props.children === text);
  if (!result) throw Error(`Actual button missing: ${text}`);
  return result.props.onClick as () => void | Promise<void>;
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (cause: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function flush() { for (let i = 0; i < 8; i++) await Promise.resolve(); }

const distribution = compile("../components/TestTypeDistribution.tsx", {
  "@/lib/case-inspector": { inspectorLabel },
}).TestTypeDistribution!;
it("renders 851 Functional cases as a bounded donut with a labelled exact legend", () => {
  const html = renderToStaticMarkup(distribution({ cases: Array.from({ length: 851 }, () => ({ testType: "functional" })) }));
  expect(html).toContain('viewBox="0 0 160 160"');
  expect(html).toContain("Functional 851 of 851");
  expect(html).toContain('stroke-dasharray="100 0"');
  expect(html).toContain("Functional: 851 (100%)");
  expect(html).not.toContain("<meter");
  expect(html).not.toContain("NaN");
});
it("keeps mixed inventory counts and empty charts truthful without inventing readiness", () => {
  const html = renderToStaticMarkup(distribution({ cases: [{ testType: "API" }, { testType: "API" }, { testType: "UI" }, { testType: "<custom>" }] }));
  expect(html).toContain("API: 2 (50%)");
  expect(html).toContain("UI: 1 (25%)");
  expect(html).toContain("&lt;custom&gt;");
  expect(html.match(/pathLength="100"/g)).toHaveLength(3);
  const empty = renderToStaticMarkup(distribution({ cases: [] }));
  expect(empty).toContain("No cases");
  expect(empty).not.toMatch(/NaN|Infinity|pathLength/);
  expect(html).not.toMatch(/Pass rate|Ready to release/);
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
  expect(css).toContain(".test-type-donut { width: 180px; height: 180px");
  expect(css).toContain(".test-type-total { fill: var(--fg)");
});

function wizard() {
  const profile = core.experienceProfileSchema.parse({ version: 1, offerings: ["SOFTWARE"], softwareKinds: ["API"], gameGenres: [], gamePlatforms: [], multiplayerModes: [], hardwareKinds: [], processKinds: [], jurisdictions: [] });
  const state: unknown[] = [profile, "a".repeat(64), "review", null, false, false, ""];
  const refs: { current: unknown }[] = [];
  let stateCursor = 0, refCursor = 0, closes = 0, writes = 0;
  let input: unknown;
  let canEdit = true;
  let invalidateFailure = false;
  const ack = deferred<{ experience: typeof profile; profileHash: string }>();
  const component = compile("../components/QualityExperienceWizard.tsx", {
    react: {
      useState: (initial: unknown) => { const slot = stateCursor++; if (!(slot in state)) state[slot] = initial; return [state[slot], (value: unknown) => { state[slot] = typeof value === "function" ? (value as (old: unknown) => unknown)(state[slot]) : value; }]; },
      useRef: (initial: unknown) => { const slot = refCursor++; return refs[slot] ?? (refs[slot] = { current: initial }); },
      useEffect: () => undefined,
      useLayoutEffect: (effect: () => void) => effect(),
    },
    "@vaettir/core": core,
    "@/lib/use-project-permissions": { useProjectPermissions: () => ({ loaded: true, canEdit, accessError: null }) },
    "./Modal": { Modal: ({ children }: { children: React.ReactNode }) => React.createElement("div", null, children) },
    "@/lib/trpcReact": { trpcReact: {
      project: { experience: { useQuery: () => ({ data: { experience: profile, profileHash: "a".repeat(64) }, isFetching: false }) }, saveExperience: { useMutation: () => ({ isPending: false, mutateAsync: (body: unknown) => { writes++; input = body; return ack.promise; } }) } },
      useUtils: () => ({ project: { experience: { invalidate: () => invalidateFailure ? Promise.reject(Error("Synthetic refresh failure")) : Promise.resolve() } } }),
    } },
  }).QualityExperienceWizard!;
  function render(overrides: Record<string, unknown> = {}) {
    stateCursor = 0; refCursor = 0;
    return component({ projectId: "synthetic-project", open: true, onClose: () => { closes++; }, ...overrides });
  }
  return { render, ack, profile, state, get closes() { return closes; }, get writes() { return writes; }, get input() { return input; }, setCanEdit: (value: boolean) => { canEdit = value; }, failRefresh: () => { invalidateFailure = true; } };
}
it("shows the actual guidance cards openly rather than a collapsed bullet-point preview", () => {
  const h = wizard(), tree = h.render(), html = renderToStaticMarkup(tree);
  expect(html).toContain('aria-label="Testing workflow preview"');
  expect(html.match(/class="experience-guidance-card"/g)).toHaveLength(4);
  expect(html).toContain("Save and close");
  expect(html).not.toContain("Close and keep draft");
  // Guidance cards remain visible; supporting prose can be expanded separately.
  expect(html).toContain("<details><summary>Details</summary>");
});
it("Save and close waits for the exact ACK and refuses duplicate same-render submission", async () => {
  const h = wizard(), click = button(h.render(), "Save and close");
  click(); click();
  expect(h.writes).toBe(1); expect(h.closes).toBe(0);
  expect(h.input).toEqual({ projectId: "synthetic-project", expectedProfileHash: "a".repeat(64), experience: h.profile });
  h.ack.resolve({ experience: h.profile, profileHash: "b".repeat(64) }); await flush();
  expect(h.closes).toBe(1); expect(h.state[4]).toBe(true);
  button(h.render(), "Close")();
  expect(h.writes).toBe(1);
});
it.each(["failure", "malformed", "mismatch"])("retains the original draft without closing after %s", async kind => {
  const h = wizard(); button(h.render(), "Save and close")();
  if (kind === "failure") h.ack.reject(Error("Synthetic conflict"));
  else h.ack.resolve({ experience: kind === "mismatch" ? { ...h.profile, jurisdictions: ["Canada"] } : h.profile, profileHash: kind === "malformed" ? "invalid" : "b".repeat(64) });
  await flush(); expect(h.closes).toBe(0); expect(h.state[0]).toEqual(h.profile); expect(h.state[4]).toBe(false);
  expect(h.state[3]).toContain("Your draft is retained");
});
it("a failed independent refresh does not undo a confirmed save or reissue the write", async () => {
  const h = wizard(); h.failRefresh(); button(h.render(), "Save and close")();
  h.ack.resolve({ experience: h.profile, profileHash: "b".repeat(64) }); await flush();
  expect(h.closes).toBe(1); expect(h.writes).toBe(1); expect(h.state[4]).toBe(true);
  expect(h.state[3]).toContain("was saved");
});
it.each(["project", "closed", "access"])("an ACK does not close a different or no-longer-editable frame: %s", async change => {
  const h = wizard(); button(h.render(), "Save and close")();
  if (change === "access") h.setCanEdit(false);
  h.render(change === "project" ? { projectId: "different-project" } : change === "closed" ? { open: false } : {});
  h.ack.resolve({ experience: h.profile, profileHash: "b".repeat(64) }); await flush();
  expect(h.closes).toBe(0); expect(h.writes).toBe(1);
});

type Dataset = { parameterNames: string[]; rows: { name: string; values: Record<string, string> }[] };
function dataset(saved: Dataset = { parameterNames: [], rows: [] }) {
  const source = readFileSync(new URL("../components/TestCaseDetailContent.tsx", import.meta.url), "utf8");
  const ast = ts.createSourceFile("Detail.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "DatasetSection");
  if (!fn) throw Error("Actual dataset declaration missing");
  const code = controllerTranspile(ts.createPrinter().printNode(ts.EmitHint.Unspecified, fn, ast), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React },
  }).outputText;
  const state: unknown[] = [null, false, false, false, null, ""];
  let cursor = 0, writes = 0, input: unknown;
  const ack = deferred<unknown>();
  const useState = (initial: unknown) => {
    const slot = cursor++; if (!(slot in state)) state[slot] = initial;
    return [state[slot], (value: unknown) => { state[slot] = typeof value === "function" ? (value as (old: unknown) => unknown)(state[slot]) : value; }];
  };
  const refuse = () => { throw Error("No run or deletion allowed in dataset grid fixtures"); };
  const trpcReact = {
    testCaseDatasets: {
      get: { useQuery: () => ({ data: saved }) }, expandedPreview: { useQuery: () => ({ data: [] }) },
      save: { useMutation: () => ({ mutateAsync: (body: unknown) => { input = body; writes++; return ack.promise; } }) },
      delete: { useMutation: () => ({ mutateAsync: refuse }) },
    },
    useUtils: () => ({ testCaseDatasets: { get: { invalidate: () => Promise.resolve() }, expandedPreview: { invalidate: () => Promise.resolve() } } }),
  };
  const component = new Function("React", "useState", "trpcReact", "DatasetExecutionWizard", code + "\nreturn DatasetSection;")(
    React, useState, trpcReact, () => null,
  ) as (props: Record<string, unknown>) => React.ReactElement;
  function render(readOnly = false) { cursor = 0; return component({ testCaseId: "synthetic-case", projectId: "synthetic-project", readOnly }); }
  function change(root: React.ReactNode, label: string, value: string) {
    const input = nodes(root).find(node => node.props["aria-label"] === label || (label === "Parameter name" && node.type === "input" && node.props.placeholder === "e.g. username"));
    if (!input) throw Error(`Actual input missing: ${label}`);
    (input.props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
  }
  return { render, change, ack, state, get writes() { return writes; }, get input() { return input; } };
}
it("dataset guidance is format-neutral and does not require Gherkin", () => {
  const h = dataset(), html = renderToStaticMarkup(h.render());
  expect(html).toContain("Add parameters and value rows for this test.");
  expect(html).toContain("&lt;paramName&gt;");
  expect(html).not.toContain("given/when/then");
  expect(h.writes).toBe(0);
});
it("the real dataset editor uses inline named columns and creates the first editable value row", () => {
  const h = dataset(); button(h.render(), "Add data set")();
  h.change(h.render(), "Parameter name", " username "); button(h.render(), "Add parameter")();
  const html = renderToStaticMarkup(h.render());
  expect(html).toContain('aria-label="Dataset values grid"');
  expect(html).toContain('<th scope="col">username</th>');
  expect(html).toContain('aria-label="Row 1: username"');
  expect(h.state[0]).toEqual({ parameterNames: ["username"], rows: [{ name: "Row 1", values: { username: "" } }] });
  expect(h.writes).toBe(0);
});
it("adding a dataset column preserves old rows and raw multiline values and rejects duplicate names", () => {
  const original = { parameterNames: ["username"], rows: [{ name: " exact row ", values: { username: " original\nvalue | kept " } }] };
  const before = JSON.stringify(original), h = dataset(original);
  button(h.render(), "Edit")(); h.change(h.render(), "Parameter name", "username"); button(h.render(), "Add parameter")();
  expect(h.state[4]).toContain("already exists"); expect(h.state[0]).toBeNull();
  h.change(h.render(), "Parameter name", "password"); button(h.render(), "Add parameter")();
  expect(h.state[0]).toEqual({ parameterNames: ["username", "password"], rows: [{ name: " exact row ", values: { username: " original\nvalue | kept ", password: "" } }] });
  expect(JSON.stringify(original)).toBe(before); expect(h.writes).toBe(0);
});
it("saving grid values sends only dataset data and a failed save retains every edited cell", async () => {
  const h = dataset({ parameterNames: ["username"], rows: [{ name: "Row 1", values: { username: "old" } }] });
  button(h.render(), "Edit")(); h.change(h.render(), "Row 1: username", " new\nvalue ");
  button(h.render(), "Save data set")();
  expect(h.input).toEqual({ testCaseId: "synthetic-case", parameterNames: ["username"], rows: [{ name: "Row 1", values: { username: " new\nvalue " } }] });
  expect(h.writes).toBe(1);
  h.ack.reject(Error("Synthetic save failed")); await flush();
  expect(h.state[1]).toBe(true); expect(h.state[4]).toBe("Synthetic save failed");
  expect(renderToStaticMarkup(h.render())).toContain(" new\nvalue ");
});
it("permission loss keeps the dataset draft mounted but disables saving and adding rows", () => {
  const h = dataset(); button(h.render(), "Add data set")();
  h.change(h.render(), "Parameter name", "username"); button(h.render(), "Add parameter")();
  const prior = JSON.stringify(h.state[0]), tree = h.render(true);
  expect(renderToStaticMarkup(tree)).toContain('<fieldset disabled=""');
  button(tree, "Save data set")(); button(tree, "+ Row")();
  expect(h.writes).toBe(0); expect(JSON.stringify(h.state[0])).toBe(prior);
});
it("prerequisites precede procedures and the same priority controller remains mounted outside metadata", () => {
  const source = readFileSync(new URL("../components/TestCaseDetailContent.tsx", import.meta.url), "utf8");
  const start = source.indexOf('id={`${sectionId}-panel-Procedure`}');
  expect(start).toBeGreaterThan(0);
  const procedure = source.slice(start, source.indexOf('id={`${sectionId}-panel-Intelligence`}', start));
  expect(procedure.indexOf("<TestCasePrerequisites")).toBeLessThan(procedure.indexOf("<table"));
  expect(source.match(/<TestCasePrerequisites\b/g)).toHaveLength(1);
  expect(source).toMatch(/<\/dl>\s*<div className=\{styles.priorityControl\}>/);
  expect(source).not.toMatch(/!readOnly &&\s*<CasePriorityField/);
});
