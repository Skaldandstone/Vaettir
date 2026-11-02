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

const networkStart = "// BEGIN EMBEDDED ANDROID NETWORK EVIDENCE\n",
  networkEnd = "// END EMBEDDED ANDROID NETWORK EVIDENCE\n";
const network = readFileSync(
  new URL("./android-network-evidence-native.mjs", import.meta.url),
  "utf8",
)
  .replaceAll("\r\n", "\n")
  .replace(
    "export function createAndroidNetworkEvidenceAdapter",
    "function createAndroidNetworkEvidenceAdapter",
  );
const withReplay = readFileSync(path, "utf8"),
  na = withReplay.indexOf(networkStart),
  nb = withReplay.indexOf(networkEnd);
if (
  na < 0 ||
  nb < na ||
  withReplay.indexOf(networkStart, na + networkStart.length) !== -1
)
  throw Error("Exact network embedding markers required");
writeFileSync(
  path,
  withReplay.slice(0, na) +
    networkStart +
    network +
    "\n" +
    withReplay.slice(nb),
);
