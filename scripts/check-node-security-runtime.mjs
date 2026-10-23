import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  brotliCompressSync,
  brotliDecompressSync,
  createBrotliDecompress,
  constants,
} from "node:zlib";
import { fileURLToPath } from "node:url";

export async function checkNodeSecurityRuntime() {
  const pin = JSON.parse(
    readFileSync(
      new URL("./node-brotli-runtime-sources.json", import.meta.url),
    ),
  ).node;
  assert.equal(process.platform, "linux");
  assert.equal(process.arch, "x64");
  assert.equal(process.versions.node, pin.version);
  const node = readFileSync(process.execPath);
  assert.equal(node.length, pin.binaryBytes);
  assert.equal(
    createHash("sha256").update(node).digest("hex"),
    pin.binarySha256,
  );
  assert.equal(constants.BROTLI_DECODER_ERROR_FORMAT_BLOCK_SWITCH, -17);
  const invalid = Buffer.from(
    "200010414141fcffff07002228f00b60f7f41f000000",
    "hex",
  );
  // The upstream fixture emits a 16 MiB meta-block before its invalid switch.
  // Keep a fixture-specific bound while allowing the decoder to reach the error.
  const outputLimit = 16 * 1024 ** 2 + 256;
  assert.throws(
    () => brotliDecompressSync(invalid, { maxOutputLength: outputLimit }),
    {
      code: "ERR__ERROR_FORMAT_BLOCK_SWITCH",
      errno: -17,
    },
  );
  const stream = createBrotliDecompress();
  let bytes = 0;
  await new Promise((accept, reject) => {
    const deadline = setTimeout(() => {
      stream.destroy();
      reject(new Error("Brotli regression deadline"));
    }, 5000);
    stream.on("data", (b) => {
      bytes += b.length;
      if (bytes > outputLimit) {
        clearTimeout(deadline);
        stream.destroy();
        reject(new Error("Brotli regression output exceeded"));
      }
    });
    stream.once("end", () => {
      clearTimeout(deadline);
      reject(new Error("Invalid Brotli stream was accepted"));
    });
    stream.once("error", (e) => {
      clearTimeout(deadline);
      try {
        assert.equal(e.code, "ERR__ERROR_FORMAT_BLOCK_SWITCH");
        assert.equal(e.errno, -17);
        accept();
      } catch (error) {
        reject(error);
      }
    });
    for (let i = 0; i < invalid.length; i++)
      stream.write(invalid.subarray(i, i + 1));
    stream.end();
  });
  const fixture = Buffer.from(
    "Vaettir synthetic Brotli runtime round trip.\n".repeat(8),
  );
  assert.deepEqual(
    brotliDecompressSync(brotliCompressSync(fixture), {
      maxOutputLength: 4096,
    }),
    fixture,
  );
  return {
    node: process.versions.node,
    nodeBinarySha256: pin.binarySha256,
    signaturePinnedBinary: true,
    invalidBlockSwitchSyncRejected: true,
    invalidBlockSwitchByteStreamRejected: true,
    invalidStreamOutputBytes: bytes,
    invalidStreamOutputLimit: outputLimit,
    error: -17,
    validRoundTrip: true,
    customerInput: false,
  };
}
if (process.argv[1] === fileURLToPath(import.meta.url))
  console.log(JSON.stringify(await checkNodeSecurityRuntime()));
