import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import type { StepReviewBuffer } from "./step-execution-review-draft";
const source = readFileSync(new URL("../components/ReviewedStepObservation.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("ReviewedStepObservation.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => ts.createPrinter().printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+/, "")).join("\n");
const executable = ts.transpileModule(functions + "\nthis.fields=StepObservationFields;this.procedure=StepFrozenObservation;", { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
type FieldsProps = { buffer: Readonly<StepReviewBuffer>; editingEnabled: boolean; correction: boolean; physical?: boolean; onChange: (buffer: StepReviewBuffer) => boolean };
type InputProps = { id?: string; value?: string; onChange: (event: { target: { value: string } }) => void };
function renderer() { const context = vm.createContext({ React, useId: () => "synthetic-field-prefix" }); vm.runInContext(executable, context); return context as unknown as { fields: (props: FieldsProps) => React.ReactElement; procedure: (props: { definition: unknown; stepIndex: number }) => React.ReactElement }; }
function buffer(note: string | null = null): StepReviewBuffer { return { status: "", note, correctionReason: null, context: { specimen: " sample ", hardwareRevision: "", firmwareVersion: "", environment: " lab\n line " }, readings: [{ name: " Voltage ", value: "9007199254740993", unit: " V ", lowerLimit: "", upperLimit: "2.00", instrument: " meter " }], evidenceAttachmentIds: ["unavailable"] }; }
function descendants(node: unknown): React.ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(descendants);
  if (!React.isValidElement(node)) return [];
  return [node, ...descendants((node.props as { children?: unknown }).children)];
}
it.each([null, "", " exact\n text "])("actual controlled editor renders note %j without trimming/number conversion or old correction reuse", note => {
  const entered = buffer(note), html = renderToStaticMarkup(renderer().fields({ buffer: entered, editingEnabled: true, correction: true, onChange: () => true }));
  for (const label of ["Observed outcome", "What actually happened", "Why is this observation being corrected?", "Historical", "Optional measured evidence"]) {
    if (label !== "Historical") expect(html).toContain(label);
  }
  expect(html).toContain('value="9007199254740993"'); expect(html).toContain('value="2.00"'); expect(html).toContain('value=" V "');
  expect(html).toContain(note === null ? "NULL note retained" : note === "" ? "Empty text note, distinct from NULL" : " exact\n text ");
  expect(html).not.toContain('type="number"'); expect(entered.readings[0]?.value).toBe("9007199254740993");
});
it("actual input callbacks retain raw note/context/decimal text and optional-limit blanks", () => {
  const entered = buffer(), changes: StepReviewBuffer[] = [];
  const fields = descendants(renderer().fields({ buffer: entered, editingEnabled: true, correction: true, onChange: (next: StepReviewBuffer) => { changes.push(next); return true; } }));
  const note = fields.find(node => node.type === "textarea" && (node.props as InputProps).id?.endsWith("-note"))!;
  (note.props as InputProps).onChange({ target: { value: "  new\n exact note  " } }); expect(changes.at(-1)?.note).toBe("  new\n exact note  ");
  const decimal = fields.find(node => node.type === "input" && (node.props as InputProps).value === "9007199254740993")!;
  (decimal.props as InputProps).onChange({ target: { value: " 0.10000000000000001 " } }); expect(changes.at(-1)?.readings[0]?.value).toBe(" 0.10000000000000001 ");
  expect(changes.at(-1)?.readings[0]?.lowerLimit).toBe(""); expect(entered.note).toBeNull(); expect(entered.readings[0]?.value).toBe("9007199254740993");
});
it("readonly and physical templates retain the same controlled fields with real disabled/open attributes", () => {
  const html = renderToStaticMarkup(renderer().fields({ buffer: buffer("<script>payload</script>"), editingEnabled: false, correction: false, physical: true, onChange: () => true }));
  expect(html).toContain('<fieldset disabled=""'); expect(html).toContain('<details open=""'); expect(html).toContain("Measurements and controlled context"); expect(html).toContain("&lt;script&gt;payload&lt;/script&gt;"); expect(html).not.toContain("<script>");
});
it("frozen technical/action/result/response use identical stored coordinate, with exact NULL/empty/media/unknown disclosure", () => {
  const definition = { testCaseId: "case", given: ["Separate prerequisite"], steps: [{ order: 0, action: "First" }, { order: 1, action: " Click this button ", expectedActionOrData: "OnclickFunction GET /apiURL", expectedResult: "", expectedResponse: null, mediaAttachmentIds: ["retained-media"], unknown: [false, 0, ""] }] };
  const html = renderToStaticMarkup(renderer().procedure({ definition, stepIndex: 1 }));
  for (const value of ["Frozen step 2", "2. Tester action", "2. Technical behavior / data", "2. Expected result", "2. Expected response", " Click this button ", "OnclickFunction GET /apiURL", "Empty text", "NULL (retained)", "Separate prerequisite", "retained-media", "unknown"]) expect(html).toContain(value);
  expect(html).toContain("white-space:pre-wrap"); expect(html).not.toContain("Not supplied");
});
it("unsupported frozen step stays raw rather than being converted into a live substitute", () => {
  const html = renderToStaticMarkup(renderer().procedure({ definition: { steps: [{ order: 99, action: "<img src=x onerror=alert(1)>" }], retained: null }, stepIndex: 0 }));
  expect(html).toContain("Friendly step view is unsupported"); expect(html).toContain("&lt;img"); expect(html).toContain("&quot;retained&quot;: null"); expect(html).not.toContain("<img");
});
it("actual editor uses one guarded completion owner, mounted close retention and explicit draft seeding", () => {
  expect(source).toContain('<Modal size="wide" keepMounted'); expect(source).toContain("useStepExecutionReviewController(original"); expect(source).toContain("workflow.change(stepObservationBuffer(fresh))");
  expect(source).toContain("workflow.change(stepObservationEvidence(buffer, id, selected))"); expect(source).toContain("Retry identical reviewed request");
  expect(source).not.toMatch(/recordStepResult|parseStepMeasurements|\.trim\(|Number\(/);
});
