import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { admitOutput } from "./output.mjs";

test("requires one explicit output argument without creating a default", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaettir-output-arguments-"));
  for (const args of [[], ["--output-dir"], ["--output-dir", ""], ["--other", "new"], ["--output-dir", "new", "extra"]]) {
    await assert.rejects(admitOutput(args, root), /Usage:/);
  }
  assert.deepEqual(await readdir(root), []);
});

test("admits a fresh directory once and preserves existing evidence bytes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaettir-output-preservation-"));
  const output = await admitOutput(["--output-dir", "first"], root);
  assert.equal(output, path.join(root, "first"));
  await writeFile(path.join(output, "result.json"), "original synthetic receipt", { flag: "wx" });
  await writeFile(path.join(output, "screen.png"), "original synthetic screenshot", { flag: "wx" });
  await assert.rejects(admitOutput(["--output-dir", output]), { code: "EEXIST" });
  assert.equal(await readFile(path.join(output, "result.json"), "utf8"), "original synthetic receipt");
  assert.equal(await readFile(path.join(output, "screen.png"), "utf8"), "original synthetic screenshot");
});

test("refuses existing empty directory, file, and missing parent", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vaettir-output-refusal-"));
  await mkdir(path.join(root, "empty"));
  await writeFile(path.join(root, "file"), "retain");
  for (const target of ["empty", "file"]) await assert.rejects(admitOutput(["--output-dir", target], root), { code: "EEXIST" });
  await assert.rejects(admitOutput(["--output-dir", "missing/child"], root), { code: "ENOENT" });
  assert.deepEqual((await readdir(root)).sort(), ["empty", "file"]);
});
