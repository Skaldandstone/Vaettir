const { releaseConfigErrors } = require("./scripts/release-config.cjs");

module.exports = ({ config }) => {
  const projectId = process.env.EXPO_PROJECT_ID ?? config.extra?.eas?.projectId;
  const resolved = {
    ...config,
    extra: { ...config.extra, ...(projectId ? { eas: { ...config.extra?.eas, projectId } } : {}) },
  };
  // Local compile-only checks are deliberately separate from EAS distribution.
  if (process.env.EAS_BUILD === "true") {
    const errors = releaseConfigErrors(process.env, resolved);
    if (errors.length) throw new Error(`NOT DISTRIBUTABLE: ${errors.join(" ")}`);
  }
  return resolved;
};
