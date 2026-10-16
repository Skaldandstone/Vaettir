import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { readdir, readFile, writeFile } from "node:fs/promises";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const built = await build({
  absWorkingDir: root,
  entryPoints: { server: "server/index.mjs", preflight: "scripts/preflight.mjs" },
  outdir: "dist",
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  banner: {
    js: 'import { createRequire as __vaettirCreateRequire } from "node:module"; const require = __vaettirCreateRequire(import.meta.url);',
  },
  legalComments: "eof",
  metafile: true,
});
const packages = new Set();
for (const input of Object.keys(built.metafile.inputs)) {
  const match = input.replaceAll("\\", "/").match(/(?:^|\/)node_modules\/((?:@[^/]+\/)?[^/]+)/);
  if (match) packages.add(match[1]);
}
const notices = [];
for (const name of [...packages].sort()) {
  const packageRoot = resolve(root, "node_modules", name);
  const metadata = JSON.parse(await readFile(resolve(packageRoot, "package.json"), "utf8"));
  const licenseFiles = (await readdir(packageRoot)).filter((name) => /^(licen[cs]e|copying)(\..*)?$/i.test(name));
  if (!licenseFiles.length) throw new Error(`Review missing license notice for ${name}`);
  notices.push(`${metadata.name}@${metadata.version} (${metadata.license ?? "see license"})`);
  for (const file of licenseFiles) notices.push(await readFile(resolve(packageRoot, file), "utf8"));
}
await writeFile(resolve(root, "dist/THIRD-PARTY-NOTICES.txt"), notices.join("\n\n") + "\n");
console.log(
  "Built server, public preflight and third-party notices; no credentials or environment values embedded.",
);
