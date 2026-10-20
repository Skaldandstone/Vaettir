import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const destination = process.argv[2] && resolve(process.argv[2]);
const relativeDestination = destination && relative(root, destination);
if (!relativeDestination || (!isAbsolute(relativeDestination) && relativeDestination !== ".." && !relativeDestination.startsWith(".." + sep)))
  throw new Error("Choose a new local output directory outside the plugin.");
const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
if (git("status", "--porcelain", "--", "."))
  throw new Error("Commit or preserve plugin changes before preparing an exact-source package.");
const source = git("rev-parse", "HEAD");
// Positive allowlist: dependencies, logs, local history and credentials cannot enter.
const files = [
  "README.md", "CONNECTION-TEST.md", "RELEASE-REVIEW.md",
  "skills/vaettir-quality/SKILL.md", "dist/server.mjs", "dist/preflight.mjs", "dist/THIRD-PARTY-NOTICES.txt",
];
// Codex's native adapter supports explicit process environment forwarding.
// Root portable metadata would take priority and must not shadow this adapter.
const inputs = [
  ["codex-plugin.json", ".codex-plugin/plugin.json"],
  ["codex-mcp.json", ".mcp.json"],
  ...files.map((name) => [name, name]),
];
for (const [name] of inputs) {
  if (!(await lstat(resolve(root, name))).isFile()) throw new Error("Package input must be a regular file.");
}
await mkdir(destination); // Never overwrite a prior preview or receipt.
const hashes = {};
for (const [name, output] of inputs) {
  const target = resolve(destination, "plugins/vaettir", output);
  await mkdir(dirname(target), { recursive: true });
  await copyFile(resolve(root, name), target);
  hashes[output] = createHash("sha256").update(await readFile(target)).digest("hex");
}
await mkdir(resolve(destination, ".agents/plugins"), { recursive: true });
await writeFile(resolve(destination, ".agents/plugins/marketplace.json"), JSON.stringify({
  name: "vaettir-synthetic-preview",
  interface: { displayName: "Vaettir synthetic preview" },
  plugins: [{ name: "vaettir", source: { source: "local", path: "./plugins/vaettir" },
    policy: { installation: "AVAILABLE", authentication: "ON_INSTALL" }, category: "Developer Tools" }],
}, null, 2) + "\n");
await writeFile(resolve(destination, "package-receipt.json"), JSON.stringify({
  source, format: "codex-native", files: hashes, credentialsIncluded: false, productionActivated: false,
  installedCodexAcceptance: false,
}, null, 2) + "\n");
console.log(JSON.stringify({ source, marketplace: destination, files: inputs.length, credentialsIncluded: false }));
