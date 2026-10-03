import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./check-llvm-arm-defaults.cpp", import.meta.url),
  "utf8",
);
const rows = [...source.matchAll(/\{"([^"]+)", "([^"]*)", "([^"]*)"\}/g)].map(
  ([, triple, march, cpu]) => ({ triple, march, cpu }),
);

test("authored fixed probe preserves all 33 exact distro policies with unchanged controls", () => {
  assert.equal(rows.length, 33);
  assert.equal(
    new Set(rows.map((row) => `${row.triple}\0${row.march}`)).size,
    33,
  );
  assert.match(source, /static_assert\(policyCount == 33/);
  for (const triple of [
    "arm-none-eabi",
    "armeb-none-eabi",
    "arm-unknown-linux-gnueabi",
    "armeb-unknown-linux-gnueabi",
  ])
    assert.deepEqual(
      rows.find((row) => row.triple === triple),
      { triple, march: "", cpu: "arm926ej-s" },
    );
  for (const arch of ["arm", "thumb", "armeb"])
    for (const suffix of [
      "unknown-none-eabihf",
      "unknown-linux-gnueabihf",
      "unknown-linux-gnueabihft64",
      "unknown-linux-musleabihf",
    ]) {
      const triple = `${arch}-${suffix}`;
      assert.deepEqual(
        rows.find((row) => row.triple === triple),
        { triple, march: "", cpu: "cortex-a8" },
      );
      assert.equal(triple.split("-").length, 4);
    }
  for (const arch of ["arm", "thumb", "armeb"])
    assert.deepEqual(
      rows.find((row) => row.triple === `${arch}-none-eabihf`),
      { triple: `${arch}-none-eabihf`, march: "", cpu: "arm926ej-s" },
    );
  for (const [triple, march, cpu] of [
    ["arm--nacl", "", "cortex-a8"],
    ["arm--openbsd", "", "cortex-a8"],
    ["armv6-unknown-freebsd", "", "arm1176jzf-s"],
    ["thumbv6-unknown-freebsd", "", "arm1176jzf-s"],
    ["armebv6-unknown-freebsd", "", "arm1176jzf-s"],
    ["arm--win32", "", "cortex-a9"],
    ["arm--win32", "armv8-a", "generic"],
    ["armv7k-apple-ios9", "", "cortex-a7"],
    ["armv7k-apple-watchos3", "", "cortex-a7"],
    ["armv7k-apple-tvos9", "", "cortex-a7"],
    ["armebeb-none-eabi", "", ""],
    ["armebv6eb-none-eabi", "", ""],
    ["armebxscale-none-eabi", "", ""],
    ["xscaleeb-none-eabi", "", "xscale"],
  ])
    assert.ok(
      rows.some(
        (row) =>
          row.triple === triple && row.march === march && row.cpu === cpu,
      ),
    );
});

test("source contract requires real public parser call, fail-hard exact match before any success receipt", () => {
  assert.match(source, /#include "llvm\/TargetParser\/ARMTargetParser.h"/);
  assert.match(source, /#include "llvm\/TargetParser\/Triple.h"/);
  assert.match(source, /const llvm::Triple triple\(entry.triple\)/);
  assert.match(source, /triple.getEnvironment\(\) == llvm::Triple::EABIHF/);
  assert.match(source, /if \(intendedHardFloat != hardFloatEnvironment\)/);
  assert.match(source, /llvm::ARM::getARMCPUForArch\(triple, entry.march\)/);
  assert.match(source, /if \(actual != entry.expected\)[\s\S]*?return 1;/);
  assert.ok(
    source.indexOf("return 1;") <
      source.indexOf('std::printf("VAETTIR_LLVM_ARM_POLICY'),
  );
  assert.doesNotMatch(
    source,
    /\b(?:getenv|system|popen|exec|dlopen|dlsym|socket|connect|scanf|fgets)\s*\(/,
  );
  assert.match(source, /int main\(\)/);
  assert.doesNotMatch(
    source,
    /\b(?:argc|argv|NDEBUG|assert\s*\(|arm7tdmi|arm1176jzf-s.*\|\||GTEST_SKIP|DISABLED_)/,
  );
  // These are source-contract assertions only. Builder must separately compile
  // against the exact headers, run the same binary with baseline then candidate
  // libLLVM, verify actual loader bindings and cmp the complete receipts.
});
