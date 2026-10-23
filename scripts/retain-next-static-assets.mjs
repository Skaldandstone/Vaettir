import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const DEFAULT_LIMITS = Object.freeze({ maxFiles: 12000, maxBytes: 512 * 1024 * 1024, maxFileBytes: 32 * 1024 * 1024, maxManifestBytes: 4 * 1024 * 1024, maxDepth: 24 });
const digest = value => createHash("sha256").update(value).digest("hex");
const cohortId = value => {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) throw new Error("Invalid release cohort identity");
  return value;
};

function safeRelative(value) {
  if (typeof value !== "string" || !value || value.length > 1024 || path.posix.isAbsolute(value) || /[\\:]/.test(value) || Array.from(value).some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) || value.split("/").some(part => !part || part === "." || part === ".." || part.length > 255))
    throw new Error("Unsafe static asset path");
  return value;
}

async function regularDirectory(directory, optional = false) {
  const absolute = path.resolve(directory);
  let current = absolute;
  while (true) {
    let info;
    try { info = await fs.lstat(current); }
    catch (error) {
      if (optional && error.code === "ENOENT" && current === absolute) return null;
      throw error;
    }
    if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Static directory and its parents must be real directories, not symlinks");
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return absolute;
}

async function regularFile(filename, maxBytes) {
  const info = await fs.lstat(filename);
  if (info.isSymbolicLink() || !info.isFile()) throw new Error("Static assets and manifests must be regular files, not symlinks");
  if (info.size > maxBytes) throw new Error("Static asset exceeded file byte limit");
  const handle = await fs.open(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size !== info.size || opened.ino !== info.ino || opened.dev !== info.dev) throw new Error("Static asset changed while inspecting it");
    const value = await handle.readFile();
    if (value.length !== info.size) throw new Error("Static asset changed while reading it");
    return value;
  } finally { await handle.close(); }
}

async function scan(directory, limits) {
  const files = new Map();
  let bytes = 0;
  let directories = 0;
  async function visit(relative, depth) {
    if (depth > limits.maxDepth || ++directories > limits.maxFiles * 2) throw new Error("Static asset tree exceeded depth/directory limit");
    const folder = relative ? path.join(directory, ...relative.split("/")) : directory;
    const entries = await fs.readdir(folder, { withFileTypes: true });
    if (entries.length > limits.maxFiles * 2) throw new Error("Static asset directory exceeded entry limit");
    entries.sort((a, b) => a.name.localeCompare(b.name, "en"));
    for (const entry of entries) {
      const name = safeRelative(relative ? `${relative}/${entry.name}` : entry.name);
      const filename = path.join(directory, ...name.split("/"));
      const info = await fs.lstat(filename);
      if (info.isSymbolicLink()) throw new Error("Symlink in static asset tree");
      if (info.isDirectory()) { await visit(name, depth + 1); continue; }
      if (!info.isFile()) throw new Error("Non-regular entry in static asset tree");
      bytes += info.size;
      if (files.size >= limits.maxFiles || bytes > limits.maxBytes) throw new Error("Static asset tree exceeded file/byte limit");
      const content = await regularFile(filename, limits.maxFileBytes);
      files.set(name, { path: name, size: content.length, sha256: digest(content) });
    }
  }
  await visit("", 0);
  return files;
}

function checkManifest(value, actual, limits) {
  if (!value || value.version !== 1 || !Array.isArray(value.cohorts) || value.cohorts.length < 1 || value.cohorts.length > 16) throw new Error("Invalid static cohort manifest");
  const seen = new Set();
  const represented = new Map();
  let entryCount = 0;
  for (const cohort of value.cohorts) {
    cohortId(cohort.id);
    if (seen.has(cohort.id) || !Array.isArray(cohort.files)) throw new Error("Invalid or duplicate cohort manifest identity");
    seen.add(cohort.id);
    const cohortPaths = new Set();
    for (const file of cohort.files) {
      safeRelative(file.path);
      if (++entryCount > limits.maxFiles * 16 || cohortPaths.has(file.path) || !Number.isSafeInteger(file.size) || file.size < 0 || file.size > limits.maxFileBytes || !/^[0-9a-f]{64}$/.test(file.sha256)) throw new Error("Invalid static cohort file entry");
      cohortPaths.add(file.path);
      const source = actual.get(file.path);
      if (!source || source.size !== file.size || source.sha256 !== file.sha256) throw new Error("Static cohort manifest does not match its files");
      represented.set(file.path, file);
    }
  }
  if (represented.size !== actual.size) throw new Error("Static files are not fully accounted for in cohort manifest");
  return value;
}

async function manifestAt(filename, actual, limits) {
  await regularDirectory(path.dirname(filename));
  try { return checkManifest(JSON.parse((await regularFile(filename, limits.maxManifestBytes)).toString("utf8")), actual, limits); }
  catch (error) { if (error.code === "ENOENT") return null; throw error; }
}

/** Merge only immutable generated assets into an explicitly supplied build output.
 * All validation and collision/size checks finish before copying or pruning.
 * Pruning touches only files owned by dropped cohorts in this output directory;
 * the previous image's exported tree is never written or deleted.
 */
