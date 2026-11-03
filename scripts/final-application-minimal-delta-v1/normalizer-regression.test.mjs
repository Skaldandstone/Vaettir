import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha } from "../production-native-successor-v1/contracts.mjs";
import { validateApplicationLedger } from "../final-application-release-v1/admission.mjs";
import {
  normalizeInventory,
  normalizeCohorts,
  staticProposal,
  applicationPlan,
} from "./normalize.derived.mjs";
import {
  deriveBuildAdapter,
  deriveWebController,
  stageEvidenceRecipe,
  validateCacheRole,
  replaceExact,
  classifyApplicationCandidate,
} from "../final-application-producers-v1/adapters.mjs";
import { deriveProbe } from "../final-application-producers-v1/derive-probes.mjs";
import { assertProbeEnvironment, assertSubset } from "../final-application-producers-v1/probe-guard.mjs";
import {
  here,
  policy,
  checkFrozen,
  admitProducerSource,
} from "../final-application-producers-v1/admission.mjs";
import { nativeMagic, payloadForPlan } from "./output-producer.mjs";
const source = "a".repeat(40),
  tree = "b".repeat(40),
  hash = "c".repeat(64),
  img = (role) =>
    `051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-${role}@sha256:${hash}`;
const raw = (path, type = "0", extra = {}) => ({
  path,
  type,
  mode: 420,
  uid: 0,
  gid: 0,
  ...(type === "0" ? { size: 1, sha256: hash } : {}),
  ...extra,
});
const dir = (path) => ({ path, type: "directory", mode: 493, uid: 0, gid: 0 });
const file = (path) => ({
  path,
  type: "file",
  mode: 420,
  uid: 0,
  gid: 0,
  bytes: 1,
  sha256: hash,
  links: 1,
});
function planInput(role = "api") {
  const paths = [
    "apps/api/dist",
    "apps/api/node_modules",
    "packages",
    "node_modules",
  ];
  const output = paths.map((p) => dir("/application/" + p));
  output.push(
    ...[
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "apps/api/package.json",
    ].map((p) => file("/application/" + p)),
    file("/application/apps/api/dist/main.js"),
  );
  return {
    role,
    source,
    tree,
    before: [
      dir("/app"),
      dir("/app/apps"),
      dir("/app/apps/api"),
      file("/usr/lib/native.so"),
      dir("/vaettir-sqlite-observation-v1"),
      file("/vaettir-sqlite-observation-v1/raw.json"),
    ],
    output,
    ownership: { path: "/app", uid: 0, gid: 0 },
    nativePaths: ["/usr/lib/native.so"],
    probeSha256: hash,
  };
}
test("normalizes full inventory hardlinks without flattening inode custody", () => {
  const rows = normalizeInventory([
    raw("a"),
    raw("b", "1", { link: "a" }),
    raw("dir", "5"),
    raw("link", "2", { link: "a" }),
  ]);
  assert.equal(rows[0].links, 2);
  assert.equal(rows[1].hardlinkGroup, "/a");
  assert.equal(rows[3].target, "a");
});
for (const [name, rows] of [
  ["traversal", [raw("../a")]],
  ["duplicate", [raw("a"), raw("a")]],
  ["cycle", [raw("a", "1", { link: "b" }), raw("b", "1", { link: "a" })]],
  ["missing target", [raw("a", "1", { link: "b" })]],
  ["mode inconsistency", [raw("a"), raw("b", "1", { link: "a", mode: 493 })]],
  ["missing uid", [raw("a", "0", { uid: undefined })]],
  ["device", [raw("a", "3")]],
])
  test("inventory refuses " + name, () =>
    assert.throws(() => normalizeInventory(rows)),
  );
