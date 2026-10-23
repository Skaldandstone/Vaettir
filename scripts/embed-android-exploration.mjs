import { readFileSync, writeFileSync } from "node:fs";
const path = new URL(
  "../apps/web/public/connectors/vaettir-device-connector.mjs",
  import.meta.url,
);
const library = readFileSync(
  new URL("./android-exploration-lib.mjs", import.meta.url),
  "utf8",
).replace(
  "export function createAndroidExplorer",
  "function createAndroidExplorer",
);
const start = "// BEGIN EMBEDDED ANDROID EXPLORER\n",
  end = "// END EMBEDDED ANDROID EXPLORER\n";
const source = readFileSync(path, "utf8").replaceAll("\r\n", "\n");
const a = source.indexOf(start),
  b = source.indexOf(end);
if (a < 0 || b < a || source.indexOf(start, a + start.length) !== -1)
  throw Error("Exact embedding markers required");
writeFileSync(
  path,
  source.slice(0, a) + start + library + "\n" + source.slice(b),
);
