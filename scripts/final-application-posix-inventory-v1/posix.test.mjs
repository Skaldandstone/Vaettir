import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { posixInventoryName, normalizeInventory, normalizeCohorts } from "./normalize.derived.mjs";
import { normalizeInventory as oldInventory } from "../final-application-minimal-delta-v1/normalize.derived.mjs";
import { relative, readRef, sha } from "../production-native-successor-v1/contracts.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import { admitPosixInventorySource, successorRoot } from "./admission.mjs";
const hash = "a".repeat(64);
const raw = (path, extra = {}) => ({path, type: "0", mode: 420, uid: 0, gid: 0, size: 3, sha256: hash, ...extra});
const names = ["var/lib/dpkg/info/gcc-14-base:amd64.list", "var/lib/dpkg/info/libacl1:amd64.md5sums"];
test("multiarch dpkg leaves survive unchanged without mutating input", () => {
  const rows = names.map(p => raw(p));
  const original = structuredClone(rows);
  assert.throws(() => oldInventory(rows), /Unsafe\/duplicate raw path/);
  const out = normalizeInventory(rows);
  assert.deepEqual(out.map(r => r.path).sort(), names.map(p => "/" + p).sort());
  assert.ok(out.every(r => r.sha256 === hash && r.bytes === 3 && r.links === 1));
  assert.deepEqual(rows, original);
});
test("colon hardlink targets resolve to real visible alias membership", () => {
  const out = normalizeInventory([raw(names[0]), raw(names[1], {type: "1", link: names[0]})]);
  assert.ok(out.every(r => r.links === 2 && r.hardlinkGroup === "/" + names[0] && r.sha256 === hash));
});
test("modeled inode aliases with colon names retain exact groups", () => {
  const out = normalizeInventory([raw(names[0], {inode: "1:7"}), raw(names[1], {inode: "1:7"}), raw("var/other:amd64", {inode: "1:8"})]);
  assert.equal(out.find(r => r.path === "/var/other:amd64").links, 1);
  assert.ok(out.filter(r => r.path.startsWith("/var/lib/")).every(r => r.links === 2));
});
test("colon directory and symlink names are data; symlink targets keep old treatment", () => {
  const out = normalizeInventory([raw("var/pkg:amd64", {type: "5"}), raw("var/link:amd64", {type: "2", link: "../original:amd64"})]);
  assert.equal(out.find(r => r.type === "symlink").target, "../original:amd64");
  assert.equal(out.find(r => r.type === "directory").path, "/var/pkg:amd64");
});
for (const [name, values] of [
  ["empty and non-string", ["", null, undefined, 1, {}, []]],
  ["NUL and backslash", ["var/a\0b", "var\\a:amd64", "\\\\server\\share"]],
  ["absolute and UNC", ["/var/a:amd64", "//server/share", "///var/a"]],
  ["noncanonical components", ["var//file:amd64", "var/", ".", "..", "./var/file", "var/./file", "var/../file", "var/pkg:amd64/../file"]],
  ["drive masquerades", ["C:", "C:relative", "c:/root", "var/C:relative", "var/c:/root", "//?/C:/root", "\\??\\C:\\root"]],
]) test(name + " refuse for both inventory paths and hardlink targets", () => {
  for (const value of values) {
    assert.equal(posixInventoryName(value), false);
    assert.throws(() => normalizeInventory([raw(value)]), /Unsafe\/duplicate raw path/);
    assert.throws(() => normalizeInventory([raw("safe"), raw("alias", {type: "1", link: value})]), /Unsafe hardlink target/);
  }
});
test("original strict length bound remains below 1024", () => {
  assert.equal(posixInventoryName("a".repeat(1023)), true);
  for (const p of ["a".repeat(1024), "a".repeat(1025)]) {
    assert.equal(posixInventoryName(p), false);
    assert.throws(() => normalizeInventory([raw(p)]));
    assert.throws(() => normalizeInventory([raw("safe"), raw("alias", {type: "1", link: p})]));
  }
});
test("ordinary colons remain literal; no decoding or renaming", () => {
  for (const p of ["pkg:amd64", "var/pkg:amd64:leaf", "var/literal%2e%2e:amd64", "var/name with space:amd64"]) {
    assert.equal(posixInventoryName(p), true);
    assert.equal(normalizeInventory([raw(p)])[0].path, "/" + p);
  }
});
test("duplicate multiarch path and missing/cyclic hardlinks still refuse", () => {
  assert.throws(() => normalizeInventory([raw(names[0]), raw(names[0])]), /duplicate/);
  assert.throws(() => normalizeInventory([raw(names[1], {type: "1", link: names[0]})]), /Missing/);
  assert.throws(() => normalizeInventory([raw(names[0], {type: "1", link: names[1]}), raw(names[1], {type: "1", link: names[0]})]), /cycle/);
});
test("colon alias owner/content inconsistencies remain refused", () => {
  assert.throws(() => normalizeInventory([raw(names[0]), raw(names[1], {type: "1", link: names[0], uid: 1})]), /metadata/);
  assert.throws(() => normalizeInventory([raw(names[0], {inode: "1:2"}), raw(names[1], {inode: "1:2", sha256: "b".repeat(64)})]), /alias inode/);
});
test("artifact/evidence references and cohort paths retain strict colon refusal", () => {
  for (const p of names) {
    assert.equal(relative(p), false);
    assert.throws(() => readRef({path: p, sha256: hash, bytes: 3}, () => { throw Error("must not read"); }), /Missing or unbounded exact artifact pin/);
    assert.throws(() => normalizeCohorts({version: 1, cohorts: [{id: "b".repeat(40), files: [{path: p, sha256: hash, size: 3}]}]}), /Invalid static asset/);
  }
});
test("normalizer delta is exactly one predicate and its two data call sites", () => {
  const parent = readFileSync(resolve(successorRoot, "../final-application-minimal-delta-v1/normalize.derived.mjs"), "utf8");
  let current = readFileSync(resolve(successorRoot, "normalize.derived.mjs"), "utf8");
  const begin = current.indexOf("// Linux inventory names are data");
  const end = current.indexOf("export function normalizeInventory(raw)", begin);
  current = current.slice(0, begin) + current.slice(end);
  current = current.replace("posixInventoryName(r.path)", "relative(r.path)").replace("posixInventoryName(r.link)", "relative(r.link)");
  assert.equal(current, parent);
});
test("CLI and output producer bind the actual successor normalizer", () => {
  const cli = readFileSync(resolve(successorRoot, "produce.mjs"), "utf8");
  assert.ok(cli.includes('join(successorRoot, "normalize.derived.mjs")'));
  assert.ok(readFileSync(resolve(successorRoot, "output-producer.mjs"), "utf8").includes('from "./normalize.derived.mjs"'));
  const gate = readFileSync(resolve(successorRoot, "release-admission.derived.mjs"), "utf8");
  assert.ok(gate.includes("admitMinimalDeltaSource(b.minimalDelta, io.read)"));
  assert.ok(gate.includes("admitPosixInventorySource(b.posixInventory, io.read)"));
});
test("source acceptance requires exact independently reviewed complete manifest", () => {
  const data = new Map();
  const add = (path, object) => { const b = Buffer.from(JSON.stringify(object)); data.set(path, b); return {path, bytes: b.length, sha256: sha(b)}; };
  const evidence = add("proof", {synthetic: true});
  const proofTree = add("proof-tree", {files: [evidence]});
  const manifest = add("manifest", {files: packageRows(successorRoot)});
  const approve = (extra = {}) => add("review", {accepted: true, independentReview: true, scope: "FINAL_APPLICATION_POSIX_INVENTORY_SOURCE", manifestSha256: manifest.sha256, proofTree, ...extra});
  const read = p => data.get(p);
  admitPosixInventorySource({manifest, approval: approve()}, read);
  for (const extra of [{accepted: false}, {independentReview: false}, {scope: "FINAL_APPLICATION_MINIMAL_DELTA_SOURCE"}, {manifestSha256: hash}])
    assert.throws(() => admitPosixInventorySource({manifest, approval: approve(extra)}, read));
  const missing = add("missing", {files: packageRows(successorRoot).slice(1)});
  assert.throws(() => admitPosixInventorySource({manifest: missing, approval: approve({manifestSha256: missing.sha256})}, read), /source changed/);
});
