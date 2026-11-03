import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accepted } from "../final-application-release-v1/admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import {
  admit as admitParent,
  checkParent as checkEarlier,
} from "../final-application-package-dependency-v1/admission.mjs";
import {
  jsonRef,
  requireThat as ok,
  same,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
export { here, policy } from "../final-application-producers-v1/admission.mjs";
export const successorRoot = dirname(fileURLToPath(import.meta.url));
export function checkParent() {
  checkEarlier();
  const p = JSON.parse(readFileSync(resolve(successorRoot, "policy.json")));
  ok(p.parentFiles.length === 20, "Incomplete d2f8 source pins");
  for (const row of p.parentFiles) {
    const raw = readFileSync(resolve(successorRoot, "../..", row.path));
    ok(
      raw.length === row.bytes && sha(raw) === row.sha256,
      "Frozen dependency parent changed: " + row.path,
    );
  }
}
export function admitMinimalDeltaSource(binding, read) {
  checkParent();
  const review = accepted(
    binding?.approval,
    read,
    "FINAL_APPLICATION_MINIMAL_DELTA_SOURCE",
  );
  ok(
    review.manifestSha256 === binding.manifest.sha256,
    "Unbound minimal delta source",
  );
  ok(
    same(jsonRef(binding.manifest, read).files, packageRows(successorRoot)),
    "Minimal delta source changed",
  );
  return review;
}
export function admit(b, policy, io) {
  const source = admitParent(b, policy, io);
  admitMinimalDeltaSource(b.minimalDelta, io.read);
  return source;
}
