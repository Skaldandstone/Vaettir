import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { here, admitProducerSource } from "./admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
import { deriveStageOperators, prepareStage } from "./stage-bootstrap.mjs";
import { normalizeInventory } from "./normalize.mjs";
const old = resolve(
  here,
  "../final-application-release-v1/inherited/materialization-successor-v1",
);
const files = deriveStageOperators();
test("producer source admission accepts correctly named independently pinned package files", () => {
  const blobs = new Map();
  const ref = (path, value) => {
    const raw = Buffer.from(JSON.stringify(value));
    blobs.set(path, raw);
    return { path, sha256: sha(raw), bytes: raw.length };
  };
  const rows = packageRows(resolve(here));
  assert.equal(rows[0].path, ".gitattributes");
  const manifest = ref("manifest.json", { files: rows });
  const proof = ref("proof.json", { synthetic: true });
  const proofTree = ref("tree.json", { files: [proof] });
  const approval = ref("approval.json", {
    accepted: true,
    independentReview: true,
    scope: "FINAL_APPLICATION_PRODUCERS_SOURCE",
    manifestSha256: manifest.sha256,
    proofTree,
  });
  assert.equal(
    admitProducerSource({ manifest, approval }, (p) => blobs.get(p)).accepted,
    true,
  );
});
test("stage assembler and independent archive verifier are byte-identical frozen inputs", () => {
  for (const name of ["prepare-archive.py", "verify-archive.py"])
    assert.deepEqual(files[name], readFileSync(resolve(old, name)));
});
test("stage contract retains every inherited descriptor/ordered-DiffID/size/hash gate", () => {
  const before = readFileSync(
      resolve(old, "archive_contract.py"),
      "utf8",
    ).replaceAll("\r\n", "\n"),
    after = files["archive_contract.py"].toString();
  for (const region of [
    before.slice(
      before.indexOf("def digest("),
      before.indexOf("def source_gate():"),
    ),
    before.slice(
      before.indexOf("    layers=read(A/'complete-layers.json')"),
      before.indexOf("\ndef verify_cached_layers"),
    ),
    before.slice(before.indexOf("def verify_cached_layers")),
  ])
    assert.ok(after.includes(region));
  assert.ok(!after.includes("prepared_gate()"));
  assert.ok(after.includes("validate_stage(HERE,SETTINGS)"));
});
test("same-daemon materializer command/auth/pull/load/export region is unchanged", () => {
  const before = readFileSync(
      resolve(old, "materialize-local.py"),
      "utf8",
    ).replaceAll("\r\n", "\n"),
    after = files["materialize-local.py"].toString();
  assert.equal(
    after.slice(0, after.indexOf("files=[q for q in OUT.iterdir()")),
    before.slice(0, before.indexOf("files=[q for q in OUT.iterdir()")),
  );
  assert.ok(!after.includes("candidate-"));
  assert.ok(after.includes("'runtimeEligible':False"));
  assert.ok(after.includes("'extendedMetadataAccepted':False"));
});
test("stage bootstrap does not depend on a final image or complete stage receipt", () => {
  const code = readFileSync(resolve(here, "stage-bootstrap.mjs"), "utf8");
  assert.ok(!code.includes("completeImage("));
  assert.ok(!code.includes("component_gate("));
  assert.throws(
    () => prepareStage({}, {}, "api", {}),
    /Stage bootstrap inputs/,
  );
});
test("stage identity uses actual build custody; never invents labels on old recipe", () => {
  const code = files["stage_support.py"].toString();
  assert.ok(code.includes("assert labels==old"));
  assert.ok(code.includes("'sqlite_observation'"));
  assert.ok(code.includes("TRANSACTION_STAGE_BYTE_VERIFICATION_INTENT"));
});
const regular = (path, inode) => ({
  path,
  type: "0",
  size: 1,
  mode: 420,
  uid: 0,
  gid: 0,
  sha256: "a".repeat(64),
  inode,
});
test("layer inode aliases survive original target replacement", () => {
  const result = normalizeInventory([
    regular("a", "1:1"),
    regular("b", "0:1"),
    regular("c", "0:1"),
  ]);
  assert.equal(result[0].links, 1);
  assert.equal(result[1].links, 2);
  assert.equal(result[2].hardlinkGroup, "/b");
});
test("normalization refuses invented mixed ownership and inconsistent alias content", () => {
  assert.throws(
    () =>
      normalizeInventory([
        regular("a", "0:1"),
        { ...regular("b", "0:1"), uid: 1 },
      ]),
    /Inconsistent/,
  );
  assert.throws(
    () =>
      normalizeInventory([
        regular("a", "0:1"),
        { ...regular("b", "0:2"), inode: undefined },
      ]),
    /Mixed/,
  );
});
test("old inventory without uid/gid is not extended or ordinary ownership proof", () => {
  const row = regular("old", "0:1");
  delete row.uid;
  delete row.gid;
  assert.throws(() => normalizeInventory([row]), /ownership/);
});
