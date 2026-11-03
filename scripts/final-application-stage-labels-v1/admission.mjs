import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accepted } from "../final-application-release-v1/admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import { checkFrozen } from "../final-application-producers-v1/admission.mjs";
import {
  jsonRef,
  requireThat as ok,
  same,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
export const successorRoot = dirname(fileURLToPath(import.meta.url));
export const policy = JSON.parse(
  readFileSync(resolve(successorRoot, "policy.json")),
);
export function checkParents() {
  checkFrozen();
  ok(
    policy.parentFiles.length === 57,
    "Complete ae06+b40d source pins required",
  );
  for (const r of policy.parentFiles) {
    const b = readFileSync(resolve(successorRoot, "../..", r.path));
    ok(
      b.length === r.bytes && sha(b) === r.sha256,
      "Frozen source changed: " + r.path,
    );
  }
}
export function admitStageLabelsSource(binding, read) {
  checkParents();
  const review = accepted(
    binding?.approval,
    read,
    "FINAL_APPLICATION_STAGE_LABELS_SOURCE",
  );
  ok(
    review.manifestSha256 === binding.manifest.sha256,
    "Unbound stage-label source",
  );
  ok(
    same(jsonRef(binding.manifest, read).files, packageRows(successorRoot)),
    "Stage-label source changed",
  );
  return review;
}