test("application maps real compiled subtree and retains native bytes", () => {
  const r = applicationPlan(planInput());
  assert.deepEqual(
    r.after.find((r) => r.path === "/usr/lib/native.so"),
    file("/usr/lib/native.so"),
  );
  assert.ok(r.after.some((r) => r.path === "/app/apps/api/dist/main.js"));
  assert.ok(
    !r.after.some((r) => r.path.startsWith("/vaettir-sqlite-observation-v1")),
  );
  assert.equal(r.ledger.accepted, false);
  assert.equal(r.ledger.independentReview, false);
  assert.throws(() =>
    validateApplicationLedger(
      r.before,
      r.after,
      r.ledger,
      ["/usr/lib/native.so"],
      hash,
    ),
  );
  assert.deepEqual(
    validateApplicationLedger(
      r.before,
      r.after,
      { ...r.ledger, accepted: true, independentReview: true },
      ["/usr/lib/native.so"],
      hash,
    ),
    r.ledger.changes,
  );
});
test("missing compiled root is terminal", () => {
  const x = planInput();
  x.output.pop();
  x.output = x.output.filter((r) => r.path !== "/application/packages");
  assert.throws(() => applicationPlan(x));
});
test("native changes are not self-approved", () => {
  const x = planInput();
  x.nativePaths.push("/app/apps/api/dist/main.js");
  assert.throws(() => applicationPlan(x));
});
test("new application marker refuses replay", () => {
  const x = planInput();
  x.before.push(file("/app/.vaettir-final-application.json"));
  assert.throws(() => applicationPlan(x));
});
test("changed hardlink refuses rather than silently breaking inode identity", () => {
  const x = planInput();
  x.output.at(-1).links = 2;
  x.output.at(-1).hardlinkGroup = "/application/shared";
  assert.throws(() => applicationPlan(x));
});
test("application symlink cannot escape app", () => {
  const x = planInput();
  x.output.push({
    path: "/application/apps/api/dist/bad",
    type: "symlink",
    mode: 511,
    uid: 0,
    gid: 0,
    target: "../../../../../etc",
  });
  assert.throws(() => applicationPlan(x));
});
test("ownership must be observed in exact stage", () => {
  const x = planInput();
  x.ownership.uid = 1001;
  assert.throws(() => applicationPlan(x));
});
test("native magic identifies added ELF, PE and Mach-O payload", () => {
  for (const b of [
    Buffer.from([127, 69, 76, 70]),
    Buffer.from("MZxx"),
    Buffer.from("feedfacf", "hex"),
  ])
    assert.equal(nativeMagic(b), true);
  assert.equal(nativeMagic(Buffer.from("javascript")), false);
});
test("payload reads exact exported bytes and rejects content substitution or a new native file", () => {
  const x = planInput(),
    content = Buffer.from("x");
  x.output.forEach((r) => {
    if (r.type === "file") r.sha256 = sha(content);
  });
  const p = applicationPlan(x),
    markerRef = {
      path: "new/marker",
      bytes: p.marker.length,
      sha256: sha(p.marker),
    },
    read = () => content;
  const rows = payloadForPlan(p, x.output, "export", read, markerRef);
  assert.equal(rows.length, 6);
  assert.equal(
    rows.filter((r) => r.ref.path.startsWith("export/application/")).length,
    5,
  );
  assert.throws(() =>
    payloadForPlan(p, x.output, "export", () => Buffer.from("y"), markerRef),
  );
  assert.throws(() =>
    payloadForPlan(p, x.output, "../escape", read, markerRef),
  );
  assert.throws(() =>
    payloadForPlan(p, x.output, "export", read, { ...markerRef, sha256: hash }),
  );
  const elf = Buffer.from([127, 69, 76, 70]),
    y = planInput();
  y.output.forEach((r) => {
    if (r.type === "file")
      Object.assign(r, { sha256: sha(elf), bytes: elf.length });
  });
  const q = applicationPlan(y);
  assert.throws(() =>
    payloadForPlan(q, y.output, "export", () => elf, {
      path: "new/marker",
      bytes: q.marker.length,
      sha256: sha(q.marker),
    }),
  );
});
test("Web standalone maps real server, public and retained static output with observed nextjs ownership", () => {
  const x = planInput("web");
  x.before = x.before.map((r) =>
    r.path === "/app" ? { ...r, uid: 1001, gid: 1001 } : r,
  );
  x.ownership = { path: "/app", uid: 1001, gid: 1001 };
  x.output = [
    dir("/application/apps/web/.next/standalone"),
    dir("/application/apps/web/.next/standalone/apps"),
    dir("/application/apps/web/.next/standalone/apps/web"),
    dir("/application/apps/web/.next/standalone/apps/web/.next"),
    file("/application/apps/web/.next/standalone/apps/web/server.js"),
    dir("/application/apps/web/.next/standalone/node_modules"),
    dir("/application/apps/web/.next/static"),
    file("/application/apps/web/.next/static/x.js"),
    file("/application/apps/web/.next/static-cohorts.json"),
    dir("/application/apps/web/public"),
  ];
  const p = applicationPlan(x);
  assert.equal(
    p.after.find((r) => r.path === "/app/apps/web/server.js").uid,
    1001,
  );
  assert.ok(p.after.some((r) => r.path === "/app/apps/web/.next/static/x.js"));
  assert.equal(p.ledger.accepted, false);
});
const cohort = (id, path) => ({ id, files: [{ path, size: 1, sha256: hash }] });
test("normalizes exact current plus two retained cohorts with complete file union", () => {
  const parent = {
    version: 1,
    cohorts: [
      cohort("b".repeat(40), "old.js"),
      cohort("c".repeat(40), "older.js"),
    ],
  };
  const raw = {
      version: 1,
      cohorts: [cohort(source, "new.js"), ...parent.cohorts],
    },
    after = ["new.js", "old.js", "older.js"].map((p) =>
      file("/app/apps/web/.next/static/" + p),
    );
  const r = staticProposal(raw, parent, source, after);
  assert.equal(r.proposal.accepted, false);
  assert.equal(r.parent.cohorts[0].files[0].path, "_next/static/old.js");
  assert.throws(() => staticProposal(raw, parent, source, after.slice(1)));
  assert.throws(() =>
    staticProposal(raw, parent, source, [
      ...after,
      file("/app/apps/web/.next/static/extra.js"),
    ]),
  );
  assert.throws(() =>
    staticProposal(
      { ...raw, cohorts: [raw.cohorts[0], ...parent.cohorts.toReversed()] },
      parent,
      source,
      after,
    ),
  );
});
test("cohort path traversal and empty membership fail", () => {
  assert.throws(() =>
    normalizeCohorts({ version: 1, cohorts: [cohort(source, "../bad")] }),
  );
  assert.throws(() =>
    normalizeCohorts({ version: 1, cohorts: [{ id: source, files: [] }] }),
  );
});
test("cache source-role review is separate from compilation role", () => {
  const item = { cacheSourceRole: "api", imageAcceptance: { sha256: hash } },
    review = {
      compilationTargetRole: "web",
      cacheSourceRole: "api",
      completeImageAcceptanceSha256: hash,
    };
  validateCacheRole(review, item, "web", { image: img("api") });
  assert.throws(() =>
    validateCacheRole({ ...review, cacheSourceRole: "web" }, item, "web", {
      image: img("api"),
    }),
  );
  assert.throws(() =>
    validateCacheRole(review, item, "web", { image: img("web") }),
  );
  assert.throws(() =>
    validateCacheRole(review, { ...item, cacheSourceRole: "other" }, "web", {
      image: img("api"),
    }),
  );
});
test("narrow build adapter preserves recipe and full-image/cache gates", () => {
  const r = deriveBuildAdapter();
  assert.match(
    r.code,
    /completeImage\(item.imageAcceptance, item.cacheSourceRole/,
  );
  assert.match(r.code, /validateCacheRole\(review, item, role, toolchain\)/);
  assert.match(r.code, /normalizeInventory\(completeInventoryRef/);
  assert.match(r.code, /sourceAdmission\(b, policy, io\)/);
  assert.match(r.code, /admitProducerSource\(b.producers/);
  assert.match(r.code, /--offline --frozen-lockfile/);
  assert.equal(r.finalRuntimeRoleChecksChanged, false);
  assert.throws(() => replaceExact("x", "y", "z"));
});
test("stage extraction contains only immutable FROM and retained COPY, no RUN", () => {
  const r = stageEvidenceRecipe(img("api"), "api");
  assert.equal(r.trim().split("\n").length, 3);
  assert.doesNotMatch(r, /RUN|sqlite.deb|transaction.mjs/);
  assert.throws(() => stageEvidenceRecipe(img("web"), "api"));
  assert.throws(() =>
    stageEvidenceRecipe(img("api").replace("@sha256:", ":"), "api"),
  );
});
test("final application classification overrides inherited stage labels without claiming acceptance", () => {
  const original = Buffer.from(
    `FROM ${img("api")} AS final_application\nRUN --network=none actual-existing-applicator\nENV VAETTIR_RELEASE_COMMIT=${source}\n`,
  );
  const r = classifyApplicationCandidate({ Dockerfile: original }, source);
  assert.match(
    r.code,
    /artifact-purpose="final-application-runtime-candidate"/,
  );
  assert.match(r.code, /runtime-eligible="pending-acceptance"/);
  assert.equal(r.releaseAccepted, false);
  assert.equal(r.code.replace(/^LABEL.*\n/m, ""), original.toString());
  assert.throws(() =>
    classifyApplicationCandidate({ Dockerfile: Buffer.from(r.code) }, source),
  );
});
test("Web controller retains all actual 23 checks and changes identity only", () => {
  const r = deriveWebController(source, img("web"));
  assert.match(r.code, /assert.equal\(rows.length,23\)/);
  assert.match(r.code, /vaettir-ui-aaaaaaaa-fixture/);
  assert.equal(r.row.substitutions.length, 4);
  assert.throws(() => deriveWebController(source, img("api")));
  assert.throws(() =>
    deriveWebController(source, img("web"), Buffer.from("wrong")),
  );
});
for (const [role, count] of [
  ["plugin", 6],
  ["android", 5],
  ["import", 2],
])
  test(
    "derives actual compiled " + role + " PG assertions, never executes here",
    () => {
      const p = policy.testSources[role],
        r = deriveProbe(
          role,
          source,
          readFileSync(join(here, p.file)),
          p.sha256,
        );
      assert.equal(r.tests, count);
      assert.ok(r.retainedAssertions >= 10);
      assert.match(r.code, /await import\("@vaettir\/db"\)/);
      assert.match(r.code, /\.\/dist\//);
      assert.doesNotMatch(
        r.code,
        /vitest|skipIf|\.skip\(|\bexpect\(|assertDatabase|61199|localhost|127\.0\.0\.1/,
      );
      assert.equal(r.realDeviceAccepted, false);
      assert.equal(r.packagedMcpTransportAccepted, false);
      if (role === "plugin") {
        assert.match(r.code, /await import\("fastify"\)/);
        assert.match(
          r.code,
          /await import\("\.\/dist\/services\/aiDisclosureRoute.js"\)/,
        );
      }
      assert.throws(() =>
        deriveProbe(role, source, Buffer.from("wrong"), p.sha256),
      );
    },
  );
test("runtime guard requires exact source-owned DB and absent credentials", () => {
  const env = {
    NODE_ENV: "production",
    VAETTIR_RELEASE_COMMIT: source,
    VAETTIR_IMAGE_DIGEST: "sha256:" + hash,
    DATABASE_URL: `postgresql://oauth_test:synthetic-local-only@vaettir-review111-images-${source.slice(0, 12)}-release-pg:5432/vaettir_case_review111_android?connection_limit=5`,
  };
  assertProbeEnvironment(env, "linux", "/app/apps/api", source, "android");
  for (const change of [
    { DATABASE_URL: env.DATABASE_URL + "&host=remote" },
    { VAETTIR_RELEASE_COMMIT: tree },
    { AWS_SESSION_TOKEN: "x" },
    { NODE_ENV: "development" },
  ])
    assert.throws(() =>
      assertProbeEnvironment(
        { ...env, ...change },
        "linux",
        "/app/apps/api",
        source,
        "android",
      ),
    );
  assert.throws(() =>
    assertProbeEnvironment(env, "win32", "/app/apps/api", source, "android"),
  );
});
test("partial assertion preserves nested keys, values and array length", () => {
  assertSubset({ a: { b: 1, c: 2 }, x: 3 }, { a: { b: 1 } });
  assert.throws(() => assertSubset({ a: [] }, { a: [1] }));
  assert.throws(() => assertSubset({ a: { b: 2 } }, { a: { b: 1 } }));
  assert.throws(() => assertSubset({}, { a: undefined }));
});
test("source admission refuses missing independent producer review before output", () => {
  assert.throws(() =>
    admitProducerSource(null, () => {
      throw Error("missing");
    }),
  );
});
test("all 47 frozen source rows remain unchanged", () => checkFrozen());
