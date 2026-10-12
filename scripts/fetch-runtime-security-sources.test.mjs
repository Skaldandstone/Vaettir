import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { sourceDescriptors, fetchSecuritySource } from "./fetch-runtime-security-sources.mjs";
const manifest = JSON.parse(readFileSync(new URL("./runtime-security-sources.json", import.meta.url), "utf8"));
const pins = sourceDescriptors();
test("finite exact signed stable-source and maintained patch closure, not binary or distro replacement", () => {
  assert.equal(pins.length, 33);
  assert.equal(pins.filter(pin => pin.name.endsWith(".patch")).length, 23);
  assert.equal(manifest.components.glibc.sourceVersion, "2.41-12+deb13u4");
  assert.equal(manifest.components.glibc.signer, "52BC8695BE34F90AD7D40CB81388C0F899E8336B");
  assert.equal(manifest.components.freetype.signer, "B6E62F3D12AC38495C0DA90510C293B6C37C4E36");
  const original = structuredClone(manifest);
  for (const changed of ["url", "name", "bytes", "sha256"]) {
    const bad = structuredClone(original);
    bad.components.glibc.sourceFiles[0][changed] = changed === "bytes" ? 25000001 : "../unapproved";
    assert.throws(() => sourceDescriptors(bad));
  }
  const truncated = structuredClone(manifest); truncated.components.glibc.patches.pop();
  assert.throws(() => sourceDescriptors(truncated));
});
test("changed authority, descriptor, extra fields or source origin cannot send a request", async () => {
  for (const changed of [{ ...pins[0], url: "http://127.0.0.1/" }, { ...pins[0], sha256: "a".repeat(64) }, { ...pins[0], extra: true }, { ...pins[0], name: "../escape" }]) {
    await assert.rejects(fetchSecuritySource(changed, { fetchImpl: () => assert.fail("unapproved request") }));
  }
});
test("bounded exact request rejects redirects, absent body, HTTP failure, length mismatch and truncation", async () => {
  for (const response of [new Response("", { status: 302 }), new Response(null), new Response("", { status: 500 }), new Response("x", { headers: { "content-length": "1" } }), new Response("x")]) {
    await assert.rejects(fetchSecuritySource(pins[0], { fetchImpl: async (url, options) => {
      assert.equal(url, pins[0].url); assert.equal(options.redirect, "error"); assert.equal(options.headers, undefined); assert.ok(options.signal instanceof AbortSignal); return response;
    } }));
  }
});
test("oversize and same-length wrong-checksum responses never become source acceptance", async () => {
  for (const length of [pins[0].bytes, pins[0].bytes + 1]) {
    await assert.rejects(fetchSecuritySource(pins[0], { fetchImpl: async () => new Response(Buffer.alloc(length)) }));
  }
  const cancel = new AbortController(); cancel.abort();
  await assert.rejects(fetchSecuritySource(pins[0], { signal: cancel.signal, fetchImpl: async (_url, options) => { options.signal.throwIfAborted(); } }), { name: "AbortError" });
});
