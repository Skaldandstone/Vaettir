import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runCaseActionBatches } from "./case-action-batches.ts";

test("851 selected cases use sequential bounded requests, not an oversized API call", async () => {
  const ids = Array.from({ length: 851 }, (_, i) => `synthetic-${i}`);
  const batches = [];
  let inFlight = 0;
  const outcome = await runCaseActionBatches(ids, async (batch) => {
    assert.equal(inFlight++, 0);
    await Promise.resolve();
    batches.push([...batch]);
    inFlight--;
    return { count: batch.length };
  });
  assert.deepEqual(
    batches.map((batch) => batch.length),
    [200, 200, 200, 200, 51],
  );
  assert.deepEqual(batches.flat(), ids);
  assert.deepEqual(outcome.completedIds, ids);
  assert.deepEqual(outcome.remainingIds, []);
  assert.equal(outcome.error, null);
});

test("partial failure stops later writes and preserves the failed and unattempted selection", async () => {
  const ids = Array.from({ length: 451 }, (_, i) => `synthetic-${i}`);
  const failure = new Error("synthetic unavailable API");
  let calls = 0;
  const outcome = await runCaseActionBatches(ids, async (batch) => {
    if (++calls === 2) throw failure;
    return { count: batch.length };
  });
  assert.equal(calls, 2);
  assert.equal(outcome.error, failure);
  assert.deepEqual(outcome.completedIds, ids.slice(0, 200));
  assert.deepEqual(outcome.remainingIds, ids.slice(200));
  const retries = [];
  await runCaseActionBatches(outcome.remainingIds, async (batch) =>
    retries.push([...batch]),
  );
  assert.deepEqual(retries.flat(), ids.slice(200));
});

test("duplicate and empty selections never create duplicate or empty writes", async () => {
  const seen = [];
  await runCaseActionBatches(["a", "a", "b"], async (ids) => seen.push(ids));
  assert.deepEqual(seen, [["a", "b"]]);
  await runCaseActionBatches([], async () => assert.fail("no empty request"));
});

test("all five free actions use bounded execution; paid analysis remains separate", () => {
  const page = readFileSync(
    new URL("../app/projects/[projectId]/test-cases/page.tsx", import.meta.url),
    "utf8",
  );
  for (const mutation of [
    "bulkReviewMutation",
    "bulkDeleteMutation",
    "bulkArchiveMutation",
    "bulkMoveMutation",
    "bulkTagMutation",
  ]) {
    assert.match(
      page,
      new RegExp(
        `runBulkAction\\(\\s*\\(?ids\\)?\\s*=>\\s*${mutation}\\.mutateAsync`,
      ),
    );
  }
  assert.doesNotMatch(page, /ids: \[\.\.\.selected\]/);
  assert.match(page, /setBulkError\(/);
  assert.match(page, /bulkError &&\s*\(?\s*<p role="alert"/);
  assert.match(page, /new Set\(outcome\.completedIds\)/);
  assert.match(
    page,
    /setSelected\(\s*\(?current\)?\s*=>\s*new Set\(\[\.\.\.current\]\.filter\(\(?id\)?\s*=>\s*!completedIds\.has\(id\)\)\),?\s*\)/,
  );
});
