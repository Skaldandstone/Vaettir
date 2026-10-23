export function databaseCredentialLiveness(rotated: boolean) {
  return { statusCode: rotated ? 503 : 200, body: { ok: !rotated } };
}

/** Detect confirmed rotation without replaying transactions or changing an active pool. */
export function createDatabaseCredentialMonitor(options: {
  initialUrl: string;
  resolveUrl: () => Promise<string | undefined>;
  onRotation: () => void;
  onCheckFailure: () => void;
}) {
  let checking = false;
  let rotated = false;
  let checkFailed = false;
  return {
    status: () => ({ rotated, checkFailed }),
    async check() {
      if (checking || rotated) return;
      checking = true;
      try {
        const current = await options.resolveUrl();
        if (!current) throw new Error("Managed credentials unavailable");
        checkFailed = false;
        if (current !== options.initialUrl) {
          rotated = true;
          options.onRotation();
        }
      } catch {
        checkFailed = true;
        // Do not expose the exception: it may contain credentials or endpoints.
        options.onCheckFailure();
      } finally {
        checking = false;
      }
    },
  };
}
