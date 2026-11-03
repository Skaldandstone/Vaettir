import {
  readFileSync,
  readdirSync,
  lstatSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readRef,
  jsonRef,
  requireThat as ok,
  sha,
  relative,
} from "../production-native-successor-v1/contracts.mjs";
import {
  fileReader,
  gitSource,
  packageFiles,
} from "../production-native-successor-v1/offline-io.mjs";
import {
  sourceAdmission,
  transactionAdmission,
  payloadAdmission,
  finalComponent,
} from "./release-admission.derived.mjs";
import { validatePlan } from "../final-application-release-v1/apply-application.mjs";
export const here = resolve(dirname(fileURLToPath(import.meta.url)), "../final-application-release-v1");
export const encode = (x) => Buffer.from(JSON.stringify(x, null, 2) + "\n");
export function packageRows(root = here) {
  const rows = [];
  function walk(dir) {
    for (const name of readdirSync(dir).sort()) {
      if (name === "__pycache__") continue;
      const path = join(dir, name),
        s = lstatSync(path);
      ok(!s.isSymbolicLink(), "Package symlink");
      if (s.isDirectory()) walk(path);
      else {
        ok(s.isFile() && !name.endsWith(".pyc"), "Non-source package member");
        const b = readFileSync(path);
        rows.push({
          path: path.slice(root.length + 1).replaceAll("\\", "/"),
          sha256: sha(b),
          bytes: b.length,
        });
      }
    }
  }
  walk(root);
  return rows;
}
export function actualIo(evidenceRoot, sourceRepo) {
  const nativeRoot = resolve(here, "../production-native-successor-v1");
  const read = fileReader(evidenceRoot),
    source = gitSource(sourceRepo),
    nativeFiles = packageFiles(nativeRoot);
  return {
    read,
    source,
    nativeFiles,
    operatorFiles: packageRows(),
    nativePolicy: JSON.parse(readFileSync(join(nativeRoot, "policy.json"))),
    native: {
      read,
      source,
      operatorFiles: nativeFiles,
      operatorRead: (p) => readFileSync(join(nativeRoot, p)),
    },
    inherited: (p) => {
      ok(relative(p), "Bad inherited path");
      return readFileSync(join(here, p));
    },
    own: (p) => readFileSync(join(here, p)),
  };
}
export function prepareApplication(b, policy, role, io) {
  ok(["api", "web"].includes(role), "Unknown role");
  const source = sourceAdmission(b, policy, io),
    stage = transactionAdmission(b.transactions[role], role, io);
  const app = payloadAdmission(b, role, stage, source, io);
  const plan = {
    ...source,
    changes: app.delta,
  };
  validatePlan(plan);
  const files = {
    "plan.json": encode(plan),
    "apply-application.mjs": io.own("apply-application.mjs"),
  };
  for (const row of app.payload.files) {
    const name = "blobs/" + row.ref.sha256,
      bytes = readRef(row.ref, io.read, 512 * 1024 ** 2);
    if (files[name]) ok(files[name].equals(bytes), "Payload hash collision");
    else files[name] = bytes;
  }
  const config = jsonRef(stage.config, io.read),
    user = config.config?.User;
  ok(
    role === "api" ? user === undefined || user === "" : user === "nextjs",
    "Runtime USER changed",
  );
  const userIn = role === "web" ? "USER root\n" : "",
    userOut = role === "web" ? "USER nextjs\n" : "";
  // The real package transaction is inherited by digest, never reconstructed
  // with COPY of dpkg status files or a second package install.
  files.Dockerfile = Buffer.from(
    `FROM scratch AS application_payload\nCOPY plan.json apply-application.mjs /\nCOPY blobs/ /blobs/\nFROM ${stage.image} AS final_application\n${userIn}RUN --network=none --mount=type=bind,from=application_payload,source=/,target=/run/vaettir-final-app,ro ["/usr/local/bin/node","/run/vaettir-final-app/apply-application.mjs","/run/vaettir-final-app","${sha(files["plan.json"])}"]\nLABEL vaettir.application-source-commit="${source.source}" vaettir.application-source-sha256="${b.application[role].sourceArchive.sha256}" vaettir.sqlite-transaction="${b.transactions[role].observation.sha256}"\nENV VAETTIR_RELEASE_COMMIT=${source.source}\n${userOut}`,
  );
  files["context-review-required.json"] = encode({
    source: source.source,
    tree: source.tree,
    role,
    parent: stage.image,
    applicationLedgerSha256: b.application[role].ledger.sha256,
    files: Object.entries(files).map(([path, v]) => ({
      path,
      sha256: sha(v),
      bytes: v.length,
    })),
    releaseAccepted: false,
  });
  return files;
}
export function writeContext(directory, files) {
  ok(Object.keys(files).every(relative), "Unsafe output member");
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  writeFileSync(
    join(directory, "context-intent.json"),
    encode({ once: true, files: Object.keys(files), releaseAccepted: false }),
    { flag: "wx", mode: 0o600 },
  );
  const dirs = new Set();
  for (const [name, bytes] of Object.entries(files)) {
    const parent = dirname(name);
    if (parent !== "." && !dirs.has(parent)) {
      mkdirSync(join(directory, parent), { recursive: false, mode: 0o700 });
      dirs.add(parent);
    }
    writeFileSync(join(directory, name), bytes, { flag: "wx", mode: 0o600 });
  }
}
export function gate(b, policy, phase, role, io) {
  const source = sourceAdmission(b, policy, io);
  if (phase === "source") return source;
  ok(
    ["materialize", "native", "runtime"].includes(phase) &&
      ["api", "web"].includes(role),
    "Invalid gate phase",
  );
  const stage = transactionAdmission(b.transactions[role], role, io);
  payloadAdmission(b, role, stage, source, io);
  return {
    ...source,
    component: finalComponent(b, role, source, io, phase === "runtime"),
    releaseAccepted: false,
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [action, bindingPath, evidenceRoot, sourceRepo, role, output] =
    process.argv.slice(2);
  ok(
    ["prepare", "source", "materialize", "native", "runtime"].includes(action),
    "Unknown action",
  );
  const bytes = readFileSync(bindingPath);
  ok(bytes.length <= 64 * 1024 ** 2, "Bindings too large");
  const b = JSON.parse(bytes),
    policy = JSON.parse(readFileSync(join(here, "policy.json"))),
    io = actualIo(evidenceRoot, sourceRepo);
  if (action === "prepare") {
    ok(output, "Exclusive new context path required");
    const files = prepareApplication(b, policy, role, io);
    writeContext(output, files);
    process.stdout.write(
      JSON.stringify({ prepared: true, releaseAccepted: false }) + "\n",
    );
  } else
    process.stdout.write(
      JSON.stringify(gate(b, policy, action, role, io)) + "\n",
    );
}
