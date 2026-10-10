import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");
const wizard = readFileSync(new URL("../components/CreationWizard.tsx", import.meta.url), "utf8");
function rule(selector) {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start,-1,`Missing ${selector}`);
  return css.slice(start,css.indexOf("}",start));
}
test("creation wizard sizes to the modal content instead of the viewport", () => {
  const content = rule(".creation-wizard");
  assert.match(content,/width: 100%/);
  assert.match(content,/max-width: 680px/);
  assert.match(content,/min-width: 0/);
  assert.doesNotMatch(content,/\d+vw/);
});
test("fields, fieldsets and chips have shrinkable widths rather than intrinsic overflow", () => {
  assert.match(css,/\.creation-wizard \.wizard-choice-group \{\s*min-width: 0;\s*max-width: 100%;/);
  assert.match(css,/\.creation-wizard select \{\s*width: 100%;\s*max-width: 100%;\s*min-width: 0;/);
  assert.match(rule(".creation-wizard .wizard-choice-group button"),/white-space: normal/);
  assert.match(wizard,/aria-pressed=\{active\}/);
  assert.doesNotMatch(wizard,/type=\{single \? "radio" : "checkbox"\}/);
  assert.match(rule(".creation-wizard-body > label"),/display: grid/);
});
test("objective textarea remains usable and resizes vertically only", () => {
  assert.match(rule(".creation-wizard textarea"),/min-height: 6em/);
  assert.match(rule(".creation-wizard textarea"),/resize: vertical/);
  const project = readFileSync(new URL("../app/projects/page.tsx", import.meta.url), "utf8");
  assert.match(project,/value=\{objective\}[\s\S]{0,120}rows=\{3\}/);
});
test("actions and progress shrink within narrow dialogs without hiding content", () => {
  assert.match(rule(".creation-wizard-actions"),/flex-wrap: wrap/);
  assert.match(rule(".creation-wizard-actions button"),/white-space: normal/);
  assert.match(wizard,/repeat\(\$\{steps.length\}, minmax\(0, 1fr\)\)/);
  assert.doesNotMatch(rule(".creation-wizard"),/overflow(-x)?: hidden/);
});

test("only a direct wizard owns the bounded, non-scrolling modal shell", () => {
  const shell = rule(".native-dialog.modal-panel:has(> .creation-wizard)");
  assert.match(shell, /display: flex/);
  assert.match(shell, /height: min\(720px, calc\(100dvh - 32px\)\)/);
  assert.match(shell, /overflow: hidden/);
  assert.doesNotMatch(css, /\.native-dialog\.modal-panel:has\(\.creation-wizard\)\s*\{/);
});

test("wrapped project setup retains the dialog scroll owner at short heights", () => {
  const modal = rule(".modal-panel");
  assert.match(modal, /overflow-y: auto/);
  assert.match(rule(".native-dialog.modal-panel"), /max-height: calc\(100dvh - 32px\)/);
  const population = rule(".modal-panel:has(.population-wizard)");
  assert.doesNotMatch(population, /overflow[^;]*hidden/);
  const body = rule(".population-wizard .creation-wizard-body");
  assert.match(body, /overflow: visible/);
  assert.match(body, /overscroll-behavior: auto/);
  const source = readFileSync(new URL("../components/PopulationWizard.tsx", import.meta.url), "utf8");
  assert.match(source, /<section className="population-wizard">[\s\S]*<fieldset[\s\S]*<CreationWizard/);
});
