import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchPinnedInput } from "./fetch-node-brotli-sources.mjs";
import { restorePreNodeBrotliDockerfileFixture } from "./node-brotli-dockerfile-inverse-fixture.mjs";
const url = "https://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz",
  body = Buffer.from("synthetic-pinned-input"),
  pin = {
    bytes: body.length,
    sha256: createHash("sha256").update(body).digest("hex"),
  };

test("isolated ABI proof selects its reviewed baseline despite newer APT candidates", () => {
  const manifest = JSON.parse(readFileSync(new URL("./node-brotli-runtime-sources.json", import.meta.url), "utf8"));
  assert.equal(manifest.brotli.baselineBinaryVersion, "1.1.0-2+b7");
  for (const name of ["../Dockerfile.api", "./Dockerfile.node-brotli-security"]) {
    const source = readFileSync(new URL(name, import.meta.url), "utf8");
    assert.equal(source.match(/apt-get install[^\n]* libbrotli1=1\.1\.0-2\+b7 /g)?.length, 1);
    assert.ok(source.includes('test "$(dpkg-query -W -f=\'${Version}\' libbrotli1)" = 1.1.0-2+b7'));
    assert.ok(source.includes('test "$(dpkg-query -W -f=\'${source:Version}\' libbrotli1)" = 1.1.0-2'));
  }
  const runtime = readFileSync(new URL("../Dockerfile.api", import.meta.url), "utf8");
  assert.ok(runtime.includes("COPY --from=node-brotli-security /build/native/proof/packages/libbrotli1_1.1.0-2+vaettir1_amd64.deb"));
  assert.ok(runtime.includes("timeout 10 /usr/share/vaettir/node-brotli-security/check-brotli-block-switch"));
});
test("source transport verifies bytes and hash and withholds implicit Brotli decoding", async () => {
  const actual = await fetchPinnedInput(url, pin, {
    fetchImpl: async (u, o) => {
      assert.equal(u, url);
      assert.equal(o.redirect, "error");
      assert.equal(o.headers["Accept-Encoding"], "identity");
      return new Response(body);
    },
  });
  assert.deepEqual(actual, body);
});
test("unapproved origins, path changes and credentials fail before a request", async () => {
  for (const u of [
    "http://nodejs.org/dist/v22.23.4/node-v22.23.4-linux-x64.tar.xz",
    url + "?other=1",
    url.replace("nodejs.org", "evil.example"),
    url.replace("nodejs.org", "secret@nodejs.org"),
    url.replace("/dist/", "/other/"),
  ])
    await assert.rejects(
      fetchPinnedInput(u, pin, {
        fetchImpl: () => {
          throw Error("Request must not run");
        },
      }),
    );
});
test("truncated, extended, changed and compressed responses fail closed", async () => {
  for (const response of [
    new Response(body.subarray(1)),
    new Response(Buffer.concat([body, body])),
    new Response(Buffer.alloc(body.length)),
    new Response(body, { headers: { "content-encoding": "br" } }),
    new Response("unavailable", { status: 503 }),
  ])
    await assert.rejects(
      fetchPinnedInput(url, pin, { fetchImpl: async () => response }),
    );
});
test("native regression uses the exact upstream Node malformed stream", () => {
  const source = readFileSync(
      new URL("./check-brotli-block-switch.c", import.meta.url),
      "utf8",
    ),
    hex = [
      ...source
        .match(/invalid\[\]\s*=\s*\{([^}]+)\}/s)[1]
        .matchAll(/0x([a-f0-9]{2})/g),
    ]
      .map((x) => x[1])
      .join("");
  assert.equal(hex, "200010414141fcffff07002228f00b60f7f41f000000");
  assert.match(source, /uint8_t output\[256\]/);
});

test("historical test input requires exact complete current bytes and preserves its predecessor", () => {
  const current = Buffer.from(
    readFileSync(
      new URL("../Dockerfile.api", import.meta.url),
      "utf8",
    ).replaceAll("\r\n", "\n"),
  );
  const old = restorePreNodeBrotliDockerfileFixture(current);
  assert.equal(
    createHash("sha256").update(old).digest("hex"),
    "401ae9ef8a65cd212f52d999864695ff210db6dddd947a83f8420f3830917374",
  );
  for (const invalid of [
    Buffer.concat([current, Buffer.from("# other edit\n")]),
    Buffer.from(
      current
        .toString()
        .replace(
          "check-node-security-runtime.mjs",
          "skip-node-security-runtime.mjs",
        ),
    ),
    Buffer.from(current.toString().replaceAll("\n", "\r\n")),
    old,
  ])
    assert.throws(() => restorePreNodeBrotliDockerfileFixture(invalid));
  for (const name of [
    "native-builder-fresh-core.mjs",
    "native-builder-fresh-prepare.mjs",
    "native-builder-fresh-final-plan.mjs",
    "native-builder-fresh-final-verifier.mjs",
  ])
    assert.doesNotMatch(
      readFileSync(new URL("./" + name, import.meta.url), "utf8"),
      /node-brotli-dockerfile-inverse-fixture/,
    );
});
