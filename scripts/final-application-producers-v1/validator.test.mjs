import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { auxCacheObservation, admitAuxCacheLeaf } from "./aux-cache-review.mjs";
import { verifyOverlay } from "./transaction-inventory.derived.mjs";
import { verifyOverlay as originalVerifyOverlay } from "../production-native-successor-v1/inventory.mjs";
import { deriveValidatorSources } from "./derive-validator.mjs";
import { here } from "./admission.mjs";
const pin = auxCacheObservation;
function fixture() {
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
test("synthetic exact measured leaf is admitted only by separately derived validator", () => {
  const f = fixture();
  assert.throws(
    () => originalVerifyOverlay(f.before, f.after, f.review, f.policy),
    /Unapproved package transaction leaf/,
  );
  assert.deepEqual(verifyOverlay(f.before, f.after, f.review, f.policy), [
    f.row,
  ]);
});
for (const [name, change] of [
  [
    "unreviewed",
    (f) => {
      f.review.accepted = false;
    },
  ],
  [
    "not independent",
    (f) => {
      f.review.independentReview = false;
    },
  ],
  [
    "different observation",
    (f) => {
      f.review.observedTransactionSha256 = "b".repeat(64);
    },
  ],
  [
    "missing leaf review",
    (f) => {
      delete f.review.auxCacheLeaf;
    },
  ],
  [
    "different before hash",
    (f) => {
      f.row.before.sha256 = "b".repeat(64);
    },
  ],
  [
    "different after hash",
    (f) => {
      f.row.after.sha256 = "b".repeat(64);
    },
  ],
  [
    "changed mode",
    (f) => {
      f.row.after.mode = 420;
    },
  ],
  [
    "hardlink alias",
    (f) => {
      f.row.after.links = 2;
    },
  ],
  [
    "changed owner",
    (f) => {
      f.row.after.uid = 1001;
    },
  ],
  [
    "changed size",
    (f) => {
      f.row.after.bytes++;
    },
  ],
])
  test("aux-cache refuses " + name, () => {
    const f = fixture();
    change(f);
    assert.throws(() => verifyOverlay(f.before, f.after, f.review, f.policy));
  });
for (const path of [
  "/var/cache/ldconfig/aux-cache.backup",
  "/var/cache/ldconfig/aux-cache/child",
  "/var/cache/ldconfig/other",
  "/var/cache/ldconfig",
])
  test("adjacent unreviewed leaf refused: " + path, () => {
    const f = fixture();
    f.row.path = path;
    f.row.before.path = path;
    f.row.after.path = path;
    f.review.categories = { [path]: "dpkg-transaction" };
    assert.equal(admitAuxCacheLeaf(f.row, f.review), false);
    assert.throws(() => verifyOverlay(f.before, f.after, f.review, f.policy));
  });
test("unrelated filesystem changes and extra category exceptions remain refused", () => {
  const f = fixture();
  f.after.push({ ...f.row.after, path: "/etc/not-approved" });
  assert.throws(() => verifyOverlay(f.before, f.after, f.review, f.policy));
  const g = fixture();
  g.review.categories["/var/cache/ldconfig/not-used"] = "dpkg-transaction";
  assert.throws(() => verifyOverlay(g.before, g.after, g.review, g.policy));
});
test("library bytes and SONAME/native checks remain unchanged", () => {
  const f = fixture();
  f.policy.sqliteAccepted.librarySha256 = "b".repeat(64);
  assert.throws(
    () => verifyOverlay(f.before, f.after, f.review, f.policy),
    /accepted library/,
  );
});
test("all derived modules exactly match bounded source transformations", () => {
  const r = deriveValidatorSources();
  assert.equal(Object.keys(r.files).length, 8);
  for (const [name, b] of Object.entries(r.files))
    assert.deepEqual(readFileSync(join(here, name)), b, name);
  assert.deepEqual(
    JSON.parse(readFileSync(join(here, "validator-derivations.json"))),
    r.rows,
  );
  assert.match(
    r.files["operator-contracts.derived.py"].toString(),
    /'purpose','producers'/,
  );
  assert.match(
    r.files["operator-contracts.derived.py"].toString(),
    /PRODUCER_PACKAGE\/'release-context.derived.mjs'/,
  );
  assert.match(
    r.files["native-release-gates.derived.mjs"].toString(),
    /jsonRef\(ref, read, 512 \* 1024 \*\* 2\)/,
  );
});
