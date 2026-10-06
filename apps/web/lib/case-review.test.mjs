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
test("review route uses native scoped pages and retained complete-snapshot decisions rather than row approval shortcuts", () => {
  const route = readFileSync(new URL("../app/projects/[projectId]/test-cases/review/page.tsx", import.meta.url), "utf8");
  assert.match(route, /useCaseReviewQueue/); assert.match(route, /Search pending cases/);
  assert.match(route, /<CaseReviewDecision/);
  assert.match(route, /Open supported review snapshot/);
  assert.match(route, /active=\{active\}/);
  assert.doesNotMatch(route, /testCases\.(approve|reject|pendingReview)/);
  const api = readFileSync(new URL("../../api/src/routers/testCases.ts", import.meta.url), "utf8");
  const read = api.slice(api.indexOf("pendingReview: protectedProcedure"), api.indexOf("approve: protectedProcedure"));
  assert.match(read, /caseReview.page\/count/);
  assert.doesNotMatch(read, /ctx\.prisma|requireProjectAccess/);
  const native = readFileSync(new URL("../../api/src/services/caseReview.ts", import.meta.url), "utf8");
  assert.match(native, /c\.archived=false AND c\."reviewStatus"='PENDING_REVIEW'/);
  assert.match(native, /LIMIT 25 OFFSET/);
  const detail = readFileSync(new URL("../components/TestCaseDetailContent.tsx", import.meta.url), "utf8");
  assert.match(detail, /<CaseReviewDecision/);
  assert.match(detail, /active=\{section === "History"\}/);
  assert.doesNotMatch(detail, /testCases\.(approve|reject)\.useMutation/);
  const library = readFileSync(new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url), "utf8");
  assert.match(library, /Review pending cases in the review queue/);
  assert.doesNotMatch(library, /testCases\.bulkReview|Approve selected|Reject selected/);
  const overview = readFileSync(new URL("../app/projects/[projectId]/page.tsx", import.meta.url), "utf8");
  assert.match(overview, /pendingReviewQueue\.fresh\?\.totalPending \?\? null/);
});
