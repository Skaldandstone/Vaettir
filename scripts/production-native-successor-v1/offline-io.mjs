import {
  lstatSync,
  realpathSync,
  openSync,
  fstatSync,
  readSync,
  closeSync,
  readdirSync,
  readFileSync,
  mkdirSync,
  writeFileSync,
} from "node:fs";
import { join, sep } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { requireThat, relative, hex, sha } from "./contracts.mjs";

// No network, credential lookup, Docker or application execution in this adapter.
export function fileReader(directory) {
  const root = realpathSync(directory);
  const reader = (path, maximum) => {
    requireThat(
      relative(path) && Number.isSafeInteger(maximum) && maximum >= 0,
      "Invalid bounded read",
    );
    let current = root;
    for (const part of path.split("/")) {
      current = join(current, part);
      requireThat(
        !lstatSync(current).isSymbolicLink(),
        "Evidence symlink refused",
      );
    }
    requireThat(
      realpathSync(current).startsWith(root + sep),
      "Evidence escaped root",
    );
    const fd = openSync(current, "r");
    try {
      const first = fstatSync(fd);
      requireThat(
        first.isFile() && first.size <= maximum,
        "Evidence is not a bounded regular file",
      );
      const bytes = Buffer.alloc(first.size);
      let offset = 0;
      while (offset < bytes.length) {
        const n = readSync(fd, bytes, offset, bytes.length - offset, offset);
        requireThat(n > 0, "Short evidence read");
        offset += n;
      }
      const last = fstatSync(fd);
      requireThat(
        first.size === last.size &&
          first.mtimeMs === last.mtimeMs &&
          first.ctimeMs === last.ctimeMs,
        "Evidence changed while reading",
      );
      return bytes;
    } finally {
      closeSync(fd);
    }
  };
  reader.verify = (ref) => {
    requireThat(
      relative(ref.path) &&
        Number.isSafeInteger(ref.bytes) &&
        ref.bytes >= 0 &&
        ref.bytes <= 12 * 1024 ** 3 &&
        hex(ref.sha256),
      "Invalid streaming evidence reference",
    );
    let current = root;
    for (const part of ref.path.split("/")) {
      current = join(current, part);
      requireThat(
        !lstatSync(current).isSymbolicLink(),
        "Evidence symlink refused",
      );
    }
    requireThat(
      realpathSync(current).startsWith(root + sep),
      "Evidence escaped root",
    );
    const fd = openSync(current, "r"),
      started = Date.now();
    try {
      const first = fstatSync(fd);
      requireThat(
        first.isFile() && first.size === ref.bytes,
        "Streaming evidence size mismatch",
      );
      const hash = createHash("sha256"),
        buffer = Buffer.alloc(1024 * 1024);
      let offset = 0;
      while (offset < first.size) {
        requireThat(
          Date.now() - started <= 600000,
          "Evidence rehash timed out",
        );
        const n = readSync(
          fd,
          buffer,
          0,
          Math.min(buffer.length, first.size - offset),
          offset,
        );
        requireThat(n > 0, "Short streaming evidence read");
        hash.update(buffer.subarray(0, n));
        offset += n;
      }
      const last = fstatSync(fd);
      requireThat(
        first.size === last.size &&
          first.mtimeMs === last.mtimeMs &&
          first.ctimeMs === last.ctimeMs &&
          hash.digest("hex") === ref.sha256,
        "Streaming evidence changed or hash mismatched",
      );
      return true;
    } finally {
      closeSync(fd);
    }
  };
  return reader;
}
export function packageFiles(directory) {
  return readdirSync(directory)
    .sort()
    .map((path) => {
      requireThat(
        relative(path) &&
          !path.includes("/") &&
          lstatSync(join(directory, path)).isFile(),
        "Unexpected package member",
      );
      const bytes = readFileSync(join(directory, path));
      return { path, sha256: sha(bytes), bytes: bytes.length };
    });
}
export function gitSource(directory) {
  const options = {
    cwd: directory,
    timeout: 60000,
    maxBuffer: 64 * 1024 ** 2,
    env: {
      ...process.env,
      GIT_NO_REPLACE_OBJECTS: "1",
      GIT_OPTIONAL_LOCKS: "0",
    },
  };
  const git = (args) =>
    execFileSync("git", ["--no-replace-objects", ...args], options);
  const commit = (value) => {
    requireThat(hex(value, 40), "Invalid immutable source identity");
    return value;
  };
  const files = (revision) => {
    const rows = git(["ls-tree", "-r", "-z", commit(revision)])
      .toString("utf8")
      .split("\0")
      .filter(Boolean);
    return new Map(
      rows.map((row) => {
        const match = /^(\d+) (blob|commit) ([a-f0-9]{40})\t([\s\S]+)$/.exec(
          row,
        );
        requireThat(
          match && match[2] === "blob" && relative(match[4]),
          "Unsupported source entry",
        );
        return [match[4], { mode: match[1], blob: match[3] }];
      }),
    );
  };
  const content = (row) => {
    if (!row) return null;
    const bytes = git(["cat-file", "blob", row.blob]);
    return { ...row, sha256: sha(bytes), bytes: bytes.length };
  };
  return {
    tree: (r) =>
      git(["rev-parse", commit(r) + "^{tree}"])
        .toString()
        .trim(),
    parents: (r) =>
      git(["show", "-s", "--format=%P", commit(r)])
        .toString()
        .trim()
        .split(" ")
        .filter(Boolean),
    contains: (r, ancestor) => {
      const p = spawnSync(
        "git",
        [
          "--no-replace-objects",
          "merge-base",
          "--is-ancestor",
          commit(ancestor),
          commit(r),
        ],
        options,
      );
      requireThat(
        !p.error && [0, 1].includes(p.status),
        "Ancestry check failed",
      );
      return p.status === 0;
    },
    migrations: (r) =>
      [...files(r)]
        .filter(
          ([p]) =>
            p.startsWith("packages/db/prisma/migrations/") &&
            p.endsWith("/migration.sql"),
        )
        .sort(([a], [b]) => a.localeCompare(b, "en"))
        .map(([path, row]) => ({ path, sha256: content(row).sha256 })),
    changes: (a, b) => {
      const before = files(a),
        after = files(b);
      return [...new Set([...before.keys(), ...after.keys()])]
        .sort()
        .filter(
          (path) =>
            JSON.stringify(before.get(path)) !==
            JSON.stringify(after.get(path)),
        )
        .map((path) => ({
          path,
          before: content(before.get(path)),
          after: content(after.get(path)),
        }));
    },
  };
}
export function writeExclusiveContext(directory, files) {
  // Parent must already exist. A failed or interrupted write is NEVER retried or removed.
  mkdirSync(directory, { recursive: false, mode: 0o700 });
  writeFileSync(
    join(directory, "context-intent.json"),
    JSON.stringify({ state: "WRITING", files: Object.keys(files).sort() }) +
      "\n",
    { flag: "wx", mode: 0o600 },
  );
  const rows = [];
  for (const [path, bytes] of Object.entries(files)) {
    requireThat(
      relative(path) && !path.includes("/"),
      "Invalid context member",
    );
    writeFileSync(join(directory, path), bytes, { flag: "wx", mode: 0o600 });
    rows.push({ path, sha256: sha(bytes), bytes: bytes.length });
  }
  writeFileSync(
    join(directory, "context-manifest.json"),
    JSON.stringify(
      {
        state: "PREPARED_ONLY",
        files: rows,
        executionAuthorized: false,
        releaseAccepted: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
