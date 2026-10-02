import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fetchVerifiedSource } from "./fetch-runtime-vendor-sources.mjs";

const origin = "https://deb.debian.org/debian/pool/main/e/expat/";
const data = Buffer.from("synthetic vendor archive");
const file = {
  name: "expat_2.8.5-2.dsc",
  sha256: createHash("sha256").update(data).digest("hex"),
  maxBytes: 100,
};

test("public vendor downloads are host pinned, redirect disabled and hash verified", async () => {
  const actual = await fetchVerifiedSource(file, {
    origin,
    fetchImpl: async (url, options) => {
      assert.equal(url, origin + file.name);
      assert.equal(options.redirect, "error");
      assert.ok(options.signal instanceof AbortSignal);
      assert.equal(options.headers, undefined);
      return new Response(data);
    },
  });
  assert.deepEqual(actual, data);
});

test("checksum, bounds, HTTP failure and cancellation fail closed", async () => {
  for (const [pin, response, message] of [
    [
      { ...file, sha256: "0".repeat(64) },
      new Response(data),
      /checksum mismatch/,
    ],
    [{ ...file, maxBytes: 1 }, new Response(data), /size exceeded/],
    [file, new Response("", { status: 500 }), /download failed/],
  ]) {
    await assert.rejects(
      fetchVerifiedSource(pin, { origin, fetchImpl: async () => response }),
      message,
    );
  }
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    fetchVerifiedSource(file, {
      origin,
      signal: controller.signal,
      fetchImpl: async (_, options) => {
        options.signal.throwIfAborted();
      },
    }),
    { name: "AbortError" },
  );
});

test("unapproved origins, path traversal and invalid pins never fetch", async () => {
  for (const [pin, host] of [
    [file, "http://127.0.0.1/"],
    [{ ...file, name: "../secret" }, origin],
    [{ ...file, maxBytes: 20_000_000 }, origin],
    [{ ...file, sha256: "invalid" }, origin],
  ]) {
    await assert.rejects(
      fetchVerifiedSource(pin, {
        origin: host,
        fetchImpl: () => assert.fail("invalid pin fetched"),
      }),
      /Invalid vendor source pin/,
    );
  }
});

test("API vendor build verifies signature, preserves packaging and validates both shipped Unicode ABIs", () => {
  const docker = readFileSync(
    new URL("../Dockerfile.api", import.meta.url),
    "utf8",
  );
  const manifest = JSON.parse(
    readFileSync(
      new URL("./runtime-vendor-sources.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.expat.version, "2.8.5-2");
  assert.equal(manifest.expat.files.length, 3);
  assert.match(
    docker,
    /gpgv --keyring \/usr\/share\/keyrings\/debian-keyring.gpg expat_2.8.5-2.dsc/,
  );
  assert.match(docker, /timeout 600 make -C build check/);
  assert.match(docker, /gcc -std=c11 -Wall -Wextra -Werror[^\n]+-lexpatw/);
  assert.match(docker, /timeout 10 \/build\/check-expat-wide/);
  const wide = readFileSync(
    new URL("./check-expat-wide-runtime.c", import.meta.url),
    "utf8",
  );
  assert.match(wide, /sizeof\(XML_Char\) == 2/);
  assert.match(wide, /XML_ERROR_INVALID_TOKEN/);
  assert.match(wide, /0xd83d, 0xde00/);
  assert.match(
    docker,
    /COPY --from=vendor-build \/build\/libexpat1_2.8.5-2_\*.deb/,
  );
  assert.match(docker, /libexpat1\)" ge '2.8.5-2'/);
  assert.match(docker, /libcurl4-gnutls\)" ge '8.21.0-2~bpo13\+1'/);
  assert.doesNotMatch(
    docker,
    /--allow-unauthenticated|trusted=yes|\bsid\b|\bunstable\b.*Suites:/,
  );
});
