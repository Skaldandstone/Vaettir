import {
  requireThat,
  same,
} from "../production-native-successor-v1/contracts.mjs";
// The one measured API observation, not a prefix allowlist or a future default.
export const auxCacheObservation = Object.freeze({
  observationSha256:
    "47f5247cbc51085e4fcfad17a05ada98e5d04313760235795e690770db2c94e9",
  observationBytes: 252820299,
  path: "/var/cache/ldconfig/aux-cache",
  before: {
    path: "/var/cache/ldconfig/aux-cache",
    mode: 384,
    uid: 0,
    gid: 0,
    type: "file",
    bytes: 8263,
    sha256: "c964b68ae8f90c15f068097fb5fa3fc3f801f87c2dec68874cfb359de8f4efbf",
    links: 1,
  },
  after: {
    path: "/var/cache/ldconfig/aux-cache",
    mode: 384,
    uid: 0,
    gid: 0,
    type: "file",
    bytes: 8263,
    sha256: "6a994b6ab184e767ec393f8a1f320029e9c2a4dd6d7d9970e81fa40943c642f1",
    links: 1,
  },
});
export function admitAuxCacheLeaf(row, review) {
  if (row.path !== auxCacheObservation.path) return false;
  requireThat(
    review.accepted === true &&
      review.independentReview === true &&
      review.scope === "SQLITE_TRANSACTION_ONLY" &&
      review.observedTransactionSha256 ===
        auxCacheObservation.observationSha256 &&
      same(row.before, auxCacheObservation.before) &&
      same(row.after, auxCacheObservation.after) &&
      same(review.auxCacheLeaf, row),
    "Exact measured auxiliary-cache leaf requires independent transaction review",
  );
  return true;
}
