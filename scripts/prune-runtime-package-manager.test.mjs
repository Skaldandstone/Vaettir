import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  validateRemovalSimulation,
  pruneRuntimePackageManager,
} from "./prune-runtime-package-manager.mjs";

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
      "RUN --network=none node scripts/prune-runtime-package-manager.mjs --image-build",
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
