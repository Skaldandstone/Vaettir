// Pure normalization of an already materialized, independently reviewed image.
// This is NOT a TAR parser or an extended-metadata acceptance mechanism.
import { posix } from "node:path";
import {
  requireThat as ok,
  hex,
  relative,
  same,
  sha,
} from "../production-native-successor-v1/contracts.mjs";
import { exactDelta } from "../production-native-successor-v1/inventory.mjs";
export const inside = (p, root) => p === root || p.startsWith(root + "/");
export function normalizeInventory(raw) {
  ok(
    Array.isArray(raw) && raw.length > 0 && raw.length <= 1000000,
    "Bounded complete inventory required",
  );
  const by = new Map();
  for (const r of raw) {
    ok(relative(r.path) && !by.has(r.path), "Unsafe/duplicate raw path");
    ok(["0", "1", "2", "5"].includes(r.type), "Unsupported inode type");
    ok(
      Number.isInteger(r.mode) &&
        r.mode >= 0 &&
        r.mode <= 0o7777 &&
        Number.isSafeInteger(r.uid) &&
        r.uid >= 0 &&
        Number.isSafeInteger(r.gid) &&
        r.gid >= 0,
      "Missing inode ownership/mode",
    );
    by.set(r.path, r);
  }
  const roots = new Map(),
    groups = new Map();
  function root(p, visited = new Set()) {
    ok(!visited.has(p), "Hardlink cycle");
    visited.add(p);
    const r = by.get(p);
    ok(r && ["0", "1"].includes(r.type), "Missing/nonregular hardlink target");
    if (r.type === "0") return p;
    ok(relative(r.link), "Unsafe hardlink target");
    return root(r.link, visited);
  }
  for (const r of raw.filter((r) => ["0", "1"].includes(r.type))) {
    const target = root(r.path);
    roots.set(r.path, target);
    if (!groups.has(target)) groups.set(target, []);
    groups.get(target).push(r.path);
  }
  return raw
    .map((r) => {
      const out = {
        path: "/" + r.path,
        type:
          r.type === "5" ? "directory" : r.type === "2" ? "symlink" : "file",
        mode: r.mode,
        uid: r.uid,
        gid: r.gid,
      };
      if (out.type === "symlink") {
        ok(
          typeof r.link === "string" && !r.link.includes("\0"),
          "Missing symlink",
        );
        out.target = r.link;
      }
      if (out.type === "file") {
        const target = by.get(roots.get(r.path)),
          group = groups.get(roots.get(r.path)).sort();
        ok(
          hex(target.sha256) &&
            Number.isSafeInteger(target.size) &&
            target.size >= 0,
          "Missing regular content",
        );
        ok(
          r.mode === target.mode &&
            r.uid === target.uid &&
            r.gid === target.gid,
          "Inconsistent hardlink metadata",
        );
        Object.assign(out, {
          bytes: target.size,
          sha256: target.sha256,
          links: group.length,
        });
        if (group.length > 1) out.hardlinkGroup = "/" + group[0];
      }
      return out;
    })
    .sort((a, b) => a.path.localeCompare(b.path, "en"));
}
export function normalizeCohorts(raw) {
  ok(
    raw?.version === 1 &&
      Array.isArray(raw.cohorts) &&
      raw.cohorts.length > 0 &&
      raw.cohorts.length <= 3,
    "Invalid cohort manifest",
  );
  const ids = new Set();
  return {
    cohorts: raw.cohorts.map((c) => {
      ok(
        hex(c.id, 40) &&
          !ids.has(c.id) &&
          Array.isArray(c.files) &&
          c.files.length > 0,
        "Invalid/empty cohort",
      );
      ids.add(c.id);
      const paths = new Set();
      return {
        id: c.id,
        files: c.files.map((f) => {
          ok(
            relative(f.path) &&
              !paths.has(f.path) &&
              hex(f.sha256) &&
              Number.isSafeInteger(f.size) &&
              f.size >= 0,
            "Invalid static asset",
          );
          paths.add(f.path);
          return {
            path: "_next/static/" + f.path,
            bytes: f.size,
            sha256: f.sha256,
          };
        }),
      };
    }),
  };
}
export function staticProposal(raw, parentRaw, source, after) {
  const current = normalizeCohorts(raw),
    parent = normalizeCohorts(parentRaw);
  ok(
    current.cohorts.length === 3 &&
      current.cohorts[0].id === source &&
      same(
        current.cohorts.slice(1).map((c) => c.id),
        parent.cohorts.slice(0, 2).map((c) => c.id),
      ),
    "Wrong three-cohort succession",
  );
  const all = new Map(
    after
      .filter(
        (r) =>
          inside(r.path, "/app/apps/web/.next/static") && r.type === "file",
      )
      .map((r) => [r.path, r]),
  );
  const seen = new Map();
  for (const c of current.cohorts)
    for (const f of c.files) {
      const p = "/app/apps/web/.next/static/" + f.path.slice(13),
        r = all.get(p);
      ok(
        r &&
          r.bytes === f.bytes &&
          r.sha256 === f.sha256 &&
          (!seen.has(p) || seen.get(p) === f.sha256),
        "Missing/changed/colliding static asset",
      );
      seen.set(p, f.sha256);
    }
  ok(
    same([...seen.keys()].sort(), [...all.keys()].sort()),
    "Unlisted static output",
  );
  return {
    parent,
    proposal: {
      scope: "THREE_COHORT_STATIC_RETENTION",
      accepted: false,
      independentReview: false,
      ...current,
    },
  };
}
// Root supplies actual ownership observed in the immutable stage, never guessed IDs.
export function applicationPlan({
  role,
  source,
  tree,
  before,
  output,
  ownership,
  nativePaths,
  probeSha256,
}) {
  ok(
    ["api", "web"].includes(role) && hex(source, 40) && hex(tree, 40),
    "Invalid application source",
  );
  const owner = before.find((r) => r.path === ownership.path);
  ok(
    owner &&
      inside(owner.path, "/app") &&
      owner.uid === ownership.uid &&
      owner.gid === ownership.gid,
    "Unbound application owner",
  );
  const by = new Map(before.map((r) => [r.path, r])),
    payloadSources = new Map();
  const sourceBy = new Map(output.map((r) => [r.path, r]));
  ok(
    by.size === before.length && sourceBy.size === output.length,
    "Duplicate snapshot paths",
  );
  const mirror = (from, to) => {
    ok(sourceBy.has(from), "Missing compiled output root: " + from);
    for (const p of by.keys()) if (inside(p, to)) by.delete(p);
    for (const r of output.filter((r) => inside(r.path, from))) {
      const path = to + r.path.slice(from.length),
        row = { ...r, path, uid: owner.uid, gid: owner.gid };
      // No silent hardlink flattening; the retained applicator forbids changed hardlinks.
      if (row.hardlinkGroup)
        row.hardlinkGroup = to + row.hardlinkGroup.slice(from.length);
      by.set(path, row);
      if (row.type === "file") payloadSources.set(path, r.path);
    }
  };
  if (role === "api") {
    for (const p of [
      "apps/api/dist",
      "apps/api/node_modules",
      "packages",
      "node_modules",
    ])
      mirror("/application/" + p, "/app/" + p);
    for (const p of [
      "package.json",
      "pnpm-lock.yaml",
      "pnpm-workspace.yaml",
      "apps/api/package.json",
    ])
      mirror("/application/" + p, "/app/" + p);
  } else {
    const standalone = "/application/apps/web/.next/standalone";
    ok(sourceBy.has(standalone), "Missing standalone output");
    // Mirror produced top-level trees, preserving unrelated parent utilities.
    const tops = output.filter((r) => posix.dirname(r.path) === standalone);
    ok(
      tops.some((r) => r.path === standalone + "/apps") &&
        tops.some((r) => r.path === standalone + "/node_modules"),
      "Incomplete standalone",
    );
    for (const r of tops) mirror(r.path, "/app/" + posix.basename(r.path));
    for (const p of [
      "apps/web/.next/static",
      "apps/web/.next/static-cohorts.json",
      "apps/web/public",
    ])
      mirror("/application/" + p, "/app/" + p);
  }
  for (const p of [...by.keys()])
    if (
      inside(p, "/tmp/vaettir-sqlite-overlay-v1") ||
      inside(p, "/vaettir-sqlite-observation-v1")
    )
      by.delete(p);
  const marker = Buffer.from(JSON.stringify({ source, tree }) + "\n"),
    markerPath = "/app/.vaettir-final-application.json";
  ok(!by.has(markerPath), "Application marker already exists");
  by.set(markerPath, {
    path: markerPath,
    type: "file",
    mode: 0o644,
    uid: owner.uid,
    gid: owner.gid,
    bytes: marker.length,
    sha256: sha(marker),
    links: 1,
  });
  payloadSources.set(markerPath, null);
  const after = [...by.values()].sort((a, b) =>
      a.path.localeCompare(b.path, "en"),
    ),
    changes = exactDelta(before, after),
    categories = {};
  const native = new Set(nativePaths);
  for (const d of changes) {
    const removal =
      inside(d.path, "/tmp/vaettir-sqlite-overlay-v1") ||
      inside(d.path, "/vaettir-sqlite-observation-v1");
    ok(
      removal ||
        (inside(d.path, "/app") &&
          relative(d.path.slice(1)) &&
          !d.path
            .split("/")
            .some((p) => [".git", ".local", "assistant-history"].includes(p))),
      "Output escapes app",
    );
    ok(
      !native.has(d.path) ||
        (d.path ===
          "/tmp/vaettir-sqlite-overlay-v1/sqlite-runtime-regression" &&
          d.after === null &&
          d.before.sha256 === probeSha256),
      "Application changes native inode",
    );
    ok(!native.has(d.before?.hardlinkGroup), "Native hardlink alias");
    for (const row of [d.before, d.after])
      if (row?.type === "file")
        ok(
          row.links === 1 && !row.hardlinkGroup,
          "Changed hardlink unsupported",
        );
    if (d.after?.type === "symlink")
      ok(
        !posix.isAbsolute(d.after.target) &&
          inside(posix.resolve(posix.dirname(d.path), d.after.target), "/app"),
        "Symlink escapes app",
      );
    if (d.after) {
      let parent = posix.dirname(d.path);
      while (parent !== "/") {
        ok(
          by.get(parent)?.type === "directory",
          "Missing/symlink application parent: " + parent,
        );
        parent = posix.dirname(parent);
      }
    }
    categories[d.path] = removal ? "observer-removal" : "application";
  }
  return {
    before,
    after,
    ledger: {
      scope: "FINAL_APPLICATION_OVERLAY",
      accepted: false,
      independentReview: false,
      changes,
      categories,
    },
    payloadSources,
    marker,
  };
}
