import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { webObservation, admitAuxCacheLeaf } from "./aux-cache-review.mjs";
import { auxCacheObservation as apiObservation } from "../final-application-producers-v1/aux-cache-review.mjs";
import { verifyOverlay as previousVerify } from "../final-application-producers-v1/transaction-inventory.derived.mjs";
import { verifyOverlay } from "./transaction-inventory.derived.mjs";
import { derive } from "./derive.mjs";
import {
  successorRoot,
  admitWebLeafSource,
  checkParent,
} from "./admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
function fixture(pin = webObservation) {
  const row = {
    path: pin.path,
    before: { ...pin.before },
    after: { ...pin.after },
  };
  const library = {
    path: "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6",
    mode: 420,
    uid: 0,
    gid: 0,
    type: "file",
    bytes: 1,
    sha256: "a".repeat(64),
    links: 1,
  };
  return {
    row,
    before: [row.before, library],
    after: [row.after, library],
    policy: { sqliteAccepted: { librarySha256: library.sha256 } },
    review: {
      accepted: true,
      independentReview: true,
      scope: "SQLITE_TRANSACTION_ONLY",
      observedTransactionSha256: pin.observationSha256,
      changes: [row],
      categories: { [pin.path]: "dpkg-transaction" },
      auxCacheLeaf: row,
    },
  };
}
test("old ae06 refuses Web; new validator admits only exact reviewed Web synthetic delta", () => {
  const f = fixture();
  assert.throws(() => previousVerify(f.before, f.after, f.review, f.policy));
  assert.deepEqual(verifyOverlay(f.before, f.after, f.review, f.policy), [
    f.row,
  ]);
});
test("existing exact API admission is unchanged", () => {
  const f = fixture(apiObservation);
  assert.deepEqual(
    verifyOverlay(f.before, f.after, f.review, f.policy),
    previousVerify(f.before, f.after, f.review, f.policy),
  );
});
for (const [name, mutate] of [
  ["unaccepted", (f) => (f.review.accepted = false)],
  ["not independent", (f) => (f.review.independentReview = false)],
  ["wrong scope", (f) => (f.review.scope = "ANY_TRANSACTION")],
  ["missing leaf", (f) => delete f.review.auxCacheLeaf],
  [
    "unknown observation",
    (f) => (f.review.observedTransactionSha256 = "b".repeat(64)),
  ],
  [
    "Web rows under API observation",
    (f) =>
      (f.review.observedTransactionSha256 = apiObservation.observationSha256),
  ],
  ["wrong before hash", (f) => (f.row.before.sha256 = "b".repeat(64))],
  ["wrong after hash", (f) => (f.row.after.sha256 = "b".repeat(64))],
  ["wrong mode", (f) => (f.row.after.mode = 420)],
  ["wrong owner", (f) => (f.row.after.uid = 1)],
  ["wrong group", (f) => (f.row.after.gid = 1)],
  ["wrong size", (f) => f.row.after.bytes++],
  ["extra alias", (f) => (f.row.after.links = 2)],
  ["symlink", (f) => (f.row.after.type = "symlink")],
  [
    "unreviewed extra leaf",
    (f) => f.after.push({ ...f.row.after, path: "/var/cache/ldconfig/other" }),
  ],
  [
    "library corruption",
    (f) => (f.after[1] = { ...f.after[1], sha256: "c".repeat(64) }),
  ],
])
  test("Web successor refuses " + name, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => verifyOverlay(f.before, f.after, f.review, f.policy));
  });
test("API rows under Web identity cannot enter Web exception", () => {
  const f = fixture(apiObservation);
  f.review.observedTransactionSha256 = webObservation.observationSha256;
  assert.throws(() => admitAuxCacheLeaf(f.row, f.review));
});
test("adjacent paths receive no cache-prefix waiver", () => {
  for (const path of [
    "/var/cache/ldconfig/other",
    "/var/cache/ldconfig/aux-cache/child",
    "/etc/ld.so.cache",
  ])
    assert.equal(admitAuxCacheLeaf({ path }, {}), false);
});
test("all derived bytes match exact documented transformations", () => {
  const { files, rows } = derive();
  for (const [name, b] of Object.entries(files))
    assert.deepEqual(readFileSync(resolve(successorRoot, name)), b);
  assert.deepEqual(
    JSON.parse(readFileSync(resolve(successorRoot, "derivations.json"))),
    rows,
  );
});
test("source guard uses proper package names and rejects unreviewed successor", () => {
  const blobs = new Map(),
    ref = (path, value) => {
      const b = Buffer.from(JSON.stringify(value));
      blobs.set(path, b);
      return { path, sha256: sha(b), bytes: b.length };
    };
  const files = packageRows(successorRoot);
  assert.equal(files[0].path, ".gitattributes");
  const manifest = ref("manifest", { files }),
    proof = ref("proof", { synthetic: true }),
    proofTree = ref("tree", { files: [proof] });
  const approval = ref("approval", {
    accepted: true,
    independentReview: true,
    scope: "FINAL_APPLICATION_WEB_LEAF_SOURCE",
    manifestSha256: manifest.sha256,
    proofTree,
  });
  assert.equal(
    admitWebLeafSource({ manifest, approval }, (p) => blobs.get(p)).accepted,
    true,
  );
  assert.throws(() => admitWebLeafSource(null, (p) => blobs.get(p)));
  blobs.set("proof", Buffer.from("tampered"));
  assert.throws(() =>
    admitWebLeafSource({ manifest, approval }, (p) => blobs.get(p)),
  );
});
test("source/native/output/seal and generated contracts all route to successor", () => {
  const get = (n) => readFileSync(resolve(successorRoot, n), "utf8");
  assert.ok(
    get("release-admission.derived.mjs").includes(
      "admitWebLeafSource(b.webLeaf, io.read)",
    ),
  );
  for (const n of [
    "release-context.derived.mjs",
    "native-probe-context.derived.mjs",
    "seal-runtime.derived.mjs",
    "output-producer.mjs",
  ])
    assert.match(get(n), /\.\/release-(admission|context)\.derived\.mjs/);
  assert.match(get("produce.mjs"), /from "\.\/output-producer\.mjs"/);
  assert.ok(
    get("operator-contracts.derived.py").includes(
      "'purpose','producers','webLeaf'",
    ),
  );
  assert.ok(
    get("operator-contracts.derived.py").includes(
      "str(WEB_LEAF_PACKAGE/'release-context.derived.mjs')",
    ),
  );
});
test("37 ae06 and all47 inherited frozen inputs remain unchanged", () =>
  checkParent());
