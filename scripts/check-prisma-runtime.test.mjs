import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkPrismaRuntime,
  prismaEngineTarget,
} from "./check-prisma-runtime.mjs";

test("native image targets require Linux and supported OpenSSL 3 architectures", () => {
  assert.equal(prismaEngineTarget("linux", "x64"), "debian-openssl-3.0.x");
  assert.equal(
    prismaEngineTarget("linux", "arm64"),
    "linux-arm64-openssl-3.0.x",
  );
  assert.throws(() => prismaEngineTarget("win32", "x64"), /requires Linux/);
  assert.throws(() => prismaEngineTarget("linux", "ia32"), /Unsupported/);
});

function smoke(overrides = {}) {
  return checkPrismaRuntime({
    platform: "linux",
    arch: "x64",
    resolveFiles: () => ({
      query: "/fixture/query.so.node",
      schema: "/fixture/schema-engine",
    }),
    loadNative: () => {},
    runSchema: () => ({
      status: 0,
      stdout: "schema-engine-cli 605197351a3c8bdd595af2d2a9bc3025bca48ea2\n",
    }),
    ...overrides,
  });
}

test("query native linking precedes bounded credential-free schema startup", () => {
  const calls = [];
  assert.equal(
    smoke({
      loadNative: (path) => calls.push(["query", path]),
      runSchema: (path, args, options) => {
        calls.push(["schema", path]);
        assert.deepEqual(args, ["--version"]);
        assert.equal(options.timeout, 10_000);
        assert.equal(options.maxBuffer, 8_192);
        assert.deepEqual(Object.keys(options.env).sort(), [
          "LANG",
          "LC_ALL",
          "PATH",
        ]);
        return {
          status: 0,
          stdout:
            "schema-engine-cli 605197351a3c8bdd595af2d2a9bc3025bca48ea2\n",
        };
      },
    }),
    "debian-openssl-3.0.x",
  );
  assert.deepEqual(calls, [
    ["query", "/fixture/query.so.node"],
    ["schema", "/fixture/schema-engine"],
  ]);
});

test("missing query libraries, schema failures, wrong output and timeout fail closed", () => {
  assert.throws(
    () =>
      smoke({
        loadNative: () => {
          throw new Error("missing libssl");
        },
      }),
    /missing libssl/,
  );
  for (const result of [
    { status: 1, stdout: "" },
    { status: 0, stdout: "not an engine" },
    { status: null, error: new Error("timeout") },
  ]) {
    assert.throws(
      () => smoke({ runSchema: () => result }),
      /bounded native startup/,
    );
  }
});

test("all image stages pin the same Trixie base and install patched Perl/OpenSSL before generation", () => {
  const api = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  const web = readFileSync(
    new URL("../Dockerfile.web", import.meta.url),
    "utf8",
  );
  const bases = [...(api + "\n" + web).matchAll(/^FROM (\S+)/gm)].map(
    (match) => match[1],
  );
  assert.equal(bases.length, 4);
  assert.equal(new Set(bases).size, 1);
  assert.match(bases[0], /node:22-trixie-slim@sha256:[a-f0-9]{64}$/);
  assert.doesNotMatch(api + web, /43ac6c60b8f89723/);
  assert.equal(
    (api + web).match(/apt-get install[^\n]+libpcre2-8-0/g)?.length,
    4,
  );
  assert.equal(
    (api + web).match(/libpcre2-8-0\)" ge '10\.46-1~deb13u3'/g)?.length,
    4,
  );
  for (const source of [api, web]) {
    assert.ok(
      source.indexOf("openssl ca-certificates") <
        source.indexOf("pnpm --filter @vaettir/db generate"),
    );
    assert.match(source, /perl-base\)" ge '5\.40\.1-6\+deb13u1'/);
    assert.match(
      source,
      /pnpm --filter @vaettir\/db generate \\\r?\n\s+&& node scripts\/check-prisma-runtime.mjs/,
    );
  }
  const runtime = web.split(/ AS runtime/)[1];
  assert.match(
    runtime,
    /apt-get install[^\n]+openssl ca-certificates perl-base/,
  );
  assert.match(runtime, /USER nextjs/);
});
