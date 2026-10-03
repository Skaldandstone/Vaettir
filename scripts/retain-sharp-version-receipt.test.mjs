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
  realpath,
  readlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, dirname, relative } from "node:path";
import {
  retainSharpVersionReceipt as retainActual,
  nativeDigest,
  isWithin,
} from "./retain-sharp-version-receipt.mjs";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const nativeBytes = Buffer.from(
  "Authored synthetic native identity fixture; never executed",
);
const syntheticHash = createHash("sha256").update(nativeBytes).digest("hex");
const retainSharpVersionReceipt = (options) =>
  retainActual({
    ...options,
    nativeDigestImpl: async (path, boundary) => {
      const result = await nativeDigest(path, boundary);
      return {
        ...result,
        sha256:
          result.sha256 === syntheticHash
            ? "4aa73553408c3964071728f4a231a8e86918e39bc49f1fbae75355f7ea933ea9"
            : result.sha256,
      };
    },
  });

const bundle = {
  name: "@img/sharp-libvips-linux-x64",
  version: "1.3.4",
  exports: {
    "./package": "./package.json",
    "./versions": "./versions.json",
    "./binary": "./lib/libvips-cpp.so.8.18.7",
  },
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
        version: "15.5.26",
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
    await put(
      resolve(
        base,
        "node_modules/@img/sharp-libvips-linux-x64/lib/libvips-cpp.so.8.18.7",
      ),
      nativeBytes,
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

test("missing standalone package metadata is retained exactly only after native equality, then partial retry is idempotent", async (t) => {
  const f = await fixture(t);
  const targetPackage = resolve(dirname(f.target), "package.json");
  const sourcePackage = await readFile(
    resolve(dirname(f.source), "package.json"),
  );
  await rm(targetPackage);
  const proof = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(proof.packageCopied, true);
  assert.deepEqual(await readFile(targetPackage), sourcePackage);
  assert.deepEqual(await readFile(f.target), bytes);
  await rm(f.target);
  const retried = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(retried.packageCopied, false);
  assert.equal(retried.copied, true);
  await rm(targetPackage);
  const reverseRetry = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(reverseRetry.packageCopied, true);
  assert.equal(reverseRetry.copied, false);
});

test("missing or mismatched native library prevents retention of either metadata file", async (t) => {
  const f = await fixture(t);
  const targetPackage = resolve(dirname(f.target), "package.json");
  const native = resolve(dirname(f.target), "lib/libvips-cpp.so.8.18.7");
  await rm(targetPackage);
  await rm(native);
  await assert.rejects(retainSharpVersionReceipt({ root: f.root }));
  await assert.rejects(readFile(targetPackage), { code: "ENOENT" });
  await put(native, "wrong library");
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /native bundle differs/,
  );
  await assert.rejects(readFile(targetPackage), { code: "ENOENT" });
  await assert.rejects(readFile(f.target), { code: "ENOENT" });
});

test("present package bytes conflict even if logical JSON identity matches", async (t) => {
  const f = await fixture(t);
  const targetPackage = resolve(dirname(f.target), "package.json");
  const original = JSON.stringify(bundle, null, 2);
  await put(targetPackage, original);
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /collision/,
  );
  assert.equal(await readFile(targetPackage, "utf8"), original);
  await assert.rejects(readFile(f.target), { code: "ENOENT" });
});

test("real pnpm nested layout and dependency links resolve copied exports inside standalone", async (t) => {
  const f = await fixture(t);
  const storeSharp = "node_modules/.pnpm/sharp@0.35.5/node_modules/sharp";
  const storeBundle =
    "node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64";
  const directoryLink = async (target, path) => {
    await mkdir(dirname(path), { recursive: true });
    await symlink(
      process.platform === "win32" ? target : relative(dirname(path), target),
      path,
      process.platform === "win32" ? "junction" : "dir",
    );
  };
  for (const base of [f.root, f.standalone]) {
    const oldSharp = resolve(base, "node_modules/sharp");
    const nestedSharp = resolve(base, storeSharp);
    await mkdir(dirname(nestedSharp), { recursive: true });
    await rename(oldSharp, nestedSharp);
    await directoryLink(nestedSharp, oldSharp);
    const oldBundle = resolve(
      base,
      "node_modules/@img/sharp-libvips-linux-x64",
    );
    const nestedBundle = resolve(base, storeBundle);
    await mkdir(dirname(nestedBundle), { recursive: true });
    await rename(oldBundle, nestedBundle);
    await rm(dirname(oldBundle), { recursive: true });
    await directoryLink(
      nestedBundle,
      resolve(dirname(nestedSharp), "@img/sharp-libvips-linux-x64"),
    );
  }
  const counterpart = resolve(f.standalone, storeBundle);
  await rm(resolve(counterpart, "package.json"));
  const result = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(result.packageCopied, true);
  assert.deepEqual(
    await readFile(resolve(counterpart, "versions.json")),
    bytes,
  );
  const require = createRequire(
    resolve(f.standalone, storeSharp, "dist/index.cjs"),
  );
  assert.equal(
    require.resolve(`${bundle.name}/versions`),
    resolve(counterpart, "versions.json"),
  );
  assert.equal(
    (await retainSharpVersionReceipt({ root: f.root })).copied,
    false,
  );
});

