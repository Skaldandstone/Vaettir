// Allowlist error telemetry. No request, user, breadcrumbs, context, local
// variables, source excerpts, model input/output or arbitrary error messages.
export function redactTelemetryEvent<T extends object>(event: T): T {
  const source = event as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["event_id", "timestamp", "platform", "level", "release", "environment"]) {
    const value = source[key];
    if (typeof value === "string" && value.length <= 160) safe[key] = value;
    if (key === "timestamp" && typeof value === "number" && Number.isFinite(value)) safe[key] = value;
  }
  const exception = source.exception as { values?: { type?: string; stacktrace?: { frames?: Record<string, unknown>[] } }[] } | undefined;
  if (Array.isArray(exception?.values)) safe.exception = { values: exception.values.slice(0, 5).filter(error => error && typeof error === "object").map((error) => ({
    type: typeof error.type === "string" ? error.type.replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 100) || "Error" : "Error",
    value: "Application error; sensitive details excluded.",
    stacktrace: Array.isArray(error.stacktrace?.frames) ? { frames: error.stacktrace.frames.slice(-50).filter(frame => frame && typeof frame === "object").map((frame) => ({
      filename: typeof frame.filename === "string" ? frame.filename.split(/[?#]/)[0]?.split(/[\\/]/).pop()?.slice(0, 160) : undefined,
      function: typeof frame.function === "string" ? frame.function.replace(/[^a-zA-Z0-9_.$<>]/g, "").slice(0, 100) : undefined,
      lineno: typeof frame.lineno === "number" && Number.isSafeInteger(frame.lineno) && frame.lineno >= 0 ? frame.lineno : undefined,
      colno: typeof frame.colno === "number" && Number.isSafeInteger(frame.colno) && frame.colno >= 0 ? frame.colno : undefined,
      in_app: typeof frame.in_app === "boolean" ? frame.in_app : undefined,
    })) } : undefined,
  })) };
  return safe as T;
}
