import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  admitPreparation,
  jsonRef,
  completeInventoryRef,
  readRef,
  requireThat,
  sha,
} from "./contracts.mjs";
import {
  fileReader,
  gitSource,
  packageFiles,
  writeExclusiveContext,
} from "./offline-io.mjs";

export const stageRoot = "/tmp/vaettir-sqlite-overlay-v1";
export const observationRoot = "/vaettir-sqlite-observation-v1";
const encoded = (value) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

export function recipe(role, image, user, nss = false) {
  requireThat(
    ["api", "web"].includes(role) &&
      /^051722405355\.dkr\.ecr\.us-east-2\.amazonaws\.com\/vaettir-(api|web)@sha256:[a-f0-9]{64}$/.test(
        image,
      ),
    "Exact baseline image required",
  );
  requireThat(
    user === undefined ||
      user === "" ||
      /^[a-zA-Z0-9_][a-zA-Z0-9_.-]*(?::[a-zA-Z0-9_][a-zA-Z0-9_.-]*)?$/.test(
        user,
      ),
    "Unsafe original USER",
  );
  // With an absent/empty original USER, omit USER entirely to preserve image config.
  const elevate = user ? "USER root\n" : "",
    restore = user ? `USER ${user}\n` : "";
  const members = [
    "transaction.mjs",
    "contracts.mjs",
    "inventory.mjs",
    "sqlite.deb",
    "sqlite-runtime-proof.json",
    "check-sqlite-runtime.mjs",
    "fetch-sqlite-runtime-sources.mjs",
    "sqlite-runtime-sources.json",
    "baseline-inventory.json",
    "Dockerfile",
    "transaction-input.json",
  ];
  const toolStage = nss
    ? 'FROM scratch AS nss_test_tool\nCOPY --chmod=0555 ["certutil", "/certutil"]\nCOPY ["nss-fixture.cjs", "/probe.cjs"]\n'
    : "";
  const nssRun = nss
    ? `RUN --network=none --mount=type=bind,from=nss_test_tool,source=/,target=/run/vaettir-nss,ro ["/usr/local/bin/node", "${stageRoot}/transaction.mjs", "--nss"]\n`
    : "";
  return `${toolStage}FROM ${image} AS sqlite_observation\n${elevate}COPY ${JSON.stringify([...members, stageRoot + "/"])}\nCOPY --chmod=0555 ["sqlite-runtime-regression", "${stageRoot}/sqlite-runtime-regression"]\nRUN --network=none ["/usr/local/bin/node", "${stageRoot}/transaction.mjs", "--observe"]\n${nssRun}${restore}FROM scratch AS evidence_only\nCOPY --from=sqlite_observation ${observationRoot}/ /\n`;
}

