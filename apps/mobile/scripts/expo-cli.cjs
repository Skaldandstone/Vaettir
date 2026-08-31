/* eslint-disable @typescript-eslint/no-require-imports -- Native CLI entrypoint is CommonJS. */
// React Native 0.76 makes CLI paths relative on Windows. Expo 52 interprets
// entry paths relative to Metro's workspace server root, not Gradle's app cwd.
// Keep the entry absolute at that boundary; leave every other option untouched.
const path = require("node:path");

function normalizeEmbedEntry(argv, cwd) {
  if (argv[2] !== "export:embed") return argv;
  const entryIndex = argv.indexOf("--entry-file", 3);
  if (entryIndex < 0 || !argv[entryIndex + 1]) throw new Error("Native bundle is missing --entry-file");
  const normalized = [...argv];
  normalized[entryIndex + 1] = path.resolve(cwd, argv[entryIndex + 1]);
  return normalized;
}

module.exports = { normalizeEmbedEntry };
if (require.main === module) {
  process.argv = normalizeEmbedEntry(process.argv, process.cwd());
  require("expo/bin/cli");
}
