import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const VENDOR_POOLS = new Map([
  [
    "https://deb.debian.org/debian/pool/main/e/expat/",
    {
      name: /^expat_[a-zA-Z0-9.+-]+\.(?:dsc|tar\.gz|debian\.tar\.xz)$/,
      maxBytes: 10000000,
      timeout: 60000,
    },
  ],
  [
    "https://deb.debian.org/debian/pool/main/l/llvm-toolchain-19/",
    {
      name: /^llvm-toolchain-19_[a-zA-Z0-9.+-]+\.(?:dsc|orig\.tar\.xz|debian\.tar\.xz)$/,
      maxBytes: 165000000,
      timeout: 180000,
    },
  ],
  [
    "https://deb.debian.org/debian/pool/main/d/dash/",
    {
      name: /^dash_[a-zA-Z0-9.+-]+\.(?:dsc|tar\.gz|debian\.tar\.xz)$/,
      maxBytes: 300000,
      timeout: 60000,
    },
  ],
  [
    "https://deb.debian.org/debian/pool/main/z/zlib/",
    {
      name: /^zlib_[a-zA-Z0-9.+-]+\.(?:dsc|tar\.gz|debian\.tar\.xz)$/,
      maxBytes: 1500000,
      timeout: 60000,
    },
  ],
  [
    "https://github.com/madler/zlib/commit/",
    {
      name: /^df84af25dc1942490e1d1c899a07619152a46148\.patch$/,
      maxBytes: 10000,
      timeout: 60000,
    },
  ],
]);

export async function fetchVerifiedSource(
  file,
  { origin, fetchImpl = fetch, signal } = {},
) {
  const pool = VENDOR_POOLS.get(origin);
  if (
    !pool ||
    !pool.name.test(file.name) ||
    !/^[a-f0-9]{64}$/.test(file.sha256) ||
    !Number.isInteger(file.maxBytes) ||
    file.maxBytes < 1 ||
    file.maxBytes > pool.maxBytes
  )
    throw new Error("Invalid vendor source pin");
  const response = await fetchImpl(origin + file.name, {
    redirect: "error",
    signal: AbortSignal.any([
      AbortSignal.timeout(pool.timeout),
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
  const component = process.argv[3] ?? "expat";
  if (!["expat", "llvm", "dash", "zlib"].includes(component))
    throw new Error("Unknown vendor component");
  await mkdir(destination, { recursive: true });
  for (const file of manifest[component].files) {
    const data = await fetchVerifiedSource(file, {
      origin: file.origin ?? manifest[component].origin,
    });
    await writeFile(join(destination, file.name), data, { flag: "wx" });
  }
  await writeFile(
    join(destination, "source-manifest.json"),
    JSON.stringify({ [component]: manifest[component] }, null, 2) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Pinned Debian ${component} sources verified; no provider credentials used.`,
  );
}
