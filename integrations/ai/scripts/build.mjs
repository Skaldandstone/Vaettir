import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
await build({
  absWorkingDir: root,
  entryPoints: ["server/index.mjs"],
  outfile: "dist/server.mjs",
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
console.log(
  "Built dist/server.mjs; no credentials or environment values embedded.",
);
