import { readFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  requireThat as ok,
  readRef,
  jsonRef,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
import { gate, actualIo, here, encode, writeContext } from "./context.mjs";
export function prepareNativeProbe(b, policy, role, io) {
  const admission = gate(b, policy, "native", role, io),
    f = b.final[role],
    image = `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-${role}@${admission.component.imageDigest}`;
  const fixtures = b.runtime.nativeChecks[role],
    files = {};
  const allowed =
    role === "api"
      ? ["sqlite-installed", "sqlite-consumers", "browser", "prisma"]
      : ["sqlite-installed", "sqlite-consumers", "prisma"];
  ok(
    JSON.stringify(fixtures.map((x) => x.name).sort()) ===
      JSON.stringify(allowed.sort()),
    "Exact native checks required",
  );
  for (const item of fixtures) {
    ok(
      item.source === admission.source &&
        item.argv[0] === "/usr/local/bin/node" &&
        item.argv.length <= 8,
      "Wrong native fixture identity",
    );
    const review = jsonRef(item.review, io.read);
    ok(
      review.accepted === true &&
        review.sourceReviewed === true &&
        review.scriptSha256 === item.script.sha256 &&
        JSON.stringify(review.argv) === JSON.stringify(item.argv),
      "Unreviewed native invocation",
    );
    files[item.name + ".mjs"] = readRef(item.script, io.read);
    ok(
      item.argv[1] === "/run/vaettir-native/" + item.name + ".mjs",
      "Native test script must use reviewed read-only bytes",
    );
  }
  let nss = null;
  if (role === "api") {
    const tool = b.nativeBindings.nssTool,
      pins = jsonRef(tool.pins, io.read),
      review = jsonRef(tool.acceptance, io.read);
    ok(
      pins.packageVersion === io.nativePolicy.roles.api.nssVersion &&
        pins.certutilSha256 === io.nativePolicy.nssTool.certutilSha256 &&
        tool.pins.sha256 === io.nativePolicy.nssTool.pinsSha256,
      "Wrong NSSu4 tool",
    );
    ok(
      review.accepted === true &&
        review.sourceReviewed === true &&
        review.fixtureSha256 === tool.fixture.sha256 &&
        review.toolPinsSha256 === tool.pins.sha256 &&
        review.externalReadOnly === true &&
        review.installedOrShipped === false,
      "NSS fixture source not reviewed",
    );
    files.certutil = readRef(tool.binary, io.read);
    files["nss-fixture.cjs"] = readRef(tool.fixture, io.read);
    ok(
      sha(files.certutil) === pins.certutilSha256 &&
        files.certutil.length === pins.certutilSize,
      "NSS tool bytes differ",
    );
    nss = {
      toolSha256: sha(files.certutil),
      fixtureSha256: sha(files["nss-fixture.cjs"]),
    };
  }
  const plan = {
    source: admission.source,
    tree: admission.tree,
    image,
    role,
    checks: fixtures,
    nss,
    output: "/vaettir-sqlite-observation-v1",
  };
  files["native-plan.json"] = encode(plan);
  files["run-native.cjs"] = io.own("run-native.cjs");
  const nssCopy =
    role === "api" ? "COPY --chmod=0555 certutil /certutil\n" : "";
  const nssMount =
    role === "api"
      ? " --mount=type=bind,from=native_test_tools,source=/,target=/run/vaettir-nss,ro"
      : "";
  files.Dockerfile = Buffer.from(
    `FROM scratch AS native_test_tools\nCOPY . /\n${nssCopy}FROM ${image} AS native_observation\nUSER root\nWORKDIR /app\nRUN --network=none --mount=type=bind,from=native_test_tools,source=/,target=/run/vaettir-native,ro${nssMount} ["/usr/local/bin/node","/run/vaettir-native/run-native.cjs","${sha(files["native-plan.json"])}"]\nFROM scratch AS evidence_only\nCOPY --from=native_observation /vaettir-sqlite-observation-v1/ /\n`,
  );
  files["probe-context.json"] = encode({
    source: admission.source,
    image,
    nativeAuditSha256: f.nativeStructure.audit.sha256,
    releaseAccepted: false,
  });
  return files;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [bp, er, sr, role, out] = process.argv.slice(2);
  ok(
    out && ["api", "web"].includes(role),
    "BINDINGS EVIDENCE SOURCE role NEW_CONTEXT",
  );
  const b = JSON.parse(readFileSync(bp)),
    p = JSON.parse(readFileSync(join(here, "policy.json")));
  writeContext(out, prepareNativeProbe(b, p, role, actualIo(er, sr)));
}
