import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  caseFieldValueControlHarness as harness,
  caseFieldValueControlHost as host,
  caseFieldValueControlElements as elements,
} from "./case-field-value-controls.fixture.mjs";
function field(key, type, extra = {}) {
  return {
    key,
    label: key,
    type,
    required: false,
    retired: false,
    options: type === "CHOICE" ? ["one", "two"] : [],
    ...extra,
  };
}
function props(fields, values, presentation) {
  return {
    fields,
    values,
    presentation,
    onChange: () => assert.fail("render must not mutate native metadata"),
    onValidityChange: () => {},
  };
}
function button(nodes, label) {
  return nodes.find(
    (node) =>
      node.type === "button" &&
      React.Children.toArray(node.props.children).join("") === label,
  );
}

test("numeric draft parser admits only finite native decimals within exact bounds", () => {
  const h = harness();
  for (const raw of [
    "",
    " ",
    "-",
    "NaN",
    "Infinity",
    "1e309",
    "0x20",
    "1e12+1",
    "1000000000001",
  ])
    assert.equal(h.parseCaseFieldNumberDraft(raw), null);
  for (const [raw, value] of [
    ["0", 0],
    ["-1e12", -1e12],
    ["+1e12", 1e12],
    [" .5 ", 0.5],
    ["-4.25", -4.25],
  ])
    assert.equal(h.parseCaseFieldNumberDraft(raw), value);
});
test("actual controls preserve raw text, explicit empty, NULL and absent keys with untouched siblings", () => {
  const h = harness(),
    render = host(h),
    changes = [],
    values = { prose: " exact\nraw ", untouched: false };
  const nodes = elements(
    render({
      ...props([field("prose", "TEXT")], values),
      onChange: (value) => changes.push(value),
    }),
  );
  nodes
    .find((node) => node.type === "textarea")
    .props.onChange({ target: { value: "" } });
  assert.deepEqual({ ...changes.pop() }, { ...values, prose: "" });
  button(nodes, "Set NULL explicitly").props.onClick();
  assert.deepEqual({ ...changes.pop() }, { ...values, prose: null });
  button(nodes, "Remove value (unset)").props.onClick();
  assert.deepEqual({ ...changes.pop() }, { untouched: false });
  nodes
    .find((node) => node.type === "textarea")
    .props.onChange({ target: { value: "  authored\n text  " } });
  assert.equal(changes.pop().prose, "  authored\n text  ");
});
test("checkbox and tri-state expose false/NULL/unset without render initialization", () => {
  const h = harness(),
    render = host(h),
    changes = [];
  const nodes = elements(
    render({
      ...props(
        [field("toggle", "BOOLEAN")],
        {},
        { version: 1, fields: { toggle: { widget: "CHECKBOX" } } },
      ),
      onChange: (value) => changes.push(value),
    }),
  );
  const checkbox = nodes.find(
    (node) => node.type === "input" && node.props.type === "checkbox",
  );
  assert.equal(checkbox.props.checked, false);
  assert.equal(changes.length, 0);
  button(nodes, "Set false explicitly").props.onClick();
  assert.equal(changes.pop().toggle, false);
  checkbox.props.onChange({ target: { checked: true } });
  assert.equal(changes.pop().toggle, true);
  const tri = elements(
    render({
      ...props([field("toggle", "BOOLEAN")], { toggle: false }),
      onChange: (value) => changes.push(value),
    }),
  ).find((node) => node.type === "select");
  assert.equal(tri.props.value, "FALSE");
  tri.props.onChange({ target: { value: "NULL" } });
  assert.equal(changes.pop().toggle, null);
  tri.props.onChange({ target: { value: "UNSET" } });
  assert.equal(Object.hasOwn(changes.pop(), "toggle"), false);
});
test("missing-only visibility reveals deliberately, while null/empty/false/zero/required remain visible", () => {
  const h = harness(),
    render = host(h),
    definition = field("notes", "TEXT"),
    config = {
      version: 1,
      fields: { notes: { widget: "PARAGRAPH", visibility: "HIDE_WHEN_EMPTY" } },
    };
  let nodes = elements(render(props([definition], {}, config)));
  assert.equal(
    nodes.some((node) => node.type === "textarea"),
    false,
  );
  button(nodes, "Reveal notes").props.onClick();
  nodes = elements(render(props([definition], {}, config)));
  assert.equal(
    nodes.some((node) => node.type === "textarea"),
    true,
  );
  for (const [type, value] of [
    ["TEXT", null],
    ["TEXT", ""],
    ["BOOLEAN", false],
    ["NUMBER", 0],
  ]) {
    const html = renderToStaticMarkup(
      React.createElement(
        h.CaseFieldValueControls,
        props(
          [field("notes", type)],
          { notes: value },
          {
            version: 1,
            fields: {
              notes: { widget: "AUTO", visibility: "HIDE_WHEN_EMPTY" },
            },
          },
        ),
      ),
    );
    assert.doesNotMatch(html, /Reveal notes/);
    assert.match(html, /Set NULL explicitly/);
  }
  const required = renderToStaticMarkup(
    React.createElement(
      h.CaseFieldValueControls,
      props([{ ...definition, required: true }], {}, config),
    ),
  );
  assert.doesNotMatch(required, /Reveal notes/);
  assert.match(required, /notes is required/);
});
test("single-line presentation falls back for saved CR/LF and exact values are safely escaped read-only", () => {
  const h = harness(),
    render = host(h),
    raw = "line\r\nnext\n";
  const nodes = elements(
    render(
      props(
        [field("prose", "TEXT")],
        { prose: raw },
        { version: 1, fields: { prose: { widget: "TEXT_INPUT" } } },
      ),
    ),
  );
  assert.equal(nodes.find((node) => node.type === "textarea").props.value, raw);
  assert.equal(
    nodes.some((node) => node.type === "input" && node.props.type === "text"),
    false,
  );
  const html = renderToStaticMarkup(
    React.createElement(
      h.CaseFieldValueControls,
      props(
        [field("retired", "TEXT", { retired: true }), field("n", "NUMBER")],
        { retired: "<script>x</script>", n: "bad", unknown: "" },
      ),
    ),
  );
  assert.match(html, /&lt;script&gt;x&lt;\/script&gt;/);
  assert.match(html, /incompatible/);
  assert.match(html, /unknown.*read-only/);
  assert.doesNotMatch(html, /<script>|type="text"/);
});
test("actual radio render uses unique per-host groups, and choice handlers send native options", () => {
  const h = harness(),
    definitions = [field("choice", "CHOICE")],
    config = { version: 1, fields: { choice: { widget: "RADIO" } } };
  const tree = React.createElement(
    "div",
    null,
    React.createElement(
      h.CaseFieldValueControls,
      props(definitions, {}, config),
    ),
    React.createElement(
      h.CaseFieldValueControls,
      props(definitions, {}, config),
    ),
  );
  const names = [...renderToStaticMarkup(tree).matchAll(/name="([^"]+)"/g)].map(
    (match) => match[1],
  );
  assert.equal(names.length, 4);
  assert.equal(names[0], names[1]);
  assert.equal(names[2], names[3]);
  assert.notEqual(names[0], names[2]);
  const changes = [],
    nodes = elements(
      host(h)({
        ...props(definitions, {}, config),
        onChange: (value) => changes.push(value),
      }),
    );
  nodes
    .find((node) => node.type === "input" && node.props.type === "radio")
    .props.onChange();
  assert.equal(changes.pop().choice, "one");
});
test("invalid/blank numeric input stays visible, blocks parent validity immediately and never reapplies old numbers", () => {
  const h = harness(),
    render = host(h),
    changes = [],
    validity = [];
  let values = { number: 12, retained: " untouched " };
  const make = () => ({
    ...props([field("number", "NUMBER")], values),
    onChange: (value) => {
      values = { ...value };
      changes.push(value);
    },
    onValidityChange: (valid, problems) => validity.push({ valid, problems }),
  });
  for (const text of ["-", "", "NaN", "1000000000001"]) {
    let nodes = elements(render(make()));
    nodes
      .find((node) => node.type === "input")
      .props.onChange({ target: { value: text } });
    assert.equal(validity.at(-1).valid, false);
    assert.equal(values.number, 12);
    assert.equal(changes.length, 0);
    nodes = elements(render(make()));
    assert.equal(nodes.find((node) => node.type === "input").props.value, text);
    assert.equal(validity.at(-1).valid, false);
  }
  elements(render(make()))
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "0" } });
  assert.equal(values.number, 0);
  assert.equal(validity.at(-1).valid, true);
  assert.equal(values.retained, " untouched ");
  let nodes = elements(render(make()));
  nodes
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "" } });
  nodes = elements(render(make()));
  button(nodes, "Set NULL explicitly").props.onClick();
  assert.equal(values.number, null);
  assert.equal(validity.at(-1).valid, true);
  nodes = elements(render(make()));
  button(nodes, "Remove value (unset)").props.onClick();
  assert.equal(Object.hasOwn(values, "number"), false);
});
test("disabled handlers never mutate, and changed external values cannot discard unresolved invalid text", () => {
  const h = harness(),
    render = host(h),
    validity = [],
    definitions = [field("number", "NUMBER")];
  let nodes = elements(
    render({
      ...props(definitions, { number: 2 }),
      onValidityChange: (valid) => validity.push(valid),
    }),
  );
  nodes
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "-" } });
  nodes = elements(
    render({ ...props(definitions, { number: 2 }), disabled: true }),
  );
  assert.equal(nodes.find((node) => node.type === "input").props.value, "-");
  nodes
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "3" } });
  button(nodes, "Set NULL explicitly").props.onClick();
  nodes = elements(
    render({
      ...props(definitions, { number: 9 }),
      onValidityChange: (valid) => validity.push(valid),
    }),
  );
  assert.equal(nodes.find((node) => node.type === "input").props.value, "-");
  assert.equal(validity.at(-1), false);
});

