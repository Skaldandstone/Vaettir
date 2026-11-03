import test from "node:test";
import assert from "node:assert/strict";
import { fixture } from "./test-fixtures.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
import { exactDelta } from "../production-native-successor-v1/inventory.mjs";
import {
  sourceAdmission,
  validateApplicationLedger,
  staticAdmission,
  completeImage,
} from "./admission.mjs";
import { validatePlan, safePath } from "./apply-application.mjs";
import { builderRecipe, validateToolchainFiles } from "./build-context.mjs";
import { writeContext } from "./context.mjs";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("offline cache rows must match the complete toolchain image and empty workspace", () => {
  const row = {
    path: "/pnpm/store/content",
    type: "file",
    bytes: 3,
    sha256: "a".repeat(64),
  };
  validateToolchainFiles([row], [row]);
  assert.throws(() =>
    validateToolchainFiles([row], [{ ...row, sha256: "b".repeat(64) }]),
  );
  assert.throws(() =>
    validateToolchainFiles(
      [row, { path: "/vaettir-final-build/stale", type: "file" }],
      [row],
    ),
  );
  assert.throws(() => validateToolchainFiles([row], [row, row]));
});

function releaseFixture() {
  const f = fixture(),
    proof = f.put("review-proof", Buffer.from("synthetic source review")),
    proofTree = f.put("review-tree", { files: [proof] });
  const io = {
    read: f.io.read,
    source: f.io.source,
    native: f.io,
    nativePolicy: f.policy,
    nativeFiles: [],
    operatorFiles: [],
    inherited: () => Buffer.alloc(0),
  };
  const policy = {
    purpose: "final-application-release/v1",
    requiredRepairPr: 111,
    nativeFiles: [],
    inherited: [],
  };
  const b = { purpose: policy.purpose, nativeBindings: f.bindings };
  const repair = {
    accepted: true,
    independentReview: true,
    scope: "NORMAL_MERGED_REPAIR",
    pr: 111,
    head: "3".repeat(40),
    merge: "1".repeat(40),
    parents: ["1".repeat(40), "3".repeat(40)],
    tree: "2".repeat(40),
    proofTree,
  };
  b.repairAcceptance = f.put("repair", repair);
  b.operatorManifest = f.put("final-manifest", { files: [] });
  b.operatorApproval = f.put("operator-review", {
    accepted: true,
    independentReview: true,
    scope: "FINAL_APPLICATION_OPERATOR_SOURCE",
    manifestSha256: b.operatorManifest.sha256,
    proofTree,
  });
  return { ...f, b, policy, io, repair, proofTree };
}
test("final admission requires actual final main source and normally merged repair", () => {
  const f = releaseFixture();
  assert.equal(sourceAdmission(f.b, f.policy, f.io).releaseAccepted, false);
});
for (const [name, change] of [
  [
    "null final source",
    (f) => {
      f.b.nativeBindings.source.commit = null;
    },
  ],
  [
    "pending main CI",
    (f) => {
      const ref = f.b.nativeBindings.source.mainCiReceipt;
      const c = JSON.parse(f.io.read(ref.path));
      c.conclusion = "IN_PROGRESS";
      f.b.nativeBindings.source.mainCiReceipt = f.put(ref.path, c);
    },
  ],
  [
    "missing repair",
    (f) => {
      f.b.repairAcceptance = null;
    },
  ],
  [
    "wrong PR",
    (f) => {
      f.repair.pr = 110;
      f.b.repairAcceptance = f.put("repair", f.repair);
    },
  ],
  [
    "squash instead of two-parent repair",
    (f) => {
      f.repair.parents = ["1".repeat(40)];
      f.b.repairAcceptance = f.put("repair", f.repair);
    },
  ],
  [
    "changed operator bytes",
    (f) => {
      f.io.operatorFiles = [{ path: "different" }];
    },
  ],
  [
    "changed frozen native package",
    (f) => {
      f.policy.nativeFiles = [
        { path: "missing", sha256: "a".repeat(64), bytes: 1 },
      ];
    },
  ],
  [
    "changed inherited materializer",
    (f) => {
      f.policy.inherited = [
        { path: "original", sha256: "a".repeat(64), bytes: 1 },
      ];
    },
  ],
  [
    "missing full parent content",
    (f) => {
      f.b.nativeBindings.baseline.api.ociAcceptance = null;
    },
  ],
  [
    "missing schema111 recovery",
    (f) => {
      f.b.nativeBindings.review.migrationCompatibilityProof = null;
    },
  ],
])
  test("final admission refuses " + name, () => {
    const f = releaseFixture();
    change(f);
    assert.throws(() => sourceAdmission(f.b, f.policy, f.io));
  });

