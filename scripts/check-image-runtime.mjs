import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

export function verifyImageLibraryVersions(versions) {
  assert.equal(versions?.sharp, "0.35.5", "Unexpected Sharp runtime");
  assert.equal(versions?.vips, "8.18.7", "Unexpected libvips runtime");
  assert.equal(versions?.xml2, "2.15.4", "Embedded XML runtime is not patched");
  assert.equal(
    versions?.expat,
    "2.8.5",
    "Embedded Expat runtime is not patched",
  );
}

export async function checkImageRuntime(sharpImpl) {
  if (!sharpImpl) {
    // Use Next's actual dependency resolution, including standalone tracing.
    const webRequire = createRequire(
      new URL("../apps/web/package.json", import.meta.url),
    );
    sharpImpl = createRequire(webRequire.resolve("next/package.json"))("sharp");
  }
  verifyImageLibraryVersions(sharpImpl.versions);
  sharpImpl.cache(false);
  const pixels = Buffer.from([17, 34, 51, 255, 68, 85, 102, 255]);
  const input = {
    raw: { width: 2, height: 1, channels: 4 },
    limitInputPixels: 256,
  };
  const png = await sharpImpl(pixels, input)
    .timeout({ seconds: 5 })
    .png()
    .toBuffer();
  const decoded = await sharpImpl(png, { limitInputPixels: 256 })
    .timeout({ seconds: 5 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.equal(decoded.info.width, 2);
  assert.equal(decoded.info.height, 1);
  assert.deepEqual(decoded.data, pixels);
  const webp = await sharpImpl(png, { limitInputPixels: 256 })
    .timeout({ seconds: 5 })
    .webp({ lossless: true })
    .toBuffer();
  const webpPixels = await sharpImpl(webp, { limitInputPixels: 256 })
    .timeout({ seconds: 5 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(webpPixels, pixels);
  // Authored constant fixture only: no scripts, external links, DTD or entities.
  const svg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="2" height="1"><rect width="2" height="1" fill="#112233"/></svg>',
  );
  const svgPixels = await sharpImpl(svg, { limitInputPixels: 256 })
    .timeout({ seconds: 5 })
    .ensureAlpha()
    .raw()
    .toBuffer();
  assert.deepEqual(svgPixels, Buffer.from([17, 34, 51, 255, 17, 34, 51, 255]));
  return {
    versions: sharpImpl.versions,
    checks: [
      "PNG exact pixels",
      "lossless WebP exact pixels",
      "authored SVG exact pixels",
    ],
    customerInput: false,
  };
}

if (
  process.argv[1] &&
  pathToFileURL(process.argv[1]).href === import.meta.url
) {
  checkImageRuntime()
    .then((result) =>
      console.log(`Image runtime verified: ${JSON.stringify(result)}`),
    )
    .catch(() => {
      console.error(
        "Image runtime validation failed; no customer input or credentials logged",
      );
      process.exitCode = 1;
    });
}
