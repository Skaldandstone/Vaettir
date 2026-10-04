// Authored source fixtures only, NOT RUN. Pure presentation is not rendered or
// current-role/cache/SQL acceptance and never grants same-project authorization.
import test from "node:test";
import assert from "node:assert/strict";
import { baselineLiteralSearch, baselineNativeCaseHref, baselineWordingFields, baselineWordingValue,
  filterBaselineCasePage, groupBaselineWording } from "./requirement-baseline-presentation.ts";
const wording = { title: "Recorded requirement", description: "", externalRef: null, externalRefWithheld: false,
  linearIssueId: null, jiraIssueKey: "SYN-1", issueIdentifiersWithheld: false };

test("all seven displayed fields partition once without changing either recorded side", () => {
  const current = { ...wording, title: "Changed human requirement", description: "New intent" };
  const before = structuredClone(wording), after = structuredClone(current);
  const grouped = groupBaselineWording(wording, current, ["title", "description"]);
  assert.equal(grouped.changed.length, 2);
  assert.equal(grouped.unchanged.length, 5);
  assert.equal(grouped.uncomparable.length, 0);
  assert.equal(new Set([...grouped.changed, ...grouped.unchanged].map(row => row.field)).size, baselineWordingFields.length);
  assert.deepEqual(wording, before); assert.deepEqual(current, after);
  assert.equal(grouped.changed.find(row => row.field === "description").before, "");
});

test("missing baseline/current is explicitly uncomparable rather than unchanged or erased", () => {
  for (const [before, current] of [[null, wording], [wording, null], [null, null]]) {
    const grouped = groupBaselineWording(before, current, []);
    assert.equal(grouped.changed.length, 0); assert.equal(grouped.unchanged.length, 0);
    assert.equal(grouped.uncomparable.length, 7);
    assert.equal(grouped.uncomparable.find(row => row.field === "title").before, before ? before.title : undefined);
  }
});

test("withheld metadata flag changes are visible and unsupported change names are never called a complete comparison", () => {
  const grouped = groupBaselineWording(wording, { ...wording, externalRefWithheld: true, issueIdentifiersWithheld: true },
    ["externalRefWithheld", "issueIdentifiersWithheld", "unsupportedSyntheticField"]);
  assert.deepEqual(grouped.changed.map(row => row.field), ["externalRefWithheld", "issueIdentifiersWithheld"]);
  assert.deepEqual(grouped.unsupportedChanges, ["unsupportedSyntheticField"]);
  assert.equal(grouped.changed[0].before, false); assert.equal(grouped.changed[0].current, true);
});

test("empty recorded text, null, false and unavailable sides remain distinct", () => {
  assert.equal(baselineWordingValue("", "captured"), "Recorded empty text");
  assert.equal(baselineWordingValue(null, "captured"), "Not recorded");
  assert.equal(baselineWordingValue(false, "current"), "Not withheld");
  assert.equal(baselineWordingValue(true, "current"), "Withheld");
  assert.equal(baselineWordingValue(undefined, "captured"), "No captured baseline");
  assert.equal(baselineWordingValue(undefined, "current"), "Current requirement unavailable");
});

test("ID/title filtering uses literal loaded labels only and preserves membership/order/items", () => {
  const items = [{ displayId: "SYN-01", title: "literal %_\\ path" }, { displayId: "SYN-02", title: "Other recorded label" }];
  const before = structuredClone(items);
  assert.equal(baselineLiteralSearch("  %_\\  "), "%_\\");
  assert.deepEqual(filterBaselineCasePage(items, "syn-02"), [items[1]]);
  assert.deepEqual(filterBaselineCasePage(items, "%_\\"), [items[0]]);
  assert.deepEqual(filterBaselineCasePage(items, ".*"), []);
  assert.deepEqual(filterBaselineCasePage(items, "  "), items);
  assert.deepEqual(items, before);
});

test("case links require available native identities and encode exact project/case segments; no display-ID route is guessed", () => {
  assert.equal(baselineNativeCaseHref("project/segment", "case?native", true), "/projects/project%2Fsegment/test-cases/case%3Fnative");
  for (const [projectId, caseId, available] of [["project", null, true], ["project", "native", false], ["", "native", true],
    ["project", "\u0000native", true], ["project", "\ud800", true], ["project", "x".repeat(121), true]])
    assert.equal(baselineNativeCaseHref(projectId, caseId, available), null);
});
