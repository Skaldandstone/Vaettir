import { readFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { test } from "node:test";

const source = readFileSync(new URL("../apps/web/public/connectors/vaettir-device-connector.mjs", import.meta.url), "utf8");
const body = source.slice(source.indexOf("function resolveAdb()"), source.indexOf("function run(command"));
function resolver(platform, env, installed) {
  return new Function("process", "existsSync", "join", `${body}; return resolveAdb();`)(
    { platform, env }, path => installed.includes(path), join,
  );
}
test("existing Android Studio SDK is found without PATH changes or installation", () => {
  const path = join("synthetic-local", "Android", "Sdk", "platform-tools", "adb.exe");
  assert.equal(resolver("win32", { LOCALAPPDATA: "synthetic-local" }, [path]), path);
});
test("explicit existing SDK roots take precedence; absent SDK falls back to PATH", () => {
  const path = join("synthetic-sdk", "platform-tools", "adb");
  assert.equal(resolver("linux", { ANDROID_SDK_ROOT: "synthetic-sdk" }, [path]), path);
  assert.equal(resolver("win32", { LOCALAPPDATA: "synthetic-local" }, []), "adb");
});
test("all connector ADB operations use the same executable resolution", () => {
  assert.match(source, /execFileSync\(command === "adb" \? resolveAdb\(\) : command, args/);
});
