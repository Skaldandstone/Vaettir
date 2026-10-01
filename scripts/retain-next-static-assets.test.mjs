import test from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { retainNextStaticAssets } from "./retain-next-static-assets.mjs";

async function fixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vaettir-static-retention-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const directory = async name => { const result = path.join(root, name, ".next", "static"); await fs.mkdir(result, { recursive: true }); return result; };
  const asset = async (directory, name, content = name) => { const target = path.join(directory, ...name.split("/")); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, content); };
  return { root, directory, asset };
}

test("retains prior immutable assets and preserves current/shared bytes", async t => {
  const { directory, asset } = await fixture(t);
  const previousDir = await directory("previous"); const currentDir = await directory("current");
  await asset(previousDir, "chunks/old-hash.js", "old bootstrap");
  await asset(previousDir, "css/shared-hash.css", "shared css");
  await asset(currentDir, "chunks/new-hash.js", "new bootstrap");
  await asset(currentDir, "css/shared-hash.css", "shared css");
  const result = await retainNextStaticAssets({ currentDir, previousDir, cohort: "new-sha", previousCohort: "old-sha" });
  assert.deepEqual(result.cohorts, ["new-sha", "old-sha"]);
  assert.equal(result.files, 3); assert.equal(result.copied, 1);
  assert.equal(await fs.readFile(path.join(currentDir, "chunks/old-hash.js"), "utf8"), "old bootstrap");
  assert.equal(await fs.readFile(path.join(currentDir, "chunks/new-hash.js"), "utf8"), "new bootstrap");
  assert.equal(await fs.readFile(path.join(previousDir, "chunks/old-hash.js"), "utf8"), "old bootstrap");
  assert.equal((await fs.readdir(currentDir)).includes("static-cohorts.json"), false);
  const retry = await retainNextStaticAssets({ currentDir, previousDir, cohort: "new-sha", previousCohort: "old-sha" });
  assert.deepEqual(retry.cohorts, result.cohorts); assert.equal(retry.copied, 0);
});

test("fails a differing-content collision before modifying either tree", async t => {
  const { directory, asset } = await fixture(t);
  const previousDir = await directory("previous"); const currentDir = await directory("current");
  await asset(previousDir, "chunks/shared.js", "previous"); await asset(previousDir, "chunks/another.js");
  await asset(currentDir, "chunks/shared.js", "current");
  await assert.rejects(retainNextStaticAssets({ currentDir, previousDir, cohort: "new", previousCohort: "old" }), /content collision/);
  assert.equal(await fs.readFile(path.join(currentDir, "chunks/shared.js"), "utf8"), "current");
  await assert.rejects(fs.stat(path.join(currentDir, "chunks/another.js")), { code: "ENOENT" });
});

test("supports the first deployment or a missing previous export", async t => {
  const { root, directory, asset } = await fixture(t);
  const currentDir = await directory("current"); await asset(currentDir, "chunks/current.js");
  const result = await retainNextStaticAssets({ currentDir, previousDir: path.join(root, "missing"), cohort: "first" });
  assert.deepEqual(result.cohorts, ["first"]); assert.equal(result.copied, 0);
});

test("carries only the latest three cohorts across four fresh release outputs", async t => {
  const { directory, asset } = await fixture(t);
  let previousDir;
  for (let index = 1; index <= 4; index++) {
    const currentDir = await directory(`release-${index}`); await asset(currentDir, `chunks/release-${index}.js`);
    const result = await retainNextStaticAssets({ currentDir, previousDir, cohort: `sha-${index}` });
    assert.deepEqual(result.cohorts, Array.from({ length: Math.min(index, 3) }, (_, offset) => `sha-${index - offset}`));
    assert.equal(result.files, Math.min(index, 3));
    if (index === 4) {
      await assert.rejects(fs.stat(path.join(currentDir, "chunks/release-1.js")), { code: "ENOENT" });
      assert.equal(await fs.readFile(path.join(previousDir, "chunks/release-1.js"), "utf8"), "chunks/release-1.js");
    }
    previousDir = currentDir;
  }
});

test("prunes only dropped cohort-owned files in the disposable current output", async t => {
  const { directory, asset } = await fixture(t);
  const oldest = await directory("oldest"); await asset(oldest, "oldest.js");
  await retainNextStaticAssets({ currentDir: oldest, cohort: "oldest" });
  const previous = await directory("previous"); await asset(previous, "previous.js");
  await retainNextStaticAssets({ currentDir: previous, previousDir: oldest, cohort: "previous" });
  const currentDir = await directory("current"); await asset(currentDir, "current.js", "current stays unchanged");
  await retainNextStaticAssets({ currentDir, previousDir: previous, cohort: "current" });
  const updatedPrevious = await directory("updated-previous"); await asset(updatedPrevious, "updated-previous.js");
  await retainNextStaticAssets({ currentDir: updatedPrevious, previousDir: previous, cohort: "updated-previous" });
  const result = await retainNextStaticAssets({ currentDir, previousDir: updatedPrevious, cohort: "current" });
  assert.deepEqual(result.cohorts, ["current", "updated-previous", "previous"]);
  assert.equal(result.removed, 1);
  await assert.rejects(fs.stat(path.join(currentDir, "oldest.js")), { code: "ENOENT" });
  assert.equal(await fs.readFile(path.join(currentDir, "current.js"), "utf8"), "current stays unchanged");
  assert.equal(await fs.readFile(path.join(updatedPrevious, "oldest.js"), "utf8"), "oldest.js");
});

