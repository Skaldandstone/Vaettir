import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accepted } from "../final-application-release-v1/admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import {
  admit as admitParent,
  checkFrozen,
} from "../final-application-producers-v1/admission.mjs";
import {
  jsonRef,
  requireThat as ok,
  same,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
export { here, policy } from "../final-application-producers-v1/admission.mjs";
export const successorRoot = dirname(fileURLToPath(import.meta.url));
export function checkParent() {
  checkFrozen();
  const p = JSON.parse(readFileSync(resolve(successorRoot, "policy.json")));
  for (const row of p.parentFiles) {
    const raw = readFileSync(resolve(successorRoot, "../..", row.path));
    ok(
      raw.length === row.bytes && sha(raw) === row.sha256,
      "Frozen ae06 producer changed: " + row.path,
    );
  }
  ok(p.parentFiles.length === 37, "Incomplete parent source pins");
}
export function admitWebLeafSource(binding, read) {
  checkParent();
  const review = accepted(
    binding?.approval,
    read,
    "FINAL_APPLICATION_WEB_LEAF_SOURCE",
  );
  ok(
    review.manifestSha256 === binding.manifest.sha256,
    "Unbound Web leaf source",
  );
  ok(
    same(jsonRef(binding.manifest, read).files, packageRows(successorRoot)),
    "Web leaf source changed",
  );
  return review;
}
export function admit(b, policy, io) {
  const source = admitParent(b, policy, io);
  admitWebLeafSource(b.webLeaf, io.read);
  return source;
}
