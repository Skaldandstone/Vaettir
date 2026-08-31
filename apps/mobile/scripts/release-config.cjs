/* eslint-disable @typescript-eslint/no-require-imports -- Used by Expo's CommonJS config. */
const fs = require("node:fs");
const path = require("node:path");

const PRODUCTION_API = "https://vaettir.skaldandstone.com/api";
function releaseConfigErrors(env, config) {
  const errors = [];
  if (!/^pk_live_[A-Za-z0-9_-]+$/.test(env.EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY ?? "")) errors.push("Set the approved production Clerk publishable key (pk_live_). Never use a secret key.");
  if ((env.EXPO_PUBLIC_API_URL ?? config.extra?.apiUrl) !== PRODUCTION_API) errors.push("Beta distribution must use the approved production HTTPS API endpoint.");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(env.EXPO_PROJECT_ID ?? config.extra?.eas?.projectId ?? "")) errors.push("Set EXPO_PROJECT_ID to the approved Expo project's UUID.");
  if (config.android?.package !== "com.skaldandstone.vaettir" || config.ios?.bundleIdentifier !== "com.skaldandstone.vaettir") errors.push("App identifiers differ from the approved signing handoff.");
  if (config.android?.allowBackup !== false) errors.push("Android backup must remain disabled for the no-offline-storage beta.");
  if (!Number.isInteger(config.android?.versionCode) || config.android.versionCode < 1 || !/^\d+$/.test(config.ios?.buildNumber ?? "") || Number(config.ios.buildNumber) < 1) errors.push("Both platforms require positive native build numbers.");
  return errors;
}

module.exports = { releaseConfigErrors };
if (require.main === module) {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "../app.json"), "utf8")).expo;
  const errors = releaseConfigErrors(process.env, config);
  if (errors.length) { console.error(`NOT DISTRIBUTABLE:\n${errors.join("\n")}`); process.exitCode = 1; }
  else console.log("Static release configuration passed. Signing identity, restricted access, cost approval and device acceptance still require verification.");
}
