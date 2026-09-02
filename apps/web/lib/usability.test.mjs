import { test } from "node:test";
import assert from "node:assert/strict";
import {
  canConfirmNamedAction,
  isCurrentSearch,
  isNavigationActive,
} from "./usability.ts";

test("destructive confirmation requires the exact nonempty project name", () => {
  assert.equal(canConfirmNamedAction("Northstar", "", false), false);
  assert.equal(canConfirmNamedAction("Northstar", "northstar", false), false);
  assert.equal(canConfirmNamedAction("Northstar", "Northstar ", false), false);
  assert.equal(canConfirmNamedAction("Northstar", "Northstar", false), true);
  assert.equal(canConfirmNamedAction("", "", false), false);
});
test("an in-flight confirmation cannot be repeated", () => {
  assert.equal(canConfirmNamedAction("Northstar", "Northstar", true), false);
  assert.equal(canConfirmNamedAction(undefined, "", true), false);
});
test("non-destructive sample reset needs no arbitrary typed phrase", () => {
  assert.equal(canConfirmNamedAction(undefined, "", false), true);
});
test("project Overview is active only at its exact project path", () => {
  assert.equal(isNavigationActive("/projects/p1", "/projects/p1", true), true);
  assert.equal(
    isNavigationActive("/projects/p1/test-cases", "/projects/p1", true),
    false,
  );
});
test("section navigation matches descendants but not similar prefixes", () => {
  assert.equal(
    isNavigationActive("/projects/p1/test-cases/c1", "/projects/p1/test-cases"),
    true,
  );
  assert.equal(
    isNavigationActive(
      "/projects/p1/test-cases-old",
      "/projects/p1/test-cases",
    ),
    false,
  );
  assert.equal(isNavigationActive("/dashboard", "/"), false);
});
test("late search responses cannot be presented under another query or project", () => {
  const response = { projectId: "p1", query: "login" };
  assert.equal(isCurrentSearch(response, "p1", " login "), true);
  assert.equal(isCurrentSearch(response, "p2", "login"), false);
  assert.equal(isCurrentSearch(response, "p1", "logout"), false);
  assert.equal(isCurrentSearch(null, "p1", "login"), false);
});
import { isConnectionFailure } from "./usability.ts";

test("connection failures are distinguished from permissions and application errors", () => {
  for (const message of [
    "Failed to fetch",
    "fetch failed",
    "Load failed",
    "NetworkError when attempting to fetch resource.",
  ])
    assert.equal(isConnectionFailure(message), true);
  for (const message of [
    "UNAUTHORIZED",
    "You have exhausted your credits",
    "Project was deleted but refresh failed",
    "",
  ])
    assert.equal(isConnectionFailure(message), false);
});
