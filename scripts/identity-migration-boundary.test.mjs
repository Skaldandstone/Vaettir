import { test } from "node:test";
import assert from "node:assert/strict";
import { assertMigrationBoundary, identityMigrations } from "./identity-migration-boundary.mjs";

const baseline = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`historical-${i}`, `hash-${i}`]));
baseline["20261023000000_unreal_playtest_bridge"] = "later-deployed-hash";
const current = { ...baseline, ...Object.fromEntries(identityMigrations.map(name => [name, "identity-hash"])) };
test("later deployed migration belongs to the baseline, not the identity tail", () => {
  assert.deepEqual(assertMigrationBoundary(current, baseline), Object.keys(baseline).sort());
});
test("changed deployed bytes fail closed", () => {
  assert.throws(() => assertMigrationBoundary({ ...current, "20261023000000_unreal_playtest_bridge": "changed" }, baseline));
});
test("missing identity migration fails closed", () => {
  const missing = { ...current }; delete missing[identityMigrations[0]];
  assert.throws(() => assertMigrationBoundary(missing, baseline));
});
test("unexpected migration fails closed", () => {
  assert.throws(() => assertMigrationBoundary({ ...current, unreviewed: "hash" }, baseline));
});
