// Source generation only: reads pinned evidence, returns bytes and UNACCEPTED reviews.
// It does not execute the generated fixtures or invoke any native/child process.
import { hash, need, equal } from "./core.mjs";

export function checked(ref, read) {
  need(ref && typeof ref.path === "string" && /^[a-f0-9]{64}$/.test(ref.sha256) && Number.isSafeInteger(ref.bytes) && ref.bytes > 0 && ref.bytes < 16 * 1024 ** 2, "Bounded evidence ref required");
  const bytes = read(ref.path);
  need(Buffer.isBuffer(bytes) && bytes.length === ref.bytes && hash(bytes) === ref.sha256, "Evidence bytes changed: " + ref.path);
  return bytes;
}
const json = (r, read) => JSON.parse(checked(r, read));

export function planFor(role, policy, inputs, read) {
  need(["api", "web"].includes(role), "Exact role required");
  const pins = policy.roles[role], inventory = json(pins.inventory, read), acceptance = json(pins.acceptance, read);
  need(acceptance.scope === "COMPLETE_STAGE_NATIVE_INVENTORY" && acceptance.accepted === true && acceptance.independentReview === true && acceptance.inventorySha256 === pins.inventory.sha256 && acceptance.imageDigest === pins.stageDigest, "Unaccepted full stage inventory");
  need(inventory.length === pins.count && new Set(inventory.map(r => r.path)).size === inventory.length, "Incomplete/duplicate native inventory");
  const proof = json(policy.sqlite.proof, read), manifest = json(policy.sqlite.manifest, read), accepted = json(policy.sqlite.acceptance, read);
  need(accepted.standaloneNativeProofAccepted === true && accepted.proofSha256 === policy.sqlite.proof.sha256 && accepted.manifestSha256 === policy.sqlite.manifest.sha256 && accepted.probeSha256 === policy.sqlite.probe.sha256 && accepted.librarySha256 === policy.sqlite.librarySha256, "SQLite standalone custody differs");
  need(proof.sourceCommit === "2b721d3d9a3397d0e14da859ab517e71b4c0c48b" && proof.manifestSha256 === policy.sqlite.manifest.sha256 && proof.probeSha256 === policy.sqlite.probe.sha256 && proof.librarySha256 === policy.sqlite.librarySha256, "SQLite proof identity differs");
  const probe = checked(policy.sqlite.probe, read);
  need(proof.candidateExports.length === 353 && proof.candidate.options.length > 10 && proof.tests.length === 16 && proof.tests.every(t => t.count > 0), "Incomplete accepted SQLite proof");
  need(proof.candidate.version === manifest.version && proof.candidate.sourceId === manifest.sourceId, "Candidate identity differs");
  const control = checked(policy.sqlite.control, read).toString("utf8");
  need(control.includes("Depends: libc6 (>= 2.41)\n") && control.includes("Version: 3.54.1-0+vaettir1\n"), "Exact package dependency control required");
  const clean = r => ({ path: "/" + r.path, sha256: r.sha256, bytes: r.bytes, mode: r.mode, uid: r.uid, gid: r.gid, nativeKind: r.nativeKind });
  // This exact stage-only probe must be removed by the reviewed final overlay.
  const oldProbe = inventory.filter(r => r.path === "tmp/vaettir-sqlite-overlay-v1/sqlite-runtime-regression");
  need(oldProbe.length === 1 && oldProbe[0].sha256 === policy.sqlite.probe.sha256, "Unreviewed stage tool removal");
  const expected = inventory.filter(r => r !== oldProbe[0]).map(clean).sort((a, b) => a.path < b.path ? -1 : 1);
  for (const row of expected) {
    need(row.path.startsWith("/") && !row.path.includes("\\") && row.path.split("/").slice(1).every(c => c && c !== "." && c !== ".."), "Unsafe inventory path");
    need(/^[a-f0-9]{64}$/.test(row.sha256) && Number.isSafeInteger(row.bytes) && row.bytes > 0 && row.bytes < 512 * 1024 ** 2 && Number.isInteger(row.uid) && Number.isInteger(row.gid), "Unbounded native row");
  }
  need(expected.reduce((n, r) => n + r.bytes, 0) < 3 * 1024 ** 3, "Native scan aggregate bound");
  let image = null, finalInventorySha256 = null;
  if (inputs.final !== null) {
    const f = inputs.final;
    need(f && /^sha256:[a-f0-9]{64}$/.test(f.imageDigest), "Final image required");
    const finalRows = json(f.inventory, read), review = json(f.review, read);
    equal(finalRows.map(clean).sort((a,b) => a.path < b.path ? -1 : 1), expected, "Final native bytes/metadata differ from exact stage minus tool");
    need(review.accepted === true && review.independentReview === true && review.inventorySha256 === f.inventory.sha256 && review.imageDigest === f.imageDigest && review.source === policy.source && review.completeFilesystem === true && review.stageInventorySha256 === pins.inventory.sha256, "Independent final inventory readmission required");
    image = `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-${role}@${f.imageDigest}`;
    finalInventorySha256 = f.inventory.sha256;
  }
  const library = expected.find(r => r.path === manifest.libraryPath);
  need(library?.sha256 === policy.sqlite.librarySha256, "Installed library differs");
  const direct = manifest.abiContract.consumers.filter(r => r.images.includes(role)).map(({ path, sha256, undefinedSQLiteSymbols }) => ({ path, sha256, undefinedSQLiteSymbols: [...undefinedSQLiteSymbols].sort() }));
  need(direct.length === (role === "api" ? 2 : 1) && direct.every(c => expected.some(r => r.path === c.path && r.sha256 === c.sha256)), "Pinned direct consumer absent");
  const engines = expected.filter(r => /prisma|query[_-]engine|schema[_-]engine/i.test(r.path));
  const prisma = { applicable: role === "api", engines, queryPath: policy.apiQueryPath, schemaPath: policy.apiSchemaPath };
  if (role === "api") need(engines.length === 6 && engines.some(r => r.path === prisma.queryPath) && engines.some(r => r.path === prisma.schemaPath), "API query/schema engine inventory changed");
  else need(engines.length === 0, "Web Prisma applicability changed");
  const browser = role === "api" ? { binary: expected.find(r => r.path === policy.apiBrowserPath), module: "/app/apps/api/node_modules/playwright" } : null;
  if (role === "api") need(browser.binary?.nativeKind === "ELF", "Pinned API browser absent");
  return { source: policy.source, image, role, nativeRows: expected, inventorySha256: pins.inventory.sha256, finalInventorySha256,
    sqlite: { library, probeBase64: probe.toString("base64"), probeSha256: policy.sqlite.probe.sha256, probeBytes: probe.length,
      version: manifest.version, sourceId: manifest.sourceId, packageVersion: manifest.packageVersion, depends: "libc6 (>= 2.41)",
      exports: proof.candidateExports, options: proof.candidate.options, consumers: direct }, prisma, browser };
}

