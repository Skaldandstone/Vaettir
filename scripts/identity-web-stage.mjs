// Offline artifact preparation only. No app import, provider call or process launch.
import { createHash } from "node:crypto";
import { lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import path from "node:path";

const reject = () => { throw new Error("Identity web staging refused. Review the candidate, target pins and clean environment."); };
const sha256 = value => createHash("sha256").update(value).digest("hex");
const digestPattern = /^[a-f0-9]{64}$/;
const osKeys = new Set(["PATH", "SYSTEMROOT", "WINDIR", "TEMP", "TMP", "COMSPEC", "PATHEXT", "SYSTEMDRIVE"]);
const fixedEnvironment = Object.freeze({
  NODE_ENV: "development",
  NEXT_TELEMETRY_DISABLED: "1",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:4208",
  VAETTIR_PUBLIC_ORIGIN: "http://localhost:3208",
  NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
  NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up",
  NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED: "0",
  NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED: "0",
});
const keyNames = ["CLERK_SECRET_KEY", "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"];
const manifestFields = ["version", "reviewReference", "sourceCommit", "applicationId", "developmentInstanceId", "organizationId", "nativeOrganizationId", "issuer", "secretKeySha256", "publishableKeySha256", "files"];
const requiredFiles = ["apps/web/package.json", "apps/web/next.config.mjs", "apps/web/app/layout.tsx", "apps/web/middleware.ts", "apps/web/node_modules/next/dist/bin/next"];

function exactKeys(object, keys) {
  if (!object || typeof object !== "object" || Array.isArray(object)
    || Object.keys(object).length !== keys.length || keys.some(key => !Object.hasOwn(object, key))) reject();
}

function safeRelative(name) {
  if (typeof name !== "string" || !name || name.includes("\\") || path.posix.isAbsolute(name)) reject();
  for (const segment of name.split("/")) {
    if (!segment || segment === "." || segment === ".." || /[:<>"|?*]/.test(segment)
      || [...segment].some(character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)
      || /[. ]$/.test(segment) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
      || /^\.env(?:\.|$)/i.test(segment)
      || /^(\.git|\.local|\.next|\.aws|\.azure|\.config|\.cache|coverage)$/i.test(segment)) reject();
  }
  return name;
}

function manifestFromText(text, approvedSha256) {
  if (typeof text !== "string" || !digestPattern.test(approvedSha256) || sha256(text) !== approvedSha256) reject();
  let manifest;
  try { manifest = JSON.parse(text); } catch { reject(); }
  exactKeys(manifest, manifestFields);
  if (manifestFields.filter(key => !["version", "files"].includes(key)).some(key => typeof manifest[key] !== "string")) reject();
  if (manifest.version !== 1 || typeof manifest.reviewReference !== "string" || !manifest.reviewReference.trim()
    || !/^[a-f0-9]{40}$/.test(manifest.sourceCommit)
    || !/^app_[A-Za-z0-9]+$/.test(manifest.applicationId)
    || !/^ins_[A-Za-z0-9]+$/.test(manifest.developmentInstanceId)
    || !/^org_[A-Za-z0-9]+$/.test(manifest.organizationId)
    || !/^[a-zA-Z0-9_-]{8,128}$/.test(manifest.nativeOrganizationId)
    || !/^https:\/\/[a-z0-9-]+\.clerk\.accounts\.dev$/.test(manifest.issuer)
    || !digestPattern.test(manifest.secretKeySha256) || !digestPattern.test(manifest.publishableKeySha256)
    || !Array.isArray(manifest.files) || manifest.files.length === 0) reject();
  const names = new Set();
  for (const file of manifest.files) {
    exactKeys(file, ["path", "sha256"]);
    safeRelative(file.path);
    const canonical = file.path.toLowerCase();
    if (names.has(canonical) || !digestPattern.test(file.sha256)) reject();
    names.add(canonical);
  }
  if (requiredFiles.some(name => !manifest.files.some(file => file.path === name))) reject();
  return manifest;
}

function validateEnvironment(environment, manifest) {
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) reject();
  const seen = new Set();
  for (const [name, value] of Object.entries(environment)) {
    // Refuse even empty/undefined inherited keys. Never spread process.env here.
    const canonical = name.toUpperCase();
    if (seen.has(canonical) || typeof value !== "string"
      || (!osKeys.has(canonical) && !Object.hasOwn(fixedEnvironment, name) && !keyNames.includes(name))) reject();
    seen.add(canonical);
  }
  for (const [name, value] of Object.entries(fixedEnvironment)) if (environment[name] !== value) reject();
  const secret = environment.CLERK_SECRET_KEY;
  const publishable = environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;
  if (!/^sk_test_[A-Za-z0-9]+$/.test(secret ?? "") || !/^pk_test_[A-Za-z0-9+/=]+$/.test(publishable ?? "")
    || sha256(secret) !== manifest.secretKeySha256 || sha256(publishable) !== manifest.publishableKeySha256) reject();
  const encoded = publishable.slice("pk_test_".length);
  const decoded = Buffer.from(encoded, "base64").toString("utf8");
  if (decoded !== `${new URL(manifest.issuer).hostname}$`
    || Buffer.from(decoded).toString("base64").replace(/=+$/, "") !== encoded.replace(/=+$/, "")) reject();
}

function physicalDirectory(directory) {
  if (typeof directory !== "string" || !path.isAbsolute(directory)) reject();
  const absolute = path.resolve(directory);
  let cursor = absolute;
  while (true) {
    const stat = lstatSync(cursor);
    if (!stat.isDirectory() || stat.isSymbolicLink()) reject();
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
  if (realpathSync(absolute) !== absolute) reject();
  return absolute;
}

function inspectTree(root, manifest) {
  const actual = new Map();
  function visit(directory, prefix = "") {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relative = safeRelative(prefix ? `${prefix}/${entry.name}` : entry.name);
      const filename = path.join(directory, entry.name);
      const stat = lstatSync(filename);
      if (stat.isSymbolicLink()) reject();
      if (stat.isDirectory()) visit(filename, relative);
      else {
        // Materialized files only: pnpm symlinks and hardlinks need separately
        // reviewed materialization, not traversal into an unreviewed store.
        if (!stat.isFile() || stat.nlink !== 1) reject();
        const key = relative.toLowerCase();
        if (actual.has(key)) reject();
        actual.set(key, { path: relative, sha256: sha256(readFileSync(filename)) });
      }
    }
  }
  visit(root);
  if (actual.size !== manifest.files.length) reject();
  for (const expected of manifest.files) {
    const file = actual.get(expected.path.toLowerCase());
    if (!file || file.path !== expected.path || file.sha256 !== expected.sha256) reject();
  }
}

function contained(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative));
}

