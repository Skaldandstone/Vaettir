// Main-only context preparation after normal source admission; no native operations.
import { readFileSync, realpathSync, lstatSync } from "node:fs";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  actualIo,
  writeContext,
} from "../final-application-release-v1/context.mjs";
import { admit } from "../final-application-producers-v1/admission.mjs";
import { requireThat as ok } from "../production-native-successor-v1/contracts.mjs";
import { prepareStage } from "./stage-bootstrap.derived.mjs";
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [binding, evidence, repo, role, output] = process.argv.slice(2);
  ok(
    output && ["api", "web"].includes(role),
    "BINDINGS EVIDENCE SOURCE_REPO api|web NEW_CONTEXT required",
  );
  const root = realpathSync(evidence),
    parent = realpathSync(dirname(resolve(output)));
  ok(
    parent === root || parent.startsWith(root + sep),
    "Output parent outside evidence root",
  );
  const rel = relative(resolve(evidence), resolve(output));
  ok(
    rel && !rel.startsWith("..") && !rel.includes(":"),
    "Output must be a new evidence child",
  );
  let p = resolve(evidence);
  for (const part of rel.split(sep).slice(0, -1)) {
    p = resolve(p, part);
    ok(!lstatSync(p).isSymbolicLink(), "Output parent symlink");
  }
  const b = JSON.parse(readFileSync(binding)),
    policy = JSON.parse(
      readFileSync(
        new URL("../final-application-release-v1/policy.json", import.meta.url),
      ),
    ),
    io = actualIo(evidence, repo);
  io.evidenceRoot = resolve(evidence);
  const source = admit(b, policy, io);
  const files = prepareStage(b, source, role, io);
  writeContext(output, files);
  process.stdout.write(
    JSON.stringify({
      context: output,
      files: Object.keys(files).length,
      operatorExecuted: false,
      releaseAccepted: false,
    }) + "\n",
  );
}