async function missingLinkFixture(t) {
  const f = await fixture(t);
  const counterpart = resolve(
    f.standalone,
    "node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64",
  );
  // Move both source and counterpart to matching pnpm stores, but deliberately
  // link only the source. The stored target native DSO still exists.
  for (const base of [f.root, f.standalone]) {
    const original = resolve(base, "node_modules/@img/sharp-libvips-linux-x64");
    const nested = resolve(
      base,
      "node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64",
    );
    await mkdir(dirname(nested), { recursive: true });
    await rename(original, nested);
    if (base === f.root)
      await symlink(
        process.platform === "win32"
          ? nested
          : relative(dirname(original), nested),
        original,
        process.platform === "win32" ? "junction" : "dir",
      );
  }
  await rm(resolve(counterpart, "package.json"));
  return {
    ...f,
    counterpart,
    link: resolve(f.standalone, "node_modules/@img/sharp-libvips-linux-x64"),
  };
}

test("missing standalone dependency link is safely restored without builder-root fallback", async (t) => {
  const f = await missingLinkFixture(t);
  const result = await retainSharpVersionReceipt({ root: f.root });
  assert.equal(result.linkCopied, true);
  assert.equal(await realpath(f.link), f.counterpart);
  if (process.platform !== "win32")
    assert.equal(
      await readlink(f.link),
      relative(dirname(f.link), f.counterpart),
    );
  const require = createRequire(
    resolve(f.standalone, "node_modules/sharp/dist/index.cjs"),
  );
  assert.equal(
    require.resolve(`${bundle.name}/versions`),
    resolve(f.counterpart, "versions.json"),
  );
  assert.equal(
    (await retainSharpVersionReceipt({ root: f.root })).linkCopied,
    false,
  );
});

test("wrong, outside or dangling standalone dependency links are rejected without overwrite", async (t) => {
  for (const kind of ["wrong", "outside", "dangling"]) {
    const f = await missingLinkFixture(t);
    const destination =
      kind === "outside"
        ? resolve(f.root, "outside")
        : resolve(f.standalone, `wrong-${kind}`);
    if (kind !== "dangling") await mkdir(destination);
    await symlink(
      destination,
      f.link,
      process.platform === "win32" ? "junction" : "dir",
    );
    const before = await readlink(f.link);
    await assert.rejects(
      retainSharpVersionReceipt({ root: f.root }),
      /conflicts|dangling/,
    );
    assert.equal(await readlink(f.link), before);
    await assert.rejects(readFile(resolve(f.counterpart, "package.json")), {
      code: "ENOENT",
    });
  }
});

test("missing bounded link parent is created, while a conflicting regular directory is preserved", async (t) => {
  const f = await missingLinkFixture(t);
  await rm(dirname(f.link), { recursive: true });
  assert.equal(
    (await retainSharpVersionReceipt({ root: f.root })).linkCopied,
    true,
  );
  const conflict = await missingLinkFixture(t);
  await mkdir(conflict.link);
  await put(resolve(conflict.link, "keep.txt"), "original");
  await assert.rejects(
    retainSharpVersionReceipt({ root: conflict.root }),
    /verified symlink/,
  );
  assert.equal(
    await readFile(resolve(conflict.link, "keep.txt"), "utf8"),
    "original",
  );
});

test("higher-priority invalid source dependency link cannot authorize restoration", async (t) => {
  const f = await missingLinkFixture(t);
  const earlier = resolve(
    f.root,
    "node_modules/sharp/node_modules/@img/sharp-libvips-linux-x64",
  );
  await mkdir(dirname(earlier), { recursive: true });
  const invalid = resolve(f.root, "node_modules/wrong-bundle");
  await mkdir(invalid);
  await symlink(
    invalid,
    earlier,
    process.platform === "win32" ? "junction" : "dir",
  );
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /Source dependency lookup conflicts/,
  );
  await assert.rejects(readFile(resolve(f.counterpart, "package.json")), {
    code: "ENOENT",
  });
});

test("unrecognized source native export cannot authorize metadata retention", async (t) => {
  const f = await fixture(t);
  await put(
    resolve(dirname(f.source), "package.json"),
    JSON.stringify({
      ...bundle,
      exports: { ...bundle.exports, "./binary": "./lib/other.so" },
    }),
  );
  await assert.rejects(
    retainSharpVersionReceipt({ root: f.root }),
    /identity\/exports/,
  );
  await assert.rejects(readFile(f.target), { code: "ENOENT" });
});

test("production hashing rejects synthetic native bytes without an injected fixture digest", async (t) => {
  const f = await fixture(t);
  const packagePath = resolve(dirname(f.target), "package.json");
  await rm(packagePath);
  await assert.rejects(
    retainActual({ root: f.root }),
    /pinned published bytes/,
  );
  await assert.rejects(readFile(packagePath), { code: "ENOENT" });
  await assert.rejects(readFile(f.target), { code: "ENOENT" });
});
