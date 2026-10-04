// SOURCE ONLY. These contracts do not prove rendered/native accessibility or current-auth acceptance.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const component = readFileSync(new URL("../components/QualityRiskStarter.tsx", import.meta.url), "utf8");
const register = readFileSync(new URL("../components/QualityRiskRegister.tsx", import.meta.url), "utf8");
test("native select and explicit reviewed apply expose optional progressively disclosed prompts", () => {
  for (const literal of ["<select", "<option value=\"\">Choose a starter", "Optional guided starter", "type=\"checkbox\"", "disabled={!eligible || !confirmed}",
    "if (eligible && confirmed) onApply(selected.id, confirmed)", "No factual fields, categories, links or human decisions were filled or persisted", "Public references and limitations"])
    assert.ok(component.includes(literal), literal);
  assert.ok(component.includes("boxSizing: \"border-box\""));
});
test("register mounts only open NEW workflow and applies a local guide without writing definition or request", () => {
  assert.ok(register.includes("{open && mode === \"CREATE\" && <QualityRiskStarter"));
  const start = register.indexOf("onApply={(id, confirmed) =>"), end = register.indexOf("}} />}", start);
  assert.ok(start > 0 && end > start);
  const apply = register.slice(start, end);
  assert.ok(apply.includes("reviewedQualityRiskStarter(definition, starterBoundary, id, confirmed)"));
  assert.ok(apply.includes("if (accepted) setStarter(accepted)"));
  for (const forbidden of ["setDefinition", "setReview", "setPending", "send(", "mutate", "crypto.randomUUID", "setAcknowledged"])
    assert.ok(!apply.includes(forbidden), forbidden);
  assert.ok(register.includes("canWrite: writeReady && formVisible"));
});
