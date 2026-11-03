import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { applicationPlan, sameRuntimeNode } from "./normalize.derived.mjs";
import { applicationPlan as previousPlan } from "../final-application-producers-v1/normalize.mjs";
import { payloadForPlan } from "./output-producer.mjs";
import { derive } from "./derive.mjs";
import { successorRoot, admitPosixInventorySource } from "./admission.mjs";
import { sha } from "../production-native-successor-v1/contracts.mjs";
const hash = sha(Buffer.from("x"));
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
function fixture() {
  const roots = [
    "apps/api/dist",
    "apps/api/node_modules",
    "packages",
    "node_modules",
  ];
  const files = [
    "package.json",
    "pnpm-lock.yaml",
    "pnpm-workspace.yaml",
    "apps/api/package.json",
    "apps/api/dist/main.js",
    "node_modules/dependency.js",
  ];
  const output = [
    ...roots.map((p) => dir("/application/" + p)),
    ...files.map((p) => file("/application/" + p)),
  ];
  const before = [
    dir("/app"),
    dir("/app/apps"),
    dir("/app/apps/api"),
    dir("/root"),
    dir("/root/store"),
    ...roots.map((p) => dir("/app/" + p)),
    ...files.map((p) => file("/app/" + p)),
    file("/root/store/dependency.js"),
  ];
  for (const path of [
    "/app/node_modules/dependency.js",
    "/root/store/dependency.js",
  ])
    Object.assign(
      before.find((r) => r.path === path),
      { links: 2, hardlinkGroup: "/app/node_modules/dependency.js" },
    );
  return {
    role: "api",
    source: "a".repeat(40),
    tree: "b".repeat(40),
    before,
    output,
    ownership: { path: "/app", uid: 0, gid: 0 },
    nativePaths: [],
    probeSha256: hash,
  };
}
test("identical dependency preserves full cross-root alias row and emits no inode writes", () => {
  const f = fixture();
  assert.throws(() => previousPlan(f));
  const p = applicationPlan(f);
  for (const path of [
    "/app/node_modules/dependency.js",
    "/root/store/dependency.js",
  ]) {
    const before = f.before.find((r) => r.path === path);
    assert.deepEqual(
      p.after.find((r) => r.path === path),
      before,
    );
    assert.ok(!p.ledger.changes.some((r) => r.path === path));
    assert.ok(!p.payloadSources.has(path));
  }
  assert.deepEqual(
    p.ledger.changes.map((r) => r.path),
    ["/app/.vaettir-final-application.json"],
  );
  assert.equal(
    payloadForPlan(
      p,
      f.output,
      "export",
      () => {
        throw Error("unchanged payload must not be read");
      },
      { path: "marker", sha256: sha(p.marker), bytes: p.marker.length },
    ).length,
    1,
  );
});
for (const [name, change] of [
  [
    "content",
    (f) =>
      (f.output.find((r) => r.path.endsWith("/dependency.js")).sha256 =
        "c".repeat(64)),
  ],
  [
    "size",
    (f) => (f.output.find((r) => r.path.endsWith("/dependency.js")).bytes = 2),
  ],
  [
    "mode",
    (f) => (f.output.find((r) => r.path.endsWith("/dependency.js")).mode = 493),
  ],
  [
    "uid",
    (f) =>
      (f.before.find((r) => r.path === "/app/node_modules/dependency.js").uid =
        1),
  ],
  [
    "gid",
    (f) =>
      (f.before.find((r) => r.path === "/app/node_modules/dependency.js").gid =
        1),
  ],
  [
    "type",
    (f) =>
      (f.output.find((r) => r.path.endsWith("/dependency.js")).type =
        "directory"),
  ],
  [
    "delete",
    (f) =>
      (f.output = f.output.filter((r) => !r.path.endsWith("/dependency.js"))),
  ],
])
  test("existing alias " + name + " change refuses", () => {
    const f = fixture();
    change(f);
    assert.throws(() => applicationPlan(f));
  });