function assertNoAncestorInputs(root) {
  // A missing staged dependency must not fall back to a checkout/global parent
  // node_modules. Environment files in parents are also refused conservatively.
  let cursor = path.dirname(root);
  while (true) {
    if (readdirSync(cursor).some(name => name.toLowerCase() === "node_modules" || /^\.env(?:\.|$)/i.test(name))) reject();
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}

function guard(operation) {
  try { return operation(); } catch { return reject(); } // Never leak paths, env values or raw loader errors.
}

/** Checks a previously materialized, operator-reviewed candidate. Does not run it. */
export function verifyIdentityWebStage({ stageRoot, manifestText, approvedManifestSha256, environment }) {
  return guard(() => {
    const manifest = manifestFromText(manifestText, approvedManifestSha256);
    validateEnvironment(environment, manifest);
    const root = physicalDirectory(stageRoot);
    assertNoAncestorInputs(root);
    inspectTree(root, manifest);
    return Object.freeze({
      version: 1, manifestSha256: approvedManifestSha256, sourceCommit: manifest.sourceCommit,
      applicationId: manifest.applicationId, developmentInstanceId: manifest.developmentInstanceId,
      organizationId: manifest.organizationId, nativeOrganizationId: manifest.nativeOrganizationId,
      filesVerified: manifest.files.length, runtimeStarted: false,
      cwd: path.join(root, "apps/web"),
      nextArguments: Object.freeze([path.join(root, requiredFiles[4]), "dev", path.join(root, "apps/web"), "--hostname", "127.0.0.1", "--port", "3208"]),
    });
  });
}

/** Copies only a fully sealed candidate into a fresh destination. Never overwrites. */
export function prepareIdentityWebStage({ sourceRoot, destinationRoot, manifestText, approvedManifestSha256, environment }) {
  return guard(() => {
    const manifest = manifestFromText(manifestText, approvedManifestSha256);
    validateEnvironment(environment, manifest);
    const source = physicalDirectory(sourceRoot);
    inspectTree(source, manifest); // No destination writes before all source/input checks pass.
    if (typeof destinationRoot !== "string" || !path.isAbsolute(destinationRoot)) reject();
    const destination = path.resolve(destinationRoot);
    physicalDirectory(path.dirname(destination));
    if (contained(source, destination) || contained(destination, source)) reject();
    assertNoAncestorInputs(destination);
    mkdirSync(destination); // EEXIST is a refusal, even for an empty existing directory.
    for (const file of manifest.files) {
      const target = path.join(destination, file.path);
      mkdirSync(path.dirname(target), { recursive: true });
      physicalDirectory(path.dirname(target));
      const bytes = readFileSync(path.join(source, file.path));
      if (sha256(bytes) !== file.sha256) reject();
      writeFileSync(target, bytes, { flag: "wx" });
    }
    // Recheck the result. On failure leave the owned partial stage for inspection;
    // do not recursively delete or call it a usable candidate.
    return verifyIdentityWebStage({ stageRoot: destination, manifestText, approvedManifestSha256, environment });
  });
}
