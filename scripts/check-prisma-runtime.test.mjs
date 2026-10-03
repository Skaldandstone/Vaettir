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

function assertPatchedPinnedStages(source, names, base) {
  const stages = [
    ...source.matchAll(
      /^FROM (\S+) AS (\S+)\r?\n([\s\S]*?)(?=^FROM |$(?![\s\S]))/gm,
    ),
  ];
  assert.deepEqual(
    stages.map((stage) => stage[2]),
    names,
  );
  const verifiedBaseStages = new Set();
  for (const [, image, name, content] of stages) {
    if (
      name === "llvm-configure-only" ||
      name === "llvm-release-core-only" ||
      name === "llvm-build"
    ) {
      assert.equal(
        image,
        "llvm-build-inputs",
        `${name} must inherit only its exact maintained inputs`,
      );
      assert.ok(
        verifiedBaseStages.has(image),
        `${name} parent must already have verified pinned base/package gates`,
      );
      continue;
    }
    assert.equal(image, base, `${name} must retain the immutable base`);
    assert.match(
      content,
      /apt-get install[^\n]+openssl ca-certificates[^\n]+perl-base[^\n]+libpcre2-8-0/,
    );
    assert.match(
      content,
      /&& dpkg --compare-versions [^\n]+perl-base\)" ge '5\.40\.1-6\+deb13u1'/,
    );
    assert.match(
      content,
      /&& dpkg --compare-versions [^\n]+libpcre2-8-0\)" ge '10\.46-1~deb13u3'/,
    );
    const updates = [...content.matchAll(/apt-get update([^\n]*)/g)];
    assert.ok(updates.length > 0, `${name} must acquire package metadata`);
    for (const update of updates) assert.match(update[1], /--error-on=any/);
    verifiedBaseStages.add(name);
  }
}

test("all image stages pin the same Trixie base and install patched Perl/OpenSSL before generation", () => {
  const api = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  const web = readFileSync(
    new URL("../Dockerfile.web", import.meta.url),
    "utf8",
  );
  const base =
    "public.ecr.aws/docker/library/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4";
  for (const [source, names] of [
    [
      api,
      [
        "vendor-build",
        "llvm-build-inputs",
        "llvm-configure-only",
        "llvm-release-core-only",
        "llvm-build",
        "zlib-build",
        "runtime",
      ],
    ],
    [web, ["native-build", "builder", "runtime"]],
  ]) {
    assertPatchedPinnedStages(source, names, base);
  }
  assert.doesNotMatch(api + web, /43ac6c60b8f89723/);
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
test("derived LLVM stages reject unpinned, unrelated, forward and incompletely gated parents", () => {
  const source = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  const base =
    "public.ecr.aws/docker/library/node:22-trixie-slim@sha256:b26b04c123d9ff8ab646ceb18b9d75a1173acf64b9a401094b906d27b29338d4";
  const names = [
    "vendor-build",
    "llvm-build-inputs",
    "llvm-configure-only",
    "llvm-release-core-only",
    "llvm-build",
    "zlib-build",
    "runtime",
  ];
  assertPatchedPinnedStages(source, names, base);
  const inputs = source.match(
    /^FROM [^\n]+ AS llvm-build-inputs\r?\n[\s\S]*?(?=^FROM )/m,
  )?.[0];
  assert.ok(inputs);
  const mutateInputs = (transform) => source.replace(inputs, transform(inputs));
  for (const malformed of [
    source.replace(
      "FROM llvm-build-inputs AS llvm-release-core-only",
      "FROM node:22-trixie-slim AS llvm-release-core-only",
    ),
    source.replace(
      "FROM llvm-build-inputs AS llvm-release-core-only",
      "FROM llvm-build AS llvm-release-core-only",
    ),
    source.replace(
      "FROM llvm-build-inputs AS llvm-release-core-only",
      "FROM vendor-build AS llvm-release-core-only",
    ),
    source.replace(
      "FROM llvm-build-inputs AS llvm-configure-only",
      "FROM node:22-trixie-slim AS llvm-configure-only",
    ),
    source.replace(
      "FROM llvm-build-inputs AS llvm-configure-only",
      "FROM vendor-build AS llvm-configure-only",
    ),
    source.replace(
      "FROM llvm-build-inputs AS llvm-configure-only",
      "FROM llvm-build AS llvm-configure-only",
    ),
    source.replace(
      "FROM llvm-build-inputs AS llvm-build",
      "FROM llvm-configure-only AS llvm-build",
    ),
    source.replace(
      `${base} AS llvm-build-inputs`,
      "node:22-trixie-slim AS llvm-build-inputs",
    ),
    source.replace("AS llvm-build-inputs", "AS unexpected-llvm-inputs"),
    source.replace(
      "&& dpkg --compare-versions",
      "&& dpkg --unverified-versions",
    ),
    mutateInputs((stage) =>
      stage.replace(
        "&& dpkg --compare-versions",
        "&& dpkg --unverified-versions",
      ),
    ),
    mutateInputs((stage) =>
      stage.replace('libpcre2-8-0)" ge', 'libpcre2-8-0)" unverified'),
    ),
    mutateInputs((stage) => stage.replace("5.40.1-6+deb13u1", "5.40.1-6")),
    mutateInputs((stage) => stage.replace("10.46-1~deb13u3", "10.46-1")),
    mutateInputs((stage) =>
      stage.replace("apt-get install", "apt-get suppressed-install"),
    ),
    mutateInputs((stage) =>
      stage.replace("apt-get update --error-on=any", "apt-get update"),
    ),
  ]) {
    assert.notEqual(malformed, source);
    assert.throws(() => assertPatchedPinnedStages(malformed, names, base));
  }
});

test("HTTPS backports are enabled only after CA bootstrap and updates fail closed", () => {
  const api = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  const runtime = api.split(" AS runtime")[1];
  const trust = runtime.indexOf(
    "apt-get install -y --no-install-recommends ca-certificates",
  );
  const source = runtime.indexOf("COPY scripts/debian-backports.sources");
  assert.ok(trust >= 0 && trust < source);
  assert.match(runtime.slice(0, trust), /apt-get update --error-on=any/);
  assert.match(runtime.slice(source), /RUN apt-get update --error-on=any/);
  assert.doesNotMatch(
    runtime,
    /Verify-Peer=false|allow-unauthenticated|allow-insecure-repositories|trusted=yes/,
  );
  const backports = readFileSync(
    new URL("./debian-backports.sources", import.meta.url),
    "utf8",
  );
  assert.match(backports, /URIs: https:\/\/deb\.debian\.org\/debian/);
  assert.match(
    backports,
    /Signed-By: \/usr\/share\/keyrings\/debian-archive-keyring\.gpg/,
  );
});
