import * as Sentry from "@sentry/node";

// P10-06: every real Anthropic call in this package funnels through here,
// so latency/cost/failure-rate for the single most expensive and most
// failure-prone path in the platform shows up as real Sentry spans -
// without needing a separate OpenTelemetry SDK/collector, since @sentry/
// node (P10-05) already IS an OTel-based tracer once SENTRY_DSN is set.
// Sentry.startSpan is a safe no-op when Sentry was never initialized (no
// DSN, or this function running outside the apps/api process), matching
// the same "inert until configured" contract P10-05's error capture
// already relies on - callers never need to check whether tracing is
// actually active.
export async function traceAnthropicCall<T extends { usage?: { input_tokens: number; output_tokens: number } }>(
  operation: string,
  model: string,
  fn: () => Promise<T>,
): Promise<T> {
  return Sentry.startSpan({ op: "ai.anthropic", name: operation, attributes: { "ai.model": model } }, async (span) => {
    const result = await fn();
    if (result.usage) {
      span.setAttribute("ai.input_tokens", result.usage.input_tokens);
      span.setAttribute("ai.output_tokens", result.usage.output_tokens);
    }
    return result;
  });
}
