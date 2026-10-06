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
  // Match the connector's supported development origins. IPv6 loopback is
  // not currently in its CORS allowlist, so do not offer a non-pairable helper.
  const loopback = ["localhost", "127.0.0.1"].includes(url.hostname);
  // These values are embedded in shell scripts. URL parsing alone permits
  // hostname characters that are unsafe in cmd/sh quoting.
  if (
    origin.length > 512 ||
    !/^[a-z0-9.:[\]-]+$/i.test(url.host) ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    url.origin !== origin
  ) {
    throw new Error(
      "The Vaettir origin is not valid for a connector launcher.",
    );
  }
  return url.origin;
}

/** First-party download only; no credentials, redirects or shared temp file. */
function connectorBootstrap(connectorUrl: string, pairingCode: string): string {
  // Deliberately use single-quoted literals: the entire program is quoted by
  // cmd.exe and sh. Both input values have already passed strict validation.
  return [
    "(async()=>{",
    "const fs=require('node:fs');",
    "const path=require('node:path');",
    "const os=require('node:os');",
    "const {spawnSync}=require('node:child_process');",
    "let directory;let file;let fileCreated=false;",
    "try{",
    "if(Number(process.versions.node.split('.')[0])<22){",
    // Diagnostic admission only; the existing major-version refusal is unchanged.
    // Never echo an arbitrary version/error body or private pairing arguments.
    "const installed=/^[0-9]{1,3}\\.[0-9]{1,3}\\.[0-9]{1,4}$/.test(process.versions.node)?process.versions.node:'unavailable';",
    "console.error('Unsupported Node.js version: '+installed+'. This helper requires Node.js 22 or newer. Install a policy-approved version from https://nodejs.org/en/download, then reopen this file.');",
    "process.exitCode=1;return;}",
    "const response=await fetch('" +
      connectorUrl +
      "',{redirect:'error',signal:AbortSignal.timeout(30000)});",
    "if(response.status!==200||!response.body)throw Error('download');",
    "const maximum=2*1024*1024;",
    "const length=response.headers.get('content-length');",
    "if(length!==null&&(!/^[0-9]+$/.test(length)||Number(length)>maximum))throw Error('size');",
    "const type=(response.headers.get('content-type')||'').split(';')[0].trim().toLowerCase();",
    "if(!['application/javascript','text/javascript','application/x-javascript','application/octet-stream','text/plain'].includes(type))throw Error('type');",
    "const chunks=[];let size=0;",
    "for await(const chunk of response.body){size+=chunk.length;if(size>maximum)throw Error('size');chunks.push(Buffer.from(chunk));}",
    "if(size===0)throw Error('empty');",
    "directory=fs.mkdtempSync(path.join(os.tmpdir(),'vaettir-device-'));",
    "file=path.join(directory,'vaettir-device-connector.mjs');",
    "const descriptor=fs.openSync(file,'wx',0o600);fileCreated=true;",
    "try{fs.writeFileSync(descriptor,Buffer.concat(chunks));}finally{fs.closeSync(descriptor);}",
    "const child=spawnSync(process.execPath,[file,'--pairing-code','" +
      pairingCode +
      "'],{stdio:'inherit',shell:false});",
    "if(child.error||child.signal||child.status===null)throw Error('start');",
    "process.exitCode=child.status;",
    "}catch{console.error('The helper could not start. Check Node 22+, your connection and your security product. Use the reviewed manual setup on the Vaettir page; do not disable protection.');process.exitCode=1;}",
    "finally{if(fileCreated){try{fs.unlinkSync(file);}catch{}}if(directory){try{fs.rmdirSync(directory);}catch{}}}",
    "})();",
  ].join(" ");
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
  const bootstrap = connectorBootstrap(connectorUrl, safePairingCode);

  if (platform === "windows") {
    return {
      filename: "Start Vaettir Device Capture.cmd",
      mimeType: "application/x-msdos-program",
      content: [
        "@echo off",
        "setlocal DisableDelayedExpansion",
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
        `node.exe -e "${bootstrap}"`,
        'set "VAETTIR_EXIT=%ERRORLEVEL%"',
        "echo.",
        "echo The connector stopped. You can close this window.",
        "pause",
        "exit /b %VAETTIR_EXIT%",
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
      // The bootstrap uses single-quoted JS literals, so quote it with double
      // quotes in sh too. There are no shell expansions in the fixed program.
      "exit_code=0",
      `node -e "${bootstrap}" || exit_code=$?`,
      "printf '\\nThe connector stopped. Press Return to close. ' && read -r _",
      'exit "$exit_code"',
      "",
    ].join("\n"),
  };
}
