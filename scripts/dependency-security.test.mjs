import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Worker } from "node:worker_threads";
import { createHash } from "node:crypto";

// Resolve the real consuming package's copy, never a convenient root dependency.
const mobile = createRequire(new URL("../apps/mobile/package.json", import.meta.url));
const expo = createRequire(mobile.resolve("expo/package.json"));
const cli = createRequire(expo.resolve("@expo/cli/package.json"));
const web = createRequire(new URL("../apps/web/package.json", import.meta.url));
const next = createRequire(web.resolve("next/package.json"));

test("committed package patches match the lockfile's integrity hashes", async () => {
  const lockfile = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  for (const [dependency, filename] of [["@expo/cli@0.22.28", "@expo__cli@0.22.28.patch"], ["image-size@1.2.1", "image-size@1.2.1.patch"]]) {
    const patch = await readFile(new URL(`../patches/${filename}`, import.meta.url));
    assert.ok(!patch.includes(13), "Patch files must retain LF endings on Windows and Linux");
    const digest = createHash("sha256").update(patch).digest("hex");
    const entry = lockfile.split("\n").find(line => line.trimStart().startsWith(`${dependency}:`) || line.trimStart().startsWith(`'${dependency}':`));
    assert.ok(entry?.trimEnd().endsWith(`: ${digest}`), `${dependency} patch integrity mismatch`);
  }
});