export function render(plan, sources) {
  const imports = 'import { hash, need, equal, sorted, pinned, command, identity, begin, actualIO } from "./core.mjs";\nimport { elf } from "./elf.mjs";\n';
  need(sources.probes.startsWith(imports), "Fixture source derivation anchor changed");
  const bundle = [sources.core, sources.elf, sources.probes.slice(imports.length)].join("\n").replaceAll(/^export /gm, "");
  return Buffer.from(bundle + "\nconst PLAN = " + JSON.stringify(plan) + ";\nawait runFixture(PLAN);\n");
}

export function propose(role, policy, inputs, read, own) {
  // Own source bytes must be reviewed separately with every generated invocation.
  const sources = { core: own("core.mjs").toString(), elf: own("elf.mjs").toString(), probes: own("probes.mjs").toString() };
  const base = planFor(role, policy, inputs, read), names = role === "api" ? ["sqlite-installed", "sqlite-consumers", "browser", "prisma"] : ["sqlite-installed", "sqlite-consumers", "prisma"];
  const files = {}, fixtures = [];
  for (const name of names) {
    const bytes = render({ ...base, kind: name }, sources), path = `${role}/${name}.mjs`, argv = ["/usr/local/bin/node", `/run/vaettir-native/${name}.mjs`];
    files[path] = bytes;
    fixtures.push({ name, source: policy.source, script: { path, sha256: hash(bytes), bytes: bytes.length }, argv,
      reviewProposal: { accepted: false, sourceReviewed: false, scriptSha256: hash(bytes), argv, image: base.image, applicability: role === "web" && name === "prisma" ? "absent-needs-gate-successor" : "actual-probe-required" } });
  }
  return { files, proposal: { role, source: policy.source, image: base.image, fixtures, actualFinalImageRequired: base.image === null,
    accepted: false, nativeAccepted: false, runtimeAccepted: false, releaseAccepted: false,
    webBrowserAndPrismaGateSuccessorRequired: role === "web", fullDynamicLookupClosureReviewStillRequired: true } };
}
