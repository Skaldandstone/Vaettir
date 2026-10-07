// Synthetic memory-only adapter construction. No native filesystem or imports.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createNativeFreshFinalAdapter } from "./native-builder-fresh-final-adapter.mjs";

const sha = raw => createHash("sha256").update(raw).digest("hex");
const names = ["build-llvm-runtime.sh", "native-build-concurrency.mjs", "native-llvm-checkpoint.mjs", "fetch-runtime-vendor-sources.mjs", "runtime-vendor-sources.json", "check-llvm-package.mjs", "check-llvm-jit.c", "check-llvm-arm-defaults.cpp", "reconcile-llvm-arm-unit-fixture.mjs"];
const checkpointPath = "/build/scripts/native-llvm-checkpoint.mjs", abiPath = "/build/scripts/check-llvm-package.mjs";
const sensitive = "PRIVATE_SYNTHETIC_BODY_NOT_PUBLIC";
function fixture() {
  const files = new Map(), fds = new Map(), opens = new Map(); let nextFd = 1;
  for (const name of names) files.set("/build/scripts/" + name, Buffer.from('import fs from "node:fs"; // ' + name + '\n'));
  const stat = path => {
    const raw = files.get(path), directory = ["/", "/build", "/build/scripts"].includes(path);
    assert.ok(raw || directory, "Unexpected synthetic path");
    return { dev: 1, ino: directory ? path.length : 100 + names.indexOf(path.slice(15)), size: raw?.length ?? 0, mtimeMs: 1, ctimeMs: 1, mode: directory ? 0o40755 : 0o100644, uid: 0, isFile: () => !directory, isDirectory: () => directory, isSymbolicLink: () => false };
  };
  const io = {
    constants: { O_RDONLY: 0, O_NOFOLLOW: 131072 },
    lstatSync: stat, realpathSync: path => path,
    openSync(path, flags) { assert.equal(flags, 131072); const count = (opens.get(path) ?? 0) + 1; opens.set(path, count); if (io.onOpen) io.onOpen(path, count); const fd = nextFd++; fds.set(fd, { path, offset: 0 }); return fd; },
    fstatSync(fd) { return stat(fds.get(fd).path); },
    readSync(fd, target, offset, length) { const f = fds.get(fd), raw = files.get(f.path), count = Math.min(length, raw.length - f.offset); raw.copy(target, offset, f.offset, f.offset + count); f.offset += count; return count; },
    closeSync(fd) { assert.equal(fds.delete(fd), true); },
  };
  const log = Buffer.from("synthetic original log\n"), marker = new Error(sensitive);
  const options = { verificationId: "a".repeat(64), scriptPins: Object.fromEntries(names.map(name => [name, sha(files.get("/build/scripts/" + name))])), probePins: { "llvm-arm-policy": "b".repeat(64), "llvm-cpu-jit": "c".repeat(64) }, finalLog: log, finalLogSha256: sha(log), deadlineMs: 1000, cleanupDeadlineMs: 1100, memoryLimitBytes: 14 * 1024 ** 3, exclusiveWriter: true };
  const deps = { fs: io, exec() { throw Error("Forbidden synthetic subprocess"); }, async importExact(url) { const raw = Buffer.from(url.slice("data:text/javascript;base64,".length), "base64").toString(); return raw.includes("native-llvm-checkpoint.mjs") ? { inventoryTree() {}, hashCandidateLibrary() {} } : { verifyLlvmCompatibility() {} }; }, clock: () => 1, platform: () => "linux", uid: () => 0, memory: () => ({ limit: 14 * 1024 ** 3, used: 0 }) };
  return { files, fds, opens, io, options, deps, marker };
}
const stages = [
  ["options", f => { f.options.exclusiveWriter = false; }],
  ["platform-identity", f => { f.deps.platform = () => "win32"; }],
  ["deadline", f => { f.options.deadlineMs = 0; }],
  ["memory-read", f => { f.deps.memory = () => { throw f.marker; }; }, true],
  ["memory-admission", f => { f.deps.memory = () => ({ limit: 14 * 1024 ** 3, used: 0, extra: true }); }],
  ["memory-limit-range", f => { f.deps.memory = () => ({ limit: 15 * 1024 ** 3, used: 0 }); }],
  ["memory-used-range", f => { f.deps.memory = () => ({ limit: 14 * 1024 ** 3, used: -1 }); }],
  ["memory-configured-limit", f => { f.deps.memory = () => ({ limit: 12 * 1024 ** 3, used: 0 }); }],
  ["memory-headroom", f => { f.deps.memory = () => ({ limit: 14 * 1024 ** 3, used: 13 * 1024 ** 3 }); }],
  ["final-log-hash", f => { f.options.finalLogSha256 = "f".repeat(64); }],
  ["filesystem-capability", f => { f.io.constants.O_NOFOLLOW = 0; }],
];
for (const [prefix, path, name] of [["checkpoint", checkpointPath, "native-llvm-checkpoint.mjs"], ["abi", abiPath, "check-llvm-package.mjs"]]) {
  stages.push([prefix + "-read", f => { f.io.onOpen = opened => { if (opened === path) throw f.marker; }; }, true]);
  stages.push([prefix + "-hash", f => { f.options.scriptPins[name] = "f".repeat(64); }]);
  stages.push([prefix + "-import-scope", f => { f.files.set(path, Buffer.from('import unsafe from "private:' + sensitive + '";')); f.options.scriptPins[name] = sha(f.files.get(path)); }]);
  stages.push([prefix + "-import", f => { const original = f.deps.importExact; f.deps.importExact = async url => { if (Buffer.from(url.slice("data:text/javascript;base64,".length), "base64").toString().includes(name)) throw f.marker; return original(url); }; }, true]);
  stages.push([prefix + "-rehash", f => { f.io.onOpen = (opened, count) => { if (opened === path && count === 2) throw f.marker; }; }, true]);
  stages.push([prefix + "-exports", f => { const original = f.deps.importExact; f.deps.importExact = async url => Buffer.from(url.slice("data:text/javascript;base64,".length), "base64").toString().includes(name) ? {} : original(url); }]);
}
for (const [label, prepare, sameError] of stages) test("constructor refusal exposes only fixed own-data label: " + label, async () => {
  const f = fixture(); prepare(f); let caught;
  try { await createNativeFreshFinalAdapter(f.options, f.deps); } catch (error) { caught = error; }
  assert.ok(caught); if (sameError) assert.equal(caught, f.marker);
  const descriptor = Object.getOwnPropertyDescriptor(caught, "nativeFinalAdapterCheck");
  assert.equal(descriptor.value, label); assert.equal(descriptor.enumerable, false); assert.equal(descriptor.writable, false); assert.equal(descriptor.get, undefined);
  assert.doesNotMatch(descriptor.value, /PRIVATE|\/|\d/); assert.equal(f.fds.size, 0);
});
test("successful construction retains exact API/provenance without a diagnostic field", async () => {
  const f = fixture(), adapter = await createNativeFreshFinalAdapter(f.options, f.deps);
  assert.deepEqual(Object.keys(adapter).sort(), ["cleanupOwnedExtraction", "ops", "provenance"]);
  assert.ok(Object.isFrozen(adapter)); assert.equal(adapter.provenance.memoryLimitBytes, 14 * 1024 ** 3); assert.equal(adapter.provenance.runtimeAcceptance, false); assert.equal(Object.hasOwn(adapter, "nativeFinalAdapterCheck"), false); assert.equal(f.fds.size, 0);
});

