import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

export const baselineCommit = "a5d17cfb8324b94b3b674e9d1063b24fe95584a1";
export const identityMigrations = [
  "20261021190000_identity_access_draft", "20261022025000_identity_directory_observations",
  "20261022060000_identity_access_policy", "20261022070000_identity_directory_mappings",
  "20261022080000_identity_provider_binding", "20261022090000_identity_manual_run_authorization",
];

// Resolve the immutable reviewed baseline locally, never the moving main ref.
// Hash raw Git blob bytes: text decoding/newline conversion would mask drift.
export function readBaselineHashes(root) {
  const git = args => {
    const result = spawnSync("git", args, { cwd: root, windowsHide: true, timeout: 10000 });
    assert.equal(result.status, 0, "Pinned migration baseline must be available locally");
    return result.stdout;
  };
  const prefix = "packages/db/prisma/migrations/";
  const paths = git(["ls-tree", "-r", "--name-only", baselineCommit, "--", prefix])
    .toString("utf8").trim().split("\n").filter(path => path.endsWith("/migration.sql"));
  assert.equal(paths.length, 101, "Review a new baseline explicitly before changing this pin");
  return Object.fromEntries(paths.map(path => [path.slice(prefix.length, -"/migration.sql".length),
    createHash("sha256").update(git(["show", `${baselineCommit}:${path}`])).digest("hex")]));
}

export function assertMigrationBoundary(currentHashes, baselineHashes) {
  const baselineNames = Object.keys(baselineHashes).sort();
  assert.equal(baselineNames.length, 101);
  assert.ok(identityMigrations.every(name => !Object.hasOwn(baselineHashes, name)));
  assert.deepEqual(Object.keys(currentHashes).sort(), [...baselineNames, ...identityMigrations].sort(),
    "Exactly the pinned 101 migrations and six reviewed identity migrations are required");
  for (const name of baselineNames) assert.equal(currentHashes[name], baselineHashes[name],
    `Deployed migration SQL bytes changed: ${name}`);
  return baselineNames;
}
