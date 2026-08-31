// Request URLs can contain tRPC inputs. Cloud logs get a finite route category,
// never headers, cookies, IP addresses, query values, bodies or error messages.
export function safeRequestLog(request: { method?: unknown; url?: unknown }) {
  const method = typeof request.method === "string" && ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"].includes(request.method) ? request.method : "OTHER";
  const path = typeof request.url === "string" ? request.url.split(/[?#]/)[0] : "";
  const route = path?.startsWith("/trpc/") || path?.startsWith("/api/trpc/") ? "trpc"
    : ["/health", "/health/detailed", "/api/health", "/api/health/detailed"].includes(path ?? "") ? "health"
      : ["/webhooks/github", "/api/webhooks/github"].includes(path ?? "") ? "github-webhook" : "other";
  return { method, route };
}

export function safeErrorLog(error: unknown) {
  const name = error instanceof Error ? error.name : "Error";
  return { type: ["Error", "TypeError", "RangeError", "ReferenceError", "SyntaxError", "URIError", "EvalError", "AggregateError"].includes(name) ? name : "Error" };
}