test("memory admission keeps the exact two-GiB boundary and rejects before imports", async () => {
  const gb = 1024 ** 3;
  for (const used of [12 * gb, 12 * gb + 1]) {
    const f = fixture(); let imports = 0;
    const original = f.deps.importExact;
    f.deps.importExact = async url => { imports++; return original(url); };
    f.deps.memory = () => ({limit: 14 * gb, used});
    if (used === 12 * gb) {
      await createNativeFreshFinalAdapter(f.options, f.deps);
      assert.equal(imports, 2);
    } else {
      await assert.rejects(createNativeFreshFinalAdapter(f.options, f.deps), error => {
        assert.equal(error.nativeFinalAdapterCheck, "memory-headroom");
        const descriptor = Object.getOwnPropertyDescriptor(error, "nativeFinalMemoryObservation");
        assert.deepEqual(descriptor.value, {limitBytes: 14 * gb, usedBytes: used, configuredLimitBytes: 14 * gb});
        assert.equal(descriptor.enumerable, false); assert.equal(descriptor.writable, false);
        assert.ok(Object.isFrozen(descriptor.value));
        return true;
      });
      assert.equal(imports, 0);
    }
    assert.equal(f.fds.size, 0);
  }
});

test("configured memory mismatch preserves actual numeric observation, not invented headroom", async () => {
  const f = fixture(), gb = 1024 ** 3;
  f.deps.memory = () => ({limit: 12 * gb, used: 0});
  await assert.rejects(createNativeFreshFinalAdapter(f.options, f.deps), error => {
    assert.equal(error.nativeFinalAdapterCheck, "memory-configured-limit");
    assert.deepEqual(error.nativeFinalMemoryObservation, {limitBytes: 12 * gb, usedBytes: 0, configuredLimitBytes: 14 * gb});
    return true;
  });
  const other = fixture(); other.options.finalLogSha256 = "f".repeat(64);
  await assert.rejects(createNativeFreshFinalAdapter(other.options, other.deps), error => !Object.hasOwn(error, "nativeFinalMemoryObservation"));
});
test("native stack/diagnostic accessors are not invoked, original exception is retained", async () => {
  const f = fixture(); let getterCalls = 0;
  Object.defineProperty(f.marker, "stack", { configurable: true, get() { getterCalls++; throw Error(sensitive); } });
  Object.defineProperty(f.marker, "nativeFinalAdapterCheck", { configurable: true, get() { getterCalls++; throw Error(sensitive); } });
  f.deps.memory = () => { throw f.marker; };
  await assert.rejects(createNativeFreshFinalAdapter(f.options, f.deps), error => error === f.marker);
  assert.equal(getterCalls, 0); assert.equal(Object.getOwnPropertyDescriptor(f.marker, "nativeFinalAdapterCheck").value, "memory-read");
});
test("nonconfigurable annotation, frozen exception and hostile proxy preserve original failure", async () => {
  const frozen = Object.freeze(new Error(sensitive)), locked = new Error(sensitive); Object.defineProperty(locked, "nativeFinalAdapterCheck", { value: "PRIVATE_EXISTING", configurable: false });
  let traps = 0; const proxy = new Proxy(new Error(sensitive), { defineProperty() { traps++; throw Error(sensitive); }, get() { throw Error("Getter must not run"); } });
  for (const error of [frozen, locked, proxy, null, "PRIVATE_PRIMITIVE"]) { const f = fixture(); f.deps.memory = () => { throw error; }; let caught; try { await createNativeFreshFinalAdapter(f.options, f.deps); } catch (value) { caught = value; } assert.equal(caught, error); }
  assert.equal(traps, 1);
});