const file = (path, content = "x") => ({
  path,
  type: "file",
  mode: 0o644,
  uid: 0,
  gid: 0,
  bytes: Buffer.byteLength(content),
  sha256: sha(Buffer.from(content)),
  links: 1,
});
function ledger(before, after, categories) {
  return {
    scope: "FINAL_APPLICATION_OVERLAY",
    accepted: true,
    independentReview: true,
    changes: exactDelta(before, after),
    categories,
  };
}
test("only exact application delta is composed and unrelated bytes survive", () => {
  const before = [file("/app/a"), file("/usr/lib/native")],
    after = [file("/app/a", "new"), file("/usr/lib/native")];
  assert.equal(
    validateApplicationLedger(
      before,
      after,
      ledger(before, after, { "/app/a": "application" }),
      ["/usr/lib/native"],
    ).length,
    1,
  );
});
for (const [name, path, native, category] of [
  [
    "native payload",
    "/app/node_modules/engine.node",
    ["/app/node_modules/engine.node"],
    "application",
  ],
  ["dpkg metadata", "/var/lib/dpkg/status", [], "application"],
  ["unexpected tmp cleanup", "/tmp/other", [], "observer-removal"],
  ["unknown category", "/app/a", [], "wildcard"],
])
  test("application ledger refuses " + name, () => {
    const before = [file(path)],
      after = category === "observer-removal" ? [] : [file(path, "changed")];
    assert.throws(() =>
      validateApplicationLedger(
        before,
        after,
        ledger(before, after, { [path]: category }),
        native,
      ),
    );
  });
