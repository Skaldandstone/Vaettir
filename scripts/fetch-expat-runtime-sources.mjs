// Current Expat security source closure. Legacy LLVM checkpoint source pins
// stay immutable and are not repinned to admit this new runtime component.
import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { fetchVerifiedSource } from "./fetch-runtime-vendor-sources.mjs";

export async function acquireExpatSources(destination) {
  const manifest = JSON.parse(
    await readFile(
      new URL("./expat-runtime-sources.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(manifest.expat.version, "2.9.0-1");
  assert.equal(manifest.expat.files.length, 3);
  const out = resolve(destination);
  await mkdir(out, { recursive: false });
  for (const file of manifest.expat.files) {
    const bytes = await fetchVerifiedSource(file, {
      origin: manifest.expat.origin,
    });
    await writeFile(join(out, file.name), bytes, { flag: "wx" });
  }
  await writeFile(
    join(out, "source-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  return { hashesVerified: true, signatureVerificationRequired: true };
}
if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  assert.equal(process.argv.length, 3);
  await acquireExpatSources(process.argv[2]);
  console.log(
    "Pinned Expat 2.9.0 source hashes verified; signature and build acceptance remain required.",
  );
}
