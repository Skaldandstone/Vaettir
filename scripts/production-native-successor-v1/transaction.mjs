// Main-owned DISPOSABLE stage entrypoint. Importing this module does no native I/O.
import {
  lstatSync,
  readdirSync,
  readlinkSync,
  readFileSync,
  openSync,
  readSync,
  closeSync,
  fstatSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { requireThat, sha, same, index } from "./contracts.mjs";
import { exactDelta } from "./inventory.mjs";

export const STAGE = "/tmp/vaettir-sqlite-overlay-v1";
export const OUTPUT = "/vaettir-sqlite-observation-v1";
export const VIRTUAL = ["/proc", "/sys", "/dev"];
export const INJECTED = ["/etc/hosts", "/etc/hostname", "/etc/resolv.conf"];
const excluded = (path) =>
  VIRTUAL.some((p) => path === p || path.startsWith(p + "/")) ||
  INJECTED.includes(path) ||
  path === OUTPUT ||
  path.startsWith(OUTPUT + "/");

export function snapshot(
  root = "/",
  limits = { entries: 400000, bytes: 12 * 1024 ** 3, ms: 600000 },
) {
  const rows = [],
    started = Date.now(),
    links = new Map();
  let total = 0;
  function visit(path) {
    if (excluded(path)) return;
    requireThat(
      rows.length < limits.entries && Date.now() - started <= limits.ms,
      "Filesystem observation limit exceeded",
    );
    const local = root === "/" ? path : root + path,
      stat = lstatSync(local),
      row = { path, mode: stat.mode & 0o7777, uid: stat.uid, gid: stat.gid };
    if (stat.isSymbolicLink()) {
      row.type = "symlink";
      row.target = readlinkSync(local);
    } else if (stat.isDirectory()) row.type = "directory";
    else if (stat.isFile()) {
      row.type = "file";
      row.bytes = stat.size;
      total += stat.size;
      requireThat(total <= limits.bytes, "Filesystem byte budget exceeded");
      const fd = openSync(local, "r");
      try {
        const opened = fstatSync(fd);
        requireThat(
          opened.ino === stat.ino &&
            opened.dev === stat.dev &&
            opened.size === stat.size,
          "File replaced while observing",
        );
        const hash = createHash("sha256"),
          buffer = Buffer.alloc(1024 * 1024);
        let offset = 0;
        while (offset < stat.size) {
          requireThat(
            Date.now() - started <= limits.ms,
            "Filesystem observation timed out",
          );
          const n = readSync(
            fd,
            buffer,
            0,
            Math.min(buffer.length, stat.size - offset),
            offset,
          );
          requireThat(n > 0, "Short filesystem read");
          hash.update(buffer.subarray(0, n));
          offset += n;
        }
        const end = fstatSync(fd);
        requireThat(
          end.size === stat.size &&
            end.mtimeMs === stat.mtimeMs &&
            end.ctimeMs === stat.ctimeMs,
          "File changed while observing",
        );
        row.sha256 = hash.digest("hex");
      } finally {
        closeSync(fd);
      }
      row.links = stat.nlink;
      if (stat.nlink > 1) {
        const key = stat.dev + ":" + stat.ino;
        if (!links.has(key)) links.set(key, path);
        row.hardlinkGroup = links.get(key);
      }
    } else throw Error("Unexpected special filesystem entry: " + path);
    rows.push(row);
    if (row.type === "directory")
      for (const child of readdirSync(local).sort())
        visit(path === "/" ? "/" + child : path + "/" + child);
  }
  visit("/");
  return rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

export function checkBaseline(actual, retained) {
  const actualMap = index(actual),
    expected = new Map();
  for (const row of retained) {
    const path = "/" + row.path;
    if (excluded(path)) continue;
    requireThat(!expected.has(path), "Duplicate baseline member");
    expected.set(path, row);
    const observed = actualMap.get(path);
    requireThat(observed, "Missing retained baseline member: " + path);
    const type = { 0: "file", 5: "directory", 2: "symlink", 1: "file" }[
      row.type
    ];
    requireThat(
      type && observed.type === type && observed.mode === row.mode,
      "Retained baseline metadata changed: " + path,
    );
    if (type === "file") {
      const target =
        row.type === "1" ? retained.find((r) => r.path === row.link) : row;
      requireThat(
        target &&
          observed.sha256 === target.sha256 &&
          observed.bytes === target.size,
        "Retained baseline bytes changed: " + path,
      );
    }
    if (type === "symlink")
      requireThat(
        observed.target === row.link,
        "Retained baseline symlink changed: " + path,
      );
  }
  for (const row of actual)
    requireThat(
      row.path === "/" ||
        row.path === STAGE ||
        row.path.startsWith(STAGE + "/") ||
        expected.has(row.path),
      "Unexpected pre-install file: " + row.path,
    );
  return true;
}

export function observeTransaction(input, io) {
  requireThat(
    input.schemaVersion === 1 &&
      ["api", "web"].includes(input.role) &&
      input.stageRoot === STAGE &&
      input.observationRoot === OUTPUT,
    "Invalid disposable observation scope",
  );
  const commands = [];
  const noPendingTriggers = (status) =>
    status
      .replace(/\n$/, "")
      .split("\n")
      .every((line) => {
        const fields = line.split("\t");
        return fields.length === 8 && fields[6] === "" && fields[7] === "";
      });
  const command = (exe, args) => {
    const result = io.run(exe, args);
    commands.push({ exe, args, ...result });
    requireThat(
      result.status === 0 && result.signal === null && result.error === null,
      "Native command failed; no retry: " + exe,
    );
    return result.stdout;
  };
  const state = () => ({
    status: command("/usr/bin/dpkg-query", [
      "-W",
      "-f=${binary:Package}\t${Status}\t${Version}\t${Architecture}\t${Depends}\t${Pre-Depends}\t${Triggers-Awaited}\t${Triggers-Pending}\n",
    ]),
    audit: command("/usr/bin/dpkg", ["--audit"]),
    loader: command("/usr/sbin/ldconfig", ["-p"]),
    updates: io.list("/var/lib/dpkg/updates"),
    // Full status/status-old, trigger, info, cache and log bytes are captured by
    // the surrounding filesystem snapshots. These stdout records are additional.
    sqliteOwnership: command("/usr/bin/dpkg-query", [
      "-L",
      "libsqlite3-0:amd64",
    ]),
  });
  let before,
    after,
    beforeState,
    afterState,
    error = null,
    installAttempted = false,
    toolsVerified = false;
  try {
    before = io.snapshot();
    checkBaseline(before, io.baseline);
    for (const tool of input.base.tools)
      requireThat(
        before.find((r) => r.path === tool.path)?.sha256 === tool.sha256,
        "Retained tool differs from reviewed baseline",
      );
    toolsVerified = true;
    beforeState = state();
    requireThat(
      beforeState.audit === "" && beforeState.updates.length === 0,
      "Baseline dpkg state is not clean",
    );
    requireThat(
      noPendingTriggers(beforeState.status),
      "Baseline package triggers pending or unparsed",
    );
    command("/usr/bin/dpkg-deb", ["--info", STAGE + "/sqlite.deb"]);
    command("/usr/bin/dpkg-deb", ["--contents", STAGE + "/sqlite.deb"]);
    installAttempted = true;
    command("/usr/bin/dpkg", ["--install", STAGE + "/sqlite.deb"]);
    command("/usr/local/bin/node", [
      STAGE + "/check-sqlite-runtime.mjs",
      "--installed",
      STAGE,
    ]);
    command("/usr/local/bin/node", [
      STAGE + "/check-sqlite-runtime.mjs",
      "--consumers",
      input.role,
    ]);
  } catch (e) {
    error = String(e.message);
  }
  // Evidence collection after failure is read-only. Do not rerun install, run a
  // repair, delete locks, clean metadata, or infer the ambiguous action failed.
  if (before) {
    if (toolsVerified)
      try {
        afterState = state();
      } catch (e) {
        error ??= String(e.message);
      }
    try {
      after = io.snapshot();
    } catch (e) {
      error ??= String(e.message);
    }
  }
  const changes = before && after ? exactDelta(before, after) : null;
  if (
    after &&
    after.find(
      (r) => r.path === "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6",
    )?.sha256 !== input.acceptedLibrarySha256
  )
    error ??= "Installed library differs from accepted artifact";
  if (
    afterState &&
    (afterState.audit !== "" ||
      afterState.updates.length !== 0 ||
      !noPendingTriggers(afterState.status))
  )
    error ??= "Dirty post-install package state";
  return {
    schemaVersion: 1,
    role: input.role,
    admission: input.admission,
    installAttempted,
    commands,
    before,
    beforeState,
    after,
    afterState,
    changes,
    error,
    observationComplete: Boolean(before && after && beforeState && afterState),
    nativeCommandsPassed: error === null,
    excluded: {
      virtual: VIRTUAL,
      injected: INJECTED,
      observationOutput: OUTPUT,
    },
    metadataCoverage:
      "content/mode/uid/gid/symlinks/hardlink-groups; final OCI extended metadata audit still required",
    independentlyReviewed: false,
    consumerDiscoveryComplete: false,
    runtimeNssAccepted: false,
    releaseAccepted: false,
  };
}

function actualNss() {
  const input = JSON.parse(
      readFileSync(STAGE + "/transaction-input.json", "utf8"),
    ),
    transaction = JSON.parse(
      readFileSync(OUTPUT + "/observation.json", "utf8"),
    );
  requireThat(
    !existsSync(OUTPUT + "/nss-command.json") &&
      !existsSync(OUTPUT + "/nss-observation.json"),
    "NSS observation already exists; no retry",
  );
  if (!transaction.nativeCommandsPassed) {
    writeFileSync(
      OUTPUT + "/nss-command.json",
      JSON.stringify({
        skipped: true,
        reason: "SQLite transaction failed",
        releaseAccepted: false,
      }) + "\n",
      { flag: "wx" },
    );
    return;
  }
  requireThat(
    input.role === "api" &&
      input.nss?.protocol === "empty-store-loader-proof/v1" &&
      input.nss.toolSha256 === sha(readFileSync("/run/vaettir-nss/certutil")) &&
      input.nss.fixtureSha256 ===
        sha(readFileSync("/run/vaettir-nss/probe.cjs")),
    "External NSS input mismatch",
  );
  const runtimeHashes = input.base.nssLibraries.map((row) => ({
    path: "/" + row.path,
    sha256: sha(readFileSync("/" + row.path)),
    expectedSha256: row.sha256,
  }));
  runtimeHashes.push({
    path: "/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6",
    sha256: sha(readFileSync("/usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6")),
    expectedSha256: input.acceptedLibrarySha256,
  });
  requireThat(
    runtimeHashes.every((row) => row.sha256 === row.expectedSha256),
    "NSS runtime bytes changed",
  );
  const r = spawnSync(
    "/usr/local/bin/node",
    ["/run/vaettir-nss/probe.cjs", OUTPUT],
    {
      encoding: "utf8",
      timeout: 90000,
      maxBuffer: 4 * 1024 ** 2,
      env: {
        PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
        LANG: "C",
        LC_ALL: "C",
        HOME: "/root",
      },
    },
  );
  writeFileSync(
    OUTPUT + "/nss-command.json",
    JSON.stringify(
      {
        status: r.status,
        signal: r.signal ?? null,
        error: r.error?.message ?? null,
        errorCode: r.error?.code ?? null,
        errorErrno: r.error?.errno ?? null,
        errorSyscall: r.error?.syscall ?? null,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
        toolSha256: input.nss.toolSha256,
        fixtureSha256: input.nss.fixtureSha256,
        runtimeHashes,
        observationPresent: existsSync(OUTPUT + "/nss-observation.json"),
        releaseAccepted: false,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx", mode: 0o600 },
  );
}
function actualMain() {
  requireThat(
    process.platform === "linux" &&
      process.getuid?.() === 0 &&
      process.argv.length === 3 &&
      ["--observe", "--nss"].includes(process.argv[2]) &&
      resolve(process.argv[1]) === STAGE + "/transaction.mjs",
    "Only the exact Main disposable Linux stage may run",
  );
  if (process.argv[2] === "--nss") {
    actualNss();
    return;
  }
  requireThat(!existsSync(OUTPUT), "Observation already exists; no retry");
  const input = JSON.parse(
    readFileSync(STAGE + "/transaction-input.json", "utf8"),
  );
  const expected = input.files
    .map((r) => r.path)
    .concat("transaction-input.json")
    .sort();
  requireThat(
    same(readdirSync(STAGE).sort(), expected),
    "Unpinned stage content",
  );
  for (const row of input.files) {
    requireThat(/^[a-zA-Z0-9_.-]+$/.test(row.path), "Invalid staged member");
    const p = STAGE + "/" + row.path;
    requireThat(lstatSync(p).isFile(), "Stage links refused");
    const b = readFileSync(p);
    requireThat(
      b.length === row.bytes && sha(b) === row.sha256,
      "Stage artifact changed",
    );
  }
  // Transport must establish this exact executable mode before observation.
  // Refuse a malformed context instead of repairing permissions at runtime.
  requireThat(
    (lstatSync(STAGE + "/sqlite-runtime-regression").mode & 0o7777) === 0o555,
    "SQLite probe transport mode must be exactly 0555",
  );
  mkdirSync(OUTPUT, { mode: 0o700 });
  writeFileSync(
    OUTPUT + "/intent.json",
    JSON.stringify({
      role: input.role,
      inputSha256: sha(readFileSync(STAGE + "/transaction-input.json")),
      releaseAccepted: false,
    }) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  const result = observeTransaction(input, {
    baseline: JSON.parse(
      readFileSync(STAGE + "/baseline-inventory.json", "utf8"),
    ),
    snapshot: () => snapshot(),
    list: (path) => readdirSync(path).sort(),
    run: (exe, args) => {
      const r = spawnSync(exe, args, {
        encoding: "utf8",
        timeout: 120000,
        maxBuffer: 32 * 1024 ** 2,
        env: {
          PATH: "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
          LANG: "C",
          LC_ALL: "C",
          HOME: "/root",
          DEBIAN_FRONTEND: "noninteractive",
        },
      });
      return {
        status: r.status,
        signal: r.signal ?? null,
        error: r.error?.message ?? null,
        errorCode: r.error?.code ?? null,
        errorErrno: r.error?.errno ?? null,
        errorSyscall: r.error?.syscall ?? null,
        stdout: r.stdout ?? "",
        stderr: r.stderr ?? "",
      };
    },
  });
  writeFileSync(
    OUTPUT + "/observation.json",
    JSON.stringify(result, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
  // Exit zero preserves failure evidence in the evidence_only target. This is an
  // observation build, never a success/eligibility signal for release.
  console.log(
    JSON.stringify({
      observationComplete: result.observationComplete,
      nativeCommandsPassed: result.nativeCommandsPassed,
      error: result.error,
      releaseAccepted: false,
    }),
  );
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  actualMain();
