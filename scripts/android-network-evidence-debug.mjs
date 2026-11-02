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
  catalog,
  clockId,
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
  const reviewedCatalog =
    catalog === undefined ? null : validateDebugCatalog(catalog);
  if (
    reviewedCatalog &&
    (!/^[a-f0-9]{48}$/.test(clockId) ||
      JSON.stringify(reviewedCatalog.routes.map((r) => r.routeKey)) !==
        JSON.stringify(approvedRouteKeys))
  )
    throw Error("Exact catalog and local clock session required.");
  const keys = [...approvedRouteKeys],
    events = [];
  let reserved = 0,
    pending = 0,
    stopped = false;
  return {
    async request(routeKey, url, options = {}) {
      if (typeof url !== "string")
        throw Error(
          "Pass an explicit URL string so the recorded method cannot differ from a Request object's method.",
        );
      const method = (options.method ?? "GET").toUpperCase();
      if (
        stopped ||
        !keys.includes(routeKey) ||
        !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
          method,
        ) ||
        reserved >= 100
      )
        throw Error(
          "Capture capability or budget unavailable; no request sent.",
        );
      if (reviewedCatalog) {
        const route = reviewedCatalog.routes.find(
          (r) => r.routeKey === routeKey && r.method === method,
        );
        const parsed = new URL(url);
        if (
          !route ||
          !["http:", "https:"].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password ||
          !new RegExp(
            "^" + route.template.replace(/\{[a-z][a-z0-9_]*\}/g, "[^/]+") + "$",
          ).test(parsed.pathname)
        )
          throw Error(
            "Request does not match the approved symbolic operation.",
          );
      }
      reserved++;
      pending++;
      const startedAt = now();
      let status = null,
        outcome = "TRANSPORT_ERROR";
      try {
        const response = await fetchImpl(url, options);
        status = response.status;
        outcome = "RESPONSE";
        return response;
      } finally {
        pending--;
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
    stop() {
      stopped = true;
    },
    exportMetadata() {
      return {
        version: reviewedCatalog ? 2 : 1,
        ...(reviewedCatalog
          ? {
              catalog: structuredClone(reviewedCatalog),
              clockId,
              pendingRequests: pending,
            }
          : {}),
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

function validateDebugCatalog(raw) {
  const plain = (v, keys) =>
    v &&
    Object.getPrototypeOf(v) === Object.prototype &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const key = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(v);
  const template =
    /^\/(?:v[1-9][0-9]?\/)?(?:[a-z][a-z_-]{0,31}|\{[a-z][a-z0-9_]{0,31}\})(?:\/(?:[a-z][a-z_-]{0,31}|\{[a-z][a-z0-9_]{0,31}\})){0,7}$/;
  if (
    !plain(raw, ["id", "revision", "routes"]) ||
    !key(raw.id) ||
    !Number.isInteger(raw.revision) ||
    raw.revision < 1 ||
    raw.revision > 1000000 ||
    !Array.isArray(raw.routes) ||
    !raw.routes.length ||
    raw.routes.length > 32 ||
    new Set(raw.routes.map((r) => r?.routeKey)).size !== raw.routes.length ||
    raw.routes.some(
      (r) =>
        !plain(r, ["routeKey", "method", "template"]) ||
        !key(r.routeKey) ||
        !["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"].includes(
          r.method,
        ) ||
        typeof r.template !== "string" ||
        r.template.length > 180 ||
        !template.test(r.template),
    )
  )
    throw Error(
      "Reviewed static catalog required; no concrete URL or identifiers.",
    );
  return {
    id: raw.id,
    revision: raw.revision,
    routes: raw.routes.map((r) => ({
      routeKey: r.routeKey,
      method: r.method,
      template: r.template,
    })),
  };
}

// Explicit developer integration only. The app creates the two private files
// and schedules poll() in its own DEBUG lifecycle. There is no file discovery,
// automatic timer, global interception or implicit capture approval here.
export function createDebugAppNetworkFileBridge({
  debugBuild,
  packageName,
  sourceId,
  catalog,
  readControl,
  writeResponse,
  approveRun,
  fetchImpl,
  now = Date.now,
  nonce,
}) {
  const reviewed = validateDebugCatalog(catalog);
  if (
    debugBuild !== true ||
    !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(packageName) ||
    !/^[a-z][a-z0-9_-]{0,63}$/.test(sourceId) ||
    [readControl, writeResponse, approveRun, fetchImpl, now, nonce].some(
      (f) => typeof f !== "function",
    )
  )
    throw Error("Explicit debug integration required.");
  let active = null,
    busy = false,
    failed = false;
  const responses = new Map();
  const parse = (text) => {
    if (
      typeof text !== "string" ||
      new TextEncoder().encode(text).length > 16384
    )
      throw Error("Bounded control required");
    // tee truncates before writing. A final newline commits the complete
    // canonical frame; an empty/partial frame causes no response or action.
    if (!text.endsWith("\n")) return null;
    const result = JSON.parse(text.slice(0, -1));
    if (JSON.stringify(result) + "\n" !== text)
      throw Error("Canonical host control required");
    return result;
  };
  return {
    request(...args) {
      if (
        failed ||
        !active ||
        now() >= active.expiresAt ||
        approveRun(structuredClone(active.approval)) !== true
      ) {
        failed = true;
        active?.capture.stop();
        throw Error("No approved capture run");
      }
      return active.capture.request(...args);
    },
    poll() {
      if (failed || busy) throw Error("Unavailable debug poll");
      busy = true;
      try {
        const request = parse(
          readControl("files/vaettir-debug-http/control.json"),
        );
        if (request === null) return;
        const fields = [
          "version",
          "operation",
          "challengeId",
          "runId",
          "packageName",
          "sourceId",
          "catalog",
          "origin",
        ];
        if (
          !request ||
          Object.keys(request).length !== fields.length ||
          !fields.every((k) => Object.hasOwn(request, k)) ||
          request.version !== 1 ||
          !["START", "SAMPLE", "FINISH", "STOP"].includes(request.operation) ||
          !/^[a-f0-9]{48}$/.test(request.challengeId) ||
          !/^[a-f0-9]{48}$/.test(request.runId) ||
          request.packageName !== packageName ||
          request.sourceId !== sourceId ||
          typeof request.origin !== "string" ||
          request.origin.length > 512 ||
          new URL(request.origin).origin !== request.origin ||
          JSON.stringify(validateDebugCatalog(request.catalog)) !==
            JSON.stringify(reviewed)
        )
          throw Error("Unapproved debug control");
        if (
          approveRun(structuredClone(request)) !== true ||
          (active &&
            (active.runId !== request.runId ||
              active.origin !== request.origin ||
              now() > active.expiresAt))
        )
          throw Error("App capture authority expired or changed");
        const exact = JSON.stringify(request);
        const previous = responses.get(request.challengeId);
        if (previous) {
          if (previous.exact !== exact)
            throw Error("Challenge identity changed");
          return;
        }
        if (responses.size >= 32)
          throw Error("Debug challenge budget exhausted");
        if (request.operation === "START") {
          if (active) throw Error("App has not approved this capture run");
          const clockId = nonce();
          if (!/^[a-f0-9]{48}$/.test(clockId))
            throw Error("Invalid local clock identity");
          active = {
            approval: structuredClone(request),
            runId: request.runId,
            origin: request.origin,
            clockId,
            expiresAt: now() + 300000,
            capture: createDebugAppNetworkEvidence({
              debugBuild: true,
              packageName,
              runId: request.runId,
              sourceId,
              approvedRouteKeys: reviewed.routes.map((r) => r.routeKey),
              catalog: reviewed,
              clockId,
              fetchImpl,
              now,
            }),
          };
        }
        if (
          !active ||
          active.runId !== request.runId ||
          active.origin !== request.origin ||
          now() > active.expiresAt
        )
          throw Error("Original capture expired or changed");
        if (request.operation === "FINISH" || request.operation === "STOP")
          active.capture.stop();
        const output = {
          version: 1,
          challengeId: request.challengeId,
          runId: active.runId,
          operation: request.operation,
          clock: { clockId: active.clockId, observedAt: now() },
          metadata: active.capture.exportMetadata(),
        };
        const text = JSON.stringify(output);
        if (new TextEncoder().encode(text).length > 65536)
          throw Error("Debug evidence exceeded its bound");
        responses.set(request.challengeId, { exact, text });
        if (writeResponse("files/vaettir-debug-http/response.json", text)?.then)
          throw Error("Synchronous atomic writer required");
      } catch {
        failed = true;
        active?.capture.stop();
        throw Error("Debug metadata unavailable");
      } finally {
        busy = false;
      }
    },
  };
}
