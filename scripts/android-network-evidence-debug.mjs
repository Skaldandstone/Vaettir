// Integrate explicitly into the selected app's DEBUG build only. This does not
// install itself, intercept TLS, patch global fetch, read ADB logs or send data.
export function createDebugAppNetworkEvidence({
  debugBuild,
  packageName,
  runId,
  sourceId,
  approvedRouteKeys,
  fetchImpl,
  now = Date.now,
}) {
  if (
    debugBuild !== true ||
    !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(packageName) ||
    !/^[a-f0-9]{48}$/.test(runId) ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(sourceId) ||
    !Array.isArray(approvedRouteKeys) ||
    !approvedRouteKeys.length ||
    approvedRouteKeys.length > 32 ||
    new Set(approvedRouteKeys).size !== approvedRouteKeys.length ||
    approvedRouteKeys.some((k) => !/^[a-z][a-z0-9_-]{0,63}$/.test(k)) ||
    typeof fetchImpl !== "function"
  )
    throw Error("Explicit debug app and route approval required.");
  const keys = [...approvedRouteKeys],
    events = [];
  let reserved = 0;
  return {
    async request(routeKey, url, options = {}) {
      if (typeof url !== "string")
        throw Error(
          "Pass an explicit URL string so the recorded method cannot differ from a Request object's method.",
        );
      const method = (options.method ?? "GET").toUpperCase();
      if (
        !keys.includes(routeKey) ||
        !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
          method,
        ) ||
        reserved >= 100
      )
        throw Error(
          "Capture capability or budget unavailable; no request sent.",
        );
      reserved++;
      const startedAt = now();
      let status = null,
        outcome = "TRANSPORT_ERROR";
      try {
        const response = await fetchImpl(url, options);
        status = response.status;
        outcome = "RESPONSE";
        return response;
      } finally {
        events.push({
          routeKey,
          method,
          status,
          startedAt,
          durationMs: now() - startedAt,
          outcome,
        });
      }
    },
    exportMetadata() {
      return {
        version: 1,
        capability: "DEBUG_APP_HTTP_CALLBACKS",
        debugBuild: true,
        metadataOnly: true,
        packageName,
        runId,
        sourceId,
        approvedRouteKeys: [...keys],
        events: events.map((e) => ({ ...e })),
      };
    },
  };
}
