import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyReportTemplate,
  REPORT_TEMPLATES,
  REPORT_TEMPLATE_IDS,
} from "./report-templates.ts";

// Authored regression coverage. Intentionally not executed during the source-only night.
const definition = {
  audience: "stakeholders",
  windowDays: 30,
  sections: ["inventory"],
  summary: "Reviewed by the project owner",
  risks: "Awaiting a separate device result",
  nextActions: "Record the missing result",
  executionScope: { planId: "synthetic-plan", platform: "synthetic-platform" },
  dateInterval: { start: "2026-10-01", end: "2026-10-02" },
};

test("all report starters only select supported recorded sections", () => {
  assert.equal(REPORT_TEMPLATE_IDS.length, 5);
  for (const id of REPORT_TEMPLATE_IDS) {
    const starter = REPORT_TEMPLATES[id];
    assert.equal(new Set(starter.sections).size, starter.sections.length);
    assert.ok(
      starter.sections.every((section) =>
        [
          "inventory",
          "execution",
          "traceability",
          "defects",
          "automation",
        ].includes(section),
      ),
    );
    assert.equal(starter.reviewPrompts.length, 3);
  }
});

test("a starter preserves authored commentary and exact selected scope", () => {
  const result = applyReportTemplate(
    definition,
    "My release decision",
    "automation-progress",
  );
  assert.equal(result.title, "My release decision");
  assert.equal(result.definition.templateId, "automation-progress");
  for (const key of [
    "summary",
    "risks",
    "nextActions",
    "windowDays",
    "executionScope",
    "dateInterval",
  ])
    assert.deepEqual(result.definition[key], definition[key]);
  assert.equal(result.definition.audience, "engineering");
  assert.deepEqual(result.definition.sections, [
    "inventory",
    "execution",
    "automation",
  ]);
  assert.deepEqual(definition.sections, ["inventory"]);
});

test("changing a starter replaces only a known starter title", () => {
  assert.equal(
    applyReportTemplate(definition, "Quality status review", "defect-review")
      .title,
    "Defect and regression review",
  );
  assert.equal(
    applyReportTemplate(
      definition,
      "Test execution progress",
      "requirements-coverage",
    ).title,
    "Requirements coverage review",
  );
  assert.equal(
    applyReportTemplate(
      definition,
      "Owner's chosen title",
      "execution-progress",
    ).title,
    "Owner's chosen title",
  );
});
