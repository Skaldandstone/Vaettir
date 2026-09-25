export type DeviceConnectorPlatform = "windows" | "macos" | "linux";

const PAIRING_CODE_PATTERN = /^[A-F0-9]{12}$/;

export function createDeviceConnectorPairingCode(): string {
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

export function detectDeviceConnectorPlatform(
  userAgent: string,
): DeviceConnectorPlatform {
  if (/macintosh|mac os x/i.test(userAgent)) return "macos";
  if (/linux/i.test(userAgent) && !/android/i.test(userAgent)) return "linux";
  return "windows";
}

function validatedOrigin(origin: string): string {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin) {
    throw new Error(
      "The Vaettir origin is not valid for a connector launcher.",
    );
  }
  return url.origin;
}

function validatedPairingCode(pairingCode: string): string {
  const normalized = pairingCode.trim().toUpperCase();
  if (!PAIRING_CODE_PATTERN.test(normalized)) {
    throw new Error("The device connector pairing code is invalid.");
  }
  return normalized;
}

export function buildDeviceConnectorLauncher({
  platform,
  origin,
  pairingCode,
}: {
  platform: DeviceConnectorPlatform;
  origin: string;
  pairingCode: string;
}): { filename: string; content: string; mimeType: string } {
  const safeOrigin = validatedOrigin(origin);
  const safePairingCode = validatedPairingCode(pairingCode);
  const connectorUrl = `${safeOrigin}/connectors/vaettir-device-connector.mjs`;

  if (platform === "windows") {
    return {
      filename: "Start Vaettir Device Capture.cmd",
      mimeType: "application/x-msdos-program",
      content: [
        "@echo off",
        "setlocal",
        "title Vaettir Device Capture",
        "echo.",
        "echo Starting Vaettir Device Capture...",
        "where node.exe >nul 2>nul",
        "if errorlevel 1 (",
        "  echo.",
        "  echo Node.js 22 or newer is required. Install it, then open this file again:",
        "  echo https://nodejs.org/en/download",
        "  echo.",
        "  pause",
        "  exit /b 1",
        ")",
        'set "VAETTIR_CONNECTOR=%TEMP%\\vaettir-device-connector.mjs"',
        `curl.exe --fail --location --silent --show-error "${connectorUrl}" --output "%VAETTIR_CONNECTOR%"`,
        "if errorlevel 1 (",
        "  echo.",
        "  echo The Vaettir connector could not be downloaded. Check your connection and try again.",
        "  echo.",
        "  pause",
        "  exit /b 1",
        ")",
        `node.exe "%VAETTIR_CONNECTOR%" --pairing-code ${safePairingCode}`,
        "echo.",
        "echo The connector stopped. You can close this window.",
        "pause",
        "",
      ].join("\r\n"),
    };
  }

  const extension = platform === "macos" ? "command" : "sh";
  return {
    filename: `Start Vaettir Device Capture.${extension}`,
    mimeType: "text/x-shellscript",
    content: [
      "#!/bin/sh",
      "set -eu",
      "printf '\\nStarting Vaettir Device Capture...\\n'",
      "if ! command -v node >/dev/null 2>&1; then",
      "  printf '\\nNode.js 22 or newer is required: https://nodejs.org/en/download\\n'",
      "  printf 'Press Return to close. ' && read -r _",
      "  exit 1",
      "fi",
      'connector_path="${TMPDIR:-/tmp}/vaettir-device-connector.mjs"',
      `curl --fail --location --silent --show-error '${connectorUrl}' --output "$connector_path"`,
      `node "$connector_path" --pairing-code ${safePairingCode}`,
      "printf '\\nThe connector stopped. Press Return to close. ' && read -r _",
      "",
    ].join("\n"),
  };
}
