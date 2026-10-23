import assert from "node:assert/strict";
import {
  existsSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
  constants,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packages = ["apt", "libapt-pkg7.0"];

function readBoundedBuildFile(path, encoding) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert.ok(
      fstatSync(fd).isFile(),
      "Image-build proof must be a regular file",
    );
    const bytes = Buffer.alloc(1024 * 1024 + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(fd, bytes, length, bytes.length - length, null);
      if (count === 0) break;
      length += count;
    }
    assert.ok(length <= 1024 * 1024, "Image-build proof file exceeds bound");
    return encoding
      ? bytes.subarray(0, length).toString(encoding)
      : bytes.subarray(0, length);
  } finally {
    closeSync(fd);
  }
}

export function assertReadOnlyBuildSource(read = readBoundedBuildFile) {
  const target = "/run/vaettir-image-build";
  const mountInfo = read("/proc/self/mountinfo", "utf8");
  assert.ok(
    typeof mountInfo === "string" &&
      Buffer.byteLength(mountInfo) <= 1024 * 1024,
    "Invalid image-build mount inventory",
  );
  assert.doesNotMatch(
    mountInfo,
    /\\(?!040|011|012|134)/,
    "Malformed kernel mount-path escaping",
  );
  const mounts = mountInfo
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "))
    .filter((fields) => fields[4] === target);
  assert.equal(
    mounts.length,
    1,
    "Require the dedicated read-only build-context mount",
  );
  const fields = mounts[0];
  const separator = fields.indexOf("-");
  assert.ok(
    /^\d+$/.test(fields[0]) &&
      /^\d+$/.test(fields[1]) &&
      /^\d+:\d+$/.test(fields[2]) &&
      fields[3].startsWith("/") &&
      separator >= 6 &&
      fields.length === separator + 4,
    "Invalid build-context mount record",
  );
  const flags = fields[5].split(",");
  assert.ok(
    flags.includes("ro") && !flags.includes("rw"),
    "Build-context source mount must be read-only",
  );
  const mounted = read(`${target}/prune-runtime-package-manager.mjs`);
  const executing = read(fileURLToPath(import.meta.url));
  assert.ok(
    Buffer.isBuffer(mounted) &&
      Buffer.isBuffer(executing) &&
      mounted.length > 0 &&
      mounted.length <= 1024 * 1024 &&
      executing.length <= 1024 * 1024 &&
      mounted.equals(executing),
    "Mounted build-context helper must exactly match the executing source",
  );
}

// No autoremove, dependencies, downloads, package installation or mutable host
// maintenance is allowed. Native/application checks still run after this step.
export function validateRemovalSimulation(output) {
  assert.equal(typeof output, "string");
  assert.ok(output.length < 64 * 1024, "Unexpected package simulation size");
  assert.equal(
    /^Inst /m.test(output),
    false,
    "Removal must not install packages",
  );
  const removed = [...output.matchAll(/^(?:Remv|Purg) (\S+)/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(removed.sort(), [...packages].sort(), "Unexpected removals");
  return removed;
}

export function pruneRuntimePackageManager({
  run = spawnSync,
  platform = process.platform,
  uid = process.getuid?.(),
  exists = existsSync,
  read = readBoundedBuildFile,
  cwd = process.cwd(),
} = {}) {
  assert.equal(platform, "linux", "Only Linux image builds are supported");
  assert.equal(uid, 0, "Run only as the image-build root user");
  assert.equal(cwd, "/app", "Run only from the packaged application directory");
  assertReadOnlyBuildSource(read);
  assert.ok(exists("/app"), "Expected application-image directory missing");
  function command(name, args) {
    const result = run(name, args, {
      encoding: "utf8",
      timeout: 90_000,
      maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH, LANG: "C", LC_ALL: "C" },
    });
    assert.equal(result.status, 0, `${name} failed: ${result.stderr}`);
    return result.stdout;
  }
  const removed = validateRemovalSimulation(
    command("apt-get", ["--simulate", "--purge", "remove", ...packages]),
  );
  // Debian marks apt essential for a mutable OS. Its actual payload is build-
  // only here, and this exception is limited to the exact simulated pair. Dpkg,
  // shell, TLS, libc, C++ libraries and application dependencies are retained.
  command("apt-get", [
    "--yes",
    "--allow-remove-essential",
    "--purge",
    "remove",
    ...packages,
  ]);
  const statusFormat = "-f=${db:Status-Abbrev}";
  for (const name of packages) {
    const state = run("dpkg-query", ["-W", statusFormat, name], {
      encoding: "utf8",
      timeout: 10_000,
      maxBuffer: 4096,
    });
    assert.ok(state.status === 0 || state.status === 1);
    assert.equal(/^ii/.test(state.stdout), false, `${name} still installed`);
  }
  for (const name of ["libstdc++6", "libgcc-s1", "dash", "ca-certificates"])
    assert.match(command("dpkg-query", ["-W", statusFormat, name]), /^ii/);
  assert.equal(exists("/usr/bin/apt-get"), false, "Apt payload still present");
  assert.ok(exists("/usr/bin/dpkg-query"), "Runtime package verifier removed");
  return { removedPackages: removed, retainedPackageVerifier: true };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assert.deepEqual(process.argv.slice(2), ["--image-build"]);
  console.log(
    "Runtime package-manager payload pruned: " +
      JSON.stringify(pruneRuntimePackageManager()),
  );
}
