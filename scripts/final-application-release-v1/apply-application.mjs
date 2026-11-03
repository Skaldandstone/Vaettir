// Main's generated final-image recipe invokes this once with a read-only
// BuildKit input mount. No dependencies, package installation or network I/O.
import {
  lstatSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  rmdirSync,
  mkdirSync,
  symlinkSync,
  chmodSync,
  chownSync,
  lchownSync,
  readlinkSync,
} from "node:fs";
import { dirname, resolve, posix } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
const sha = (b) => createHash("sha256").update(b).digest("hex");
const ok = (v, m) => {
  if (!v) throw Error(m);
};
export function safePath(p) {
  return (
    typeof p === "string" &&
    (p.startsWith("/app/") ||
      p === "/tmp/vaettir-sqlite-overlay-v1" ||
      p.startsWith("/tmp/vaettir-sqlite-overlay-v1/") ||
      p === "/vaettir-sqlite-observation-v1" ||
      p.startsWith("/vaettir-sqlite-observation-v1/")) &&
    !p.includes("\\") &&
    !p.includes("//") &&
    !p
      .split("/")
      .some((x) =>
        [".", "..", ".git", ".local", "assistant-history"].includes(x),
      )
  );
}
function parents(p) {
  let d = dirname(p);
  while (d !== "/") {
    const s = lstatSync(d);
    ok(
      s.isDirectory() && !s.isSymbolicLink() && realpathSync(d) === d,
      "Parent path changed or is a symlink",
    );
    d = dirname(d);
  }
}
function observe(p) {
  let s;
  try {
    s = lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const v = { path: p, mode: s.mode & 0o7777, uid: s.uid, gid: s.gid };
  if (s.isSymbolicLink())
    return { ...v, type: "symlink", target: readlinkSync(p) };
  if (s.isDirectory()) return { ...v, type: "directory" };
  ok(s.isFile(), "Special application file refused");
  return {
    ...v,
    type: "file",
    bytes: s.size,
    sha256: sha(readFileSync(p)),
    links: s.nlink,
  };
}
function matches(actual, expected) {
  if (expected === null) return actual === null;
  if (!actual) return false;
  return Object.entries(expected).every(([k, v]) =>
    k === "hardlinkGroup"
      ? actual.links === 1
      : JSON.stringify(actual[k]) === JSON.stringify(v),
  );
}
export function validatePlan(plan) {
  ok(
    plan &&
      /^[a-f0-9]{40}$/.test(plan.source) &&
      Array.isArray(plan.changes) &&
      plan.changes.length > 0 &&
      plan.changes.length <= 200000,
    "Invalid application plan",
  );
  ok(
    new Set(plan.changes.map((x) => x.path)).size === plan.changes.length,
    "Duplicate application path",
  );
  ok(
    plan.changes.some(
      (x) =>
        x.path === "/app/.vaettir-final-application.json" &&
        x.before === null &&
        x.after?.type === "file",
    ),
    "Exclusive final application marker required",
  );
  for (const r of plan.changes) {
    ok(safePath(r.path), "Unsafe application path");
    ok(
      r.path.startsWith("/app/") || r.after === null,
      "Observer paths can only be removed",
    );
    for (const v of [r.before, r.after].filter(Boolean)) {
      ok(
        v.path === r.path &&
          ["file", "directory", "symlink"].includes(v.type) &&
          Number.isInteger(v.mode) &&
          v.mode >= 0 &&
          v.mode <= 0o777 &&
          Number.isSafeInteger(v.uid) &&
          v.uid >= 0 &&
          Number.isSafeInteger(v.gid) &&
          v.gid >= 0,
        "Invalid application metadata",
      );
      if (v.type === "file")
        ok(
          v.links === 1 &&
            !v.hardlinkGroup &&
            /^[a-f0-9]{64}$/.test(v.sha256) &&
            Number.isSafeInteger(v.bytes) &&
            v.bytes >= 0,
          "Hardlinks or unbound payload refused",
        );
      if (v.type === "symlink")
        ok(
          typeof v.target === "string" &&
            !v.target.startsWith("/") &&
            !v.target.includes("\\") &&
            posix.resolve(posix.dirname(r.path), v.target).startsWith("/app/"),
          "Application symlink escapes /app",
        );
    }
  }
}
export function apply(plan, inputRoot) {
  validatePlan(plan);
  ok(
    process.platform === "linux" && process.getuid() === 0,
    "Owned Linux image build only",
  );
  ok(
    realpathSync(inputRoot) === inputRoot,
    "Unexpected application input mount",
  );
  const changes = plan.changes;
  // All byte and before-state checks precede the first mutation.
  for (const r of changes) {
    ok(
      matches(observe(r.path), r.before),
      "Application baseline mismatch: " + r.path,
    );
    if (r.after?.type === "file") {
      const p = inputRoot + "/blobs/" + r.after.sha256,
        s = lstatSync(p);
      ok(
        s.isFile() &&
          !s.isSymbolicLink() &&
          s.size === r.after.bytes &&
          sha(readFileSync(p)) === r.after.sha256,
        "Application blob mismatch",
      );
    }
  }
  for (const r of [...changes].sort(
    (a, b) => b.path.split("/").length - a.path.split("/").length,
  )) {
    if (
      !r.before ||
      (r.before.type === "directory" && r.after?.type === "directory")
    )
      continue;
    parents(r.path);
    if (r.before.type === "directory") rmdirSync(r.path);
    else unlinkSync(r.path);
  }
  for (const r of [...changes].sort(
    (a, b) =>
      a.path.split("/").length - b.path.split("/").length ||
      a.path.localeCompare(b.path, "en"),
  )) {
    const v = r.after;
    if (!v) continue;
    parents(r.path);
    if (v.type === "directory") {
      if (!r.before || r.before.type !== "directory")
        mkdirSync(r.path, { mode: v.mode });
    } else if (v.type === "file")
      writeFileSync(r.path, readFileSync(inputRoot + "/blobs/" + v.sha256), {
        flag: "wx",
        mode: v.mode,
      });
    else symlinkSync(v.target, r.path);
    if (v.type === "symlink") lchownSync(r.path, v.uid, v.gid);
    else {
      chownSync(r.path, v.uid, v.gid);
      chmodSync(r.path, v.mode);
    }
  }
  for (const r of changes)
    ok(
      matches(observe(r.path), r.after),
      "Application result mismatch: " + r.path,
    );
  const marker = JSON.parse(
    readFileSync("/app/.vaettir-final-application.json"),
  );
  ok(
    marker.source === plan.source && marker.tree === plan.tree,
    "Final application marker mismatch",
  );
  process.stdout.write(
    JSON.stringify({
      scope: "APPLICATION_LAYER_ONLY",
      source: plan.source,
      planSha256: sha(Buffer.from(JSON.stringify(plan))),
      releaseAccepted: false,
    }) + "\n",
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [inputRoot, expected] = process.argv.slice(2);
  ok(
    inputRoot === "/run/vaettir-final-app" && /^[a-f0-9]{64}$/.test(expected),
    "Exact application input required",
  );
  const bytes = readFileSync(inputRoot + "/plan.json");
  ok(sha(bytes) === expected, "Plan bytes changed");
  apply(JSON.parse(bytes), inputRoot);
}