export function prepareContext(bindings, policy, role, io) {
  requireThat(["api", "web"].includes(role), "Unknown runtime role");
  const admission = admitPreparation(bindings, policy, io); // ALL gates before any output.
  const baseline = bindings.baseline[role],
    config = jsonRef(baseline.config, io.read);
  requireThat(
    config.os === "linux" && config.architecture === "amd64",
    "Wrong baseline platform",
  );
  const inventory = completeInventoryRef(baseline.inventory, io.read);
  requireThat(
    Array.isArray(inventory) &&
      !inventory.some((r) =>
        ["tmp/vaettir-sqlite-overlay-v1", "vaettir-sqlite-observation-v1"].some(
          (p) => r.path === p || r.path.startsWith(p + "/"),
        ),
      ),
    "Observation paths must be absent in baseline",
  );
  const files = {};
  for (const name of ["transaction.mjs", "contracts.mjs", "inventory.mjs"]) {
    const row = io.operatorFiles.find((r) => r.path === name);
    requireThat(row, "Missing accepted collector source");
    const bytes = io.operatorRead(name);
    requireThat(
      bytes.length === row.bytes && sha(bytes) === row.sha256,
      "Executing collector source changed",
    );
    files[name] = bytes;
  }
  for (const [key, name] of [
    ["package", "sqlite.deb"],
    ["proof", "sqlite-runtime-proof.json"],
    ["probe", "sqlite-runtime-regression"],
  ])
    files[name] = readRef(bindings.sqlite[key], io.read, 512 * 1024 ** 2);
  for (const [name, ref] of Object.entries(bindings.sqlite.scripts))
    files[name] = readRef(ref, io.read);
  let nss = null,
    toolBytes,
    fixtureBytes;
  if (policy.roles[role].nssVersion) {
    const tool = bindings.nssTool,
      accept = jsonRef(tool?.acceptance, io.read),
      pins = jsonRef(tool.pins, io.read);
    requireThat(
      tool.pins.sha256 === policy.nssTool.pinsSha256 &&
        pins.certutilSha256 === policy.nssTool.certutilSha256 &&
        pins.packageVersion === policy.roles[role].nssVersion,
      "Matching runtime NSS tool provenance required",
    );
    requireThat(
      accept.accepted === true &&
        accept.sourceReviewed === true &&
        accept.protocol === "empty-store-loader-proof/v1" &&
        accept.toolPinsSha256 === tool.pins.sha256 &&
        accept.fixtureSha256 === tool.fixture.sha256 &&
        accept.externalReadOnly === true &&
        accept.installedOrShipped === false,
      "Separate NSS fixture/tool source review required",
    );
    requireThat(
      tool.binary.sha256 === pins.certutilSha256 &&
        tool.binary.bytes === pins.certutilSize,
      "Exact external certutil required",
    );
    toolBytes = readRef(tool.binary, io.read);
    fixtureBytes = readRef(tool.fixture, io.read);
    nss = {
      toolSha256: tool.binary.sha256,
      fixtureSha256: tool.fixture.sha256,
      sourceReviewSha256: tool.acceptance.sha256,
      protocol: "empty-store-loader-proof/v1",
    };
  }
  files["baseline-inventory.json"] = encoded(inventory);
  files["Dockerfile"] = Buffer.from(
    recipe(role, policy.roles[role].image, config.config?.User, Boolean(nss)),
  );
  // Context metadata never claims native or hosted acceptance. Input file pins also
  // cover Dockerfile, so container-side checks see exactly what root reviewed.
  files["transaction-input.json"] = encoded({
    schemaVersion: 1,
    role,
    admission,
    base: policy.roles[role],
    originalUser: config.config?.User ?? null,
    acceptedLibrarySha256: bindings.sqlite.library.sha256,
    stageRoot,
    observationRoot,
    nss,
    files: Object.entries(files).map(([path, bytes]) => ({
      path,
      sha256: sha(bytes),
      bytes: bytes.length,
    })),
  });
  files[".dockerignore"] = Buffer.from(
    "context-intent.json\ncontext-manifest.json\n.dockerignore\n",
  );
  // These two members belong ONLY to the independent scratch tool stage. They
  // are never copied into the SQLite stage or evidence-only output image.
  if (nss) {
    files.certutil = toolBytes;
    files["nss-fixture.cjs"] = fixtureBytes;
  }
  return files;
}

const directory = dirname(fileURLToPath(import.meta.url));
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  requireThat(
    process.argv.length === 7,
    "Usage: overlay-context.mjs BINDINGS EVIDENCE_ROOT SOURCE_REPO api|web NEW_CONTEXT",
  );
  const [, , bindingsPath, evidenceRoot, sourceRepo, role, output] =
    process.argv;
  const bindings = JSON.parse(readFileSync(bindingsPath, "utf8")),
    policy = JSON.parse(readFileSync(join(directory, "policy.json"), "utf8"));
  const files = prepareContext(bindings, policy, role, {
    read: fileReader(evidenceRoot),
    source: gitSource(sourceRepo),
    operatorFiles: packageFiles(directory),
    operatorRead: (name) => readFileSync(join(directory, name)),
  });
  writeExclusiveContext(output, files);
  console.log(
    JSON.stringify({
      prepared: true,
      role,
      nativeExecuted: false,
      releaseAccepted: false,
    }),
  );
}
