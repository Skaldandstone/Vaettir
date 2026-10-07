import assert from "node:assert/strict";
import test from "node:test";
import { governanceCriterionValue, governanceHeaderDescription, governanceOperationLabel, governanceMetadataValue } from "./plan-governance-display.ts";
const rows = [{ id: "criterion", description: " exact\nwording ", status: "PENDING", requirementId: null }];
test("all supported governance operations have distinct honest history labels", () => {
  const operations = ["EDIT_CRITERION_DESCRIPTION", "SET_CRITERION_VERDICT", "ATTACH_UNASSIGNED_PLAN", "DETACH_ATTACHED_PLAN", "ADD_CRITERION", "DELETE_CRITERION", "SET_CRITERION_REQUIREMENT", "EDIT_PLAN_HEADER", "SET_PLAN_STATUS", "EDIT_PLAN_CUSTOM_FIELDS"];
  assert.equal(new Set(operations.map(governanceOperationLabel)).size, operations.length);
  assert.equal(governanceOperationLabel("unknown"), "Unsupported governance operation");
});

test("metadata history distinguishes absent, NULL, empty, false, zero and complete exact repeated lists", () => {
  assert.equal(governanceMetadataValue({}, "field"), "Unset (key absent)");
  assert.equal(governanceMetadataValue({ field: null }, "field"), "Explicit NULL");
  assert.equal(governanceMetadataValue({ field: "" }, "field"), 'Empty text ("")');
  assert.equal(governanceMetadataValue({ field: false }, "field"), "false");
  assert.equal(governanceMetadataValue({ field: 0 }, "field"), "0");
  assert.equal(governanceMetadataValue({ field: ["", " raw,\nprose ", "same", "same"] }, "field"), JSON.stringify(["", " raw,\nprose ", "same", "same"], null, 2));
  const reserved = JSON.parse('{"__proto__":{"retained":true}}');
  assert.equal(governanceMetadataValue(reserved, "__proto__"), '{\n  "retained": true\n}');
  assert.equal(governanceMetadataValue({}, "constructor"), "Unset (key absent)");
});
test("header history retains exact prose and distinguishes native NULL from empty description", () => {
  assert.equal(governanceHeaderDescription(null), "No description (NULL)");
  assert.equal(governanceHeaderDescription(""), "Empty description");
  assert.equal(governanceHeaderDescription(" \n, exact prose \t"), " \n, exact prose \t");
});
test("missing added/deleted criteria differ from empty retained wording", () => {
  assert.equal(governanceCriterionValue([], "criterion", "ADD_CRITERION"), "Not present in this snapshot");
  assert.equal(governanceCriterionValue([], "criterion", "DELETE_CRITERION"), "Not present in this snapshot");
  assert.equal(governanceCriterionValue(rows, "criterion", "EDIT_CRITERION_DESCRIPTION"), " exact\nwording ");
  assert.equal(governanceCriterionValue([{ ...rows[0], description: "" }], "criterion", "EDIT_CRITERION_DESCRIPTION"), "Empty wording");
});
test("history shows native verdict and requirement identity separately without reconstructing requirement content", () => {
  assert.equal(governanceCriterionValue(rows, "criterion", "SET_CRITERION_VERDICT"), "PENDING");
  assert.equal(governanceCriterionValue(rows, "criterion", "SET_CRITERION_REQUIREMENT"), "Unlinked");
  assert.equal(governanceCriterionValue([{ ...rows[0], requirementId: "synthetic" }], "criterion", "SET_CRITERION_REQUIREMENT"), "Requirement ID: synthetic");
});
