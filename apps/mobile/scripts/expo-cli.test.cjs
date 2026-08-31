/* eslint-disable @typescript-eslint/no-require-imports -- Node's dependency-free test runner. */
const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { normalizeEmbedEntry } = require("./expo-cli.cjs");

test("native embed resolves the entry against app cwd without changing output paths", () => {
  const cwd = path.resolve("apps/mobile");
  const argv = ["node", "cli", "export:embed", "--entry-file", "./index.js", "--bundle-output", "android/build/index.bundle"];
  const normalized = normalizeEmbedEntry(argv, cwd);
  assert.equal(normalized[4], path.join(cwd, "index.js"));
  assert.equal(normalized[6], argv[6]);
  assert.equal(argv[4], "./index.js");
});
test("absolute entries are unchanged", () => {
  const entry = path.resolve("apps/mobile/index.js");
  assert.equal(normalizeEmbedEntry(["node", "cli", "export:embed", "--entry-file", entry], process.cwd())[4], entry);
});
test("non-embed commands and missing arguments fail safely", () => {
  const argv = ["node", "cli", "start"];
  assert.equal(normalizeEmbedEntry(argv, process.cwd()), argv);
  assert.throws(() => normalizeEmbedEntry(["node", "cli", "export:embed"], process.cwd()), /missing --entry-file/);
});
