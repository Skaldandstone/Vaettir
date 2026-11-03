import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { accepted } from "../final-application-release-v1/admission.mjs";
import { packageRows } from "../final-application-release-v1/context.mjs";
import {
  admit as admitParent,
  checkParent as checkEarlier,
} from "../final-application-web-leaf-v1/admission.mjs";
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
  ok(p.parentFiles.length === 32, "Incomplete b40d/0e605 source pins");
  for (const row of p.parentFiles) {
    const raw = readFileSync(resolve(successorRoot, "../..", row.path));
    ok(
      raw.length === row.bytes && sha(raw) === row.sha256,
      "Frozen parent changed: " + row.path,
    );
  }
}
export function admitDependencySource(binding, read) {
  checkParent();
  const review = accepted(
    binding?.approval,
    read,
    "FINAL_APPLICATION_PACKAGE_DEPENDENCY_SOURCE",
  );
  ok(
    review.manifestSha256 === binding.manifest.sha256,
    "Unbound dependency source",
  );
  ok(
    same(jsonRef(binding.manifest, read).files, packageRows(successorRoot)),
    "Dependency source changed",
  );
  return review;
}
export function admit(b, policy, io) {
  const source = admitParent(b, policy, io);
  admitDependencySource(b.packageDependency, io.read);
  return source;
}
