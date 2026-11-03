import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { join, resolve } from "node:path";
import {
  requireThat as ok,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
import { image } from "../final-application-release-v1/admission.mjs";
import { here, policy, checkFrozen } from "./admission.mjs";
export function replaceExact(text, from, to, count = 1) {
  ok(
    text.split(from).length - 1 === count,
    "Source derivation drift: " + from.slice(0, 80),
  );
  return text.split(from).join(to);
}
export function validateCacheRole(review, item, role, toolchain) {
  ok(
    ["api", "web"].includes(role) &&
      ["api", "web"].includes(item.cacheSourceRole),
    "Explicit cache source/target roles required",
  );
  ok(
    review.compilationTargetRole === role &&
      review.cacheSourceRole === item.cacheSourceRole &&
      review.completeImageAcceptanceSha256 === item.imageAcceptance.sha256 &&
      image(toolchain.image, item.cacheSourceRole),
    "Unreviewed cache-role crossing",
  );
}
export function deriveBuildAdapter() {
  checkFrozen();
  const old = resolve(
      here,
      "../final-application-release-v1/build-context.mjs",
    ),
    original = readFileSync(old, "utf8");
  let value = replaceExact(
    original,
    "toolchain = completeImage(item.imageAcceptance, role, io.read);",
    "toolchain = completeImage(item.imageAcceptance, item.cacheSourceRole, io.read);\n  admitProducerSource(b.producers, io.read);",
  );
  value = replaceExact(
    value,
    "  const inv = jsonRef(item.cacheInventory, io.read, 256 * 1024 ** 2);",
    "  validateCacheRole(review, item, role, toolchain);\n  const inv = jsonRef(item.cacheInventory, io.read, 256 * 1024 ** 2);",
  );
  value = replaceExact(
    value,
    "    completeInventoryRef(toolchain.inventory, io.read),",
    "    normalizeInventory(completeInventoryRef(toolchain.inventory, io.read)),",
  );
  value = value.replace(
    /from "(\.[^"]+)"/g,
    (_, p) =>
      "from " + JSON.stringify(pathToFileURL(resolve(old, "..", p)).href),
  );
  value =
    `import {normalizeInventory} from ${JSON.stringify(pathToFileURL(join(here, "normalize.mjs")).href)};\nimport {validateCacheRole} from ${JSON.stringify(pathToFileURL(join(here, "adapters.mjs")).href)};\nimport {admitProducerSource} from ${JSON.stringify(pathToFileURL(join(here, "admission.mjs")).href)};\n` +
    value;
  return {
    code: value,
    originalSha256: sha(Buffer.from(original)),
    candidateSha256: sha(Buffer.from(value)),
    scope: "CACHE_SOURCE_ROLE_ONLY",
    finalRuntimeRoleChecksChanged: false,
    releaseAccepted: false,
  };
}
export function deriveWebController(
  source,
  finalImage,
  raw = readFileSync(join(here, policy.webController.path)),
) {
  ok(
    /^[a-f0-9]{40}$/.test(source) &&
      image(finalImage, "web") &&
      sha(raw) === policy.webController.sha256,
    "Exact Web source/image/original required",
  );
  let value = raw.toString();
  const substitutions = [
    [
      "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@sha256:3f615b8ee455c1a1160c9f20de125e310ca26ac6d754f5a56a4c0801f343b2ef",
      finalImage,
      1,
    ],
    [
      "vaettir-ui-62c6645a-fixture",
      "vaettir-ui-" + source.slice(0, 8) + "-fixture",
      2,
    ],
    [
      "vaettir.fixture=ui-62c6645a",
      "vaettir.fixture=ui-" + source.slice(0, 8),
      1,
    ],
    ["62c6645a99e4bfa156b8b242569e3a828a0f48fe", source, 1],
  ];
  for (const [from, to, count] of substitutions)
    value = replaceExact(value, from, to, count);
  ok(
    value.includes("assert.equal(rows.length,23)"),
    "Missing inherited 23 assertions",
  );
  return {
    code: value,
    row: {
      name: "candidate-web-controller.executed.mjs",
      originalSha256: sha(raw),
      candidateSha256: sha(Buffer.from(value)),
      substitutions,
    },
    releaseAccepted: false,
  };
}
export function stageEvidenceRecipe(stageImage, role) {
  ok(
    image(stageImage, role),
    "Exact original stage digest/repository required",
  );
  return `FROM ${stageImage} AS retained_transaction\nFROM scratch AS evidence_only\nCOPY --from=retained_transaction /vaettir-sqlite-observation-v1/ /\n`;
}
export function classifyApplicationCandidate(files, source) {
  ok(/^[a-f0-9]{40}$/.test(source), "Exact final source required");
  const original = files.Dockerfile.toString();
  ok(
    original.includes(" AS final_application\n") &&
      !original.includes("vaettir.artifact-purpose="),
    "Unexpected final recipe",
  );
  const next = replaceExact(
    original,
    `\nENV VAETTIR_RELEASE_COMMIT=${source}\n`,
    `\nLABEL vaettir.artifact-purpose="final-application-runtime-candidate" vaettir.runtime-eligible="pending-acceptance" vaettir.validation-source="${source}"\nENV VAETTIR_RELEASE_COMMIT=${source}\n`,
  );
  return {
    code: next,
    originalSha256: sha(Buffer.from(original)),
    candidateSha256: sha(Buffer.from(next)),
    classificationOnly: true,
    releaseAccepted: false,
  };
}