test("successful observer probe removal is exact-hash limited", () => {
  const p = "/tmp/vaettir-sqlite-overlay-v1/sqlite-runtime-regression",
    before = [file(p)],
    r = ledger(before, [], { [p]: "observer-removal" });
  assert.throws(() => validateApplicationLedger(before, [], r, [p]));
  assert.equal(
    validateApplicationLedger(before, [], r, [p], before[0].sha256).length,
    1,
  );
  assert.throws(() =>
    validateApplicationLedger(before, [], r, [p], "a".repeat(64)),
  );
});
test("application changes cannot alias a native hardlink group", () => {
  const before = [
      { ...file("/app/a"), links: 2, hardlinkGroup: "/usr/lib/native" },
    ],
    after = [file("/app/a", "b")];
  assert.throws(() =>
    validateApplicationLedger(
      before,
      after,
      ledger(before, after, { "/app/a": "application" }),
      ["/usr/lib/native"],
    ),
  );
});
test("unused review exceptions and modified delta refused", () => {
  const before = [file("/app/a")],
    after = [file("/app/a", "new")],
    r = ledger(before, after, {
      "/app/a": "application",
      "/app/b": "application",
    });
  assert.throws(() => validateApplicationLedger(before, after, r, []));
  delete r.categories["/app/b"];
  r.changes = [];
  assert.throws(() => validateApplicationLedger(before, after, r, []));
});
test("applicator refuses traversal, special modes, hardlinks and absent exclusive marker", () => {
  for (const p of [
    "/app/../etc/passwd",
    "/app/a/../../tmp/x",
    "/app/.local/a",
    "/var/lib/dpkg/status",
    "/app/a\\b",
  ])
    assert.equal(safePath(p), false);
  const marker = file("/app/.vaettir-final-application.json"),
    plan = {
      source: "1".repeat(40),
      changes: [{ path: marker.path, before: null, after: marker }],
    };
  validatePlan(plan);
  for (const change of [
    (p) => (p.changes = []),
    (p) => (p.changes[0].after.mode = 0o4755),
    (p) => (p.changes[0].after.links = 2),
  ]) {
    const p = structuredClone(plan);
    change(p);
    assert.throws(() => validatePlan(p));
  }
});
test("application build is offline and isolated from the original source path", () => {
  const image =
    "051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@sha256:" +
    "a".repeat(64);
  const recipe = builderRecipe("web", image, image, "1".repeat(40), [
    "scripts/build.sh",
  ]);
  assert.match(
    recipe,
    /COPY --chmod=0755 \["source\/scripts\/build.sh","\/vaettir-final-build\/scripts\/build.sh"\]/,
  );
  assert.doesNotMatch(recipe, /COPY --chmod=0755 source\/ \.\//);
  assert.match(recipe, /WORKDIR \/vaettir-final-build/);
  assert.match(
    recipe,
    /RUN --network=none pnpm install --offline --frozen-lockfile/,
  );
  assert.match(recipe, /retain-next-static-assets/);
  assert.match(recipe, /static-cohorts.json/);
  assert.match(recipe, /FROM scratch AS compiled_application_evidence/);
  assert.doesNotMatch(recipe, /apt-get|dpkg --install|docker login/);
});

test("Linux application symlinks validate on the Windows source host and cannot escape", () => {
  const marker = file("/app/.vaettir-final-application.json");
  const link = {
    path: "/app/node_modules/pkg",
    type: "symlink",
    mode: 0o777,
    uid: 0,
    gid: 0,
    target: ".pnpm/pkg",
  };
  const plan = {
    source: "1".repeat(40),
    changes: [
      { path: marker.path, before: null, after: marker },
      { path: link.path, before: null, after: link },
    ],
  };
  validatePlan(plan);
  link.target = "../../etc/passwd";
  assert.throws(() => validatePlan(plan));
});
test("static retention requires exactly three cohorts with exact files and order", () => {
  const f = releaseFixture(),
    after = [
      file("/app/apps/web/.next/static/a"),
      file("/app/apps/web/.next/static/b"),
      file("/app/apps/web/.next/static/c"),
    ];
  const cohorts = ["1", "2", "3"].map((v, i) => ({
    id: v.repeat(40),
    files: [
      {
        path: "_next/static/" + ["a", "b", "c"][i],
        sha256: after[i].sha256,
        bytes: 1,
      },
    ],
  }));
  const parent = f.put("parent-static", { cohorts: cohorts.slice(1) });
  const r = {
    scope: "THREE_COHORT_STATIC_RETENTION",
    accepted: true,
    independentReview: true,
    proofTree: f.proofTree,
    cohorts,
    parentCohorts: parent,
  };
  assert.equal(
    staticAdmission(f.put("static", r), "1".repeat(40), after, f.io.read)
      .cohorts.length,
    3,
  );
  assert.throws(() =>
    staticAdmission(
      f.put("static", { ...r, cohorts: cohorts.slice(0, 2) }),
      "1".repeat(40),
      after,
      f.io.read,
    ),
  );
  assert.throws(() =>
    staticAdmission(
      f.put("static", r),
      "1".repeat(40),
      [...after, file("/app/apps/web/.next/static/extra")],
      f.io.read,
    ),
  );
});
test("a boolean full OCI assertion without archive/content proofs is refused", () => {
  const f = releaseFixture(),
    ref = f.put("oci", {
      scope: "COMPLETE_IMMUTABLE_IMAGE",
      accepted: true,
      independentReview: true,
      proofTree: f.proofTree,
      completeContent: true,
    });
  assert.throws(() => completeImage(ref, "api", f.io.read));
});
test("exclusive context writer preserves partial/original output on attempted replay", () => {
  const parent = mkdtempSync(join(tmpdir(), "vaettir-source-contract-")),
    out = join(parent, "context");
  writeContext(out, {
    "plan.json": Buffer.from("original"),
    "blobs/a": Buffer.from("payload"),
  });
  assert.throws(() =>
    writeContext(out, { "plan.json": Buffer.from("replacement") }),
  );
  assert.equal(readFileSync(join(out, "plan.json")).toString(), "original");
  // Deliberately retained synthetic source fixture; no recursive cleanup.
});
test("real preparation CLI refuses null final bindings without creating output", () => {
  const parent = mkdtempSync(join(tmpdir(), "vaettir-null-source-")),
    out = join(parent, "absent");
  const run = spawnSync(
    process.execPath,
    [
      resolve("scripts/final-application-release-v1/context.mjs"),
      "prepare",
      resolve("scripts/final-application-release-v1/bindings.template.json"),
      parent,
      process.cwd(),
      "api",
      out,
    ],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.notEqual(run.status, 0);
  assert.equal(existsSync(out), false);
});
