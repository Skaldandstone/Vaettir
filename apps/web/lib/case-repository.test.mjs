import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  repositoryReviewStatus,
  rowDropTarget,
  sameSuiteAfterAnchor,
  unmodifiedCaseClick,
} from "./case-repository.ts";

test("legacy empty or invalid review scope never mixes draft cases into the approved repository", () => {
  for (const scope of ["", "all", "APPROVED", "obsolete"])
    assert.equal(repositoryReviewStatus(scope), "APPROVED");
  assert.equal(repositoryReviewStatus("PENDING_REVIEW"), "PENDING_REVIEW");
  assert.equal(repositoryReviewStatus("REJECTED"), "REJECTED");
});

test("move-down never supplies an anchor from the next suite in a filtered prefix-folder view", () => {
  assert.equal(
    sameSuiteAfterAnchor("Release", {
      id: "nested",
      suitePath: "Release/Nested",
    }),
    null,
  );
  assert.equal(
    sameSuiteAfterAnchor("Release", { id: "same", suitePath: "Release" }),
    "same",
  );
  assert.equal(sameSuiteAfterAnchor("Release", undefined), null);
  assert.equal(
    sameSuiteAfterAnchor(null, { id: "unassigned", suitePath: null }),
    "unassigned",
  );
});
test("case links preserve modified clicks, new tabs, middle-button and cancelled default navigation", () => {
  const plain = {
    button: 0,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
  };
  assert.equal(unmodifiedCaseClick(plain), true);
  for (const field of [
    "defaultPrevented",
    "ctrlKey",
    "metaKey",
    "shiftKey",
    "altKey",
  ])
    assert.equal(unmodifiedCaseClick({ ...plain, [field]: true }), false);
  assert.equal(unmodifiedCaseClick({ ...plain, button: 1 }), false);
  const page = readFileSync(
    new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(page, /if \(!unmodifiedCaseClick\(e\)\) return/);
  assert.match(
    page,
    /if \(\s*readOnly \|\|\s*tc.archived \|\|\s*moveMutation.isPending\s*\)\s*return/,
  );
  assert.match(page, /sameSuiteAfterAnchor\(\s*target.suitePath,\s*after,?\s*\)/);
});

test("row drops reorder exact persisted suite or unassigned placements, never derived source folders", () => {
  const unassigned = { id: "a", suitePath: null, sourceFilePath: "tests/auth" };
  const sameGroup = { id: "b", suitePath: null, sourceFilePath: "tests/auth" };
  assert.deepEqual(rowDropTarget(unassigned, sameGroup), {
    targetSuitePath: null,
    beforeCaseId: "b",
  });
  assert.deepEqual(
    rowDropTarget(unassigned, { id: "c", suitePath: "Release/Smoke" }),
    { targetSuitePath: "Release/Smoke", beforeCaseId: "c" },
  );
  assert.equal(
    rowDropTarget(unassigned, {
      id: "d",
      suitePath: null,
      sourceFilePath: "tests/payment",
    }),
    null,
  );
  assert.equal(
    rowDropTarget({ id: "e", suitePath: "Curated" }, sameGroup),
    null,
  );
  assert.equal(rowDropTarget(unassigned, unassigned), null);
});

test("repository reset stays in its lifecycle lane and moves keep persisted CAS baselines", () => {
  const page = readFileSync(
    new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    page,
    /tc.reviewStatus === repositoryReviewStatus\(reviewFilter\)/,
  );
  assert.doesNotMatch(page, /setReviewFilter\(""\)/);
  assert.match(page, /expectedSuitePath: placement.suitePath/);
  assert.match(page, /expectedSortPosition: placement.sortPosition/);
  assert.match(page, /rowDropTarget\(moving, tc\)/);
  assert.match(page, /setSortBy\("manual"\)/);
  assert.match(page, /tc.isFlaky &&\s*\(\s*<span/);
  assert.match(page, /tc.archived &&\s*\(\s*<span/);
  assert.match(page, /tc.tags.map\(\(tag\)[\s\S]*?setTagFilter\(tag\)/);
  assert.doesNotMatch(page, /data-label="Review"/);
});
