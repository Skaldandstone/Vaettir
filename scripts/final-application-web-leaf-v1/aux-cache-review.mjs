import {
  requireThat,
  same,
} from "../production-native-successor-v1/contracts.mjs";
import { admitAuxCacheLeaf as admitApiLeaf } from "../final-application-producers-v1/aux-cache-review.mjs";
// One observed Web transaction only. The frozen API predicate stays unchanged.
export const webObservation = Object.freeze({
  observationSha256:
    "4a48afd17da7f449b8a6de0fcc70e37edc4e8ed8933f4d5de10a6e76364b9575",
  observationBytes: 8338373,
  path: "/var/cache/ldconfig/aux-cache",
  before: Object.freeze({
    path: "/var/cache/ldconfig/aux-cache",
    mode: 384,
    uid: 0,
    gid: 0,
    type: "file",
    bytes: 3982,
    sha256: "4ec98bbc44aa3f5c3e392353e2e9546ef17914864307ce7cacca00445e3c2468",
    links: 1,
  }),
  after: Object.freeze({
    path: "/var/cache/ldconfig/aux-cache",
    mode: 384,
    uid: 0,
    gid: 0,
    type: "file",
    bytes: 3982,
    sha256: "607929c80f61cd55b325ea65bc45e0d893f5b0dae693e144922dd94280abfcb4",
    links: 1,
  }),
});
export function admitAuxCacheLeaf(row, review) {
  if (row.path !== webObservation.path) return false;
  if (review.observedTransactionSha256 !== webObservation.observationSha256)
    return admitApiLeaf(row, review);
  requireThat(
    review.accepted === true &&
      review.independentReview === true &&
      review.scope === "SQLITE_TRANSACTION_ONLY" &&
      same(row.before, webObservation.before) &&
      same(row.after, webObservation.after) &&
      same(review.auxCacheLeaf, row),
    "Exact measured Web auxiliary-cache leaf requires independent transaction review",
  );
  return true;
}
