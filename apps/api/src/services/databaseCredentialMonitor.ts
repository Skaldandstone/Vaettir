export function databaseCredentialLiveness() {
  // Pool readiness is reported separately. Rotation must not remove the only
  // serving target while a replacement connection is still being prepared.
  return { statusCode: 200, body: { ok: true } };
}

/** Refresh confirmed rotation without evicting the task or replaying work. */
export function createDatabaseCredentialMonitor(options: {
  initialUrl: string;
  resolveUrl: () => Promise<string | undefined>;
  refresh: (url: string) => Promise<void>;
  onRotation: () => void;
  onCheckFailure: () => void;
}) {
  let checking = false;
  let rotated = false;
  let checkFailed = false;
  let activeUrl = options.initialUrl;
  let refreshing = false;
  let stopped = false;
  return {
    status: () => ({ rotated, checkFailed, refreshing }),
    stop: () => { stopped = true; },
    async check() {
      if (checking || stopped) return;
      checking = true;
      try {
        const current = await options.resolveUrl();
        if (stopped) return;
        if (!current) throw new Error("Managed credentials unavailable");
        checkFailed = false;
        if (current !== activeUrl) {
          rotated = true;
          refreshing = true;
          await options.refresh(current);
          activeUrl = current;
          rotated = false;
          options.onRotation();
        } else {
          rotated = false;
        }
      } catch {
        checkFailed = true;
        // Do not expose the exception: it may contain credentials or endpoints.
        options.onCheckFailure();
      } finally {
        refreshing = false;
        checking = false;
      }
    },
  };
}
