// Expo 52's Gradle bundler must run from the mobile app, not the workspace root.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");

module.exports = (config) => {
  config = withProjectBuildGradle(config, (result) => {
    if (!result.modResults.contents.includes("vaettir-short-cxx-path")) {
      result.modResults.contents += `
// vaettir-short-cxx-path: pnpm's Windows store path exceeds CMake's object limit.
subprojects { subproject ->
    if (System.getProperty("os.name").toLowerCase().contains("windows") && subproject.name == "expo-modules-core") {
        subproject.plugins.withId("com.android.library") {
            subproject.android.externalNativeBuild.cmake.buildStagingDirectory = rootProject.file("../.expo/cxx")
        }
    }
}
`;
    }
    return result;
  });
  return withAppBuildGradle(config, (result) => {
  if (!result.modResults.contents.includes("root = file(projectRoot)")) {
    if (!result.modResults.contents.includes("react {")) throw new Error("Unknown React Native Gradle template");
    result.modResults.contents = result.modResults.contents.replace("react {", "react {\n    root = file(projectRoot)");
  }
  // Use the small entry-path adapter instead of patching installed Expo/RN code.
  const cliAssignment = /^\s*cliFile\s*=.*$/m;
  if (!cliAssignment.test(result.modResults.contents)) throw new Error("Unknown Expo CLI Gradle template");
  result.modResults.contents = result.modResults.contents.replace(cliAssignment,
    '\n    cliFile = new File(projectRoot, "scripts/expo-cli.cjs")');
  // A Gradle worker limit does not limit Metro's separate worker pool.
  if (!result.modResults.contents.includes('extraPackagerArgs = ["--max-workers", "2"]')) {
    result.modResults.contents = result.modResults.contents.replace('bundleCommand = "export:embed"',
      'bundleCommand = "export:embed"\n    extraPackagerArgs = ["--max-workers", "2"]');
  }
  return result;
  });
};
