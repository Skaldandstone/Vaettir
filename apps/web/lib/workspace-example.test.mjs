import { test } from "node:test";
import assert from "node:assert/strict";
import {
  exampleCases,
  exampleReviews,
  filterExampleCases,
} from "./workspace-example.ts";

test("example case identifiers and review identifiers are unique", () => {
  assert.equal(
    new Set(exampleCases.map((item) => item.id)).size,
    exampleCases.length,
  );
  assert.equal(
    new Set(exampleReviews.map((item) => item.id)).size,
    exampleReviews.length,
  );
});
test("all-result search returns a separate list without changing the corpus", () => {
  const result = filterExampleCases("", "All results");
  assert.deepEqual(result, exampleCases);
  assert.notEqual(result, exampleCases);
});
test("search is case-insensitive and trims whitespace", () => {
  assert.deepEqual(
    filterExampleCases("  tC-003  ", "All results").map((item) => item.id),
    ["TC-003"],
  );
});
test("search includes suite names", () => {
  assert.equal(
    filterExampleCases("identity & access", "All results").length,
    2,
  );
});
test("query and execution status combine rather than replace each other", () => {
  assert.deepEqual(
    filterExampleCases("CI integration", "Failed").map((item) => item.id),
    ["TC-003"],
  );
  assert.deepEqual(filterExampleCases("TC-003", "Passed"), []);
});
test("unknown searches and statuses produce an honest empty state", () => {
  assert.deepEqual(filterExampleCases("unknown record", "All results"), []);
  assert.deepEqual(filterExampleCases("", "UNKNOWN"), []);
});
test("displayed example execution totals match the corpus", () => {
  assert.equal(
    exampleCases.filter((item) => item.status === "Passed").length,
    4,
  );
  assert.equal(
    exampleCases.filter((item) => item.status === "Failed").length,
    1,
  );
  assert.equal(
    exampleCases.filter((item) => item.status === "Not run").length,
    1,
  );
  assert.equal(new Set(exampleCases.map((item) => item.suite)).size, 3);
});
test("every case and suggestion has a complete human-readable scenario", () => {
  for (const item of [...exampleCases, ...exampleReviews]) {
    for (const field of ["title", "given", "when", "then"])
      assert.ok(item[field]?.trim());
  }
});
