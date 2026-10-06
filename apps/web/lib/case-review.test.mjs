import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { reviewQueuePage } from "./case-review.ts";
const fixture = Array.from({ length: 851 }, (_, index) => ({ id: `internal-${index}`, displayId: `QA-${index + 1}`, title: "Same title", confidence: index % 3 === 0 ? null : .5, sourceFilePath: index === 850 ? "last.ts" : null }));
test("review paging reaches all 851 exact IDs and never mutates original order", () => {
  const original = fixture.map(item => item.id), ids = [];
  for (let page = 0; page < 35; page++) { const result = reviewQueuePage(fixture, "", "case-id", page); ids.push(...result.items.map(item => item.id)); assert.ok(result.items.length <= 25); }
  assert.deepEqual(ids, original); assert.deepEqual(fixture.map(item => item.id), original);
});
test("review search finds stable IDs/source paths and natural sorting does not invent confidence", () => {
  assert.equal(reviewQueuePage(fixture, "QA-851", "title", 999).items[0].id, "internal-850");
  assert.equal(reviewQueuePage(fixture, "last.ts", "case-id", 0).total, 1);
  assert.equal(reviewQueuePage(fixture, "nothing", "confidence", 0).total, 0);
  assert.equal(reviewQueuePage(fixture, "", "confidence", 0).items[0].confidence, .5);
});
test("review route isolates active pending cases and preserves ordinary new-tab navigation", () => {
  const route = readFileSync(new URL("../app/projects/[projectId]/test-cases/review/page.tsx", import.meta.url), "utf8");
  assert.match(route, /reviewQueuePage/); assert.match(route, /Search pending cases/);
  assert.match(route, /event\.ctrlKey \|\| event\.metaKey/);
  const api = readFileSync(new URL("../../api/src/routers/testCases.ts", import.meta.url), "utf8");
  const read = api.slice(api.indexOf("pendingReview: protectedProcedure"), api.indexOf("approve: protectedProcedure"));
  assert.match(read, /reviewStatus: "PENDING_REVIEW", archived: false/);
  assert.match(read, /displayId: c\.displayId/);
});
