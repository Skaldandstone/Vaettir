import { companionRuntime } from "./applicability.mjs";
// A proof-index generator, not a release approver or ECS operator.
import {
  jsonRef,
  readRef,
  verifyTree,
  requireThat as ok,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
import { gate, actualIo, here, encode } from "./release-context.derived.mjs";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { completeImage, accepted } from "./release-admission.derived.mjs";
export function runtimeIndex(b, policy, io) {
  const api = gate(b, policy, "runtime", "api", io),
    web = gate(b, policy, "runtime", "web", io),
    refs = b.runtime.results;
  const source = api.source;
  ok(source === web.source, "Mixed source runtime proof");
  for (const role of ["api", "web"]) {
    const full = completeImage(refs[role + "Image"], role, io.read);
    ok(
      full.image.endsWith(
        "@" + (role === "api" ? api : web).component.imageDigest,
      ),
      "Different materialized runtime image",
    );
  }
  const a = jsonRef(refs.api, io.read),
    w = jsonRef(refs.web, io.read),
    extra = jsonRef(refs.additional, io.read);
  verifyTree(refs.proofTree, io.read);
  ok(
    a.source === source &&
      a.schema === 111 &&
      a.actualImage.endsWith("@" + api.component.imageDigest),
    "Wrong API/source/schema",
  );
  ok(
    a.compiled42Tests.tests === 42 &&
      a.compiled42Tests.passed === 42 &&
      a.compiled42Tests.failed === 0 &&
      a.compiled42Tests.skipped === 0,
    "Actual API42 proof missing",
  );
  ok(
    a.normalDisabledAndUnknownConfigurations.length === 3 &&
      a.sameDigestAllConfigurations === true &&
      a.sevenWorkersAllConfigurations === true &&
      a.externalProviderCalls === 0,
    "Missing runtime modes/workers",
  );
  const modes = new Set();
  for (const mode of a.normalDisabledAndUnknownConfigurations) {
    modes.add(mode.configuration);
    ok(
      mode.sameImmutableImage === a.actualImage &&
        mode.noOomOrRestart === true &&
        mode.noPublishedPortsOrMounts === true &&
        mode.startupAndWorkersPreservedCatalogsAndDrafts === true,
      "Incomplete isolated runtime observation",
    );
    ok(
      mode.health.release.commit === source &&
        mode.health.release.imageDigest === api.component.imageDigest &&
        mode.health.db.ok === true &&
        mode.health.pollers.length === 7 &&
        mode.health.pollers.every((x) => !x.stale),
      "Wrong runtime health",
    );
  }
  ok(
    ["enabled", "disabled", "invalid-nonempty-setting"].every((x) =>
      modes.has(x),
    ),
    "Missing refusal mode",
  );
  const rawLog = readRef(refs.api42Log, io.read),
    log = rawLog.toString();
  ok(
    sha(rawLog) === a.compiled42Tests.logSha256 &&
      /# tests 42\b/.test(log) &&
      /# pass 42\b/.test(log) &&
      /# fail 0\b/.test(log) &&
      /# skipped 0\b/.test(log),
    "API42 original log mismatch",
  );
  ok(
    w.sourceCommit === source &&
      w.imageDigest === web.component.imageDigest &&
      w.passed === true &&
      w.checks === 23 &&
      w.productionCredentialsUsed === false &&
      w.customerWrites === false,
    "Actual Web23 missing",
  );
  companionRuntime(b, source, api.component.imageDigest, web.component.imageDigest, io.read);
  const webLog = readRef(refs.webLog, io.read);
  ok(sha(webLog) === w.originalLogSha256, "Web original log mismatch");
  ok(
    extra.source === source &&
      extra.image === a.actualImage &&
      extra.schema === 111 &&
      extra.results.length === 3,
    "Additional compiled runtime proofs missing",
  );
  for (const [name, minimum] of Object.entries({
    plugin: 6,
    android: 5,
    import: 2,
  })) {
    const row = extra.results.find((x) => x.name === name);
    ok(
      row &&
        row.actualCompiledModules === true &&
        row.tests >= minimum &&
        row.tests === row.passed &&
        row.failed === 0 &&
        row.skipped === 0,
      "New route fixture not executed",
    );
    const raw = readRef(refs.additionalLogs[name], io.read);
    ok(
      sha(raw) === row.logSha256 &&
        new RegExp("# pass " + row.tests + "\\b").test(raw.toString()) &&
        /# skipped 0\b/.test(raw.toString()),
      "Additional original log mismatch",
    );
  }
  const recovery = accepted(refs.recovery, io.read, "SCHEMA111_RECOVERY");
  ok(
    recovery.source === source &&
      recovery.schema === 111 &&
      recovery.tenantWritesPreserved === true &&
      recovery.revokedAuthorityRefused === true,
    "Recovery evidence incomplete",
  );
  return {
    source,
    tree: api.tree,
    apiDigest: api.component.imageDigest,
    webDigest: web.component.imageDigest,
    proofReferences: refs,
    locallyVerifiedRuntimeProofsLinked: true,
    releaseAccepted: false,
    fullHostedAcceptance: false,
    fullProductionAcceptance: false,
    remaining: [
      "Main-reviewed current backup/schedule/alarm preflight",
      "Web-first rollout and stable-Web before API",
      "retired API traffic absent and compatible schema111 recovery",
      "hosted mapping/mobile/both themes/aTwist reload",
      "applicable feature/provider/device/owner acceptance",
    ],
  };
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [bindingPath, evidenceRoot, sourceRepo, output] = process.argv.slice(2);
  ok(output, "Expected BINDINGS EVIDENCE SOURCE NEW_INDEX");
  const raw = readFileSync(bindingPath);
  ok(raw.length <= 64 * 1024 ** 2, "Bindings too large");
  const result = runtimeIndex(
    JSON.parse(raw),
    JSON.parse(readFileSync(join(here, "policy.json"))),
    actualIo(evidenceRoot, sourceRepo),
  );
  writeFileSync(output, encode(result), { flag: "wx", mode: 0o600 });
}
