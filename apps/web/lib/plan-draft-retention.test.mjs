import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import ts from "typescript";

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
    useState(initial) { const index = hook++; return [index === 0 ? saving : index === 2 ? error : index === 3 ? draft : initial, () => {}]; },
    trpcReact: {
      useUtils: () => utils,
      testPlans: { byId: { useQuery: () => ({ data, error: loadError && { message: loadError } }) }, update: { useMutation: () => ({ mutateAsync: async value => { inputs.push(value); } }) }, addAcceptanceCriterion: { useMutation: () => ({}) }, deleteAcceptanceCriterion: { useMutation: () => ({}) } },
      requirements: { list: { useQuery: () => ({ data: [], error: null }) } },
    },
    PlanExecutionModal: "plan-execution", PlanCustomFieldsForm: "custom-fields",
    CriterionDescriptionEditor: "criterion-wording", CriterionVerdictEditor: "criterion-verdict", GovernedCriterionCollection: "criterion-collection", PlanGovernanceHistory: "governance-history", STATUSES: ["DRAFT", "ACTIVE", "IN_REVIEW", "APPROVED"],
  };
  vm.createContext(sandbox); vm.runInContext(compiled, sandbox);
  return { nodes: elements(sandbox.TestPlanDetailContent({ id: "synthetic", readOnly })), inputs };
}
test("actual plan component keeps mounted fields and governed editors when a save/refetch reports an error", () => {
  for (const values of [{ error: "Synthetic lost acknowledgement" }, { loadError: "Synthetic refetch failure" }]) {
    const { nodes } = render(values);
    assert.ok(nodes.some(node => node.props.role === "alert"));
    for (const type of ["custom-fields", "criterion-wording", "criterion-verdict", "criterion-collection", "governance-history"]) assert.ok(nodes.some(node => node.type === type), `${type} stays mounted`);
  }
});
test("actual plan role hiding preserves mounted edit children, and pending saves disable the complete field group", () => {
  const readonly = render({ readOnly: true }).nodes;
  assert.ok(readonly.some(node => node.type === "custom-fields"));
  assert.ok(readonly.some(node => node.type === "div" && node.props.hidden === true && elements(node).some(child => child.type === "custom-fields")));
  assert.ok(render({ saving: true }).nodes.some(node => node.type === "fieldset" && node.props.disabled === true));
});
test("actual save handler distinguishes untouched NULL, explicit empty text and exact multiline prose", async () => {
  for (const [draft, expected] of [[{}, undefined], [{ description: "" }, ""], [{ description: " line\n, text " }, " line\n, text "]]) {
    const { nodes, inputs } = render({ draft });
    await nodes.find(node => node.type === "button" && node.props.children === "Save").props.onClick();
    assert.equal(inputs.length, 1); assert.equal(inputs[0].description, expected);
  }
  for (const values of [{ readOnly: true }, { saving: true }]) {
    const { nodes, inputs } = render(values);
    await nodes.find(node => node.type === "button" && ["Save", "Saving…"].includes(node.props.children)).props.onClick();
    assert.equal(inputs.length, 0);
  }
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