test("new artifact hardlink refuses", () => {
  const f = fixture();
  f.output.push({
    ...file("/application/node_modules/new.js"),
    links: 2,
    hardlinkGroup: "/application/node_modules/dependency.js",
  });
  assert.throws(() => applicationPlan(f));
});
test("changed artifact hardlink refuses", () => {
  const f = fixture();
  Object.assign(
    f.output.find((r) => r.path.endsWith("/main.js")),
    {
      sha256: "c".repeat(64),
      links: 2,
      hardlinkGroup: "/application/node_modules/dependency.js",
    },
  );
  assert.throws(() => applicationPlan(f));
});
test("artifact-only alias grouping cannot replace a preserved existing inode", () => {
  const f = fixture();
  Object.assign(
    f.output.find((r) => r.path.endsWith("/dependency.js")),
    { links: 3, hardlinkGroup: "/application/node_modules/artifact-only.js" },
  );
  const p = applicationPlan(f);
  assert.deepEqual(
    p.after.find((r) => r.path === "/app/node_modules/dependency.js"),
    f.before.find((r) => r.path === "/app/node_modules/dependency.js"),
  );
});
test("unaliased changed and new generated JavaScript remain payload writes", () => {
  const f = fixture();
  f.output.find((r) => r.path.endsWith("/main.js")).sha256 = "c".repeat(64);
  f.output.push(file("/application/packages/prisma-generated.js"));
  const p = applicationPlan(f);
  assert.ok(p.payloadSources.has("/app/apps/api/dist/main.js"));
  assert.ok(p.payloadSources.has("/app/packages/prisma-generated.js"));
});
test("native content or metadata change remains forbidden", () => {
  for (const field of ["sha256", "mode"]) {
    const f = fixture();
    f.nativePaths = ["/app/apps/api/dist/main.js"];
    f.output.find((r) => r.path.endsWith("/main.js"))[field] =
      field === "sha256" ? "c".repeat(64) : 493;
    assert.throws(() => applicationPlan(f));
  }
});
test("identical native row may remain but new native payload bytes still refuse", () => {
  const f = fixture();
  f.nativePaths = ["/app/node_modules/dependency.js"];
  applicationPlan(f);
  const bytes = Buffer.from("MZxx");
  f.output.push({
    ...file("/application/packages/new.bin"),
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  const p = applicationPlan(f);
  assert.throws(() =>
    payloadForPlan(p, f.output, "export", () => bytes, {
      path: "marker",
      sha256: sha(p.marker),
      bytes: p.marker.length,
    }),
  );
});
test("symlink target comparison is exact and does not mask a target mutation", () => {
  const a = {
    path: "/app/link",
    type: "symlink",
    mode: 511,
    uid: 0,
    gid: 0,
    target: "target",
  };
  assert.equal(sameRuntimeNode(a, { ...a }), true);
  assert.equal(sameRuntimeNode(a, { ...a, target: "different" }), false);
});
test("incomplete inode content is never treated as unchanged", () => {
  const a = file("/app/file");
  assert.equal(sameRuntimeNode(a, { ...a, sha256: undefined }), false);
  assert.equal(sameRuntimeNode(a, { ...a, links: undefined }), false);
});
test("all source derivations match exactly and module graph links", async () => {
  const r = derive();
  assert.equal(Object.keys(r.files).length, 11);
  for (const [name, raw] of Object.entries(r.files))
    assert.deepEqual(readFileSync(resolve(successorRoot, name)), raw, name);
  for (const name of readdirSync(successorRoot).filter(
    (n) => n.endsWith(".mjs") && !n.endsWith(".test.mjs"),
  ))
    await import(pathToFileURL(resolve(successorRoot, name)));
});
test("new source review is mandatory", () =>
  assert.throws(() => admitPosixInventorySource(null, () => Buffer.alloc(0))));
