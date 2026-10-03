import assert from "node:assert/strict";
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUNDLE = "@img/sharp-libvips-linux-x64";
const MAX = 64 * 1024;

export function isWithin(root, path) {
  const remainder = relative(root, path);
  return (
    remainder !== "" &&
    !isAbsolute(remainder) &&
    remainder !== ".." &&
    !remainder.startsWith(`..${sep}`)
  );
}

async function checkedPath(path, boundary, regular = true) {
  const actual = await realpath(path);
  if (!isWithin(boundary, actual))
    throw new Error("Dependency path escapes build boundary");
  const info = await lstat(path);
  if (regular && (!info.isFile() || info.isSymbolicLink()))
    throw new Error("Dependency receipt/metadata is not a regular file");
  return actual;
}

async function boundedRead(path, boundary) {
  await checkedPath(path, boundary);
  const handle = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1 || info.size > MAX)
      throw new Error("Dependency metadata exceeds size bound");
    const buffer = Buffer.alloc(MAX + 1);
    let length = 0;
    while (length < buffer.length) {
      const result = await handle.read(
        buffer,
        length,
        buffer.length - length,
        length,
      );
      if (!result.bytesRead) break;
      length += result.bytesRead;
    }
    if (length > MAX) throw new Error("Dependency metadata exceeds size bound");
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

async function metadata(path, boundary) {
  return JSON.parse((await boundedRead(path, boundary)).toString("utf8"));
}

async function sharpMetadata(entry, boundary) {
  // Sharp's exported entry is dist/index.cjs; package.json itself is not an
  // exported subpath. Read the package adjacent to that actual resolved entry.
  await checkedPath(entry, boundary);
  const path = resolve(dirname(entry), "../package.json");
  const value = await metadata(path, boundary);
  if (value.name !== "sharp" || value.version !== "0.35.5")
    throw new Error("Unexpected resolved Sharp package");
  return value;
}

function samePackage(source, target) {
  assert.equal(target.name, source.name, "Standalone package name differs");
  assert.equal(
    target.version,
    source.version,
    "Standalone package version differs",
  );
  assert.deepEqual(
    target.exports,
    source.exports,
    "Standalone package exports differ",
  );
}

export async function retainSharpVersionReceipt({
  root = fileURLToPath(new URL("../", import.meta.url)),
} = {}) {
  const canonicalRoot = await realpath(root);
  const sourceBoundary = await realpath(resolve(canonicalRoot, "node_modules"));
  if (sourceBoundary !== resolve(canonicalRoot, "node_modules"))
    throw new Error("Source dependencies escape repository");
  const standalone = await realpath(
    resolve(canonicalRoot, "apps/web/.next/standalone"),
  );
  if (standalone !== resolve(canonicalRoot, "apps/web/.next/standalone"))
    throw new Error("Standalone directory escapes repository");
  const entries = [];
  for (const [base, boundary] of [
    [canonicalRoot, sourceBoundary],
    [standalone, standalone],
  ]) {
    const webRequire = createRequire(resolve(base, "apps/web/package.json"));
    const nextPackage = webRequire.resolve("next/package.json");
    const next = await metadata(nextPackage, boundary);
    if (next.name !== "next" || typeof next.version !== "string")
      throw new Error("Unexpected resolved Next package");
    const nextRequire = createRequire(nextPackage);
    const sharpEntry = nextRequire.resolve("sharp");
    const sharp = await sharpMetadata(sharpEntry, boundary);
    const sharpRequire = createRequire(sharpEntry);
    const bundlePackage = sharpRequire.resolve(`${BUNDLE}/package`);
    const bundle = await metadata(bundlePackage, boundary);
    if (
      bundle.name !== BUNDLE ||
      bundle.version !== "1.3.4" ||
      bundle.exports?.["./versions"] !== "./versions.json" ||
      bundle.exports?.["./package"] !== "./package.json"
    )
      throw new Error("Unexpected libvips bundle identity/exports");
    entries.push({
      next,
      sharp,
      bundle,
      bundlePackage,
      sharpRequire,
      boundary,
    });
  }
  const [source, target] = entries;
  samePackage(source.next, target.next);
  samePackage(source.sharp, target.sharp);
  samePackage(source.bundle, target.bundle);
  const sourcePath = source.sharpRequire.resolve(`${BUNDLE}/versions`);
  if (sourcePath !== resolve(dirname(source.bundlePackage), "versions.json"))
    throw new Error("Bundle version export is not adjacent published receipt");
  const bytes = await boundedRead(sourcePath, source.boundary);
  const versions = JSON.parse(bytes.toString("utf8"));
  if (
    versions.vips !== "8.18.7" ||
    versions.xml2 !== "2.15.4" ||
    versions.expat !== "2.8.5"
  )
    throw new Error(
      "Published libvips receipt versions do not match maintained bundle",
    );
  const targetPath = resolve(dirname(target.bundlePackage), "versions.json");
  const parent = await realpath(dirname(targetPath));
  if (!isWithin(standalone, parent))
    throw new Error("Standalone receipt parent escapes boundary");
  let copied = false;
  let handle;
  try {
    handle = await open(
      targetPath,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    await checkedPath(targetPath, standalone);
    await handle.writeFile(bytes);
    copied = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
    if (!(await boundedRead(targetPath, standalone)).equals(bytes))
      throw new Error(
        "Standalone receipt collision differs from published bytes",
        { cause: error },
      );
  } finally {
    if (handle) await handle.close();
  }
  if (!(await boundedRead(targetPath, standalone)).equals(bytes))
    throw new Error("Retained receipt byte verification failed");
  return {
    copied,
    package: BUNDLE,
    version: "1.3.4",
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    scope:
      "Published dependency receipt retention only; final image runtime checks remain required",
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  if (
    process.argv.length !== 2 ||
    process.platform !== "linux" ||
    process.arch !== "x64"
  )
    throw new Error(
      "Sharp receipt retention accepts no arguments and requires Linux x64",
    );
  const deadline = setTimeout(() => {
    console.error(
      "Published Sharp receipt retention exceeded its bounded deadline.",
    );
    process.exit(1);
  }, 30_000);
  retainSharpVersionReceipt()
    .then((proof) =>
      console.log(`Published Sharp receipt retained: ${JSON.stringify(proof)}`),
    )
    .catch(() => {
      console.error(
        "Published Sharp receipt retention failed; verify package identity, boundary and byte equality. No credentials logged.",
      );
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(deadline));
}
