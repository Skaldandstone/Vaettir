import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(
  new URL("../app/projects/page.tsx", import.meta.url),
  "utf8",
);
const population = readFileSync(
  new URL("../components/PopulationWizard.tsx", import.meta.url),
  "utf8",
);

test("project creation requires a name but permits an empty objective without invented text", () => {
  assert.match(page, /createStep === 0\s*\? Boolean\(name.trim\(\)\)/);
  assert.doesNotMatch(page, /name.trim\(\) && objective.trim\(\)/);
  assert.doesNotMatch(page, /Describe the objective to continue/);
  const field = page.match(
    /<textarea\s+id="new-project-objective"[\s\S]*?\/>/,
  )?.[0];
  assert.ok(field);
  assert.doesNotMatch(field, /\brequired\b/);
  assert.match(field, /maxLength=\{1000\}/);
  assert.match(page, /Objective \(optional\)/);
  assert.match(
    page,
    /disabled=\{createMutation.isPending \|\| !name.trim\(\)\}/,
  );
  assert.match(page, /Not sure yet · continue without an objective/);
  assert.match(page, /qualityProfile:\s*\{\s*objective,/);
  assert.match(page, /objective.trim\(\) \? objective : "Not specified yet"/);
});

test("re-entrant objective deferral preserves the entered baseline and only advances the draft", () => {
  assert.match(population, /useState\(initial\)/);
  assert.match(population, /onClick=\{\(\) => move\(step \+ 1\)\}/);
  assert.match(
    population,
    /draft.objective.trim\(\)[\s\S]*?Keep this objective and continue/,
  );
  assert.match(
    population,
    /setDraft\(\{\s*\.\.\.draft,\s*step: nextPopulationStep/,
  );
  assert.doesNotMatch(population, /setDraft\(\{[^}]*objective:\s*["']["']/);
  assert.match(population, /onSubmit=\{\(\) => onSave\(draft\)\}/);
});

test("server creation and population draft schemas genuinely accept unknown objectives", () => {
  const router = readFileSync(
    new URL("../../api/src/routers/project.ts", import.meta.url),
    "utf8",
  );
  const schema = readFileSync(
    new URL("../../../packages/core/src/projectPopulation.ts", import.meta.url),
    "utf8",
  );
  assert.match(router, /objective: z.string\(\).max\(1000\).default\(""\)/);
  assert.match(schema, /objective: z.string\(\).max\(2000\)/);
  assert.doesNotMatch(schema, /objective: z.string\(\).min\(/);
});
