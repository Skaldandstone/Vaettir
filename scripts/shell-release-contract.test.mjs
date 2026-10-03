import assert from "node:assert/strict";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(
  new URL("../apps/api/package.json", import.meta.url),
);
const Zip = require("adm-zip");
test("Linux shell source remains LF in Git archives even with Windows autocrlf enabled", () => {
  const attributes = readFileSync(
    new URL("../.gitattributes", import.meta.url),
    "utf8",
  );
  assert.match(attributes, /^\*\.sh text eol=lf$/m);
  // Use current attributes so this assertion also tests a not-yet-committed
  // attributes repair. The release preflight additionally inspects the actual
  // exact-commit archive, without this option, before any S3 upload.
  const archive = execFileSync(
    "git",
    [
      "-c",
      "core.autocrlf=true",
      "archive",
      "--worktree-attributes",
      "--format=zip",
      "HEAD",
      "scripts",
    ],
    { timeout: 10000, maxBuffer: 10 * 1024 * 1024 },
  );
  const shells = new Zip(archive)
    .getEntries()
    .filter((entry) => entry.entryName.endsWith(".sh"));
  assert.ok(shells.length >= 6);
  for (const entry of shells) {
    const bytes = entry.getData();
    assert.equal(
      bytes.includes(13),
      false,
      `${entry.entryName} contains a carriage return`,
    );
    assert.ok(bytes.includes(10), `${entry.entryName} has no LF line endings`);
  }
});
