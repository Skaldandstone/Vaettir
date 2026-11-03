import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { packageRows } from "../final-application-release-v1/context.mjs";
import { jsonRef, sha, requireThat as ok, same } from "../production-native-successor-v1/contracts.mjs";
const root = dirname(fileURLToPath(import.meta.url));
export function admitFixtureSource(binding, read) {
  const review = jsonRef(binding.approval, read), manifest = jsonRef(binding.manifest, read);
  ok(review.scope === "FINAL_NATIVE_FIXTURE_SOURCE" && review.accepted === true && review.independentReview === true && review.manifestSha256 === binding.manifest.sha256, "Independent native fixture source review required");
  ok(same(manifest.files, packageRows(root)), "Native fixture source package changed");
  const policy = JSON.parse(readFileSync(resolve(root, "policy.json")));
  for (const row of policy.parents) {
    const b = readFileSync(resolve(root, "../..", row.path));
    ok(b.length === row.bytes && sha(b) === row.sha256, "Frozen parent source changed");
  }
  return review;
}