export async function retainNextStaticAssets({ currentDir, previousDir, cohort, previousCohort, manifestPath, previousManifestPath, limits: overrides = {} }) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const value of Object.values(limits)) if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid static retention limit");
  const id = cohortId(cohort);
  const current = await regularDirectory(currentDir);
  const previous = previousDir ? await regularDirectory(previousDir, true) : null;
  if (previous && (current === previous || current.startsWith(previous + path.sep) || previous.startsWith(current + path.sep))) throw new Error("Current and previous static directories must not overlap");
  const outputManifest = path.resolve(manifestPath ?? path.join(current, "..", "static-cohorts.json"));
  if (outputManifest === current || outputManifest.startsWith(current + path.sep)) throw new Error("Keep cohort manifest outside the public static tree");
  if (path.dirname(outputManifest) !== path.dirname(current)) throw new Error("Write cohort manifest only adjacent to the disposable static output");
  const currentFiles = await scan(current, limits);
  const existing = await manifestAt(outputManifest, currentFiles, limits);
  if (existing && existing.cohorts[0].id !== id) throw new Error("Current output already belongs to a different release cohort");
  const currentCohort = existing?.cohorts[0] ?? { id, files: [...currentFiles.values()] };
  let prior = existing?.cohorts.slice(1) ?? [];
  if (previous) {
    const previousFiles = await scan(previous, limits);
    const previousManifest = path.resolve(previousManifestPath ?? path.join(previous, "..", "static-cohorts.json"));
    const tracked = await manifestAt(previousManifest, previousFiles, limits);
    prior = [...(tracked?.cohorts ?? [{ id: previousCohort ? cohortId(previousCohort) : `legacy-${digest(JSON.stringify([...previousFiles.values()])).slice(0, 32)}`, files: [...previousFiles.values()] }]), ...prior];
  }
  const unique = [currentCohort];
  const identities = new Set([id]);
  for (const item of prior) if (!identities.has(item.id)) { identities.add(item.id); unique.push(item); }
  const kept = unique.slice(0, 3);
  const plan = new Map();
  for (const item of kept) for (const file of item.files) {
    const registered = plan.get(file.path);
    if (registered && registered.sha256 !== file.sha256) throw new Error(`Static asset content collision: ${file.path}`);
    const currentFile = currentFiles.get(file.path);
    if (currentFile && currentFile.sha256 !== file.sha256) throw new Error(`Static asset content collision: ${file.path}`);
    plan.set(file.path, file);
  }
  if (plan.size > limits.maxFiles || [...plan.values()].reduce((total, file) => total + file.size, 0) > limits.maxBytes) throw new Error("Retained static cohorts exceeded file/byte limit");
  const result = { version: 1, cohorts: kept };
  const manifestBytes = Buffer.from(JSON.stringify(result, null, 2) + "\n");
  if (manifestBytes.length > limits.maxManifestBytes) throw new Error("Retained cohort manifest exceeded byte limit");
  let copied = 0;
  for (const [relative, file] of plan) {
    if (currentFiles.has(relative)) continue;
    const source = path.join(previous, ...relative.split("/"));
    const content = await regularFile(source, limits.maxFileBytes);
    if (content.length !== file.size || digest(content) !== file.sha256) throw new Error("Previous asset changed during retention");
    const target = path.join(current, ...relative.split("/"));
    await fs.mkdir(path.dirname(target), { recursive: true });
    await regularDirectory(path.dirname(target));
    await fs.writeFile(target, content, { flag: "wx" });
    copied++;
  }
  // Existing output manifests are the only authority for pruning output files.
  let removed = 0;
  if (existing) for (const relative of currentFiles.keys()) if (!plan.has(relative)) {
    const filename = path.join(current, ...relative.split("/"));
    await regularDirectory(path.dirname(filename));
    const content = await regularFile(filename, limits.maxFileBytes);
    if (digest(content) !== currentFiles.get(relative).sha256) throw new Error("Output asset changed before pruning; refusing deletion");
    await fs.unlink(filename);
    removed++;
  }
  await regularDirectory(path.dirname(outputManifest));
  const tempManifest = `${outputManifest}.tmp-${process.pid}`;
  await fs.writeFile(tempManifest, manifestBytes, { flag: "wx" });
  await fs.rename(tempManifest, outputManifest);
  return { cohorts: kept.map(item => item.id), files: plan.size, bytes: [...plan.values()].reduce((total, file) => total + file.size, 0), copied, removed, manifestPath: outputManifest };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = {};
    const names = { "--current-dir": "currentDir", "--previous-dir": "previousDir", "--cohort": "cohort", "--previous-cohort": "previousCohort", "--manifest": "manifestPath", "--previous-manifest": "previousManifestPath" };
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = names[process.argv[index]];
      const value = process.argv[index + 1];
      if (!key || !value || options[key]) throw new Error("Use --current-dir PATH --cohort ID [--previous-dir PATH --previous-cohort ID] [--manifest PATH --previous-manifest PATH]");
      options[key] = value;
    }
    if (!options.currentDir || !options.cohort) throw new Error("--current-dir and --cohort are required");
    console.log(JSON.stringify(await retainNextStaticAssets(options)));
  } catch (error) { console.error(`Static retention failed: ${error.message}`); process.exitCode = 1; }
}
