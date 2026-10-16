/** Dedicated credential requests must not be duplicated into error telemetry,
 * including query parameters, headers, body, cookies, or nearby breadcrumbs. */
export function redactAiDisclosureEvent<
  T extends { request?: { url?: string }; breadcrumbs?: unknown[] },
>(event: T): T {
  const url = event.request?.url ?? "";
  if (!url.includes("/integrations/ai/") && !url.includes("aiDisclosure."))
    return event;
  return {
    ...event,
    request: { url: "/api/integrations/ai/[redacted]" },
    breadcrumbs: [],
  };
}
