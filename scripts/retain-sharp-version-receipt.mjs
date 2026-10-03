import assert from "node:assert/strict";
import { constants } from "node:fs";
import {
  lstat,
  open,
  realpath,
  link,
  unlink,
  readlink,
  symlink,
  mkdir,
} from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUNDLE = "@img/sharp-libvips-linux-x64";
const MAX = 64 * 1024;
const NATIVE = "lib/libvips-cpp.so.8.18.7";
const NATIVE_SHA =
  "4aa73553408c3964071728f4a231a8e86918e39bc49f1fbae75355f7ea933ea9";

export async function nativeDigest(path, boundary) {
  await checkedPath(path, boundary);
  const file = await open(
    path,
    constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0),
  );
  try {
    const info = await file.stat();
    if (!info.isFile() || info.size < 1 || info.size > 32 * 1024 * 1024)
      throw new Error("Native dependency size invalid");
    const buffer = Buffer.alloc(MAX);
    const hash = createHash("sha256");
    let bytes = 0;
    for (;;) {
      const read = await file.read(buffer, 0, buffer.length, bytes);
      if (!read.bytesRead) break;
      bytes += read.bytesRead;
      if (bytes > 32 * 1024 * 1024)
        throw new Error("Native dependency exceeds bound");
      hash.update(buffer.subarray(0, read.bytesRead));
    }
    if (bytes !== info.size)
      throw new Error("Native dependency changed while hashing");
    return { bytes, sha256: hash.digest("hex") };
  } finally {
    await file.close();
  }
}

async function existingIdentical(path, bytes, boundary) {
  try {
    if (!(await boundedRead(path, boundary)).equals(bytes))
      throw new Error(
        "Standalone receipt collision differs from published bytes",
      );
    return true;
  } catch (error) {
    if (error.code === "ENOENT") {
      // A dangling symlink is not a missing destination.
      try {
        await lstat(path);
      } catch (missing) {
        if (missing.code === "ENOENT") return false;
        throw missing;
      }
    }
    throw error;
  }
}

async function retainFile(path, bytes, boundary) {
  if (await existingIdentical(path, bytes, boundary)) return false;
  const parent = await realpath(dirname(path));
  if (!isWithin(boundary, parent))
    throw new Error("Standalone receipt parent escapes boundary");
  const temporary = resolve(parent, `.vaettir-receipt-${randomUUID()}.tmp`);
  let file;
  let ownsTemporary = false;
  let failure;
  let copied = false;
  try {
    file = await open(
      temporary,
      constants.O_WRONLY |
        constants.O_CREAT |
        constants.O_EXCL |
        (constants.O_NOFOLLOW ?? 0),
      0o644,
    );
    ownsTemporary = true;
    await checkedPath(temporary, boundary);
    await file.writeFile(bytes);
    await file.sync();
    await file.close();
    file = undefined;
    // Same-directory hard link is atomic and cannot overwrite an existing
    // destination. A killed writer never exposes partial JSON to the runtime.
    try {
      await link(temporary, path);
      copied = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      await existingIdentical(path, bytes, boundary);
    }
    if (!(await boundedRead(path, boundary)).equals(bytes))
      throw new Error("Retained receipt byte verification failed");
  } catch (error) {
    failure = error;
  } finally {
    try {
      if (file) await file.close();
    } catch (error) {
      failure ??= error;
    }
    try {
      if (ownsTemporary) await unlink(temporary);
    } catch (error) {
      if (error.code !== "ENOENT") failure ??= error;
    }
  }
  if (failure) throw failure;
  return copied;
}

