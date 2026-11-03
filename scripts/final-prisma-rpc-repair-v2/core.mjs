import * as fs from "node:fs";
import * as cp from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
export const hash = (b) => createHash("sha256").update(b).digest("hex");
export const need = (v, why) => { if (!v) throw Error(why); };
export const equal = (a, b, why) => need(JSON.stringify(a) === JSON.stringify(b), why);
export const sorted = (a) => [...new Set(a)].sort();
export const OUT = "/vaettir-sqlite-observation-v1";
export function actualIO() {
  return { read: fs.readFileSync, stat: fs.lstatSync, real: fs.realpathSync,
    exists: fs.existsSync, mkdir: fs.mkdirSync, temp: fs.mkdtempSync,
    write: (p, b, mode = 0o600) => fs.writeFileSync(p, b, { flag: "wx", mode }),
    spawn: cp.spawnSync, spawnAsync: cp.spawn,
    load: (p) => createRequire("/app/package.json")(p), platform: process.platform };
}
export function pinned(io, row) {
  need(row.path.startsWith("/") && row.path.length < 1024 && !row.path.includes("\0") && !row.path.includes("\\") && row.path.split("/").slice(1).every(x => x && x !== ".." && x !== "."), "Invalid absolute native path");
  const s = io.stat(row.path);
  need(s.isFile() && !s.isSymbolicLink(), "Expected regular native file");
  need(s.size === row.bytes && (s.mode & 0o7777) === row.mode && s.uid === row.uid && s.gid === row.gid, "Native metadata differs");
  const b = io.read(row.path);
  need(hash(b) === row.sha256 && b.length === row.bytes, "Native bytes differ");
  return b;
}
export function command(io, label, exe, args, dir, extra = {}) {
  need(/^[a-z0-9-]+$/.test(label) && exe.startsWith("/"), "Unscoped command");
  const r = io.spawn(exe, args, { cwd: dir, env: { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: dir, LANG: "C", ...extra }, encoding: "utf8", timeout: 45000, maxBuffer: 8 * 1024 ** 2, stdio: ["ignore", "pipe", "pipe"] });
  const record = { exe, args, status: r.status, signal: r.signal ?? null,
    error: r.error ? { code: r.error.code ?? null, errno: r.error.errno ?? null, syscall: r.error.syscall ?? null, message: r.error.message } : null,
    stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  io.write(`${dir}/${label}.json`, JSON.stringify(record));
  need(record.status === 0 && record.signal === null && record.error === null, "Native command failed: " + label);
  return record;
}
export function identity(text, p, io) {
  const lines = text.trim().split(/\r?\n/), field = key => {
    const rows = lines.filter(x => x.startsWith(key + "="));
    need(rows.length === 1, "Missing/duplicate SQLite " + key); return rows[0].slice(key.length + 1);
  };
  need(field("VERSION") === p.sqlite.version && field("SOURCE_ID") === p.sqlite.sourceId, "SQLite source identity differs");
  need(io.real(field("LIBRARY")) === p.sqlite.library.path, "Loaded another SQLite library");
  const options = lines.filter(x => x.startsWith("OPTION=")).map(x => x.slice(7));
  equal(sorted(options), sorted(p.sqlite.options), "Actual SQLite options differ from accepted proof");
  need(options.length === new Set(options).size, "Duplicate SQLite option");
  return { version: p.sqlite.version, sourceId: p.sqlite.sourceId, options };
}
export function begin(p, io) {
  need(io.platform === "linux" && p.source === "94cde34624bcc910c5f8c1a19214302ffa04c2bf", "Wrong fixture host/source");
  need(["api", "web"].includes(p.role) && ["sqlite-installed", "sqlite-consumers", "browser", "prisma"].includes(p.kind), "Wrong fixture role/kind");
  const parent = JSON.parse(io.read("/run/vaettir-native/native-plan.json"));
  need(new RegExp(`^051722405355\\.dkr\\.ecr\\.us-east-2\\.amazonaws\\.com/vaettir-${p.role}@sha256:[a-f0-9]{64}$`).test(p.image ?? ""), "Actual final image binding required");
  need(parent.image === p.image && parent.source === p.source && parent.role === p.role, "Fixture image/role differs from parent");
  need(io.real(OUT) === OUT && io.stat(OUT).isDirectory() && !io.stat(OUT).isSymbolicLink(), "Invalid observation root");
  const dir = `${OUT}/fixture-${p.kind}`;
  io.mkdir(dir, { recursive: false, mode: 0o700 });
  io.write(dir + "/intent.json", JSON.stringify({ source: p.source, image: p.image, role: p.role, kind: p.kind, once: true, releaseAccepted: false }));
  return dir;
}
