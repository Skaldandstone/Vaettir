// Expo 52's Gradle bundler must run from the mobile app, not the workspace root.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAppBuildGradle } = require("expo/config-plugins");

module.exports = (config) => withAppBuildGradle(config, (result) => {
  if (!result.modResults.contents.includes("root = file(projectRoot)")) {
    if (!result.modResults.contents.includes("react {")) throw new Error("Unknown React Native Gradle template");
    result.modResults.contents = result.modResults.contents.replace("react {", "react {\n    root = file(projectRoot)");
  }
  return result;
});
