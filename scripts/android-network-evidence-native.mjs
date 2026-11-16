// Embedded into the paired connector. No standalone execution or background
// polling. execute() is the fixed ADB boundary, never a general shell command.
export function createAndroidNetworkEvidenceAdapter({
  execute,
  inspect,
  parse,
  now,
  nonce,
  sleep,
}) {
  const sessions = new Map();
  const copy = (v) => JSON.parse(JSON.stringify(v));
  const fail = () => {
    throw Error("DEBUG_METADATA_UNAVAILABLE");
  };
  const plain = (v, keys) =>
    v &&
    Object.getPrototypeOf(v) === Object.prototype &&
    Object.keys(v).length === keys.length &&
    keys.every((k) => Object.hasOwn(v, k));
  const key = (v) => typeof v === "string" && /^[a-z][a-z0-9_-]{0,63}$/.test(v);
  const id = (v) => typeof v === "string" && /^[a-f0-9]{48}$/.test(v);
  const methods = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"];
  const stamp = (v) =>
    Number.isSafeInteger(v) && v >= 0 && v < Number.MAX_SAFE_INTEGER - 300000;
  function catalog(raw) {
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
          !methods.includes(r.method) ||
          typeof r.template !== "string" ||
          r.template.length > 180 ||
          !template.test(r.template),
      )
    )
      fail();
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
  function checkContext(c) {
    const observedNow = now();
    if (!stamp(observedNow)) fail();
    if (
      !plain(c, [
        "serial",
        "packageName",
        "runId",
        "origin",
        "scopeKey",
        "clockId",
        "expiresAt",
        "approval",
      ]) ||
      typeof c.serial !== "string" ||
      !/^[A-Za-z0-9._:-]{1,200}$/.test(c.serial) ||
      typeof c.packageName !== "string" ||
      c.packageName.length > 200 ||
      !/^[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)+$/.test(c.packageName) ||
      !id(c.runId) ||
      !id(c.clockId) ||
      typeof c.scopeKey !== "string" ||
      !c.scopeKey ||
      c.scopeKey.length > 2048 ||
      typeof c.origin !== "string" ||
      c.origin.length > 512 ||
      new URL(c.origin).origin !== c.origin ||
      !stamp(c.expiresAt) ||
      c.expiresAt <= observedNow ||
      c.expiresAt > observedNow + 300000 ||
      !plain(c.approval, [
        "sourceId",
        "catalog",
        "debugMetadata",
        "sourceReviewed",
        "catalogReviewed",
        "temporalOnlyReviewed",
      ]) ||
      !key(c.approval.sourceId) ||
      c.approval.debugMetadata !== true ||
      c.approval.sourceReviewed !== true ||
      c.approval.catalogReviewed !== true ||
      c.approval.temporalOnlyReviewed !== true
    )
      fail();
    catalog(c.approval.catalog);
  }
  function guard(s, c) {
    try {
      checkContext(c);
      if (
        s.failed ||
        JSON.stringify(c) !== s.context ||
        inspect(c.serial) !== c.packageName
      )
        fail();
    } catch {
      s.failed = true;
      fail();
    }
  }
  function metadata(raw, c, knownClock) {
    if (
      !plain(raw, [
        "version",
        "capability",
        "debugBuild",
        "metadataOnly",
        "packageName",
        "runId",
        "sourceId",
        "approvedRouteKeys",
        "events",
        "catalog",
        "clockId",
        "pendingRequests",
      ]) ||
      raw.version !== 2 ||
      raw.capability !== "DEBUG_APP_HTTP_CALLBACKS" ||
      raw.debugBuild !== true ||
      raw.metadataOnly !== true ||
      raw.packageName !== c.packageName ||
      raw.runId !== c.runId ||
      raw.sourceId !== c.approval.sourceId ||
      !id(raw.clockId) ||
      (knownClock && raw.clockId !== knownClock) ||
      JSON.stringify(catalog(raw.catalog)) !==
        JSON.stringify(catalog(c.approval.catalog)) ||
      JSON.stringify(raw.approvedRouteKeys) !==
        JSON.stringify(c.approval.catalog.routes.map((r) => r.routeKey)) ||
      !Number.isInteger(raw.pendingRequests) ||
      raw.pendingRequests < 0 ||
      raw.pendingRequests > 100 ||
      !Array.isArray(raw.events) ||
      raw.events.length > 100
    )
      fail();
    for (const e of raw.events) {
      if (
        !plain(e, [
          "routeKey",
          "method",
          "status",
          "startedAt",
          "durationMs",
          "outcome",
        ]) ||
        !raw.catalog.routes.some(
          (r) => r.routeKey === e.routeKey && r.method === e.method,
        ) ||
        !stamp(e.startedAt) ||
        !Number.isInteger(e.durationMs) ||
        e.durationMs < 0 ||
        e.durationMs > 300000 ||
        !["RESPONSE", "TRANSPORT_ERROR"].includes(e.outcome) ||
        (e.outcome === "RESPONSE"
          ? !Number.isInteger(e.status) || e.status < 100 || e.status > 599
          : e.status !== null)
      )
        fail();
    }
    return copy(raw);
  }
  function exchange(s, c, operation) {
    guard(s, c);
    if (s.samples.length >= 32 || s.closed) fail();
    const challengeId = nonce();
    if (!id(challengeId) || s.challenges.has(challengeId)) fail();
    s.challenges.add(challengeId);
    const control = {
      version: 1,
      operation,
      challengeId,
      runId: c.runId,
      packageName: c.packageName,
      sourceId: c.approval.sourceId,
      catalog: catalog(c.approval.catalog),
      origin: c.origin,
    };
    const input = JSON.stringify(control) + "\n";
    if (new TextEncoder().encode(input).length > 16384) fail();
    if (s.samples.length && now() <= s.samples.at(-1).receivedAt) sleep(2);
    const sentAt = now();
    if (!stamp(sentAt)) fail();
    if (s.samples.length && sentAt <= s.samples.at(-1).receivedAt) fail();
    try {
      // Exactly one write. An ambiguous tee result is terminal, never retried.
      execute(
        [
          "-s",
          c.serial,
          "exec-out",
          "run-as",
          c.packageName,
          "tee",
          "files/vaettir-debug-http/control.json",
        ],
        { input, timeout: 500, maxBuffer: 16385 },
      );
      for (let poll = 0; poll < 4; poll++) {
        guard(s, c);
        if (now() - sentAt > 2500) fail();
        const text = execute(
          [
            "-s",
            c.serial,
            "exec-out",
            "run-as",
            c.packageName,
            "cat",
            "files/vaettir-debug-http/response.json",
          ],
          { timeout: 400, maxBuffer: 65537 },
        );
        const receivedAt = now();
        if (
          typeof text !== "string" ||
          new TextEncoder().encode(text).length > 65536
        )
          fail();
        if (text === "") {
          sleep(50);
          continue;
        }
        const response = parse(text, 65536);
        if (
          !plain(response, [
            "version",
            "challengeId",
            "runId",
            "operation",
            "clock",
            "metadata",
          ]) ||
          response.version !== 1 ||
          !id(response.challengeId) ||
          response.runId !== c.runId ||
          !["START", "SAMPLE", "FINISH", "STOP"].includes(response.operation)
        )
          fail();
        if (response.challengeId !== challengeId) {
          if (!s.challenges.has(response.challengeId)) fail();
          sleep(50);
          continue;
        }
        if (
          response.operation !== operation ||
          !plain(response.clock, ["clockId", "observedAt"]) ||
          !id(response.clock.clockId) ||
          !stamp(response.clock.observedAt) ||
          !stamp(sentAt) ||
          !stamp(receivedAt) ||
          receivedAt < sentAt ||
          receivedAt - sentAt > 1000
        )
          fail();
        guard(s, c);
        const admitted = metadata(response.metadata, c, s.appClockId);
        if (admitted.clockId !== response.clock.clockId) fail();
        if (
          s.samples.length &&
          response.clock.observedAt <= s.samples.at(-1).appObservedAt
        )
          fail();
        if (s.samples.length && sentAt <= s.samples.at(-1).receivedAt) fail();
        s.appClockId = admitted.clockId;
        s.samples.push({
          challengeId,
          sentAt,
          appObservedAt: response.clock.observedAt,
          receivedAt,
        });
        s.metadata = admitted;
        if (operation === "FINISH" || operation === "STOP") s.closed = true;
        return snapshot(s, c);
      }
      fail();
    } catch {
      s.failed = true;
      fail();
    }
  }
  function snapshot(s, c) {
    if (!s.metadata) return null;
    const times = [
      ...s.samples.map((x) => x.appObservedAt),
      ...s.metadata.events.flatMap((e) => [
        e.startedAt,
        e.startedAt + e.durationMs,
      ]),
    ];
    const startedAt = Math.min(...times),
      endedAt = Math.max(...times);
    if (endedAt - startedAt > 300000) fail();
    return {
      metadata: copy(s.metadata),
      selection: {
        sourceId: c.approval.sourceId,
        approvedRouteKeys: c.approval.catalog.routes.map((r) => r.routeKey),
        startedAt,
        endedAt,
        correlation: {
          captureClock: { domain: "APP_REPORTED", clockId: s.appClockId },
          catalog: catalog(c.approval.catalog),
          sourceReviewed: true,
          catalogReviewed: true,
          temporalOnlyReviewed: true,
          clockCalibration:
            s.samples.length < 2
              ? null
              : {
                  appClockId: s.appClockId,
                  connectorClockId: c.clockId,
                  method: "REPORTED_ROUND_TRIP_CALLBACK",
                  samples: copy(s.samples),
                },
        },
      },
    };
  }
  return {
    start(c) {
      checkContext(c);
      if (sessions.size >= 5 || sessions.has(c.runId)) fail();
      const s = {
        context: JSON.stringify(c),
        samples: [],
        challenges: new Set(),
        metadata: null,
        appClockId: null,
        failed: false,
        closed: false,
      };
      sessions.set(c.runId, s);
      try {
        return exchange(s, c, "START");
      } catch {
        s.failed = true;
        fail();
      }
    },
    sample(c, operation = "SAMPLE") {
      const s = sessions.get(c?.runId);
      if (!s) fail();
      try {
        if (!["SAMPLE", "FINISH", "STOP"].includes(operation)) fail();
        return exchange(s, c, operation);
      } catch {
        s.failed = true;
        fail();
      }
    },
  };
}