async function existingDependencyLink(plan, standalone) {
  let info;
  try {
    info = await lstat(plan.path);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  if (!info.isSymbolicLink())
    throw new Error(
      "Existing standalone dependency link is not the verified symlink",
    );
  let actual;
  try {
    actual = await realpath(plan.path);
  } catch (error) {
    throw new Error("Existing standalone dependency link is dangling", {
      cause: error,
    });
  }
  if (!isWithin(standalone, actual) || actual !== plan.destination)
    throw new Error(
      "Existing standalone dependency link conflicts or escapes boundary",
    );
  if (
    process.platform !== "win32" &&
    (await readlink(plan.path)) !== plan.relativeTarget
  )
    throw new Error(
      "Existing standalone dependency link has different target text",
    );
  return true;
}

async function dependencyLinkPlan(
  source,
  canonicalRoot,
  standalone,
  destination,
) {
  const paths = source.sharpRequire.resolve.paths(BUNDLE);
  if (!paths || paths.length > 32)
    throw new Error("Dependency lookup exceeds bounded source paths");
  for (const path of paths) {
    const candidate = resolve(path, BUNDLE);
    if (!isWithin(source.boundary, candidate)) continue;
    let info;
    try {
      info = await lstat(candidate);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    const actual = await checkedPath(candidate, source.boundary, false);
    if (actual !== dirname(source.bundlePackage))
      throw new Error(
        "Source dependency lookup conflicts with verified bundle",
      );
    if (info.isDirectory() && !info.isSymbolicLink()) return null;
    if (!info.isSymbolicLink())
      throw new Error("Source dependency lookup is not a pnpm directory link");
    const original = await readlink(candidate);
    if (
      process.platform !== "win32" &&
      (isAbsolute(original) || resolve(dirname(candidate), original) !== actual)
    )
      throw new Error(
        "Source dependency link is not the original bounded relative pnpm link",
      );
    const counterpart = resolve(standalone, relative(canonicalRoot, candidate));
    // Linux keeps the actual pnpm link text, not a newly invented dependency
    // route. Windows fixtures use junctions whose readlink text is absolute.
    const relativeTarget =
      process.platform === "win32"
        ? relative(dirname(counterpart), destination)
        : original;
    if (
      !isWithin(standalone, counterpart) ||
      isAbsolute(relativeTarget) ||
      resolve(dirname(counterpart), relativeTarget) !== destination
    )
      throw new Error("Standalone dependency link target escapes boundary");
    const plan = { path: counterpart, destination, relativeTarget };
    await existingDependencyLink(plan, standalone);
    return plan;
  }
  throw new Error("No verified original source dependency link found");
}

async function retainDependencyLink(plan, standalone) {
  if (!plan || (await existingDependencyLink(plan, standalone))) return false;
  const missing = [];
  let parent = dirname(plan.path);
  for (;;) {
    if (parent !== standalone && !isWithin(standalone, parent))
      throw new Error("Dependency link parent escapes standalone");
    try {
      const info = await lstat(parent);
      if (
        !info.isDirectory() ||
        info.isSymbolicLink() ||
        (await realpath(parent)) !== parent
      )
        throw new Error("Dependency link parent aliases another directory");
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      missing.push(parent);
      if (missing.length > 8)
        throw new Error("Dependency link parent creation exceeds bound", {
          cause: error,
        });
      parent = dirname(parent);
    }
  }
  for (const path of missing.reverse()) {
    try {
      await mkdir(path, { mode: 0o755 });
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const info = await lstat(path);
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      (await realpath(path)) !== path
    )
      throw new Error(
        "Created dependency link parent aliases another directory",
      );
  }
  let copied = false;
  try {
    await symlink(
      process.platform === "win32" ? plan.destination : plan.relativeTarget,
      plan.path,
      process.platform === "win32" ? "junction" : "dir",
    );
    copied = true;
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  await existingDependencyLink(plan, standalone);
  return copied;
}

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
  nativeDigestImpl = nativeDigest,
} = {}) {
  let stage = "canonical-boundaries";
  try {
    const canonicalRoot = await realpath(root);
    const sourceBoundary = await realpath(
      resolve(canonicalRoot, "node_modules"),
    );
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
      const prefix = base === canonicalRoot ? "source" : "standalone";
      stage = `${prefix}-next`;
      const webRequire = createRequire(resolve(base, "apps/web/package.json"));
      const nextPackage = webRequire.resolve("next/package.json");
      const next = await metadata(nextPackage, boundary);
      if (next.name !== "next" || typeof next.version !== "string")
        throw new Error("Unexpected resolved Next package");
      const nextRequire = createRequire(nextPackage);
      stage = `${prefix}-sharp`;
      const sharpEntry = nextRequire.resolve("sharp");
      const sharp = await sharpMetadata(sharpEntry, boundary);
      const sharpRequire = createRequire(sharpEntry);
      entries.push({
        next,
        sharp,
        sharpEntry,
        sharpRequire,
        boundary,
      });
    }
    const [source, target] = entries;
    stage = "package-equality";
    samePackage(source.next, target.next);
    samePackage(source.sharp, target.sharp);
    stage = "source-bundle";
    source.bundlePackage = await checkedPath(
      source.sharpRequire.resolve(`${BUNDLE}/package`),
      source.boundary,
    );
    const packageBytes = await boundedRead(
      source.bundlePackage,
      source.boundary,
    );
    source.bundle = JSON.parse(packageBytes.toString("utf8"));
    if (
      source.bundle.name !== BUNDLE ||
      source.bundle.version !== "1.3.4" ||
      source.bundle.exports?.["./versions"] !== "./versions.json" ||
      source.bundle.exports?.["./package"] !== "./package.json" ||
      source.bundle.exports?.["./binary"] !== `./${NATIVE}`
    )
      throw new Error("Unexpected libvips bundle identity/exports");
    const targetPackage = resolve(
      standalone,
      relative(canonicalRoot, source.bundlePackage),
    );
    const targetDirectory = await realpath(dirname(targetPackage));
    if (
      !isWithin(standalone, targetDirectory) ||
      targetDirectory !== dirname(targetPackage)
    )
      throw new Error(
        "Standalone bundle directory escapes boundary or aliases another package",
      );
    stage = "native-identity";
    const sourceNative = source.sharpRequire.resolve(`${BUNDLE}/binary`);
    if (sourceNative !== resolve(dirname(source.bundlePackage), NATIVE))
      throw new Error("Native export path differs from published bundle");
    const before = await nativeDigestImpl(sourceNative, source.boundary);
    const after = await nativeDigestImpl(
      resolve(targetDirectory, NATIVE),
      standalone,
    );
    if (
      before.sha256 !== NATIVE_SHA ||
      after.sha256 !== before.sha256 ||
      after.bytes !== before.bytes
    )
      throw new Error(
        "Standalone native bundle differs from pinned published bytes",
      );
    stage = "source-receipt";
    const sourcePath = source.sharpRequire.resolve(`${BUNDLE}/versions`);
    if (sourcePath !== resolve(dirname(source.bundlePackage), "versions.json"))
      throw new Error(
        "Bundle version export is not adjacent published receipt",
      );
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
    stage = "dependency-link-preflight";
    const linkPlan = await dependencyLinkPlan(
      source,
      canonicalRoot,
      standalone,
      targetDirectory,
    );
    const targetPath = resolve(targetDirectory, "versions.json");
    stage = "target-receipt";
    const parent = await realpath(dirname(targetPath));
    if (!isWithin(standalone, parent))
      throw new Error("Standalone receipt parent escapes boundary");
    // Preflight both collisions before either write. An interrupted two-file
    // operation safely retries exact existing bytes and completes the other.
    if (await existingIdentical(targetPackage, packageBytes, standalone))
      samePackage(source.bundle, await metadata(targetPackage, standalone));
    await existingIdentical(targetPath, bytes, standalone);
    stage = "target-package";
    const packageCopied = await retainFile(
      targetPackage,
      packageBytes,
      standalone,
    );
    stage = "target-receipt";
    const copied = await retainFile(targetPath, bytes, standalone);
    stage = "dependency-link-retention";
    const linkCopied = await retainDependencyLink(linkPlan, standalone);
    stage = "standalone-resolution";
    const standaloneRequire = createRequire(target.sharpEntry);
    for (const [subpath, expected] of [
      ["package", targetPackage],
      ["versions", targetPath],
    ]) {
      const resolved = standaloneRequire.resolve(`${BUNDLE}/${subpath}`);
      if ((await checkedPath(resolved, standalone)) !== expected)
        throw new Error(
          "Standalone dependency resolution differs from verified counterpart",
        );
    }
    return {
      copied,
      packageCopied,
      linkCopied,
      native: after,
      package: BUNDLE,
      version: "1.3.4",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      scope:
        "Published dependency receipt retention only; final image runtime checks remain required",
    };
  } catch (error) {
    error.retentionStage = stage;
    throw error;
  }
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
    .catch((error) => {
      const code = [
        "ENOENT",
        "EEXIST",
        "EACCES",
        "ERR_ASSERTION",
        "MODULE_NOT_FOUND",
        "ERR_PACKAGE_PATH_NOT_EXPORTED",
      ].includes(error.code)
        ? error.code
        : "OTHER";
      console.error(
        `Published Sharp receipt retention failed at ${error.retentionStage ?? "unknown"} (${code}); verify package identity, boundary and byte equality. No credentials logged.`,
      );
      process.exitCode = 1;
    })
    .finally(() => clearTimeout(deadline));
}
