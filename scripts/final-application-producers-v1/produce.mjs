import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { resolve, join, relative, sep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actualIo,
  writeContext,
  encode,
  gate,
  prepareApplication,
} from "./release-context.derived.mjs";
import {
  accepted,
  completeImage,
} from "../final-application-release-v1/admission.mjs";
import {
  sha,
  requireThat as ok,
  verifyRef,
} from "../production-native-successor-v1/contracts.mjs";
import { here, policy, admit } from "./admission.mjs";
import { deriveProbe } from "./derive-probes.mjs";
import {
  deriveBuildAdapter,
  deriveWebController,
  stageEvidenceRecipe,
  classifyApplicationCandidate,
} from "./adapters.mjs";
import { produceOutput } from "./output-producer.mjs";
import { prepareStage } from "./stage-bootstrap.mjs";
export function prepare(command, b, oldPolicy, role, io, prefix) {
  const source = admit(b, oldPolicy, io),
    files = {};
  if (command === "stage-bootstrap") return prepareStage(b, source, role, io);
  if (command === "probes") {
    ok(
      io.source.contains(source.source, policy.fixtureSource),
      "Probe source ancestor missing",
    );
    // API implementation or test changes need a separately reviewed derivation.
    ok(
      io.source
        .changes(policy.fixtureSource, source.source)
        .every(
          (r) =>
            !r.path.startsWith("apps/api/src/") &&
            !r.path.startsWith("packages/db/"),
        ),
      "Probe source changed since pinned integration tests",
    );
    const rows = [];
    for (const name of ["plugin", "android", "import"]) {
      const p = policy.testSources[name],
        raw = readFileSync(join(here, p.file));
      const r = deriveProbe(name, source.source, raw, p.sha256),
        filename = "additional-" + name + ".mjs";
      files[filename] = Buffer.from(r.code);
      rows.push({
        ...r,
        code: undefined,
        name,
        script: {
          path: prefix + "/" + filename,
          sha256: sha(files[filename]),
          bytes: files[filename].length,
        },
        accepted: false,
        independentReview: false,
      });
    }
    files["compiled-probes.proposed.json"] = encode({
      source: source.source,
      rows,
      releaseAccepted: false,
    });
  } else if (command === "cache-adapter") {
    const r = deriveBuildAdapter();
    files["build-context-cache-role.mjs"] = Buffer.from(r.code);
    files["cache-adapter-derivation.json"] = encode({
      ...r,
      code: undefined,
      source,
      accepted: false,
      independentReview: false,
    });
  } else if (command === "final-context") {
    Object.assign(files, prepareApplication(b, oldPolicy, role, io));
    const change = classifyApplicationCandidate(files, source.source);
    files["inherited-context-review.json"] =
      files["context-review-required.json"];
    files.Dockerfile = Buffer.from(change.code);
    files["artifact-label-derivation.json"] = encode({
      ...change,
      code: undefined,
      source,
    });
    const prior = JSON.parse(files["context-review-required.json"]);
    files["context-review-required.json"] = encode({
      ...prior,
      files: Object.entries(files)
        .filter(([p]) => p !== "context-review-required.json")
        .map(([path, v]) => ({ path, sha256: sha(v), bytes: v.length })),
      classification: "final-application-runtime-candidate",
      runtimeEligible: "pending-acceptance",
      releaseAccepted: false,
    });
  } else if (command === "web-controller") {
    const final = gate(b, oldPolicy, "runtime", "web", io);
    const r = deriveWebController(
      source.source,
      "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@" +
        final.component.imageDigest,
    );
    files["candidate-web-controller.executed.mjs"] = Buffer.from(r.code);
    files["image-auditor-derivations.json"] = encode({
      source: source.source,
      rows: [r.row],
      accepted: false,
      independentReview: false,
      releaseAccepted: false,
    });
  } else if (command === "stage-extract") {
    const item = b.producerInputs.stages[role],
      stage = completeImage(item.imageAcceptance, role, io.read),
      review = accepted(
        item.custody,
        io.read,
        "PRESERVED_SQLITE_OBSERVATION_STAGE",
      );
    ok(
      review.source === source.source &&
        review.imageDigest === "sha256:" + stage.manifest.sha256 &&
        review.configDigest === "sha256:" + stage.config.sha256 &&
        review.buildLogSha256 === item.buildLog.sha256 &&
        review.target === "sqlite_observation" &&
        review.nativeSource === "8b7d9f0ffc50d5134d5f05e8c3e2ec2e41c847ac",
      "Exact first native-stage custody required",
    );
    verifyRef(item.buildLog, io.read);
    files.Dockerfile = Buffer.from(stageEvidenceRecipe(stage.image, role));
    files["stage-extraction.json"] = encode({
      source,
      stage: stage.image,
      buildLog: item.buildLog,
      scope: "COPY_RETAINED_EVIDENCE_ONLY",
      noRun: true,
      nativeAccepted: false,
      releaseAccepted: false,
    });
  } else if (command === "application")
    return produceOutput(b, source, role, io, prefix);
  else throw Error("Unknown producer");
  return files;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [command, bindingPath, evidence, sourceRepo, role, output] =
    process.argv.slice(2);
  ok(
    output && ["api", "web"].includes(role),
    "Expected COMMAND BINDINGS EVIDENCE SOURCE_REPO api|web NEW_OUTPUT",
  );
  const prefix = relative(resolve(evidence), resolve(output))
    .split(sep)
    .join("/");
  ok(
    prefix && !prefix.startsWith(".") && !prefix.includes(":"),
    "Output must be a new child of evidence root",
  );
  const evidenceReal = realpathSync(evidence),
    parent = realpathSync(dirname(resolve(output)));
  ok(
    parent === evidenceReal || parent.startsWith(evidenceReal + sep),
    "Output parent escaped evidence root",
  );
  let checked = resolve(evidence);
  for (const part of prefix.split("/").slice(0, -1)) {
    checked = join(checked, part);
    ok(!lstatSync(checked).isSymbolicLink(), "Output parent symlink refused");
  }
  const b = JSON.parse(readFileSync(bindingPath)),
    oldPolicy = JSON.parse(
      readFileSync(
        resolve(here, "../final-application-release-v1/policy.json"),
      ),
    ),
    io = actualIo(evidence, sourceRepo);
  io.normalizerSha256 = sha(readFileSync(join(here, "normalize.mjs")));
  io.evidenceRoot = resolve(evidence);
  const files = prepare(command, b, oldPolicy, role, io, prefix);
  files["producer-generation.json"] = encode({
    command,
    source: b.nativeBindings.source.commit,
    files: Object.entries(files).map(([path, v]) => ({
      path,
      sha256: sha(v),
      bytes: v.length,
    })),
    operatorExecuted: false,
    releaseAccepted: false,
  });
  writeContext(output, files);
  process.stdout.write(
    JSON.stringify({
      output,
      files: Object.keys(files).length,
      operatorExecuted: false,
      releaseAccepted: false,
    }) + "\n",
  );
}
