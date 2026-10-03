import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  checkImageRuntime,
  verifyImageLibraryVersions,
} from "./check-image-runtime.mjs";

test("embedded image libraries require the exact maintained patched trio", () => {
  const versions = {
    sharp: "0.35.5",
    vips: "8.18.7",
    xml2: "2.15.4",
    expat: "2.8.5",
  };
  verifyImageLibraryVersions(versions);
  for (const [key, old] of Object.entries({
    sharp: "0.35.4",
    vips: "8.18.6",
    xml2: "2.15.3",
    expat: "2.7.3",
  })) {
    assert.throws(() =>
      verifyImageLibraryVersions({ ...versions, [key]: old }),
    );
    assert.throws(() =>
      verifyImageLibraryVersions({ ...versions, [key]: undefined }),
    );
  }
});

function syntheticPipeline({ badStage = -1, failStage = -1 } = {}) {
  const pixels = Buffer.from([17, 34, 51, 255, 68, 85, 102, 255]);
  const outputs = [
    Buffer.from("authored PNG placeholder"),
    { info: { width: 2, height: 1 }, data: pixels },
    Buffer.from("authored WebP placeholder"),
    pixels,
    Buffer.from([17, 34, 51, 255, 17, 34, 51, 255]),
  ];
  let stage = 0;
  const timeouts = [];
  const sharp = () => {
    const chain = {
      timeout(options) {
        timeouts.push(options.seconds);
        return chain;
      },
      png() {
        return chain;
      },
      ensureAlpha() {
        return chain;
      },
      raw() {
        return chain;
      },
      webp() {
        return chain;
      },
      async toBuffer() {
        const current = stage++;
        if (current === failStage)
          throw Error("Synthetic native conversion failure");
        if (current === badStage)
          return current === 1
            ? { info: { width: 2, height: 1 }, data: Buffer.alloc(8) }
            : Buffer.alloc(8);
        return outputs[current];
      },
    };
    return chain;
  };
  sharp.versions = {
    sharp: "0.35.5",
    vips: "8.18.7",
    xml2: "2.15.4",
    expat: "2.8.5",
  };
  sharp.cache = () => {};
  return { sharp, timeouts };
}

test("all image transformations require exact pixels and bounded native operations", async () => {
  const fixture = syntheticPipeline();
  const result = await checkImageRuntime(fixture.sharp);
  assert.equal(result.customerInput, false);
  assert.deepEqual(fixture.timeouts, [5, 5, 5, 5, 5]);
  for (const badStage of [1, 3, 4]) {
    await assert.rejects(
      checkImageRuntime(syntheticPipeline({ badStage }).sharp),
    );
  }
  for (const failStage of [0, 1, 2, 3, 4]) {
    await assert.rejects(
      checkImageRuntime(syntheticPipeline({ failStage }).sharp),
      /Synthetic native conversion failure/,
    );
  }
});

test("both real final images run the isolated native image check", () => {
  for (const component of ["api", "web"]) {
    const docker = readFileSync(
      new URL(`../Dockerfile.${component}`, import.meta.url),
      "utf8",
    );
    assert.match(
      docker,
      /^RUN --network=none node scripts\/check-image-runtime.mjs$/m,
    );
  }
  const workspace = readFileSync(
    new URL("../pnpm-workspace.yaml", import.meta.url),
    "utf8",
  );
  assert.match(workspace, /'sharp@>=0\.34\.0 <0\.35\.5': '0\.35\.5'/);
});

test("standalone retains the actual native version receipt rather than weakening runtime checks", () => {
  const config = readFileSync(new URL("../apps/web/next.config.mjs", import.meta.url), "utf8");
  assert.match(config, /outputFileTracingRoot:\s*fileURLToPath\(new URL\("\.\.\/\.\.\/", import\.meta\.url\)\)/);
  assert.match(config, /outputFileTracingIncludes:\s*\{\s*"\/\*":/);
  assert.ok(config.includes("../../node_modules/.pnpm/@img+sharp-libvips-linux-x64@1.3.4/node_modules/@img/sharp-libvips-linux-x64/versions.json"));
  const missingReceiptVersions = { sharp: "0.35.5", vips: "8.18.7" };
  assert.throws(() => verifyImageLibraryVersions(missingReceiptVersions), /Embedded XML runtime is not patched/);
});
