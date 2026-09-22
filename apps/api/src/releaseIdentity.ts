const COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const IMAGE_DIGEST_PATTERN = /^sha256:[a-f0-9]{64}$/;

export type ReleaseIdentity = {
  commit: string | null;
  imageDigest: string | null;
  verifiable: boolean;
};

export function getReleaseIdentity(
  env: NodeJS.ProcessEnv = process.env,
): ReleaseIdentity {
  const commit = COMMIT_PATTERN.test(env.VAETTIR_RELEASE_COMMIT ?? "")
    ? env.VAETTIR_RELEASE_COMMIT!
    : null;
  const imageDigest = IMAGE_DIGEST_PATTERN.test(env.VAETTIR_IMAGE_DIGEST ?? "")
    ? env.VAETTIR_IMAGE_DIGEST!
    : null;

  return {
    commit,
    imageDigest,
    verifiable: commit !== null && imageDigest !== null,
  };
}
