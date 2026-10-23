import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { freshCasePresentation } from "./case-presentation-read.ts";
const origin = { projectId: "p", organizationId: "o", clerkActorId: "clerk", caseId: "case" };
const data = { projectId: "p", organizationId: "o", caseId: null, readScope: { projectId: "p", organizationId: "o", actorId: "user", actorClerkUserId: "clerk" } };
const query = { data, isFetching: false, isPaused: false };
test("project presentation reads require a fresh authenticated namespace echo, never cached access", () => {
  assert.equal(freshCasePresentation(query, origin), data);
  for (const changed of [{ error: Error("Revoked") }, { isFetching: true }, { isPaused: true }]) assert.equal(freshCasePresentation({ ...query, ...changed }, origin), undefined);
  for (const changed of [{ organizationId: "other" }, { projectId: "other" }, { clerkActorId: "other" }]) assert.equal(freshCasePresentation(query, { ...origin, ...changed }), undefined);
  assert.equal(freshCasePresentation(query, null), undefined);
});
test("settings retain scoped receipts, lock edits during ambiguity and independently refresh after ACK", () => {
  const source = readFileSync(new URL("../components/ProjectCasePresentation.tsx", import.meta.url), "utf8");
  assert.match(source, /requestId: crypto\.randomUUID\(\)/);
  assert.match(source, /pending \?\? \{ origin/);
  assert.match(source, /definitivelyRejected\(cause, attempt\.everAmbiguous\)/);
  assert.match(source, /everAmbiguous: true/);
  assert.match(source, /result\.actorClerkUserId !== origin\.clerkActorId/);
  assert.match(source, /setPending\(current => current === attempt \? null/);
  assert.match(source, /fieldset disabled=\{save\.isPending \|\| Boolean\(pending\)\}/);
  assert.match(source, /await utils\.casePresentation\.get\.invalidate/);
});
test("case authoring visibility never conditions submitted saved fields or rewrites existing choices", () => {
  const source = readFileSync(new URL("../components/TestCaseForm.tsx", import.meta.url), "utf8");
  assert.match(source, /retainedCaseChoices\(presentation\.domains, value\.validationDomain\)/);
  assert.match(source, /retainedCaseChoices\(presentation\.testTypes, value\.testType\)/);
  assert.match(source, /mode !== "create" \|\| interacted\.current/);
  assert.match(source, /initial\?\.validationDomain \?\? preferences\.domains\[0\]/);
  assert.match(source, /verificationProfile: value\.verificationProfile/);
  assert.match(source, /steps: preparedSteps\.steps/);
  assert.match(source, /prepareCaseStepsForSave\(value\.sharedStepGroupId \? \[\] : value\.steps\)/);
  assert.doesNotMatch(source, /s\.expectedActionOrData \|\| null/);
  assert.doesNotMatch(source, /verificationProfile: visible/);
});
