const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;
const PLACEHOLDER_COMMIT = "0".repeat(40);
const PLACEHOLDER_IMAGE_DIGEST = `sha256:${"0".repeat(64)}`;

export type ReleaseIdentity = {
  commit: string | null;
  imageDigest: string | null;
  verifiable: boolean;
};

export function getReleaseIdentity(
  env: NodeJS.ProcessEnv = process.env,
): ReleaseIdentity {
  const commit =
    COMMIT_PATTERN.test(env.VAETTIR_RELEASE_COMMIT ?? "") &&
    env.VAETTIR_RELEASE_COMMIT !== PLACEHOLDER_COMMIT
      ? env.VAETTIR_RELEASE_COMMIT!
      : null;
  const imageDigest =
    IMAGE_DIGEST_PATTERN.test(env.VAETTIR_IMAGE_DIGEST ?? "") &&
    env.VAETTIR_IMAGE_DIGEST !== PLACEHOLDER_IMAGE_DIGEST
      ? env.VAETTIR_IMAGE_DIGEST!
      : null;

  return {
    commit,
    imageDigest,
    verifiable: commit !== null && imageDigest !== null,
  };
}

export function assertProductionReleaseIdentity(
  env: NodeJS.ProcessEnv = process.env,
) {
  const identity = getReleaseIdentity(env);
  if (env.NODE_ENV === "production" && !identity.verifiable) {
    throw new Error(
      "Production startup requires a real VAETTIR_RELEASE_COMMIT and VAETTIR_IMAGE_DIGEST",
    );
  }
  return identity;
}
