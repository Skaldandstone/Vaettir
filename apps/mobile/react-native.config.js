// Expo 52's in-memory RN config loader can lose pnpm's realpath when loading
// Expo's own config. Preserve the package import declared by Expo itself.
module.exports = {
  dependencies: {
    expo: {
      platforms: {
        android: {
          packageImportPath: "import expo.modules.ExpoModulesPackage;",
          packageInstance: "new ExpoModulesPackage()",
        },
      },
    },
  },
};
