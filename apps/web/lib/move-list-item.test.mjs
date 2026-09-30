import { test } from "node:test";
import assert from "node:assert/strict";
import { moveListItem } from "./move-list-item.ts";

test("moves complete structured rows without losing identity, fields or future metadata", () => {
  const first = Object.freeze({ id: "one", action: "Login", expectedActionOrData: "POST", expectedResult: "Dashboard", expectedResponse: "200", media: ["reference"] });
  const second = Object.freeze({ id: "two", action: "Continue" });
  const original = Object.freeze([first, second]);
  const moved = moveListItem(original, 0, 1);
  assert.deepEqual(moved, [second, first]);
  assert.equal(moved[1], first);
  assert.deepEqual(original, [first, second]);
  assert.deepEqual(moveListItem(moved, 1, 0), original);
});
test("preserves duplicates and exact BDD wording when reordering", () => {
  assert.deepEqual(moveListItem(["same", "different", "same"], 1, 0), ["different", "same", "same"]);
});
test("boundary or invalid moves cannot lose items", () => {
  const original = ["one", "two"];
  for (const [from, to] of [[0, -1], [1, 2], [-1, 0], [0.5, 1], [0, 0], [NaN, 1]]) assert.deepEqual(moveListItem(original, from, to), original);
  assert.deepEqual(moveListItem([], 0, 1), []);
});
