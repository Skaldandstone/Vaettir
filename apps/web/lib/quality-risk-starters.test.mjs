// SOURCE ONLY: scenarios authored, not executed tonight.
import test from "node:test";
import assert from "node:assert/strict";
import { canApplyQualityRiskStarter, reviewedQualityRiskStarter, qualityRiskStarters } from "./quality-risk-starters.ts";
import { qualityRiskDefinition } from "../../api/src/services/qualityRiskSchema.ts";
const blank = () => ({ title: "", component: "", failureMode: "", cause: "", effect: "", rationale: "", mitigation: "",
  likelihood: "UNKNOWN", consequence: "UNKNOWN", requirementIds: [], caseIds: [] });
const boundary = () => ({ open: true, mode: "CREATE", canWrite: true, pending: false, busy: false, hasBaseline: false,
  hasSelectedEntry: false, acknowledged: false, dropUnavailableLinks: false,
  review: { likelihood: "UNKNOWN", consequence: "UNKNOWN", rationale: "", evidenceNotes: "", disposition: "FURTHER_ACTION", resultIds: [] } });

test("all four reviewed starters expose guidance without filling valid factual risk data", () => {
  assert.equal(qualityRiskStarters.length, 4);
  for (const starter of qualityRiskStarters) {
    const definition = blank(), review = boundary(), before = JSON.stringify({ definition, review });
    assert.equal(reviewedQualityRiskStarter(definition, review, starter.id, true), starter.id);
    assert.equal(JSON.stringify({ definition, review }), before);
    assert.equal(qualityRiskDefinition.safeParse(definition).success, false);
    assert.equal(starter.prompts.length, 4);
    assert.ok(starter.prompts.every(stage => stage.length === 2));
  }
});
test("any human text including whitespace forbids starter apply", () => {
  for (const key of ["title", "component", "failureMode", "cause", "effect", "rationale", "mitigation"])
    for (const value of ["Human entry", " "]) {
      const definition = { ...blank(), [key]: value }, before = structuredClone(definition);
      assert.equal(canApplyQualityRiskStarter(definition, boundary()), false);
      assert.equal(reviewedQualityRiskStarter(definition, boundary(), "SOFTWARE_BUSINESS", true), null);
      assert.deepEqual(definition, before);
    }
});
test("links and qualitative categories remain untouched and disable apply", () => {
  for (const patch of [{ caseIds: ["existing-case"] }, { requirementIds: ["existing-requirement"] }, { likelihood: "RARE" }, { consequence: "MINOR" }]) {
    const definition = { ...blank(), ...patch }, before = structuredClone(definition);
    assert.equal(canApplyQualityRiskStarter(definition, boundary()), false);
    assert.deepEqual(definition, before);
  }
});
test("closed, unauthorized, existing, busy and pending workflows are inert", () => {
  for (const patch of [{ open: false }, { canWrite: false }, { mode: "UPDATE" }, { mode: "REVIEW" }, { mode: "VIEW" },
    { pending: true }, { busy: true }, { hasBaseline: true }, { hasSelectedEntry: true }, { acknowledged: true }, { dropUnavailableLinks: true }]) {
    assert.equal(reviewedQualityRiskStarter(blank(), { ...boundary(), ...patch }, "GAME_PLATFORM_INPUT", true), null);
  }
});
test("human residual decisions and evidence cannot be overwritten by a starter", () => {
  for (const patch of [{ likelihood: "POSSIBLE" }, { consequence: "SEVERE" }, { rationale: "Human rationale" },
    { evidenceNotes: "Evidence" }, { disposition: "REVIEW_RECORDED" }, { resultIds: ["existing-result"] }]) {
    const context = boundary(); context.review = { ...context.review, ...patch };
    const before = structuredClone(context);
    assert.equal(reviewedQualityRiskStarter(blank(), context, "HARDWARE_HIL_MACHINERY", true), null);
    assert.deepEqual(context, before);
  }
});
test("unknown or unreviewed selections cannot activate a guide; public links are fixed and credential-free", () => {
  assert.equal(reviewedQualityRiskStarter(blank(), boundary(), "invented-domain", true), null);
  assert.equal(reviewedQualityRiskStarter(blank(), boundary(), "PROCESS_LAB_FOOD", false), null);
  for (const starter of qualityRiskStarters) for (const reference of starter.references) {
    const url = new URL(reference.url);
    assert.equal(url.protocol, "https:"); assert.equal(url.username, ""); assert.equal(url.password, ""); assert.equal(url.search, "");
    assert.ok(["swehb.nasa.gov", "www.nasa.gov", "www.fda.gov", "learn.microsoft.com"].includes(url.hostname));
  }
});
