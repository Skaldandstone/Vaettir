import { AsyncLocalStorage } from "node:async_hooks";
import * as Sentry from "@sentry/node";

// P12-12: real token usage, captured per logical AI operation. Every
// Anthropic call in this package already funnels through traceAnthropicCall
// below, so this is the one place usage can be summed without touching the
// return type of any exported function (their callers - routers, jobs,
// webhooks - only want the parsed result). Callers that need the numbers
// wrap the call in captureAiUsage(); the AsyncLocalStorage store scopes the
// sum to that async subtree, so two concurrent operations in the same
// process never bleed into each other's totals.
export interface AiUsage {
  inputTokens: number;
  outputTokens: number;
  // How many real Anthropic requests the operation made. Almost always 1
  // today; it becomes meaningful the moment P2-09's chunking splits one
  // logical operation across several requests.
  calls: number;
  // The model the last request used - null only if no request ran.
  model: string | null;
}

interface UsageStore {
  usage: AiUsage;
}

const usageStorage = new AsyncLocalStorage<UsageStore>();

export async function captureAiUsage<T>(fn: () => Promise<T>): Promise<{ result: T; usage: AiUsage }> {
  const store: UsageStore = { usage: { inputTokens: 0, outputTokens: 0, calls: 0, model: null } };
  const result = await usageStorage.run(store, fn);
  return { result, usage: store.usage };
}

function recordUsage(model: string, usage: { input_tokens: number; output_tokens: number }): void {
  const store = usageStorage.getStore();
  if (!store) return;
  store.usage.inputTokens += usage.input_tokens;
  store.usage.outputTokens += usage.output_tokens;
  store.usage.calls += 1;
  store.usage.model = model;
}

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
      recordUsage(model, result.usage);
    }
    return result;
  });
}
