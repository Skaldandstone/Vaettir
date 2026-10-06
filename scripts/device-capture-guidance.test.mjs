import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildDeviceConnectorLauncher } from "../apps/web/lib/deviceConnectorLauncher.ts";

// Documentation/source contracts only. Construct synthetic text, never execute
// a launcher, connector, shell, device/provider command or real pairing code.
const guidance = readFileSync(new URL("../docs/DEVICE_CAPTURE.md", import.meta.url), "utf8");
const page = readFileSync(new URL("../apps/web/app/projects/[projectId]/live-app-generation/page.tsx", import.meta.url), "utf8");
const recipe = readFileSync(new URL("./build-device-connector.mjs", import.meta.url), "utf8");
const normalizedPage = page.replace(/\s+/g, " ");
const normalizedGuidance = guidance.replace(/\s+/g, " ");

test("guidance names the actual delivered unsigned launcher files and capture modes", () => {
  for (const platform of ["windows", "macos", "linux"]) {
    const launcher = buildDeviceConnectorLauncher({ platform, origin: "https://vaettir.skaldandstone.com", pairingCode: "ABCDEF123456" });
    assert.ok(guidance.includes(launcher.filename));
    assert.doesNotMatch(launcher.content, /ExecutionPolicy|Unblock-File|RunAs|\.ps1/i);
  }
  for (const mode of ["Android / ADB", "Connected iOS", "Remote iOS"]) {
    assert.ok(page.includes(`"${mode}"`));
    assert.ok(guidance.includes(`**${mode}**`));
  }
  assert.match(normalizedGuidance, /Node\.js 22 or newer must already be available/);
  assert.match(normalizedGuidance, /not a signed standalone Windows installer/);
  assert.match(recipe, /signed: false, deviceCaptureVerified: false/);
});

test("bounded bootstrap statements match generated text without executing it", () => {
  const { content } = buildDeviceConnectorLauncher({ platform: "windows", origin: "https://vaettir.skaldandstone.com", pairingCode: "ABCDEF123456" });
  assert.match(content, /redirect:'error'/);
  assert.match(content, /AbortSignal\.timeout\(30000\)/);
  assert.match(content, /const maximum=2\*1024\*1024/);
  assert.match(content, /mkdtempSync/);
  assert.match(content, /openSync\(file,'wx',0o600\)/);
  assert.match(content, /spawnSync\(process\.execPath/);
  assert.match(content, /shell:false/);
  assert.match(normalizedGuidance, /30-second download timeout and a 2 MiB body ceiling/);
  assert.match(normalizedGuidance, /old curl\/shared-temp implementation/);
  assert.match(normalizedGuidance, /not a digital signature, immutable version pin, Windows-policy clearance or device test/);
});

test("blocked-launch guidance matches report/cancellation UI and does not diagnose a policy", () => {
  for (const label of ["Windows blocked this helper", "Manual setup and troubleshooting", "Download raw connector"]) {
    assert.ok(normalizedPage.includes(label));
    assert.ok(normalizedGuidance.includes(label));
  }
  assert.match(page, /revokeDeviceConnection\(connectionAttemptRef\.current, \{ blocked: true \}\)/);
  assert.match(normalizedPage, /Already started local discovery may finish; its results are ignored/);
  assert.match(normalizedGuidance, /Already-started local discovery may finish; late results are ignored/);
  assert.match(normalizedGuidance, /The cause is unverified/);
  assert.match(normalizedGuidance, /Do not disable protection, unblock files, remove Mark of the Web, add exclusions, change ExecutionPolicy or Smart App Control, or run as administrator/);
  assert.match(normalizedGuidance, /A PowerShell `\.ps1` workaround is not provided/);
});

test("manual command is the actual Node raw-connector path, not a security bypass", () => {
  assert.match(page, /download="vaettir-device-connector\.mjs"/);
  assert.match(page, /node "vaettir-device-connector\.mjs" --pairing-code /);
  assert.match(guidance, /node "vaettir-device-connector\.mjs" --pairing-code YOUR_PAIRING_CODE/);
  assert.match(normalizedGuidance, /open PowerShell in the downloaded file's actual folder/);
  assert.match(normalizedGuidance, /Do not run this command to circumvent a blocked executable or security policy/);
  assert.match(normalizedGuidance, /Stop if policy also refuses the raw connector/);
  assert.doesNotMatch(guidance, /(?:Set-ExecutionPolicy|Unblock-File|powershell(?:\.exe)?\s+-|Start-Process.*-Verb|curl\.exe)/i);
});

test("connection, private pairing and processing approval remain distinct", () => {
  assert.match(normalizedPage, /No paired helper response was received\. Downloading does not prove that Windows launched it/);
  assert.match(normalizedGuidance, /successful download or a launched terminal does not prove connection, device access or capture/);
  assert.match(normalizedGuidance, /Do not share the launcher, code or screenshots that reveal it/);
  assert.match(normalizedGuidance, /Pairing does not approve capture, upload, AI processing, provider charges or access to another app\/source/);
  assert.match(normalizedGuidance, /Saving a draft creates or updates a case for review, not an approved execution result/);
  assert.doesNotMatch(normalizedGuidance, /the page connects automatically|Download Windows helper|guaranteed (?:launch|connection|capture)/i);
});
