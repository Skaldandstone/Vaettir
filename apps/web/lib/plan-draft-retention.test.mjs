import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";
import { planMetadataChanges } from "./plan-root-metadata.ts";
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
function render(options = {}) {
  const { loadError = null, readOnly = false, projectId = "synthetic-project", signedIn = true, open = false } = options;
  // Explicitly absent query data must not accidentally use the fixture plan.
  const data = Object.hasOwn(options, "data") ? options.data : plan;
  const projectData = Object.hasOwn(options, "projectData") ? options.projectData : { id: projectId, organizationId: "synthetic-org" };
  const legacyAccesses = [];
  const utils = { testPlans: { byId: { invalidate() {} }, history: { invalidate() {} } } };
  const sandbox = {
    React,
    planMetadataChanges, describeRetainedPlanValue,
    useAuth: () => ({ isLoaded: true, isSignedIn: signedIn, userId: signedIn ? "synthetic-actor" : null }),
    useState(initial) { return [initial === false ? open : typeof initial === "function" ? initial() : initial, () => {}]; },
    trpcReact: {
      useUtils: () => utils,
      testPlans: { byId: { useQuery: () => ({ data, error: loadError && { message: loadError } }) }, get update() { legacyAccesses.push("update"); throw Error("Legacy whole-plan writes must never be mounted"); } },
      project: { byId: { useQuery: () => ({ data: projectData }) } },
      requirements: { list: { useQuery: () => ({ data: [], error: null }) } },
    },
    PlanExecutionModal: "plan-execution", PlanStatusEditor: "plan-status", PlanCustomFieldsEditor: "plan-fields",
    CriterionDescriptionEditor: "criterion-wording", CriterionVerdictEditor: "criterion-verdict", GovernedCriterionCollection: "criterion-collection", PlanHeaderEditor: "plan-header", PlanGovernanceHistory: "governance-history",
  };
  vm.createContext(sandbox); vm.runInContext(compiled, sandbox);
  return { nodes: elements(sandbox.TestPlanDetailContent({ id: "synthetic", projectId, readOnly })), legacyAccesses };
}
function renderHistory(data, error = null) {
  const sandbox = { React, planMetadataChanges, trpcReact: {testPlans: {history: {useQuery: () => ({data,error,isPending:false,refetch() {}})}}} };
  vm.createContext(sandbox);vm.runInContext(compiled,sandbox);
  return elements(sandbox.VersionHistorySection({testPlanId:"synthetic"}));
}
test("actual plan component keeps independent governed editors mounted across retained and unavailable read errors", () => {
  for (const values of [{ loadError: "Synthetic refetch failure" }, { loadError: "Synthetic original access loss", data: undefined }]) {
    const { nodes } = render(values);
    assert.ok(nodes.some(node => node.props.role === "alert"));
    for (const type of ["plan-fields", "plan-status", "plan-header"]) assert.ok(nodes.some(node => node.type === type), `${type} stays mounted`);
  }
});
test("actual parent retains the same execution-owner element across unavailable reads while withholding its visible dialog", () => {
  const initial = render({ open: true }).nodes.find(node => node.type === "plan-execution");
  assert.ok(initial);
  assert.equal(initial.props.open, true);
  for (const values of [
    { loadError: "Synthetic original access loss", data: undefined },
    { data: undefined },
    { data: { ...plan, projectId: "different-project" } },
    { readOnly: true },
    { signedIn: false },
  ]) {
    const retained = render({ ...values, open: true }).nodes.find(node => node.type === "plan-execution");
    assert.ok(retained, "Unavailable parent metadata must not unmount a held draft or UNKNOWN start owner");
    assert.equal(retained.type, initial.type);
    assert.equal(retained.key, initial.key);
    assert.equal(retained.props.id, initial.props.id);
    assert.equal(retained.props.projectId, "synthetic-project");
    assert.equal(retained.props.open, false, "Retention is not permission to show stale execution metadata");
  }
});
test("actual parent role hiding preserves each independently guarded controller, not a shared legacy mutation", () => {
  const readonly = render({ readOnly: true }).nodes;
  assert.ok(readonly.some(node => node.type === "plan-header" && node.props.readOnly === true));
  for (const type of ["plan-fields", "plan-status"]) assert.ok(readonly.some(node => node.type === type && node.props.readOnly === true));
  assert.deepEqual(render({ readOnly: true }).legacyAccesses, []);
});
test("execution discovery passes only the route project's organization and never fabricates native identity", () => {
  const current = render().nodes.find(node => node.type === "plan-execution");
  assert.equal(current.props.organizationId, "synthetic-org");
  assert.equal(Object.hasOwn(current.props, "nativeOrganizationId"), false);
  for (const projectData of [undefined, { id: "different-project", organizationId: "unrelated-org" }]) {
    const retained = render({ projectData }).nodes.find(node => node.type === "plan-execution");
    assert.ok(retained);
    assert.equal(retained.key, current.key);
    assert.equal(retained.props.organizationId, undefined);
    assert.equal(Object.hasOwn(retained.props, "nativeOrganizationId"), false);
  }
});
test("whole-record legacy save is absent rather than resending stale header/status/metadata", () => {
  const { nodes, legacyAccesses } = render();
  assert.equal(nodes.some(node => node.type === "button" && node.props.children === "Save status and fields"), false);
  assert.deepEqual(legacyAccesses, []);
  assert.doesNotMatch(source, /testPlans\.update\.useMutation|legacyPlanMetadataPatch|updateMutation\.mutateAsync/);
  for (const type of ["plan-header", "plan-status", "plan-fields"]) assert.ok(nodes.some(node => node.type === type));
});
test("retained native NULL/array/scalar metadata keeps status/field controllers mounted without fabricated defaults", () => {
  for (const customFields of [null, [" retained ", false, 0], "exact prose", false, 0]) {
    const { nodes, legacyAccesses } = render({ data: { ...plan, customFields } });
    assert.ok(nodes.some(node => node.type === "plan-header"));
    assert.ok(nodes.some(node => node.type === "governance-history"));
    assert.ok(nodes.some(node => node.type === "plan-status")); assert.ok(nodes.some(node => node.type === "plan-fields"));
    assert.ok(nodes.some(node => node.type === "pre" && node.props.children === describeRetainedPlanValue(customFields, true)));
    assert.deepEqual(legacyAccesses, []);
  }
});
test("route-project mismatch hides unrelated body while current-scoped controls remain mounted", () => {
  const { nodes, legacyAccesses } = render({ data: { ...plan, projectId: "different-project" } });
  assert.equal(nodes.some(node => node.type === "h1" && node.props.children === plan.name), false);
  assert.ok(nodes.some(node => node.props.role === "alert"));
  for (const type of ["plan-header", "plan-status", "plan-fields"]) assert.ok(nodes.some(node => node.type === type && node.props.projectId === "synthetic-project"));
  assert.deepEqual(legacyAccesses, []);
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
  assert.match(drawer, /projectId=\{projectId\}/);
  assert.match(page, /projectId=\{params.projectId\}/);
});
test("both plan and release mount guarded criterion collection, not unbounded legacy add/remove pickers", () => {
  const release = readFileSync(new URL("../app/projects/[projectId]/releases/[releaseId]/page.tsx", import.meta.url), "utf8");
  for (const page of [source, release]) assert.match(page, /<GovernedCriterionCollection key=\{/);
  assert.doesNotMatch(source, /testPlans\.(addAcceptanceCriterion|deleteAcceptanceCriterion|updateAcceptanceCriterion|requirements\.list)/);
  assert.doesNotMatch(source, /New acceptance criterion, press Enter/);
});