test("rejects traversal in an optional manifest without touching external files", async t => {
  const { root, directory, asset } = await fixture(t);
  const previousDir = await directory("previous"); const currentDir = await directory("current");
  await asset(previousDir, "chunks/old.js");
  const outside = path.join(root, "outside.txt"); await fs.writeFile(outside, "must remain");
  await fs.writeFile(path.join(previousDir, "..", "static-cohorts.json"), JSON.stringify({ version: 1, cohorts: [{ id: "old", files: [{ path: "../../outside.txt", size: 11, sha256: "a".repeat(64) }] }] }));
  await assert.rejects(retainNextStaticAssets({ currentDir, previousDir, cohort: "new" }), /Unsafe static asset path/);
  assert.equal(await fs.readFile(outside, "utf8"), "must remain");
  assert.deepEqual(await fs.readdir(currentDir), []);
});

test("rejects symlink/junction trees instead of following them", async t => {
  const { root, directory, asset } = await fixture(t);
  const previousDir = await directory("previous"); const currentDir = await directory("current");
  const external = path.join(root, "external"); await fs.mkdir(external); await asset(external, "secret.js", "not generated assets");
  await fs.symlink(external, path.join(previousDir, "linked"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(retainNextStaticAssets({ currentDir, previousDir, cohort: "new", previousCohort: "old" }), /Symlink/);
  assert.equal(await fs.readFile(path.join(external, "secret.js"), "utf8"), "not generated assets");
  const alias = path.join(root, "alias"); await fs.symlink(currentDir, alias, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(retainNextStaticAssets({ currentDir: alias, cohort: "new" }), /symlinks/);
});

test("rejects overlapping input/output trees", async t => {
  const { directory } = await fixture(t); const currentDir = await directory("current");
  await assert.rejects(retainNextStaticAssets({ currentDir, previousDir: currentDir, cohort: "new" }), /must not overlap/);
});

test("enforces total retained file and byte bounds before copying", async t => {
  const { directory, asset } = await fixture(t);
  const previousDir = await directory("previous"); const currentDir = await directory("current");
  await asset(previousDir, "old.js", "123456"); await asset(currentDir, "new.js", "123456");
  await assert.rejects(retainNextStaticAssets({ currentDir, previousDir, cohort: "new", previousCohort: "old", limits: { maxBytes: 10 } }), /file\/byte limit/);
  await assert.rejects(retainNextStaticAssets({ currentDir, previousDir, cohort: "new", previousCohort: "old", limits: { maxFiles: 1 } }), /file\/byte limit/);
  await assert.rejects(fs.stat(path.join(currentDir, "old.js")), { code: "ENOENT" });
});

test("rejects oversized individual assets and invalid identities", async t => {
  const { directory, asset } = await fixture(t); const currentDir = await directory("current");
  await asset(currentDir, "large.js", "123456");
  await assert.rejects(retainNextStaticAssets({ currentDir, cohort: "new", limits: { maxFileBytes: 5 } }), /file byte limit/);
  await assert.rejects(retainNextStaticAssets({ currentDir, cohort: "../escape" }), /cohort identity/);
});

test("rejects a tampered manifest or a manifest inside publicly served static files", async t => {
  const { directory, asset } = await fixture(t); const currentDir = await directory("current");
  await asset(currentDir, "current.js", "current");
  await assert.rejects(retainNextStaticAssets({ currentDir, cohort: "new", manifestPath: path.join(currentDir, "manifest.json") }), /outside the public static tree/);
  await assert.rejects(retainNextStaticAssets({ currentDir, cohort: "new", manifestPath: path.join(currentDir, "..", "..", "escape.json") }), /only adjacent/);
  const result = await retainNextStaticAssets({ currentDir, cohort: "new" });
  const manifest = JSON.parse(await fs.readFile(result.manifestPath, "utf8")); manifest.cohorts[0].files[0].sha256 = "0".repeat(64);
  await fs.writeFile(result.manifestPath, JSON.stringify(manifest));
  await assert.rejects(retainNextStaticAssets({ currentDir, cohort: "new" }), /does not match its files/);
});
