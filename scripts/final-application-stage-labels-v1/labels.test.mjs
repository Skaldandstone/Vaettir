import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { derive } from "./derive.mjs";
import {
  successorRoot,
  admitStageLabelsSource,
  checkParents,
} from "./admission.mjs";
import { deriveStageOperators } from "./stage-bootstrap.derived.mjs";
import { deriveStageOperators as parentOperators } from "../final-application-producers-v1/stage-bootstrap.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
test("both derived source files match exact bounded transformations", () => {
  const { files, rows } = derive();
  for (const [n, b] of Object.entries(files))
    assert.deepEqual(readFileSync(resolve(successorRoot, n)), b);
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(successorRoot, "derivations.json"))),
    rows,
  );
});
test("assembler/verifier/driver/archive contract/metadata helper remain byte exact", () => {
  const a = parentOperators(),
    b = deriveStageOperators();
  assert.deepEqual(Object.keys(a), Object.keys(b));
  for (const n of Object.keys(a))
    if (n !== "stage_support.py") assert.deepEqual(a[n], b[n], n);
  assert.deepEqual(
    b["stage_support.py"],
    readFileSync(resolve(successorRoot, "stage-support.derived.py")),
  );
});
test("actual driver pin, independent intent and successor proof tree are bound before output", () => {
  const s = readFileSync(
    resolve(successorRoot, "stage-bootstrap.derived.mjs"),
    "utf8",
  );
  for (const part of [
    "admitStageLabelsSource(b.stageLabels,io.read)",
    "verifyRef(input.buildDriver,io.read)",
    "buildDriver: input.buildDriver",
    "'vaettir.validation-source':source.source",
    "collect(b.stageLabels)",
    "b.stageLabels.approval",
  ])
    assert.ok(s.includes(part), part);
});
test("independent successor source proof uses exact package rows", () => {
  const blobs = new Map(),
    ref = (path, v) => {
      const b = Buffer.from(JSON.stringify(v));
      blobs.set(path, b);
      return { path, sha256: sha(b), bytes: b.length };
    };
  const manifest = ref("manifest", { files: packageRows(successorRoot) }),
    proof = ref("proof", { synthetic: true }),
    proofTree = ref("tree", { files: [proof] }),
    approval = ref("approval", {
      accepted: true,
      independentReview: true,
      scope: "FINAL_APPLICATION_STAGE_LABELS_SOURCE",
      manifestSha256: manifest.sha256,
      proofTree,
    });
  assert.equal(
    admitStageLabelsSource({ manifest, approval }, (p) => blobs.get(p))
      .accepted,
    true,
  );
  blobs.set("proof", Buffer.from("changed"));
  assert.throws(() =>
    admitStageLabelsSource({ manifest, approval }, (p) => blobs.get(p)),
  );
});
test("missing independent source review refuses", () =>
  assert.throws(() =>
    admitStageLabelsSource(null, () => {
      throw Error("missing");
    }),
  ));
test("all57 ae06+b40d and47 older source pins preserved", () => checkParents());
