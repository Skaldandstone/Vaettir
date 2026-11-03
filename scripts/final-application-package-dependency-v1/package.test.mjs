import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkDependencyRows,
  parseStatus,
  validateRetainedObservation,
  verifyDependencyChange,
} from "./package-transition.mjs";
import {
  successorRoot,
  checkParent,
  admitDependencySource,
} from "./admission.mjs";
import { derive } from "./derive.mjs";
import { prepare } from "./produce.mjs";
import { fixture } from "../final-application-release-v1/test-fixtures.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
function rows() {
  const row = {
    name: "libsqlite3-0:amd64",
    status: "install ok installed",
    version: "3.46.1-7+deb13u2",
    architecture: "amd64",
    dependencies: "libc6 (>= 2.38)",
    preDepends: "",
    triggersAwaited: "",
    triggersPending: "",
  };
  const libc = {
    ...row,
    name: "libc6:amd64",
    version: "2.41-12+deb13u4+vaettir1",
    dependencies: "libgcc-s1",
  };
  return {
    before: [row, libc],
    after: [
      { ...row, version: "3.54.1-0+vaettir1", dependencies: "libc6 (>= 2.41)" },
      { ...libc },
    ],
  };
}
test("exact minimum transition is satisfied by exact unchanged libc", () => {
  const f = rows();
  assert.equal(checkDependencyRows(f.before, f.after), true);
});
for (const [name, mutate] of [
  ["unknown minimum", (f) => (f.after[0].dependencies = "libc6 (>= 2.42)")],
  ["added dependency", (f) => (f.after[0].dependencies += ", zlib1g")],
  ["alternative", (f) => (f.after[0].dependencies += " | other")],
  ["old dependency", (f) => (f.before[0].dependencies = "libc6 (>= 2.34)")],
  ["changed libc", (f) => (f.after[1].version = "2.42")],
  [
    "different unchanged libc",
    (f) => {
      f.before[1].version = f.after[1].version = "2.41-13";
    },
  ],
  ["predependency", (f) => (f.after[0].preDepends = "other")],
  ["architecture", (f) => (f.after[0].architecture = "arm64")],
  ["pending trigger", (f) => (f.after[0].triggersPending = "ldconfig")],
  ["awaited trigger", (f) => (f.before[1].triggersAwaited = "ldconfig")],
  [
    "half configured",
    (f) => (f.after[0].status = "install ok half-configured"),
  ],
  ["additional package", (f) => f.after.push({ ...f.after[0], name: "extra" })],
  ["removed package", (f) => f.after.pop()],
  ["duplicate package", (f) => f.after.push(f.after[0])],
  ["unknown field", (f) => (f.after[0].extra = true)],
  ["missing field", (f) => delete f.after[0].preDepends],
])
  test("refuses " + name, () => {
    const f = rows();
    mutate(f);
    assert.throws(() => checkDependencyRows(f.before, f.after));
  });
test("caller cannot forge a read-evidence token", () => {
  const f = rows();
  assert.throws(() =>
    verifyDependencyChange({ packages: f.before }, { packages: f.after }, f),
  );
});
test("status parser preserves all eight control fields and refuses truncation/duplicates", () => {
  const f = rows(),
    text = f.before.map((r) => Object.values(r).join("\t")).join("\n") + "\n";
  assert.deepEqual(parseStatus(text), f.before);
  assert.throws(() => parseStatus(text.trimEnd()));
  assert.throws(() => parseStatus(text + text));
});
function observation() {
  const f = rows(),
    state = (values) => ({
      status: values.map((r) => Object.values(r).join("\t")).join("\n") + "\n",
      audit: "",
      updates: [],
      loader: "synthetic unchanged loader",
    });
  return {
    role: "api",
    observationComplete: true,
    nativeCommandsPassed: true,
    installAttempted: true,
    error: null,
    beforeState: state(f.before),
    afterState: state(f.after),
    commands: Array.from({ length: 13 }, (_, i) => ({
      exe: i === 6 ? "/usr/bin/dpkg" : "/synthetic/read",
      args:
        i === 6
          ? ["--install", "/tmp/vaettir-sqlite-overlay-v1/sqlite.deb"]
          : [],
      status: 0,
      signal: null,
      error: null,
    })),
  };
}
test("retained observation validation is pure and retains strict command/state checks", () =>
  assert.equal(
    validateRetainedObservation(observation(), "api").after.length,
    2,
  ));
