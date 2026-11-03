import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";
import {
  accepted,
  sourceAdmission,
} from "../final-application-release-v1/admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import {
  requireThat as ok,
  jsonRef,
  same,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
export const here = fileURLToPath(new URL("./", import.meta.url));
export const policy = JSON.parse(readFileSync(join(here, "policy.json")));
export function checkFrozen() {
  const repo = resolve(here, "../..");
  for (const r of policy.frozenFiles) {
    const b = readFileSync(join(repo, r.path));
    ok(
      b.length === r.bytes && sha(b) === r.sha256,
      "Frozen input changed: " + r.path,
    );
  }
}
export function admitProducerSource(binding, read) {
  checkFrozen();
  const review = accepted(
    binding?.approval,
    read,
    "FINAL_APPLICATION_PRODUCERS_SOURCE",
  );
  ok(
    review.manifestSha256 === binding.manifest.sha256,
    "Unbound producer source",
  );
  ok(
    same(jsonRef(binding.manifest, read).files, packageRows(resolve(here))),
    "Producer source changed",
  );
  return review;
}
export function admit(b, oldPolicy, io) {
  const source = sourceAdmission(b, oldPolicy, io);
  admitProducerSource(b.producers, io.read);
  return source;
}
