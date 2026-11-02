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

const replayStart = "// BEGIN EMBEDDED ANDROID CASE REPLAY\n";
const replayEnd = "// END EMBEDDED ANDROID CASE REPLAY\n";
const replay = readFileSync(
  new URL("./android-case-replay-lib.mjs", import.meta.url),
  "utf8",
)
  .replaceAll("\r\n", "\n")
  .replace(
    "export function createAndroidCaseReplay",
    "function createAndroidCaseReplay",
  );
const updated = readFileSync(path, "utf8");
const ra = updated.indexOf(replayStart),
  rb = updated.indexOf(replayEnd);
if (
  ra < 0 ||
  rb < ra ||
  updated.indexOf(replayStart, ra + replayStart.length) !== -1
)
  throw Error("Exact replay embedding markers required");
writeFileSync(
  path,
  updated.slice(0, ra) + replayStart + replay + "\n" + updated.slice(rb),
);
