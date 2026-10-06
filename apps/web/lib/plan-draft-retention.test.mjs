import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import { legacyPlanMetadataPatch, planMetadataChanges, planMetadataRecord } from "./plan-root-metadata.ts";
import { describeRetainedPlanValue } from "./plan-custom-fields.ts";

const source = readFileSync(new URL("../components/TestPlanDetailContent.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("plan.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const printer = ts.createPrinter();
const declarations = ast.statements.filter(ts.isFunctionDeclaration).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/^export /, ""));
const compiled = ts.transpileModule(declarations.join("\n"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
const plan = { id: "synthetic", projectId: "synthetic-project", name: "Synthetic plan", description: null, status: "DRAFT", customFields: {}, testPlanType: { key: "functional", name: "Functional", fieldSchema: {} }, acceptanceCriteria: [{ id: "synthetic-criterion", description: "Retained wording", status: "PENDING" }], linkedPlans: [] };
function elements(element) {
  if (!React.isValidElement(element)) return [];
  return [element, ...React.Children.toArray(element.props.children).flatMap(elements)];
}
function render({ error = null, loadError = null, readOnly = false, saving = false, draft = {}, data = plan } = {}) {
  let hook = 0;
  const inputs = [];
  const utils = { testPlans: { byId: { invalidate() {} }, history: { invalidate() {} } } };
  const sandbox = {
    React,
    legacyPlanMetadataPatch, planMetadataChanges, planMetadataRecord, describeRetainedPlanValue,
    useState(initial) { const index = hook++; return [index === 0 ? saving : index === 2 ? error : index === 3 ? draft : initial, () => {}]; },
    trpcReact: {
      useUtils: () => utils,
      testPlans: { byId: { useQuery: () => ({ data, error: loadError && { message: loadError } }) }, update: { useMutation: () => ({ mutateAsync: async value => { inputs.push(value); } }) }, addAcceptanceCriterion: { useMutation: () => ({}) }, deleteAcceptanceCriterion: { useMutation: () => ({}) } },
      requirements: { list: { useQuery: () => ({ data: [], error: null }) } },
    },
    PlanExecutionModal: "plan-execution", PlanCustomFieldsForm: "custom-fields",
    CriterionDescriptionEditor: "criterion-wording", CriterionVerdictEditor: "criterion-verdict", GovernedCriterionCollection: "criterion-collection", PlanHeaderEditor: "plan-header", PlanGovernanceHistory: "governance-history", STATUSES: ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"],
  };
  vm.createContext(sandbox); vm.runInContext(compiled, sandbox);
  return { nodes: elements(sandbox.TestPlanDetailContent({ id: "synthetic", readOnly })), inputs };
}
function renderHistory(data, error = null) {
  const sandbox = { React, planMetadataChanges, trpcReact: {testPlans: {history: {useQuery: () => ({data,error,isPending:false,refetch() {}})}}} };
  vm.createContext(sandbox);vm.runInContext(compiled,sandbox);
  return elements(sandbox.VersionHistorySection({testPlanId:"synthetic"}));
}
test("actual plan component keeps mounted fields and governed editors when a save/refetch reports an error", () => {
  for (const values of [{ error: "Synthetic lost acknowledgement" }, { loadError: "Synthetic refetch failure" }]) {
    const { nodes } = render(values);
    assert.ok(nodes.some(node => node.props.role === "alert"));
    for (const type of ["custom-fields", "criterion-wording", "criterion-verdict", "criterion-collection", "plan-header", "governance-history"]) assert.ok(nodes.some(node => node.type === type), `${type} stays mounted`);
  }
});
test("actual plan role hiding preserves mounted edit children, and pending saves disable the complete field group", () => {
  const readonly = render({ readOnly: true }).nodes;
  assert.ok(readonly.some(node => node.type === "plan-header" && node.props.readOnly === true));
  assert.ok(readonly.some(node => node.type === "custom-fields"));
  assert.ok(readonly.some(node => node.type === "div" && node.props.hidden === true && elements(node).some(child => child.type === "custom-fields")));
  assert.ok(render({ saving: true }).nodes.some(node => node.type === "fieldset" && node.props.disabled === true));
});
test("legacy settings save never resends header text, even if a retained older draft contains it", async () => {
  for (const draft of [{}, { name: "Older cached name", description: "" }, { description: " line\n, text " }]) {
    const { nodes, inputs } = render({ draft });
    await nodes.find(node => node.type === "button" && node.props.children === "Save status and fields").props.onClick();
    assert.equal(inputs.length, 1);
    assert.equal(Object.hasOwn(inputs[0], "description"), false);
    assert.equal(Object.hasOwn(inputs[0], "name"), false);
    assert.equal(inputs[0].status, "DRAFT");
    assert.equal(Object.hasOwn(inputs[0], "customFields"), false);
  }
  for (const values of [{ readOnly: true }, { saving: true }]) {
    const { nodes, inputs } = render(values);
    await nodes.find(node => node.type === "button" && ["Save status and fields", "Saving…"].includes(node.props.children)).props.onClick();
    assert.equal(inputs.length, 0);
  }
});
test("retained native NULL/array/scalar metadata keeps governed editors mounted and is never replaced by a status save", async () => {
  for (const customFields of [null, [" retained ", false, 0], "exact prose", false, 0]) {
    const { nodes, inputs } = render({ data: { ...plan, customFields } });
    assert.ok(nodes.some(node => node.type === "plan-header"));
    assert.ok(nodes.some(node => node.type === "governance-history"));
    assert.equal(nodes.some(node => node.type === "custom-fields"), false);
    await nodes.find(node => node.type === "button" && node.props.children === "Save status and fields").props.onClick();
    assert.equal(inputs.length, 1); assert.equal(Object.hasOwn(inputs[0], "customFields"), false);
  }
});
test("explicit ordinary metadata edits remain lossless without echoing header fields", async () => {
  const customFields = { raw: " exact\ntext ", future: [false, 0, null] };
  const {nodes,inputs}=render({draft:{customFields}});
  await nodes.find(node=>node.type === "button" && node.props.children === "Save status and fields").props.onClick();
  assert.equal(inputs[0].customFields, customFields);assert.equal(Object.hasOwn(inputs[0],"name"),false);assert.equal(Object.hasOwn(inputs[0],"description"),false);
});
test("history read errors never become No history yet, and retained root JSON is diffed without crashing",()=>{
  const failed=renderHistory([], {message:"Synthetic bounded history refusal"});
  assert.ok(failed.some(node=>node.props.role === "alert"));
  assert.equal(failed.some(node=>node.props.children === "No history yet."),false);
  const base={name:"Synthetic",description:null,status:"DRAFT",executionTemplate:null,createdAt:new Date("2026-10-05T12:00:00Z"),createdBy:null};
  const nodes=renderHistory([{...base,versionNumber:2,customFields:[" raw ",false,0]},{...base,versionNumber:1,customFields:null}]);
  assert.ok(nodes.some(node=>node.props.children === "Retained root metadata changed"));
});
test("the guarded header is identity keyed and remains mounted independently of legacy fields", () => {
  const header = render().nodes.find(node => node.type === "plan-header");
  // elements() uses Children.toArray, which escapes ':' in React's key path.
  const expectedKey = React.Children.toArray(React.createElement("plan-header", { key: "synthetic-project:synthetic" }))[0].key;
  assert.equal(header.key, expectedKey);
  assert.equal(header.props.projectId, "synthetic-project");
  assert.equal(header.props.testPlanId, "synthetic");
});
test("plan drawer and route never reuse one plan's mounted drafts as another plan", () => {
  const drawer = readFileSync(new URL("../app/projects/[projectId]/test-plans/page.tsx", import.meta.url), "utf8");
  const page = readFileSync(new URL("../app/projects/[projectId]/test-plans/[id]/page.tsx", import.meta.url), "utf8");
  assert.match(drawer, /<TestPlanDetailContent\s+key=\{openPlanId\}\s+id=\{openPlanId\}/);
  assert.match(page, /<TestPlanDetailContent key=\{params.id\} id=\{params.id\}/);
});
test("both plan and release mount guarded criterion collection, not unbounded legacy add/remove pickers", () => {
  const release = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
  for (const page of [source, release]) assert.match(page, /<GovernedCriterionCollection key=\{/);
  assert.doesNotMatch(source, /testPlans\.(addAcceptanceCriterion|deleteAcceptanceCriterion|updateAcceptanceCriterion|requirements\.list)/);
  assert.doesNotMatch(source, /New acceptance criterion, press Enter/);
});
