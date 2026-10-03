import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  rename,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname } from "node:path";
import {
  retainSharpVersionReceipt,
  isWithin,
} from "./retain-sharp-version-receipt.mjs";

const bundle = {
  name: "@img/sharp-libvips-linux-x64",
  version: "1.3.4",
  exports: { "./package": "./package.json", "./versions": "./versions.json" },
};
const sharp = {
  name: "sharp",
  version: "0.35.5",
  main: "dist/index.cjs",
  exports: { ".": "./dist/index.cjs" },
};
const bytes = Buffer.from(
  '{\n  "vips": "8.18.7", "xml2": "2.15.4", "expat": "2.8.5", "zlib": "1.3.2"\n}\n',
);
async function put(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, data);
}
async function fixture(t) {
  const root = await mkdtemp(resolve(tmpdir(), "vaettir-sharp-receipt-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const standalone = resolve(root, "apps/web/.next/standalone");
  for (const base of [root, standalone]) {
    await put(resolve(base, "apps/web/package.json"), "{}");
    await put(
      resolve(base, "node_modules/next/package.json"),
      JSON.stringify({
        name: "next",
        version: "15.5.24",
        exports: { "./package.json": "./package.json" },
      }),
    );
    await put(
      resolve(base, "node_modules/sharp/package.json"),
      JSON.stringify(sharp),
    );
    await put(
      resolve(base, "node_modules/sharp/dist/index.cjs"),
      "throw new Error('Must never execute Sharp');\n",
    );
    await put(
      resolve(base, "node_modules/@img/sharp-libvips-linux-x64/package.json"),
      JSON.stringify(bundle),
    );
  }
  const source = resolve(
    root,
    "node_modules/@img/sharp-libvips-linux-x64/versions.json",
  );
  const target = resolve(
    standalone,
    "node_modules/@img/sharp-libvips-linux-x64/versions.json",
  );
  await put(source, bytes);
  return { root, standalone, source, target };
}

test("copies exact published bytes through Next -> Sharp exports, then identical no-op", async (t) => {
  const f = await fixture(t);
  const first = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(first.copied, true);
  assert.deepEqual(await readFile(f.target), bytes);
  assert.equal(first.bytes, bytes.length);
  const second = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(second.copied, false);
  assert.equal(first.sha256, second.sha256);
  assert.match(first.scope, /runtime checks remain required/);
});

test("rejects differing existing bytes without replacing originals", async (t) => {
  const f = await fixture(t);
  await put(f.target, '{"vips":"wrong"}');
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /collision/,
  );
  assert.equal(await readFile(f.target, "utf8"), '{"vips":"wrong"}');
});

test("rejects malformed, oversize, missing and incorrect source library identities", async (t) => {
  const f = await fixture(t);
  for (const value of [
    "{bad",
    "x".repeat(65537),
    "{}",
    '{"vips":"8.18.7","xml2":"2.15.3","expat":"2.8.5"}',
  ]) {
    await put(f.source, value);
    await assert.rejects(retainSharpVersionReceipt({ root: f.root }));
  }
  await rm(f.source);
  await assert.rejects(retainSharpVersionReceipt({ root: f.root }));
});

test("rejects package version and exports mismatch instead of fabricating receipt", async (t) => {
  const f = await fixture(t);
  const targetPackage = resolve(dirname(f.target), "package.json");
  for (const bad of [
    { ...bundle, version: "1.3.3" },
    { ...bundle, name: "@img/other" },
    { ...bundle, exports: { ...bundle.exports, "./versions": "./other.json" } },
  ]) {
    await put(targetPackage, JSON.stringify(bad));
    await assert.rejects(retainSharpVersionReceipt({ root: f.root }));
  }
  await put(targetPackage, JSON.stringify(bundle));
  await put(
    resolve(f.standalone, "node_modules/sharp/package.json"),
    JSON.stringify({ ...sharp, version: "0.34.0" }),
  );
  await assert.rejects(retainSharpVersionReceipt({ root: f.root }), /Sharp/);
});

test("rejects receipt symlinks and directory collisions without writing through", async (t) => {
  const f = await fixture(t);
  const outside = resolve(f.root, "outside.json");
  await put(outside, "original");
  // Windows disallows unprivileged file symlinks on this machine. Exercise a
  // real directory junction at the receipt path instead; Linux tests the file
  // symlink. Both must fail closed without any write to the referenced target.
  if (process.platform === "win32") {
    const outsideDirectory = resolve(f.root, "outside-directory");
    await mkdir(outsideDirectory);
    await symlink(outsideDirectory, f.target, "junction");
  } else await symlink(outside, f.target, "file");
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /boundary|regular/,
  );
  assert.equal(await readFile(outside, "utf8"), "original");
  await rm(f.target);
  await mkdir(f.target);
  await assert.rejects(retainSharpVersionReceipt({ root: f.root }), /regular/);
});

test("rejects standalone dependency directory escaping via junction", async (t) => {
  const f = await fixture(t);
  const targetDir = dirname(f.target);
  const outside = resolve(f.root, "outside-bundle");
  await mkdir(outside);
  await put(resolve(outside, "package.json"), JSON.stringify(bundle));
  await rm(targetDir, { recursive: true });
  await symlink(
    outside,
    targetDir,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(retainSharpVersionReceipt({ root: f.root }), /boundary/);
});

test("boundary check rejects siblings, parent and absolute escapes", () => {
  const root = resolve(tmpdir(), "boundary");
  assert.equal(isWithin(root, resolve(root, "node_modules/file.json")), true);
  for (const path of [root, dirname(root), `${root}-sibling`])
    assert.equal(isWithin(root, path), false);
});

test("root node_modules cannot relocate outside the canonical dependency boundary", async (t) => {
  const f = await fixture(t);
  const original = resolve(f.root, "node_modules");
  const relocated = resolve(f.root, "other-dependencies");
  await rename(original, relocated);
  await symlink(
    relocated,
    original,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /Source dependencies escape/,
  );
});
