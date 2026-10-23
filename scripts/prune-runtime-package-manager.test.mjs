import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateRemovalSimulation,
  pruneRuntimePackageManager,
  assertReadOnlyBuildSource,
} from "./prune-runtime-package-manager.mjs";

const mountRecord =
  "42 35 0:64 / /run/vaettir-image-build ro,relatime - overlay overlay rw\n";
const buildProof = {
  cwd: "/app",
  read: (path) =>
    path === "/proc/self/mountinfo"
      ? mountRecord
      : Buffer.from("synthetic helper bytes"),
};

test("build-context guard rejects plain hosts, forged directories, writable/duplicate mounts and altered source", () => {
  assertReadOnlyBuildSource(buildProof.read);
  for (const inventory of [
    "",
    mountRecord.replace("ro,", "rw,"),
    mountRecord + mountRecord,
    mountRecord.replace("ro,", "ro,rw,"),
    "x".repeat(1024 * 1024 + 1),
    mountRecord.replace(
      "/run/vaettir-image-build",
      "/run/vaettir-image-build\\040forged",
    ),
    mountRecord.replace(
      "/run/vaettir-image-build",
      "/run/vaettir-image-build\\777",
    ),
    mountRecord.replace(" - overlay overlay rw", " - overlay"),
    mountRecord.replace("42 35 0:64", "forged forged not-a-device"),
    mountRecord.replace(
      "/run/vaettir-image-build",
      "/run/not-the-build-context",
    ),
  ])
    assert.throws(() =>
      assertReadOnlyBuildSource((path) =>
        path === "/proc/self/mountinfo"
          ? inventory
          : Buffer.from("synthetic helper bytes"),
      ),
    );
  assert.throws(() =>
    assertReadOnlyBuildSource((path) =>
      path === "/proc/self/mountinfo"
        ? mountRecord
        : Buffer.from(
            path.startsWith("/run/") ? "altered source" : "actual source",
          ),
    ),
  );
  assert.throws(() =>
    pruneRuntimePackageManager({
      ...buildProof,
      cwd: "/",
      platform: "linux",
      uid: 0,
      exists: () => true,
      run: () => assert.fail("must not execute"),
    }),
  );
  assert.throws(() =>
    pruneRuntimePackageManager({
      ...buildProof,
      read: (path) =>
        path === "/proc/self/mountinfo"
          ? ""
          : Buffer.from("synthetic helper bytes"),
      platform: "linux",
      uid: 0,
      exists: () => true,
      run: () => assert.fail("must not execute"),
    }),
  );
});

test("only the exact two build-only package payloads may be removed", () => {
  for (const operation of ["Remv", "Purg"])
    assert.deepEqual(
      validateRemovalSimulation(
        `${operation} apt [3.0.3]\n${operation} libapt-pkg7.0 [3.0.3]\n`,
      ),
      ["apt", "libapt-pkg7.0"],
    );
  for (const output of [
    "",
    "Purg apt\n",
    "Purg apt\nPurg libapt-pkg7.0\nPurg nodejs\n",
    "Purg apt\nPurg libapt-pkg7.0\nInst replacement\n",
    "Purg apt\nPurg apt\nPurg libapt-pkg7.0\n",
    "x".repeat(65536),
  ])
    assert.throws(() => validateRemovalSimulation(output));
});

test("refuses host, non-Linux and non-root operations before commands", () => {
  for (const options of [
    { platform: "win32", uid: 0, exists: () => true },
    { platform: "linux", uid: 1001, exists: () => true },
    { platform: "linux", uid: 0, exists: () => false },
  ])
    assert.throws(() =>
      pruneRuntimePackageManager({
        ...buildProof,
        ...options,
        run() {
          throw Error("Must not execute");
        },
      }),
    );
});

test("removal failure or unexpected simulation is fatal; no retries or autoremove", () => {
  for (const output of [
    "Purg apt\nPurg libapt-pkg7.0\nPurg dash\n",
    "Purg apt\nPurg libapt-pkg7.0\n",
  ]) {
    let calls = 0;
    assert.throws(() =>
      pruneRuntimePackageManager({
        ...buildProof,
        platform: "linux",
        uid: 0,
        exists: () => true,
        run(name, args) {
          calls++;
          assert.equal(name, "apt-get");
          assert.equal(args.includes("autoremove"), false);
          return {
            status: calls === 1 ? 0 : 1,
            stdout: output,
            stderr: "fixture failure",
          };
        },
      }),
    );
    assert.equal(calls, output.includes("Purg dash") ? 1 : 2);
  }
});

test("Docker runtime pruning precedes native acceptance without removing checks", () => {
  for (const service of ["web", "api"]) {
    const source = readFileSync(
      new URL(`../Dockerfile.${service}`, import.meta.url),
      "utf8",
    );
    const position = source.indexOf(
      "RUN --network=none --mount=type=bind,source=scripts,target=/run/vaettir-image-build,readonly node scripts/prune-runtime-package-manager.mjs --image-build",
    );
    assert.ok(position > source.indexOf(" AS runtime"));
    for (const check of [
      "check-dash-runtime.mjs",
      "check-zlib-runtime.mjs",
      "check-image-runtime.mjs",
    ])
      assert.ok(
        source.indexOf(`RUN --network=none node scripts/${check}`) > position,
      );
    if (service === "api")
      for (const check of [
        "check-browser-runtime.mjs",
        "check-browser-graphics.mjs",
        "check-mesa-runtime.mjs",
        "check-git-runtime.mjs",
      ])
        assert.ok(
          source.indexOf(`RUN --network=none node scripts/${check}`) > position,
        );
  }
});

test("successful pruning verifies real package absence and retained runtime prerequisites", () => {
  let removal = false;
  const calls = [];
  const result = pruneRuntimePackageManager({
    ...buildProof,
    platform: "linux",
    uid: 0,
    exists: (path) => (path === "/usr/bin/apt-get" ? !removal : true),
    run(name, args, options) {
      calls.push({ name, args });
      assert.ok(options.timeout <= 90000);
      if (name === "apt-get") {
        if (args.includes("--simulate"))
          return {
            status: 0,
            stdout: "Purg apt\nPurg libapt-pkg7.0\n",
            stderr: "",
          };
        assert.deepEqual(args, [
          "--yes",
          "--allow-remove-essential",
          "--purge",
          "remove",
          "apt",
          "libapt-pkg7.0",
        ]);
        removal = true;
        return { status: 0, stdout: "", stderr: "" };
      }
      return {
        status: ["apt", "libapt-pkg7.0"].includes(args.at(-1)) ? 1 : 0,
        stdout: ["apt", "libapt-pkg7.0"].includes(args.at(-1)) ? "" : "ii ",
        stderr: "",
      };
    },
  });
  assert.deepEqual(result, {
    removedPackages: ["apt", "libapt-pkg7.0"],
    retainedPackageVerifier: true,
  });
  assert.equal(calls.length, 8);
});
