import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Uses Node's built-in SEA compiler; the output includes its own runtime.
// Run on each target OS/architecture. This is not a server-runtime upgrade.
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
if (Number(process.versions.node.split(".")[0]) < 26) {
  throw new Error("Build with Node 26.8.1: pnpm dlx node@26.8.1 scripts/build-device-connector.mjs");
}
const outputDir = resolve(root, "dist/device-connector", `${process.platform}-${process.arch}`);
await mkdir(outputDir, { recursive: true });
const executable = resolve(outputDir, `VaettirDeviceConnector${process.platform === "win32" ? ".exe" : ""}`);
const source = resolve(root, "apps/web/public/connectors/vaettir-device-connector.mjs");
const config = resolve(outputDir, "sea-config.json");
await writeFile(config, JSON.stringify({
  main: source, mainFormat: "module", output: executable,
  disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false,
  execArgvExtension: "none",
}, null, 2));
execFileSync(process.execPath, ["--build-sea", config], { stdio: "inherit", windowsHide: true });
const bytes = await readFile(executable);
const manifest = {
  filename: executable.split(/[\\/]/).at(-1), platform: process.platform, architecture: process.arch,
  runtime: process.version, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"),
  sourceSha256: createHash("sha256").update(await readFile(source)).digest("hex"),
  signed: false, deviceCaptureVerified: false,
};
await writeFile(resolve(outputDir, "manifest.json"), JSON.stringify(manifest, null, 2));
if (process.platform === "darwin") {
  const app = resolve(outputDir, "Vaettir Device Connector.app");
  const launcher = resolve(outputDir, "launcher.applescript");
  await writeFile(launcher, [
    'set connectorPath to POSIX path of (path to resource "VaettirDeviceConnector")',
    'tell application "Terminal"',
    'activate',
    'do script quoted form of connectorPath',
    'end tell',
  ].join("\n"));
  execFileSync("/usr/bin/osacompile", ["-o", app, launcher], { stdio: "inherit" });
  await copyFile(executable, resolve(app, "Contents/Resources/VaettirDeviceConnector"));
  execFileSync("/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, resolve(outputDir, "VaettirDeviceConnector-macos.zip")], { stdio: "inherit" });
}
console.log(`Standalone connector: ${executable}`);
console.log("Unsigned development artifact. Sign and verify on target devices before public distribution.");
