import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  requireZlibCompatibility,
  zlibElfContract,
  zlibProbeEnvironment,
  requireInstalledZlibProof,
  checkZlibRuntime,
  checkInstalledZlibRuntime,
  requireZlibNegativeControl,
} from "./check-zlib-runtime.mjs";

const api = [
  "gzwrite",
  "gzprintf",
  "gzclearerr",
  "compress2",
  "uncompress",
  "zlibVersion",
].map((name) => `${name}@GLOBAL:default`);
const baseline = {
  soname: "libz.so.1",
  exports: api,
  abi: api.map((identity) => ({ identity, type: 2 })),
  sha256: "baseline",
};
function syntheticElf() {
  const names = [
    "libz.so.1",
    ...api.map((identity) => identity.split("@")[0]),
    "ZLIB_1.3.2",
  ];
  const bytes = Buffer.alloc(2048),
    offsets = new Map();
  bytes.write("7f454c46", 0, "hex");
  bytes[4] = 2;
  bytes[5] = 1;
  bytes.writeUInt16LE(62, 18);
  bytes.writeBigUInt64LE(64n, 40);
  bytes.writeUInt16LE(64, 58);
  bytes.writeUInt16LE(6, 60);
  let cursor = 449;
  for (const name of names) {
    offsets.set(name, cursor - 448);
    bytes.write(name, cursor);
    cursor += Buffer.byteLength(name) + 1;
  }
  const section = (index, type, offset, size, link, entry) => {
    const p = 64 + index * 64;
    bytes.writeUInt32LE(type, p + 4);
    bytes.writeBigUInt64LE(BigInt(offset), p + 24);
    bytes.writeBigUInt64LE(BigInt(size), p + 32);
    bytes.writeUInt32LE(link, p + 40);
    bytes.writeBigUInt64LE(BigInt(entry), p + 56);
  };
  section(1, 3, 448, cursor - 448, 0, 0);
  section(2, 6, 768, 32, 1, 16);
  bytes.writeBigUInt64LE(14n, 768);
  bytes.writeBigUInt64LE(BigInt(offsets.get("libz.so.1")), 776);
  section(3, 11, 832, 7 * 24, 1, 24);
  section(4, 0x6fffffff, 1024, 14, 3, 2);
  section(5, 0x6ffffffd, 1088, 28, 1, 0);
  bytes.writeUInt16LE(2, 1092);
  bytes.writeUInt32LE(20, 1100);
  bytes.writeUInt32LE(offsets.get("ZLIB_1.3.2"), 1108);
  api.forEach((identity, i) => {
    const p = 832 + (i + 1) * 24;
    bytes.writeUInt32LE(offsets.get(identity.split("@")[0]), p);
    bytes[p + 4] = 0x12;
    bytes.writeUInt16LE(1, p + 6);
    bytes.writeUInt16LE(1, 1024 + (i + 1) * 2);
  });
  return bytes;
}
test("parses actual bounded ELF table structure and checks asynchronous package probes", async () => {
  const elf = syntheticElf(),
    contract = zlibElfContract(elf);
  assert.equal(contract.soname, "libz.so.1");
  assert.deepEqual(contract.exports, [...api].sort());
  assert.ok(contract.abi.every((entry) => entry.type === 2));
  const stdout = "nonblocking EAGAIN hard write error round trips";
  let launches = 0;
  const options = {
    load: async () => elf,
    run: async (_path, args, settings) => {
      launches++;
      assert.deepEqual(args, []);
      assert.equal(settings.timeout, 15000);
      assert.equal(settings.maxBuffer, 8192);
      assert.equal(settings.killSignal, "SIGKILL");
      assert.deepEqual(settings.env, zlibProbeEnvironment("/fixture"));
      return { stdout };
    },
  };
  const proof = await checkZlibRuntime(
    "/fixture/libz.so.1",
    "/baseline/libz.so.1",
    "/fixture/probe",
    options,
  );
  assert.equal(launches, 1);
  assert.equal(proof.sha256, contract.sha256);
  await assert.rejects(
    checkZlibRuntime("relative", "/baseline/libz.so.1", "/fixture/probe", {
      ...options,
      load: () => {
        throw Error("should never load");
      },
    }),
    /Absolute/,
  );
  await assert.rejects(
    checkZlibRuntime(
      "/fixture/libz.so.1",
      "/baseline/libz.so.1",
      "/fixture/probe",
      {
        ...options,
        run: async () => {
          throw Error("timeout");
        },
      },
    ),
    /timeout/,
  );
  await assert.rejects(
    checkZlibRuntime(
      "/fixture/libz.so.1",
      "/baseline/libz.so.1",
      "/fixture/probe",
      {
        ...options,
        run: async () => ({ stdout: "round trips" }),
      },
    ),
    /Incomplete/,
  );
  const installed = {
    ...options,
    load: async (path) =>
      path.endsWith("json") ? Buffer.from(JSON.stringify(proof)) : elf,
  };
  assert.equal(
    (
      await checkInstalledZlibRuntime(
        "/fixture/libz.so.1",
        "/fixture/proof.json",
        "/fixture/probe",
        installed,
      )
    ).installedPackageVerified,
    true,
  );
  await assert.rejects(
    checkInstalledZlibRuntime(
      "/fixture/libz.so.1",
      "/fixture/proof.json",
      "/fixture/probe",
      {
        ...installed,
        load: async () => Buffer.alloc(16385),
      },
    ),
    /bounds/,
  );
  assert.throws(
    () =>
      requireZlibCompatibility(
        {
          ...baseline,
          abi: baseline.abi.map((entry) => ({ ...entry, type: 1, bytes: 8 })),
        },
        baseline,
      ),
    /type or object/,
  );
});
test("installed runtime must match the verified package receipt without shipping the old library", () => {
  const candidate = { ...baseline, sha256: "a".repeat(64) };
  const proof = {
    soname: "libz.so.1",
    sha256: candidate.sha256,
    baselineExports: 6,
    candidateExports: 6,
    regression: "nonblocking EAGAIN hard write error round trips",
  };
  assert.doesNotThrow(() => requireInstalledZlibProof(candidate, proof));
  for (const bad of [
    { ...proof, sha256: "b".repeat(64) },
    { ...proof, soname: "libz.so.2" },
    { ...proof, baselineExports: 0 },
    { ...proof, candidateExports: 5 },
    { ...proof, candidateExports: 7 },
    { ...proof, regression: "round trips" },
  ])
    assert.throws(() => requireInstalledZlibProof(candidate, bad));
});
test("retains exact SONAME and every previous symbol version while allowing compatible additions", () => {
  assert.equal(
    requireZlibCompatibility(
      {
        ...baseline,
        exports: [...api, "newAPI@ZLIB_1.3.2:default"],
        sha256: "candidate",
      },
      baseline,
    ).baselineExports,
    6,
  );
  assert.throws(
    () =>
      requireZlibCompatibility({ ...baseline, soname: "libz.so.2" }, baseline),
    /SONAME/,
  );
  assert.throws(
    () =>
      requireZlibCompatibility(
        { ...baseline, exports: api.slice(1) },
        baseline,
      ),
    /Removed/,
  );
  assert.throws(
    () =>
      requireZlibCompatibility(
        {
          ...baseline,
          exports: api.map((value) => value.replace("GLOBAL", "ZLIB_1.3.2")),
        },
        baseline,
      ),
    /versioned/,
  );
  assert.throws(
    () =>
      requireZlibCompatibility(
        {
          ...baseline,
          exports: api.map((value) => value.replace(":default", ":hidden")),
        },
        baseline,
      ),
    /versioned/,
  );
});
test("does not inherit secret or dynamic injection environment into synthetic regression", () => {
  assert.deepEqual(zlibProbeEnvironment("/isolated/lib"), {
    PATH: "/usr/bin:/bin",
    LANG: "C",
    LC_ALL: "C",
    LD_LIBRARY_PATH: "/isolated/lib",
  });
  assert.equal(
    zlibProbeEnvironment("/isolated/lib", true).UBSAN_OPTIONS,
    "halt_on_error=1:print_stacktrace=1",
  );
});
test("rejects arbitrary text, non-x86 ELF, oversized files and corrupt section bounds", () => {
  assert.throws(
    () => zlibElfContract(Buffer.from("libz.so.1 gzwrite")),
    /ELF64/,
  );
  const elf = Buffer.alloc(128);
  elf.write("7f454c46", 0, "hex");
  elf[4] = 2;
  elf[5] = 1;
  elf.writeUInt16LE(62, 18);
  elf.writeBigUInt64LE(64n, 40);
  elf.writeUInt16LE(64, 58);
  elf.writeUInt16LE(256, 60);
  assert.throws(() => zlibElfContract(elf), /bounds/);
  elf.writeUInt16LE(183, 18);
  assert.throws(() => zlibElfContract(elf), /x86_64/);
  assert.throws(() => zlibElfContract(Buffer.alloc(2_000_001)), /bounded/);
});
test("signed source and exact upstream patch pins gate a maintained real-package rebuild", () => {
  const builder = readFileSync(
    new URL("./build-zlib-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(builder, /gpgv --keyring/);
  assert.match(builder, /VALIDSIG ADE668AA675718B59FE29FEA24D68B725D5487D0/);
  assert.match(
    builder,
    /110ff14375733173d8aa54574473424fbd7dfe4b81f1ca34a759c6fe14b15b14/,
  );
  assert.match(builder, /patch --batch --fuzz=0 -p1/);
  assert.match(builder, /timeout 60 make test/);
  assert.match(
    builder,
    /DEB_BUILD_PROFILES=nobiarch dpkg-buildpackage -b -us -uc/,
  );
  assert.match(builder, /1:1\.3\.dfsg\+really1\.3\.2-3\+vaettir1/);
  assert.match(builder, /dpkg-deb -f "\$artifact" Package/);
});
test("sanitizers instrument the library and require the exact vulnerable negative control to fail", () => {
  const builder = readFileSync(
    new URL("./build-zlib-runtime.sh", import.meta.url),
    "utf8",
  );
  assert.match(
    builder,
    /CFLAGS='[^']*-fsanitize=address,undefined' \.\/configure --static/,
  );
  assert.match(
    builder,
    /requireZlibNegativeControl\(\{diagnostic,status:error.status,signal:error.signal\}\)/,
  );
  assert.match(builder, /timeout:20000,maxBuffer:32768/);
  const packaged = builder.indexOf("dpkg-buildpackage -b -us -uc");
  const restored = builder.indexOf("dpkg-source --before-build .", packaged);
  const patchVerified = builder.indexOf(
    "patch --batch --fuzz=0 -R -p1 --dry-run",
    restored,
  );
  const instrumentedCopy = builder.indexOf(
    'cp -a "$build_root/source" "$build_root/instrumented"',
  );
  assert.ok(
    packaged >= 0 &&
      restored > packaged &&
      patchVerified > restored &&
      instrumentedCopy > patchVerified,
    "Sanitizer source must restore and verify the patch after Debian package cleanup, before copying",
  );
  const fixture = readFileSync(
    new URL("./zlib-runtime-regression.c", import.meta.url),
    "utf8",
  );
  assert.match(fixture, /O_NONBLOCK/);
  assert.match(fixture, /free\(external\)/);
  assert.match(fixture, /gzclearerr\(file\)/);
  assert.match(fixture, /gzprintf\(file/);
  assert.match(fixture, /open\("\/dev\/full"/);
  assert.match(fixture, /memcmp\(recovered, "ab", 2\)/);
});

test("attributes the observed libc write-SEGV without accepting unrelated sanitizer crashes", () => {
  const diagnostic = `ERROR: AddressSanitizer: SEGV on unknown address
The signal is caused by a WRITE memory access.
    #0 0x123 (/lib/x86_64-linux-gnu/libc.so.6+0x17b868)
    #1 0x456 in gz_write /build/zlib-build/unpatched/gzwrite.c:217
    #2 0x789 in gzwrite /build/zlib-build/unpatched/gzwrite.c:276
    #3 0xabc in nonblocking /build/scripts/zlib-runtime-regression.c:39
SUMMARY: AddressSanitizer: SEGV (/lib/x86_64-linux-gnu/libc.so.6+0x17b868)
ABORTING`;
  const proof = { diagnostic, status: null, signal: "SIGABRT" };
  assert.equal(requireZlibNegativeControl(proof).reporter, "write-SEGV");
  assert.equal(
    requireZlibNegativeControl({
      ...proof,
      diagnostic: diagnostic.replace("SEGV on", "heap-buffer-overflow on"),
      status: 1,
      signal: null,
    }).reproduced,
    true,
  );
  for (const bad of [
    { ...proof, status: 0, signal: null },
    { ...proof, signal: "SIGKILL" },
    { ...proof, diagnostic: diagnostic.replace("WRITE", "READ") },
    { ...proof, diagnostic: diagnostic.replace("in gz_write", "in unrelated") },
    {
      ...proof,
      diagnostic: diagnostic.replace("/unpatched/", "/instrumented/"),
    },
    {
      ...proof,
      diagnostic: diagnostic.replace("in nonblocking", "in unrelated"),
    },
    { ...proof, diagnostic: diagnostic.replace("ABORTING", "") },
    { ...proof, diagnostic: "AddressSanitizer:DEADLYSIGNAL" },
    { ...proof, diagnostic: diagnostic + "x".repeat(32768) },
  ])
    assert.throws(() => requireZlibNegativeControl(bad));
});
