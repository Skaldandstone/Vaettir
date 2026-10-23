// Authored source assertions only. No execution or rendered validation overnight.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const ui = readFileSync(
  new URL("../components/ManualRetestWizard.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../../api/src/services/manualRetest.ts", import.meta.url),
  "utf8",
);
test("scoped retest preview projects captured labels, not current project labels or changed snapshot keys", () => {
  assert.ok(service.includes("stepFieldLabels: frozen.stepFieldLabels"));
  const projectionEnd = service.indexOf("/** Bounded direct relationships");
  const projection = service.slice(
    service.lastIndexOf("return {", projectionEnd),
    projectionEnd,
  );
  assert.ok(projection.includes("input.expectedScope ?"));
  assert.ok(projection.includes("stepFieldLabels: frozen.stepFieldLabels"));
  assert.ok(ui.includes("preview.stepFieldLabels?.expectedActionOrData"));
  assert.ok(ui.includes("preview.stepFieldLabels?.expectedResponse"));
});
test("frozen step review retains sequence, stored order, all literal expected fields and media references", () => {
  const table = ui.slice(
    ui.indexOf("{c.steps.length > 0"),
    ui.indexOf("Object.entries(c.verificationProfile)"),
  );
  assert.ok(table.includes("c.steps.map((step, index)"));
  assert.ok(table.includes("{step.order}"));
  assert.ok(table.includes("{index + 1}"));
  for (const key of [
    "action",
    "expectedActionOrData",
    "expectedResult",
    "expectedResponse",
  ])
    assert.ok(table.includes(`"${key}"`));
  assert.ok(table.includes('step[field] === null ? "Not supplied"'));
  assert.ok(table.includes("<em>Empty string</em>"));
  assert.ok(table.includes("step.mediaAttachmentIds.map"));
  assert.ok(table.includes('whiteSpace: "pre-wrap"'));
  assert.ok(table.includes('role="region"'));
  assert.ok(table.includes("tabIndex={0}"));
  assert.ok(!table.includes(".filter("));
  assert.ok(!table.includes(".sort("));
  assert.ok(!table.includes("fetch("));
});
test("all original dataset values are reviewed without truthy filtering or current-dataset substitution", () => {
  const dataset = ui.slice(
    ui.indexOf("{preview.sourceDatasetExecution &&"),
    ui.indexOf("<summary>Captured original result evidence"),
  );
  assert.ok(
    dataset.includes(
      "Object.entries(preview.sourceDatasetExecution.values).map",
    ),
  );
  assert.ok(dataset.includes('value === "" ? <em>Empty string</em> : value'));
  assert.ok(dataset.includes("No dataset values were captured"));
  assert.ok(!dataset.includes(".filter("));
  assert.ok(!dataset.includes("useQuery"));
  assert.ok(
    ui.indexOf("!access.ready || accessRejected ?") <
      ui.indexOf("Captured original dataset values"),
  );
});
