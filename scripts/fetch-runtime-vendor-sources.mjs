import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export async function fetchVerifiedSource(
  file,
  { origin, fetchImpl = fetch, signal } = {},
) {
  if (
    origin !== "https://deb.debian.org/debian/pool/main/e/expat/" ||
    !/^expat_[a-zA-Z0-9.+-]+\.(?:dsc|tar\.gz|debian\.tar\.xz)$/.test(
      file.name,
    ) ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !Number.isInteger(file.maxBytes) ||
    file.maxBytes < 1 ||
    file.maxBytes > 10_000_000
  )
    throw new Error("Invalid vendor source pin");
  const response = await fetchImpl(origin + file.name, {
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(60_000),
      ...(signal ? [signal] : []),
    ]),
  });
  if (!response.ok) throw new Error("Vendor source download failed");
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > file.maxBytes) throw new Error("Vendor source size exceeded");
    chunks.push(chunk);
  }
  const data = Buffer.concat(chunks);
  if (createHash("sha256").update(data).digest("hex") !== file.sha256)
    throw new Error("Vendor source checksum mismatch");
  return data;
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const destination = resolve(process.argv[2] ?? "/build/runtime-sources");
  const manifest = JSON.parse(
    await readFile(
      new URL("./runtime-vendor-sources.json", import.meta.url),
      "utf8",
    ),
  );
  await mkdir(destination, { recursive: true });
  for (const file of manifest.expat.files) {
    const data = await fetchVerifiedSource(file, {
      origin: manifest.expat.origin,
    });
    await writeFile(join(destination, file.name), data, { flag: "wx" });
  }
  await writeFile(
    join(destination, "source-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    "Pinned Debian Expat sources verified; no provider credentials used.",
  );
}