async function temporary(action) {
  const directory = await mkdtemp(path.join(tmpdir(), "vaettir-dependency-test-"));
  try { await action(directory); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("Expo's tar consumer extracts a locally generated gzip archive", async () => temporary(async (directory) => {
  const tar = cli("tar");
  const source = path.join(directory, "source");
  const target = path.join(directory, "target");
  await mkdir(source); await mkdir(target);
  await writeFile(path.join(source, "fixture.txt"), "Vaettir archive fixture");
  const archive = path.join(directory, "fixture.tgz");
  await tar.create({ cwd: source, file: archive, gzip: true }, ["fixture.txt"]);
  const { extractAsync } = cli("@expo/cli/build/src/utils/tar.js");
  await extractAsync(archive, target);
  assert.equal(await readFile(path.join(target, "fixture.txt"), "utf8"), "Vaettir archive fixture");
  const entries = [];
  await tar.list({ file: archive, onReadEntry: (entry) => entries.push(entry.path) });
  assert.deepEqual(entries, ["fixture.txt"]);
  const npmTarget = path.join(directory, "npm-target");
  const { extractLocalNpmTarballAsync } = cli("@expo/cli/build/src/utils/npm.js");
  const checksum = await extractLocalNpmTarballAsync(archive, { cwd: npmTarget, strip: 0, name: "fixture", checksumAlgorithm: "sha256" });
  assert.match(checksum, /^[0-9a-f]{64}$/);
  assert.equal(await readFile(path.join(npmTarget, "fixture.txt"), "utf8"), "Vaettir archive fixture");
}));

test("Expo's cacache consumer retains integrity-checked round trips", async () => temporary(async (directory) => {
  const cache = cli("cacache");
  await cache.put(directory, "fixture", "cache value");
  assert.equal((await cache.get(directory, "fixture")).data.toString(), "cache value");
  assert.equal((await cache.verify(directory)).badContentCount, 0);
}));

test("Expo plist and xmldom retain XML escaping and nested values", () => {
  const plist = cli("@expo/plist").default;
  const value = { CFBundleName: "Vaettir <beta> & team", nested: { enabled: true, count: 5 }, array: ["one", "two"] };
  assert.deepEqual(plist.parse(plist.build(value)), value);
});

test("Next and Expo Metro resolve patched PostCSS and preserve CSS output", async () => {
  const metro = createRequire(expo.resolve("@expo/metro-config"));
  for (const consumer of [next, metro]) {
    const postcss = consumer("postcss");
    assert.equal(consumer("postcss/package.json").version, "8.5.26");
    const result = await postcss([]).process(".beta { color: #26211b; }", { from: undefined, map: false });
    assert.equal(result.css, ".beta { color: #26211b; }");
  }
});

test("Next's sharp native binary decodes, rotates, resizes and encodes", async () => {
  const sharp = next("sharp");
  assert.equal(sharp.versions.sharp, "0.35.4");
  const png = await sharp({ create: { width: 24, height: 12, channels: 4, background: "#26211b" } }).png().toBuffer();
  for (const format of ["webp", "jpeg", "png", "avif"]) {
    const result = await sharp(png).rotate().resize(8, 8, { fit: "inside" }).toFormat(format).toBuffer();
    const metadata = await sharp(result).metadata();
    assert.equal(metadata.width, 8);
    assert.equal(metadata.height, 4);
  }
});

test("Expo's UUID consumers keep their CommonJS v1/v4 contracts", () => {
  for (const consumer of ["@expo/bunyan", "@expo/rudder-sdk-node", "jayson"]) {
    const consumerRequire = createRequire(cli.resolve(consumer));
    const uuid = consumerRequire("uuid");
    assert.equal(consumerRequire("uuid/package.json").version, "11.1.1");
    assert.ok(uuid.validate(uuid.v1()));
    assert.ok(uuid.validate(uuid.v4()));
  }
  const configPlugins = createRequire(expo.resolve("@expo/config-plugins"));
  const xcode = configPlugins("xcode");
  const project = xcode.project("unused.pbxproj");
  project.hash = { project: { objects: {} } };
  assert.match(project.generateUuid(), /^[0-9A-F]{24}$/);
});

function imageConsumer() {
  const reactNative = createRequire(mobile.resolve("react-native/package.json"));
  const community = createRequire(reactNative.resolve("@react-native/community-cli-plugin"));
  return createRequire(community.resolve("metro"));
}

function box(name, size, payload = Buffer.alloc(0)) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(size, 0); header.write(name, 4);
  return Buffer.concat([header, payload]);
}

function sizedBox(name, payload = Buffer.alloc(0)) {
  return box(name, payload.length + 8, payload);
}

const jxlPrefix = Buffer.concat([sizedBox("JXL ", Buffer.from([13, 10, 135, 10])), sizedBox("ftyp", Buffer.from("jxl "))]);
const heifPrefix = sizedBox("ftyp", Buffer.concat([Buffer.from("heic"), Buffer.alloc(4), Buffer.from("heicmif1")]));

test("every locked image-size consumer selects the pinned patched copy", async () => {
  // This does not cover parsers vendored inside Next. The web config contract
  // disables unused entry points, but its bundled parser still needs review.
  const lockfile = await readFile(new URL("../pnpm-lock.yaml", import.meta.url), "utf8");
  const entries = lockfile.split("\n").filter(line => /^ {6}image-size:/.test(line));
  assert.equal(entries.length, 1, "Review newly introduced image-size consumers");
  assert.match(entries[0], /1\.2\.1\(patch_hash=f8e038ee5a4cecc5b4bbd34e610bfa7687291875927a37b4296b409ba2d3d871\)/);
  const metro = imageConsumer();
  assert.equal(metro("image-size/package.json").version, "1.2.1");
  const installed = createRequire(metro.resolve("image-size"));
  assert.match(await readFile(installed.resolve("./types/icns.js"), "utf8"), /Invalid ICNS entry length/);
  assert.match(await readFile(installed.resolve("./types/utils.js"), "utf8"), /if \(boxSize < 8\)/);
});

test("Metro image-size rejects non-advancing and truncated entries in a bounded worker", async () => {
  const metro = imageConsumer();
  const imageSizePath = metro.resolve("image-size");
  const icns = Buffer.alloc(16);
  icns.write("icns"); icns.writeUInt32BE(16, 4); icns.write("icp4", 8);
  const vectors = [];
  for (let size = 0; size < 8; size++) {
    const invalidIcns = Buffer.from(icns); invalidIcns.writeUInt32BE(size, 12);
    vectors.push(invalidIcns);
    vectors.push(Buffer.concat([jxlPrefix, box("jxlp", size)]));
    vectors.push(Buffer.concat([heifPrefix, box("meta", size)]));
  }
  for (let length = 0; length < 8; length++) {
    vectors.push(icns.subarray(0, 8 + length));
    vectors.push(Buffer.concat([jxlPrefix, box("jxlp", 12).subarray(0, length)]));
    vectors.push(Buffer.concat([heifPrefix, box("meta", 12).subarray(0, length)]));
  }
  vectors.push(Buffer.concat([jxlPrefix, box("jxlc", 4096, Buffer.from([255, 10]))]));
  vectors.push(Buffer.concat([heifPrefix, box("meta", 4096, Buffer.alloc(4))]));
  vectors.push(Buffer.concat([jxlPrefix, sizedBox("free"), box("jxlp", 0), box("jxlp", 0)]));
  vectors.push(Buffer.concat([jxlPrefix, sizedBox("jxlp", Buffer.concat([Buffer.alloc(4), Buffer.from([255, 10])])), box("jxlp", 0)]));
  vectors.push(Buffer.concat([heifPrefix, sizedBox("meta", Buffer.concat([Buffer.alloc(4), box("iprp", 0)]))]));
  await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const imageSize = require(workerData.imageSizePath);
      const rejected = workerData.vectors.map(value => {
        try { imageSize(Buffer.from(value, 'base64')); return false; }
        catch { return true; }
      });
      parentPort.postMessage(rejected);
    `, { eval: true, workerData: { imageSizePath, vectors: vectors.map(value => value.toString("base64")) }, resourceLimits: { maxOldGenerationSizeMb: 32 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("image-size parser did not terminate")); }, 2000);
    worker.once("error", (error) => { clearTimeout(timer); reject(error); });
    worker.once("message", (rejected) => {
      clearTimeout(timer);
      try { assert.deepEqual(rejected, vectors.map(() => true)); resolve(); }
      catch (error) { reject(error); }
    });
  });
});

test("image-size preserves supported ICNS, JXL and HEIF dimension paths", async () => {
  const metro = imageConsumer();
  const imageSize = metro("image-size");
  // Small metadata fixtures exercise parser paths, not complete codec/render acceptance.
  const validIcon = Buffer.alloc(24);
  validIcon.write("icns"); validIcon.writeUInt32BE(24, 4);
  validIcon.write("icp4", 8); validIcon.writeUInt32BE(8, 12);
  validIcon.write("icp5", 16); validIcon.writeUInt32BE(8, 20);
  assert.deepEqual(imageSize(validIcon).images.map(image => image.width), [16, 32]);
  const stream = Buffer.from([255, 10, 3, 4]); // Small image, height 16, explicit width 24.
  const jxl = Buffer.concat([jxlPrefix, sizedBox("free"), sizedBox("jxlc", stream)]);
  assert.deepEqual(imageSize(jxl), { width: 24, height: 16, type: "jxl" });
  const first = sizedBox("jxlp", Buffer.concat([Buffer.alloc(4), stream.subarray(0, 2)]));
  const lastIndex = Buffer.alloc(4); lastIndex.writeUInt32BE(0x80000001);
  const last = sizedBox("jxlp", Buffer.concat([lastIndex, stream.subarray(2)]));
  assert.deepEqual(imageSize(Buffer.concat([jxlPrefix, first, sizedBox("free"), last])), { width: 24, height: 16, type: "jxl" });
  const dimensions = Buffer.alloc(12); dimensions.writeUInt32BE(37, 4); dimensions.writeUInt32BE(19, 8);
  const ipco = sizedBox("ipco", Buffer.concat([sizedBox("free"), sizedBox("ispe", dimensions)]));
  const meta = sizedBox("meta", Buffer.concat([Buffer.alloc(4), sizedBox("iprp", ipco)]));
  assert.deepEqual(imageSize(Buffer.concat([heifPrefix, meta])), { width: 37, height: 19, type: "heic" });
  const png = await next("sharp")({ create: { width: 10, height: 6, channels: 4, background: "#26211b" } }).png().toBuffer();
  assert.deepEqual(imageSize(png), { width: 10, height: 6, type: "png" });
});

test("actual Metro buffer and file asset paths reach patched parsers despite a png filename", async () => temporary(async (directory) => {
  const metro = imageConsumer();
  const assetsPath = metro.resolve("metro/src/Assets.js");
  const icns = Buffer.alloc(16);
  icns.write("icns"); icns.writeUInt32BE(16, 4); icns.write("icp4", 8);
  const malformed = [icns, Buffer.concat([jxlPrefix, box("jxlp", 0)]), Buffer.concat([heifPrefix, box("meta", 0)])];
  const goodIcon = Buffer.from(icns); goodIcon.writeUInt32BE(8, 12);
  const files = [];
  for (let index = 0; index < malformed.length; index++) {
    const file = path.join(directory, `hostile-${index}.png`);
    await writeFile(file, malformed[index]); files.push(file);
  }
  const positive = path.join(directory, "valid-metadata.png"); await writeFile(positive, goodIcon);
  await new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const { readFileSync } = require('node:fs');
      const assets = require(workerData.assetsPath);
      (async () => {
        const rejected = [];
        for (const file of workerData.files) {
          let bufferRejected = false, fileRejected = false;
          try { assets.getAssetSize('png', readFileSync(file), file); } catch { bufferRejected = true; }
          try { await assets.getAssetData(file, 'fixture.png', [], null, '/assets'); } catch { fileRejected = true; }
          rejected.push([bufferRejected, fileRejected]);
        }
        const validBuffer = assets.getAssetSize('png', readFileSync(workerData.positive), workerData.positive);
        const validFile = await assets.getAssetData(workerData.positive, 'fixture.png', [], null, '/assets');
        parentPort.postMessage({ rejected, validBuffer, validFile: { width: validFile.width, height: validFile.height } });
      })().catch(error => { throw error; });
    `, { eval: true, workerData: { assetsPath, files, positive }, resourceLimits: { maxOldGenerationSizeMb: 64 } });
    const timer = setTimeout(() => { void worker.terminate(); reject(new Error("Metro asset parser did not terminate")); }, 3000);
    worker.once("error", error => { clearTimeout(timer); reject(error); });
    worker.once("message", result => {
      clearTimeout(timer);
      try {
        assert.deepEqual(result.rejected, malformed.map(() => [true, true]));
        // ICNS dimensions through a .png name prove content-based dispatch.
        assert.deepEqual(result.validBuffer, { width: 16, height: 16 });
        assert.deepEqual(result.validFile, { width: 16, height: 16 });
        resolve();
      } catch (error) { reject(error); }
    });
  });
}));
