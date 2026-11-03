// Main-only source output. No native process, container or fixture execution.
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { propose } from "./produce.mjs";
import { admitFixtureSource } from "./source-admission.mjs";
import { fileReader } from "../production-native-successor-v1/offline-io.mjs";
import { need, hash } from "./core.mjs";
const here = dirname(fileURLToPath(import.meta.url));
export function generate(input, evidenceRead) {
  admitFixtureSource(input.sourceBinding, evidenceRead);
  const policy = JSON.parse(readFileSync(join(here, "policy.json")));
  const read = path => {
    // Policy pins use retained local evidence; invocation-specific refs use custody root.
    const pinned = Object.values(policy.roles).flatMap(r => [r.inventory, r.acceptance]).concat(Object.values(policy.sqlite).filter(r => r && typeof r === "object"));
    return pinned.some(r => r.path === path) ? readFileSync(path) : evidenceRead(path);
  };
  return propose(input.role, policy, { final: input.final }, read, n => readFileSync(join(here, n)));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [inputPath, evidenceRoot, output] = process.argv.slice(2);
  need(inputPath && evidenceRoot && output, "INPUT EVIDENCE_ROOT NEW_OUTPUT required");
  const raw = readFileSync(inputPath); need(raw.length < 1024 ** 2, "Input bound");
  const result = generate(JSON.parse(raw), fileReader(evidenceRoot));
  mkdirSync(output, { recursive: false, mode: 0o700 });
  writeFileSync(join(output, "generation-intent.json"), JSON.stringify({ inputSha256: hash(raw), once: true, sourceOnly: true, accepted: false }), { flag: "wx", mode: 0o600 });
  mkdirSync(join(output, result.proposal.role), { recursive: false, mode: 0o700 });
  for (const [name, bytes] of Object.entries(result.files)) writeFileSync(join(output, name), bytes, { flag: "wx", mode: 0o600 });
  writeFileSync(join(output, "fixtures-review-required.json"), JSON.stringify(result.proposal, null, 2) + "\n", { flag: "wx", mode: 0o600 });
  process.stdout.write(JSON.stringify({ sourceOnly: true, accepted: false, fixtureCount: result.proposal.fixtures.length }) + "\n");
}