for (const [name, mutate] of [
  ["force flag", (o) => o.commands[6].args.push("--force-depends")],
  ["failed command", (o) => (o.commands[0].status = 1)],
  ["second install", (o) => (o.commands[0] = o.commands[6])],
  ["audit", (o) => (o.afterState.audit = "unfinished")],
  ["updates", (o) => o.afterState.updates.push("0001")],
  ["loader changed", (o) => (o.afterState.loader += " extra")],
])
  test("raw observation refuses " + name, () => {
    const o = observation();
    mutate(o);
    assert.throws(() => validateRetainedObservation(o, "api"));
  });
test("all inert modules link through their actual transitive imports", async () => {
  for (const n of readdirSync(successorRoot).filter(
    (n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs"),
  ))
    await import(pathToFileURL(resolve(successorRoot, n)));
});
test("all ten derived files match bounded transformations and frozen parents", () => {
  checkParent();
  const r = derive();
  assert.equal(Object.keys(r.files).length, 10);
  for (const [name, raw] of Object.entries(r.files))
    assert.deepEqual(readFileSync(resolve(successorRoot, name)), raw, name);
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(successorRoot, "derivations.json"))),
    r.rows,
  );
});
function sourceFixture() {
  const f = fixture(),
    proofTree = f.put("source-proof-tree", {
      files: [f.put("source-proof", { synthetic: true })],
    });
  const policy = {
    purpose: "final-application-release/v1",
    requiredRepairPr: 111,
    nativeFiles: [],
    inherited: [],
  };
  const b = { purpose: policy.purpose, nativeBindings: f.bindings };
  b.repairAcceptance = f.put("repair", {
    accepted: true,
    independentReview: true,
    scope: "NORMAL_MERGED_REPAIR",
    pr: 111,
    head: "3".repeat(40),
    merge: "1".repeat(40),
    parents: ["1".repeat(40), "3".repeat(40)],
    tree: "2".repeat(40),
    proofTree,
  });
  b.operatorManifest = f.put("operator-manifest-final", { files: [] });
  b.operatorApproval = f.put("operator-review-final", {
    accepted: true,
    independentReview: true,
    scope: "FINAL_APPLICATION_OPERATOR_SOURCE",
    manifestSha256: b.operatorManifest.sha256,
    proofTree,
  });
  for (const [key, dir, scope] of [
    [
      "producers",
      "final-application-producers-v1",
      "FINAL_APPLICATION_PRODUCERS_SOURCE",
    ],
    [
      "webLeaf",
      "final-application-web-leaf-v1",
      "FINAL_APPLICATION_WEB_LEAF_SOURCE",
    ],
    [
      "packageDependency",
      "final-application-package-dependency-v1",
      "FINAL_APPLICATION_PACKAGE_DEPENDENCY_SOURCE",
    ],
  ]) {
    const manifest = f.put(key + "-manifest", {
      files: packageRows(resolve(successorRoot, "..", dir)),
    });
    b[key] = {
      manifest,
      approval: f.put(key + "-approval", {
        accepted: true,
        independentReview: true,
        scope,
        manifestSha256: manifest.sha256,
        proofTree,
      }),
    };
  }
  return {
    ...f,
    b,
    policy,
    io: {
      read: f.io.read,
      source: f.io.source,
      native: f.io,
      nativePolicy: f.policy,
      nativeFiles: [],
      operatorFiles: [],
      inherited: () => Buffer.alloc(0),
    },
  };
}
for (const command of ["cache-adapter", "probes"])
  test(
    "actual gated " +
      command +
      " source generator uses source/review delegates only",
    () => {
      const f = sourceFixture();
      const files = prepare(command, f.b, f.policy, "api", f.io, "synthetic");
      assert.ok(Object.keys(files).length > 1);
      const receipt = JSON.parse(
        files[
          command === "probes"
            ? "compiled-probes.proposed.json"
            : "cache-adapter-derivation.json"
        ],
      );
      if (command === "probes") assert.equal(receipt.rows.length, 3);
      else assert.equal(receipt.accepted, false);
      delete f.b.packageDependency;
      assert.throws(() =>
        prepare(command, f.b, f.policy, "api", f.io, "synthetic"),
      );
    },
  );
test("new source review fails closed on missing approval", () =>
  assert.throws(() => admitDependencySource(null, () => Buffer.alloc(0))));