test("valid numeric spelling survives native echo, while deliberately changed external numbers may reseed", () => {
  const h = harness(),
    render = host(h);
  let values = { number: 2 };
  const make = () => ({
    ...props([field("number", "NUMBER")], values),
    onChange: (next) => {
      values = { ...next };
    },
  });
  let nodes = elements(render(make()));
  nodes
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "2.00" } });
  assert.equal(values.number, 2);
  nodes = elements(render(make()));
  assert.equal(nodes.find((node) => node.type === "input").props.value, "2.00");
  nodes
    .find((node) => node.type === "input")
    .props.onChange({ target: { value: "1e3" } });
  assert.equal(values.number, 1000);
  nodes = elements(render(make()));
  assert.equal(nodes.find((node) => node.type === "input").props.value, "1e3");
  values = { number: 7 };
  nodes = elements(render(make()));
  assert.equal(nodes.find((node) => node.type === "input").props.value, "7");
});

test("DATE controls retain native date strings and explicit nullable clearing with required flags", () => {
  const h = harness(),
    changes = [],
    nodes = elements(
      host(h)({
        ...props([field("date", "DATE", { required: true })], {
          date: "2026-10-05",
          untouched: 0,
        }),
        onChange: (next) => changes.push(next),
      }),
    );
  const input = nodes.find((node) => node.type === "input");
  assert.equal(input.props.type, "date");
  assert.equal(input.props.required, true);
  assert.equal(input.props.value, "2026-10-05");
  input.props.onChange({ target: { value: "2026-10-06" } });
  assert.deepEqual({ ...changes.pop() }, { date: "2026-10-06", untouched: 0 });
  input.props.onChange({ target: { value: "" } });
  assert.deepEqual({ ...changes.pop() }, { date: null, untouched: 0 });
});

test("a second same-frame field edit cannot falsely clear another unresolved numeric buffer", () => {
  const h = harness(),
    validity = [],
    nodes = elements(
      host(h)({
        ...props(
          [
            field("first", "NUMBER"),
            field("second", "NUMBER"),
            field("text", "TEXT"),
          ],
          { first: 1, second: 2, text: "saved" },
        ),
        onChange: () => {},
        onValidityChange: (valid) => validity.push(valid),
      }),
    );
  const inputs = nodes.filter((node) => node.type === "input");
  inputs[0].props.onChange({ target: { value: "-" } });
  inputs[1].props.onChange({ target: { value: "3" } });
  assert.equal(validity.at(-1), false);
  nodes
    .find((node) => node.type === "textarea")
    .props.onChange({ target: { value: "updated" } });
  assert.equal(validity.at(-1), false);
});
