type Status<T> = {
  status: "READING" | "READY" | "FAILED" | "CANCELLED";
  checkpoints: number;
  preview?: T;
  error?: string;
};

function pause(signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      done();
      reject(new Error("Workbook reading cancelled."));
    };
    const timer = setTimeout(() => {
      done();
      resolve();
    }, 1500);
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
}

/** No fixed total deadline and no import/commit call. Each poll reauthenticates.
 * Cancellation and stale page cleanup stop only the read, never case writes.
 */
export async function readWorkbookPreview<T>(
  api: {
    start: (requestId: string) => Promise<unknown>;
    status: (requestId: string) => Promise<Status<T>>;
    cancel: (requestId: string) => Promise<unknown>;
  },
  signal: AbortSignal,
  onProgress: (checkpoints: number) => void,
): Promise<T> {
  const requestId = crypto.randomUUID();
  let ready = false;
  try {
    if (signal.aborted) throw new Error("Workbook reading cancelled.");
    await api.start(requestId);
    let failures = 0;
    while (!signal.aborted) {
      let status: Status<T>;
      try {
        status = await api.status(requestId);
        failures = 0;
      } catch (error) {
        // Only retry read-only status transport, never start a second parse or
        // replay an import write. Keep the same original request identity.
        if (++failures >= 3) throw error;
        await pause(signal);
        continue;
      }
      if (signal.aborted) break;
      if (status.status === "READY" && status.preview) {
        ready = true;
        return status.preview;
      }
      if (status.status !== "READING")
        throw new Error(status.error ?? "Workbook reading cancelled.");
      onProgress(status.checkpoints);
      await pause(signal);
    }
    throw new Error("Workbook reading cancelled.");
  } finally {
    if (!ready) void api.cancel(requestId).catch(() => undefined);
  }
}
