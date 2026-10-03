import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import vm from "node:vm";

const workflow = readFileSync(
  new URL("../.github/workflows/ci.yml", import.meta.url),
  "utf8",
).replaceAll("\r\n", "\n");
const job = workflow.slice(workflow.indexOf("  llvm-configure-diagnostic:"));
const recipe = readFileSync(
  new URL("./build-llvm-runtime.sh", import.meta.url),
);
const pins = readFileSync(
  new URL("./runtime-vendor-sources.json", import.meta.url),
);
const dockerfile = readFileSync(new URL("../Dockerfile.api", import.meta.url));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("both runtime configurations preserve the maintained PERF component and unchanged ABI gates", () => {
  const text = recipe.toString("utf8").replaceAll("\r\n", "\n");
  const functionStart = text.indexOf("configure_llvm() {");
  const functionEnd = text.indexOf("\n}", functionStart);
  assert.ok(functionStart >= 0 && functionEnd > functionStart);
  assert.match(text.slice(functionStart, functionEnd), /-DLLVM_ENABLE_LIBPFM=ON -DLLVM_USE_PERF=ON/);
  assert.match(text, /grep -Fx 'LLVM_USE_PERF:BOOL=ON' "\$build_dir\/CMakeCache.txt"/);
  assert.match(text, /grep -Fx '#define LLVM_USE_PERF 1' "\$build_dir\/include\/llvm\/Config\/llvm-config.h"/);
  assert.match(text, /assert\.equal\(relevant\.filter\(entry => entry\.file === '\/build\/llvm-source\/llvm\/lib\/ExecutionEngine\/PerfJITEvents\/PerfJITEventListener\.cpp'\)\.length, 1/);
  assert.match(text, /verify_llvm_configuration release \/build\/llvm-build OFF ON/);
  assert.match(text, /verify_llvm_configuration assertions \/build\/llvm-assert-build ON OFF/);
  assert.equal((text.match(/node \/build\/scripts\/check-llvm-package\.mjs/g) ?? []).length, 3);
  assert.match(text, /timeout 1800 cmake --build \/build\/llvm-build --parallel "\$native_jobs" --target check-llvm-unit/);
  assert.match(text, /timeout 7200 cmake --build \/build\/llvm-assert-build --parallel "\$native_jobs" --target check-llvm-unit/);
});

test("LLVM diagnostic is manual opt-in, isolated read-only and explicitly bounded", () => {
  assert.ok(workflow.includes("  llvm-configure-diagnostic:"));
  assert.match(
    workflow,
    /workflow_dispatch:\n\s+inputs:\n\s+llvm_configure_only:\n\s+description: [^\n]+\n\s+type: boolean\n\s+required: false\n\s+default: false/,
  );
  assert.match(
    job,
    /if: \$\{\{ github.event_name == 'workflow_dispatch' && inputs.llvm_configure_only == true \}\}/,
  );
  assert.match(
    job,
    /runs-on: ubuntu-latest\n\s+timeout-minutes: 15\n\s+permissions:\n\s+contents: read\n\s+steps:/,
  );
  assert.match(
    job,
    /actions\/checkout@v7\n\s+with:\n\s+persist-credentials: false/,
  );
  assert.doesNotMatch(
    job,
    /secrets\.|id-token:|contents: write|aws |aws-actions|docker login|docker push|docker run|upload-artifact|kubectl|prisma migrate/i,
  );
  assert.match(
    job,
    /timeout --signal=TERM --kill-after=15s 750s docker build --progress=plain --target llvm-configure-only -f Dockerfile.api/,
  );
  assert.doesNotMatch(
    job,
    /docker build[^\n]*(?:--target llvm-build\b|--cache|build-arg)/,
  );
  assert.match(job, /git rev-parse HEAD\)" = "\$GITHUB_SHA"/);
  assert.match(job, /available_kib < 8388608/);
  assert.doesNotMatch(job, /rm -rf|apt-get|find [^\n]*-delete/);
  assert.match(job, /tail -c 8192 "\$diagnostic_dir\/build.log"/);
});

test("receipt extraction never runs the diagnostic container and cleanup is restricted to its owned ID", () => {
  assert.match(job, /container_id=\n/);
  assert.match(
    job,
    /if \[\[ "\$container_id" =~ \^\[a-f0-9\]\{64\}\$ \]\]; then\n\s+timeout 20s docker rm -f "\$container_id" >\/dev\/null/,
  );
  assert.match(job, /trap cleanup EXIT/);
  assert.match(
    job,
    /container_id=\$\(timeout 30s docker create "\$diagnostic_image"\)/,
  );
  assert.match(job, /\[\[ "\$container_id" =~ \^\[a-f0-9\]\{64\}\$ \]\]/);
  assert.match(
    job,
    /timeout 30s docker cp "\$container_id:\/build\/llvm-configure-only-measurement.json" "\$diagnostic_dir\/measurement.json"/,
  );
  assert.doesNotMatch(
    job,
    /docker (?:start|exec|run|system|image prune|container prune)/,
  );
  assert.match(
    job,
    /executionEnvironment: 'github-hosted-linux-diagnostic-not-codebuild'/,
  );
  assert.match(job, /deploymentAcceptance: false/);
});

const receiptSource = job
  .match(
    /node - "\$diagnostic_dir\/measurement.json" <<'NODE'\n([\s\S]*?)\n {10}NODE/,
  )?.[1]
  .replace(/^ {10}/gm, "");
function fixtureReceipt() {
  return {
    schemaVersion: 1,
    purpose: "llvm-configure-only-measurement",
    mode: "configure-only",
    elapsedSeconds: 45,
    boundedCompilerJobs: 1,
    diskAvailableBytes: "10000000000",
    diskTotalBytes: "80000000000",
    recipeSha256: sha256(recipe),
    sourceManifestSha256: sha256(
      JSON.stringify({ llvm: JSON.parse(pins).llvm }, null, 2) + "\n",
    ),
    releaseCacheSha256: "a".repeat(64),
    assertionsCacheSha256: "b".repeat(64),
    graphs: {
      release: {
        scheduledCommands: 4500,
        compilationCommands: 4000,
        acceptance: false,
      },
      assertions: {
        scheduledCommands: 4300,
        compilationCommands: 3800,
        acceptance: false,
      },
    },
    compileAcceptance: false,
    unitAcceptance: false,
    candidateAbiAcceptance: false,
    packageCreated: false,
    runtimeAcceptance: false,
    authenticatedAcceptance: false,
  };
}
function runReceipt(
  receipt,
  { bytes = Buffer.from(JSON.stringify(receipt)), environment = {} } = {},
) {
  assert.ok(receiptSource, "Actual workflow receipt validator required");
  const files = new Map([
    ["synthetic-measurement.json", bytes],
    ["scripts/build-llvm-runtime.sh", recipe],
    ["scripts/runtime-vendor-sources.json", pins],
    ["Dockerfile.api", dockerfile],
  ]);
  const output = [];
  vm.runInNewContext(
    receiptSource,
    {
      Buffer,
      process: {
        argv: ["node", "-", "synthetic-measurement.json"],
        env: {
          GITHUB_SHA: "c".repeat(40),
          GITHUB_RUN_ID: "123",
          GITHUB_RUN_ATTEMPT: "1",
          ...environment,
        },
      },
      require: (name) => {
        if (name === "node:assert/strict") return assert;
        if (name === "node:crypto") return { createHash };
        assert.equal(
          name,
          "node:fs",
          "Validator cannot access additional capabilities",
        );
        return {
          statSync: (path) => ({ size: files.get(path).length }),
          readFileSync: (path, encoding) => {
            assert.ok(files.has(path));
            return encoding
              ? files.get(path).toString(encoding)
              : files.get(path);
          },
        };
      },
      console: { log: (line) => output.push(line) },
    },
    { timeout: 1000 },
  );
  return output;
}

test("actual workflow validator binds fixture receipts to source identity without claiming runtime", () => {
  const output = runReceipt(fixtureReceipt());
  assert.equal(output.length, 1);
  assert.ok(Buffer.byteLength(output[0]) <= 12350);
  assert.ok(output[0].startsWith("VAETTIR_GITHUB_LLVM_CONFIG_DIAGNOSTIC="));
  const parsed = JSON.parse(output[0].split("=").slice(1).join("="));
  assert.equal(
    parsed.provenance.executionEnvironment,
    "github-hosted-linux-diagnostic-not-codebuild",
  );
  assert.equal(parsed.provenance.deploymentAcceptance, false);
  assert.equal(parsed.provenance.checkoutSha, "c".repeat(40));
  assert.equal(parsed.provenance.dockerfileSha256, sha256(dockerfile));
  assert.equal(parsed.measurement.runtimeAcceptance, false);
});

test("actual workflow validator rejects acceptance claims, mismatched source, malformed counts and oversized logs", () => {
  for (const key of [
    "compileAcceptance",
    "unitAcceptance",
    "candidateAbiAcceptance",
    "packageCreated",
    "runtimeAcceptance",
    "authenticatedAcceptance",
  ])
    assert.throws(() => runReceipt({ ...fixtureReceipt(), [key]: true }));
  for (const override of [
    { mode: "complete" },
    { purpose: "runtime" },
    { recipeSha256: "f".repeat(64) },
    { sourceManifestSha256: "f".repeat(64) },
    { releaseCacheSha256: "not-a-hash" },
    { elapsedSeconds: 751 },
    { boundedCompilerJobs: 13 },
    { diskAvailableBytes: "unknown" },
    {
      graphs: {
        release: {
          scheduledCommands: 4000,
          compilationCommands: 1,
          acceptance: false,
        },
        assertions: fixtureReceipt().graphs.assertions,
      },
    },
    {
      graphs: {
        ...fixtureReceipt().graphs,
        release: { ...fixtureReceipt().graphs.release, acceptance: true },
      },
    },
  ])
    assert.throws(() => runReceipt({ ...fixtureReceipt(), ...override }));
  assert.throws(() =>
    runReceipt(fixtureReceipt(), { bytes: Buffer.from("{") }),
  );
  assert.throws(() =>
    runReceipt(fixtureReceipt(), { bytes: Buffer.alloc(8193) }),
  );
  assert.throws(() =>
    runReceipt(fixtureReceipt(), { environment: { GITHUB_SHA: "main" } }),
  );
});
