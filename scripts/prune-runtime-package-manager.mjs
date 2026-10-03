import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const packages = ["apt", "libapt-pkg7.0"];

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
} = {}) {
  assert.equal(platform, "linux", "Only Linux image builds are supported");
  assert.equal(uid, 0, "Run only as the image-build root user");
  assert.ok(exists("/.dockerenv"), "Refuse package removal on a host");
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
