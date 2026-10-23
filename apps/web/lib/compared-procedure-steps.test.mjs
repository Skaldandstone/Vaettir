// Authored only. No test execution or rendered acceptance overnight.
import assert from "node:assert/strict";
import test from "node:test";
import { readComparedProcedureSteps } from "./compared-procedure-steps.ts";
const step = {
  order: 4,
  action: "Choose a sample\nthen record its label",
  expectedActionOrData: "",
  expectedResult: null,
  expectedResponse: "  Ω\nresponse  ",
  mediaAttachmentIds: ["image-ref", "video-ref"],
};
test("preserves exact ordered fields, explicit empty/null, whitespace and all media references", () => {
  const value = [step, { ...step, order: 9 }];
  assert.deepEqual(readComparedProcedureSteps(JSON.stringify(value)), value);
});
test("invalid row refuses the entire structured view instead of returning a supported prefix", () => {
  for (const invalid of [
    null,
    42,
    [],
    {},
    { ...step, extra: "unknown" },
    { ...step, action: null },
    { ...step, expectedResult: 0 },
    { ...step, mediaAttachmentIds: ["image-ref", "image-ref"] },
    { ...step, mediaAttachmentIds: ["image-ref", 42] },
  ])
    assert.equal(
      readComparedProcedureSteps(JSON.stringify([step, invalid])),
      null,
    );
});
test("unknown or missing fields and malformed JSON are never normalized into a procedure", () => {
  const { expectedResponse, ...missing } = step;
  assert.equal(readComparedProcedureSteps(JSON.stringify([missing])), null);
  assert.equal(readComparedProcedureSteps('{"steps":[]}'), null);
  assert.equal(readComparedProcedureSteps("["), null);
});
test("preserves empty procedure while refusing duplicate, reversed or overbound order and rows", () => {
  assert.deepEqual(readComparedProcedureSteps("[]"), []);
  for (const order of [4, 3, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
    assert.equal(
      readComparedProcedureSteps(JSON.stringify([step, { ...step, order }])),
      null,
    );
  assert.equal(
    readComparedProcedureSteps(
      JSON.stringify(
        Array.from({ length: 501 }, (_, order) => ({ ...step, order })),
      ),
    ),
    null,
  );
});
test("byte bounds and field limits refuse complete structured view", () => {
  assert.equal(
    readComparedProcedureSteps(
      JSON.stringify([{ ...step, action: "x".repeat(100001) }]),
    ),
    null,
  );
  assert.equal(
    readComparedProcedureSteps(" ".repeat(2 * 1024 * 1024 + 1)),
    null,
  );
  assert.equal(
    readComparedProcedureSteps(JSON.stringify("Ω".repeat(1024 * 1024))),
    null,
  );
});
