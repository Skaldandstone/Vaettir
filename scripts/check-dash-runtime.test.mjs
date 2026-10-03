import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { access } from "node:fs/promises";
import {
  checkDashRuntime,
  importsLibcFnmatch,
  dashChildEnvironment,
  patternFixture,
} from "./check-dash-runtime.mjs";

function elf(name = "fnmatch", { defined = false } = {}) {
  const binary = Buffer.alloc(512);
  binary.write("7f454c46", 0, "hex");
  binary[4] = 2;
  binary[5] = 1;
  binary.writeBigUInt64LE(64n, 40);
  binary.writeUInt16LE(64, 58);
  binary.writeUInt16LE(3, 60);
  binary.writeUInt32LE(11, 64 + 64 + 4);
  binary.writeBigUInt64LE(256n, 64 + 64 + 24);
  binary.writeBigUInt64LE(48n, 64 + 64 + 32);
  binary.writeUInt32LE(2, 64 + 64 + 40);
  binary.writeBigUInt64LE(24n, 64 + 64 + 56);
  binary.writeUInt32LE(3, 64 + 128 + 4);
  binary.writeBigUInt64LE(320n, 64 + 128 + 24);
  binary.writeBigUInt64LE(32n, 64 + 128 + 32);
  binary.writeUInt32LE(1, 280);
  binary.writeUInt16LE(defined ? 1 : 0, 286);
  binary.write(name, 321);
  return binary;
}
test("requires actual bounded ELF64 libc fnmatch import, not an arbitrary matching string", () => {
  assert.equal(importsLibcFnmatch(elf()), true);
  assert.equal(importsLibcFnmatch(elf("fnmatch", { defined: true })), false);
  assert.equal(importsLibcFnmatch(elf("pmatch")), false);
  assert.throws(() => importsLibcFnmatch(Buffer.from("fnmatch")));
  const invalid = elf();
  invalid.writeBigUInt64LE(999999n, 40);
  assert.throws(() => importsLibcFnmatch(invalid), /bounds/);
  const unbounded = elf();
  unbounded.writeBigUInt64LE(999999n, 64 + 64 + 32);
  assert.throws(() => importsLibcFnmatch(unbounded), /bounds/);
});
test("child environment excludes provider, database, cloud and injected shell configuration", () => {
  const environment = dashChildEnvironment(
    {
      PATH: "/usr/bin:/bin",
      DATABASE_URL: "secret",
      AWS_SECRET_ACCESS_KEY: "secret",
      ENV: "/attacker/rc",
      BASH_ENV: "/attacker/rc",
      LD_PRELOAD: "/attacker.so",
    },
    "/synthetic",
    "C",
  );
  assert.deepEqual(environment, {
    PATH: "/usr/bin:/bin",
    HOME: "/synthetic",
    TMPDIR: "/synthetic",
    LANG: "C",
    LC_ALL: "C",
  });
});
test("runs synthetic quoting, pattern, locale and adverse case/glob checks with exact bounds and cleans up", async () => {
  const calls = [];
  const proof = await checkDashRuntime({
    readFileImpl: async () => elf(),
    runImpl: async (command, args, options) => {
      calls.push({ command, args, options });
      assert.equal(command, "/bin/dash");
      assert.equal(args[0], "-c");
      assert.equal(options.maxBuffer, 4096);
      assert.equal(options.killSignal, "SIGKILL");
      assert.equal(options.env.DATABASE_URL, undefined);
      assert.equal(options.env.ENV, undefined);
      return {
        code: 0,
        stdout: args[1].includes("bounded-case-verified")
          ? "bounded-case-verified\n"
          : args[1].includes("bounded-glob-verified")
            ? "bounded-glob-verified\n"
            : "pattern-semantics-verified\n",
      };
    },
  });
  assert.equal(proof.imported, "fnmatch");
  assert.equal(proof.checks, 4);
  assert.match(proof.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(
    calls.map((row) => row.options.timeout),
    [3000, 3000, 1500, 1500],
  );
  assert.deepEqual(
    calls.slice(0, 2).map((row) => row.options.env.LC_ALL),
    ["C", "C.UTF-8"],
  );
  await assert.rejects(access(calls[0].options.cwd));
});
test("rejects missing imported matcher before launching the shell", async () => {
  let called = false;
  await assert.rejects(
    checkDashRuntime({
      readFileImpl: async () => elf("pmatch"),
      runImpl: async () => {
        called = true;
      },
    }),
    /does not import/,
  );
  assert.equal(called, false);
});
test("fails closed on regression output and child timeout with temporary cleanup", async () => {
  for (const failure of ["output", "timeout"]) {
    let root;
    await assert.rejects(
      checkDashRuntime({
        readFileImpl: async () => elf(),
        runImpl: async (_command, _args, options) => {
          root = options.cwd;
          if (failure === "timeout") throw Error("Synthetic child timeout");
          return { code: 0, stdout: "unexpected" };
        },
      }),
    );
    await assert.rejects(access(root));
  }
});
test("cancelled guards never launch the shell", async () => {
  const controller = new AbortController();
  controller.abort();
  let called = false;
  await assert.rejects(
    checkDashRuntime({
      signal: controller.signal,
      runImpl: async () => {
        called = true;
      },
    }),
  );
  assert.equal(called, false);
});
test("signed-source rebuild retains Debian patches/options, transparent version and fails on configuration drift", () => {
  const build = readFileSync(
    new URL("./build-dash-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(build, /sha256sum --check/);
  for (const pin of [
    "589efc4d87a4ae4745c273bdb33198d7c4f28a71736a8ece81d3677cf9c6e5ce",
    "6a474ac46e8b0b32916c4c60df694c82058d3297d8b385b74508030ca4a8f28a",
    "a278acb5d9a1f5d9a086d36a547287cbf3105b8f33c0e62d86d264decf5ba1ad",
  ])
    assert.ok(build.includes(pin));
  assert.match(
    build,
    /gpgv --keyring \/usr\/share\/keyrings\/debian-keyring.gpg/,
  );
  assert.match(build, /VALIDSIG 83DCD17F44B22CC83656EDA1E8446B4AC8C77261/);
  assert.match(build, /dpkg-source -x/);
  assert.match(
    build,
    /rules.replace\('--disable-fnmatch', '--enable-fnmatch'\)/,
  );
  assert.match(build, /!rules.includes\('--disable-glob'\)/);
  assert.match(build, /!rules.includes\('--disable-lineno'\)/);
  assert.match(build, /0.5.12-12\+vaettir1/);
  assert.match(
    build,
    /timeout 600 env DEB_BUILD_OPTIONS=parallel=2 dpkg-buildpackage -b -us -uc/,
  );
  assert.match(build, /timeout 30 node "\$checker" "\$binary"/);
  assert.doesNotMatch(
    build,
    /DEB_BUILD_OPTIONS=.*nocheck|--force|--allow-unauthenticated/,
  );
  assert.match(patternFixture, /\[\[:alpha:\]\]\[\[:digit:\]\]/);
  assert.match(patternFixture, /\$\{v#'prefix\*'\}/);
});
