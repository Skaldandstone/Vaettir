const path = require("node:path");
const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);
// Keep Expo's cache implementation, but never reset another app/worktree's
// shared OS-temp cache when Gradle runs export:embed --reset-cache.
const ExpoFileStore = config.cacheStores[0].constructor;
config.cacheStores = [new ExpoFileStore({ root: path.join(__dirname, ".expo", "metro-cache") })];
module.exports = config;
