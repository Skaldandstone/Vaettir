import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  caseFieldValueControlHarness,
  caseFieldValueControlHost,
  caseFieldValueControlElements,
} from "./case-field-value-controls.fixture.mjs";
const source = readFileSync(
  new URL("../components/CaseCustomFields.tsx", import.meta.url),
  "utf8",
);
const render = (props) =>
  caseFieldValueControlHost(caseFieldValueControlHarness())({
    ...props,
    onValidityChange: () => {},
  });
const elements = (node, type) =>
  caseFieldValueControlElements(node).filter((value) => value.type === type);
const definition = {
  key: "technical_notes",
  label: "Technical notes",
  type: "TEXT",
  required: false,
  retired: false,
  options: [],
};
test("actual native TEXT editor renders retained multiline prose without single-line normalization", () => {
  const values = {
    technical_notes: "first line\n  retained, second line\nλ 🎮",
    unknown: "literal, retained",
  };
  const output = render({
    fields: [definition],
    values,
    disabled: false,
    onChange: () => assert.fail("render must not publish a mutation"),
  });
  const controls = elements(output, "textarea");
  assert.equal(controls.length, 1);
  assert.equal(controls[0].props.value, values.technical_notes);
  assert.equal(controls[0].props.rows, 4);
  assert.equal(controls[0].props.maxLength, 2000);
  assert.equal(elements(output, "input").length, 0);
});
test("multiline TEXT edits preserve exact supplied text and all unedited siblings", () => {
  const values = Object.freeze({
      technical_notes: "Original\ntext",
      flag: false,
      count: 0,
      retired: "",
      unknown: "literal, retained",
    }),
    changes = [];
  const control = elements(
    render({
      fields: [definition],
      values,
      disabled: false,
      onChange: (value) => changes.push(value),
    }),
    "textarea",
  )[0];
  control.props.onChange({ target: { value: "Updated\n  comma, value\n" } });
  assert.equal(changes[0].technical_notes, "Updated\n  comma, value\n");
  for (const key of ["flag", "count", "retired", "unknown"])
    assert.equal(changes[0][key], values[key]);
  assert.equal(values.technical_notes, "Original\ntext");
});
test("explicit empty/NULL/unset and disabled required controls preserve native distinctions", () => {
  const changes = [],
    control = elements(
      render({
        fields: [{ ...definition, required: true }],
        values: { technical_notes: null },
        disabled: true,
        onChange: (value) => changes.push(value),
      }),
      "textarea",
    )[0];
  assert.equal(control.props.disabled, true);
  assert.equal(control.props.required, true);
  assert.equal(control.props.value, "");
  control.props.onChange({ target: { value: "" } });
  assert.equal(
    changes.length,
    0,
    "Disabled handler never mutates a retained value",
  );
  const editable = render({
    fields: [definition],
    values: { technical_notes: "saved", retained: false },
    disabled: false,
    onChange: (value) => changes.push(value),
  });
  elements(editable, "textarea")[0].props.onChange({ target: { value: "" } });
  assert.equal(
    changes.pop().technical_notes,
    "",
    "Empty authored text is not NULL",
  );
  elements(editable, "button")
    .find((button) => button.props.children === "Set NULL explicitly")
    .props.onClick();
  assert.equal(changes.pop().technical_notes, null);
  elements(editable, "button")
    .find((button) => button.props.children === "Remove value (unset)")
    .props.onClick();
  assert.deepEqual({ ...changes.pop() }, { retained: false });
});
test("non-TEXT native types retain dropdown/date/number controls without changing schema types", () => {
  const fields = ["BOOLEAN", "CHOICE", "DATE", "NUMBER"].map((type, index) => ({
    ...definition,
    type,
    key: `field_${index}`,
    options: type === "CHOICE" ? ["One", "Two"] : [],
  }));
  const output = render({
    fields,
    values: {
      field_0: false,
      field_1: "Two",
      field_2: "2026-10-05",
      field_3: 0,
    },
    disabled: false,
    onChange: () => {},
  });
  assert.equal(elements(output, "textarea").length, 0);
  assert.equal(elements(output, "select").length, 2);
  assert.deepEqual(
    elements(output, "input").map((control) => control.props.type),
    ["date", "text"],
  );
  assert.equal(
    elements(output, "input")[1].props.inputMode,
    "decimal",
    "Native NUMBER uses a raw text buffer, not a new data type",
  );
  assert.equal(elements(output, "select")[0].props.value, "FALSE");
  assert.equal(elements(output, "input")[1].props.value, "0");
  assert.match(
    source,
    /expectedValueHash:\s*currentDraft!\.expectedCustomFieldRevision/,
  );
  assert.match(source, /retainedCaseFieldReceipt\(attempt,\s*error\)/);
});
