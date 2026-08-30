// Allowlist error telemetry. No request, user, breadcrumbs, context, local
// variables, source excerpts, model input/output or arbitrary error messages.
export function redactTelemetryEvent<T extends object>(event: T): T {
  const source = event as Record<string, unknown>;
  const safe: Record<string, unknown> = {};
  for (const key of ["event_id", "timestamp", "platform", "level", "release", "environment"]) {
    if (typeof source[key] === "string" || typeof source[key] === "number") safe[key] = source[key];
  }
  const exception = source.exception as { values?: { type?: string; stacktrace?: { frames?: Record<string, unknown>[] } }[] } | undefined;
  if (exception?.values) safe.exception = { values: exception.values.map((error) => ({
    type: error.type?.replace(/[^a-zA-Z0-9_.]/g, "").slice(0, 100) || "Error",
    value: "Application error; sensitive details excluded.",
    stacktrace: error.stacktrace ? { frames: error.stacktrace.frames?.map((frame) => ({
      filename: typeof frame.filename === "string" ? frame.filename.split(/[?#]/)[0]?.split(/[\\/]/).pop() : undefined,
      function: typeof frame.function === "string" ? frame.function.replace(/[^a-zA-Z0-9_.$<>]/g, "").slice(0, 100) : undefined,
      lineno: frame.lineno, colno: frame.colno, in_app: frame.in_app,
    })) } : undefined,
  })) };
  return safe as T;
}
