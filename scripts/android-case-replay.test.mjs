import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { createAndroidCaseReplay } from "./android-case-replay-lib.mjs";
import { createDebugAppNetworkEvidence } from "./android-network-evidence-debug.mjs";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
const hash = (v) => createHash("sha256").update(v).digest("hex"),
  scope = { projectId: "p", organizationId: "o", actorId: "a", sessionId: "s" };
function fixture(network) {
  let clock = 1000,
    taps = 0,
    observations = 0,
    focused = "com.example.qa",
    broken = false;
  const target = {
    packageName: focused,
    objectId: "com.example.qa:id/catalog",
    className: "android.widget.Button",
    selector: { kind: "RESOURCE_ID", value: "com.example.qa:id/catalog" },
    bounds: [0, 0, 100, 100],
  };
  let before = {
    id: hash("before"),
    label: "Home",
    blocked: false,
    controls: [
      {
        id: hash("control"),
        name: "Open catalog",
        navigable: true,
        bounds: target.bounds,
        target,
      },
    ],
  };
  let after = {
    id: hash("after"),
    label: "Catalog",
    blocked: false,
    controls: [
      {
        id: hash("heading"),
        name: "Catalog",
        navigable: false,
        bounds: null,
        target: null,
      },
    ],
  };
  const engine = createAndroidCaseReplay(
    {
      network,
      inspect: () => focused,
      observe: () => {
        observations++;
        if (broken && taps) throw Error();
        return structuredClone(taps ? after : before);
      },
      tap: () => {
        taps++;
        return ["shell", "input", "tap", "50", "50"];
      },
    },
    { hash, nonce: () => randomBytes(24).toString("hex"), now: () => clock },
  );
  const plan = {
    caseId: "case",
    revision: "a".repeat(64),
    packageName: focused,
    steps: [
      {
        stepId: "step",
        label: "Open catalog",
        expectedResult: "Catalog is visible",
        locator: {
          kind: "RESOURCE_ID",
          value: target.objectId,
          className: target.className,
        },
        assertion: {
          kind: "VISIBLE_LABEL",
          value: "Catalog",
          relationReviewed: true,
        },
      },
    ],
  };
  let r;
  const start = (networkApproval) => {
    const t = engine.handle(
      "inspect",
      { serial: "synthetic", scope },
      "https://example.test",
    );
    r = engine.handle(
      "start",
      {
        ticket: t.ticket,
        ...(networkApproval === undefined ? {} : { networkApproval }),
        scope,
        plan,
        consent: {
          localObservation: true,
          oneRun: true,
          testAccount: true,
          assertionsReviewed: true,
        },
      },
      "https://example.test",
    );
    return r;
  };
  const next = (extra = {}) => {
    const input = {
      id: r.id,
      scope,
      revision: plan.revision,
      sequence: r.sequence,
      requestId: randomUUID(),
      screenId: r.screen.id,
      ...extra,
    };
    r = engine.handle(
      extra.candidateId ? "retry" : "next",
      input,
      "https://example.test",
    );
    return { r, input };
  };
  return {
    engine,
    plan,
    start,
    next,
    get run() {
      return r;
    },
    get taps() {
      return taps;
    },
    get observations() {
      return observations;
    },
    before,
    after,
    clock: (v) => (clock = v),
    focus: (v) => (focused = v),
    break: () => (broken = true),
  };
}
const approvedNetwork = {
  sourceId: "qa",
  catalog: {
    id: "qa",
    revision: 1,
    routes: [{ routeKey: "catalog", method: "GET", template: "/catalog" }],
  },
  debugMetadata: true,
  sourceReviewed: true,
  catalogReviewed: true,
  temporalOnlyReviewed: true,
};
test("navigation alone never calls the optional metadata adapter", () => {
  let calls = 0;
  const f = fixture({
    start() {
      calls++;
      throw Error();
    },
    sample() {
      calls++;
      throw Error();
    },
  });
  const initial = f.start();
  assert.equal(Object.hasOwn(initial, "networkCapture"), false);
  f.next();
  assert.equal(calls, 0);
});
test("separate requested capability must start successfully before any tap", () => {
  for (const adapter of [
    undefined,
    {
      start() {
        throw Error("unavailable");
      },
    },
  ]) {
    const f = fixture(adapter),
      r = f.start(approvedNetwork);
    assert.equal(r.status, "STOPPED");
    assert.equal(r.networkCapture.status, "UNAVAILABLE");
    assert.throws(() => f.next());
    assert.equal(f.taps, 0);
  }
});
test("replay binds exact scope and clocks and captures only after complete native receipt", () => {
  const calls = [];
  const f = fixture({
    start(c) {
      calls.push({ op: "START", c });
      return { metadata: { test: true }, selection: { test: true } };
    },
    sample(c, op) {
      calls.push({ op, c });
      return { metadata: { test: true }, selection: { test: true } };
    },
  });
  f.start(approvedNetwork);
  const { r } = f.next();
  assert.equal(r.status, "COMPLETED");
  assert.deepEqual(
    calls.map((x) => x.op),
    ["START", "FINISH"],
  );
  assert.equal(calls[0].c.runId, r.id);
  assert.equal(calls[0].c.origin, "https://example.test");
  assert.equal(calls[0].c.scopeKey, JSON.stringify(["p", "o", "a", "s"]));
  assert.deepEqual(calls[0].c.approval, approvedNetwork);
  assert.equal(r.receipts[0].timing.clockId, calls[0].c.clockId);
  assert.equal(r.receipts[0].timing.endedAt, r.receipts[0].observedAt);
  assert.equal(f.taps, 1);
  f.engine.handle("read", { id: r.id, scope }, "https://example.test");
  assert.equal(calls.length, 2);
});
test("metadata failure retains known completed receipt and blocks subsequent actions", () => {
  let samples = 0;
  const f = fixture({
    start() {
      return { metadata: {}, selection: {} };
    },
    sample() {
      samples++;
      throw Error();
    },
  });
  f.start(approvedNetwork);
  const { r } = f.next();
  assert.equal(r.status, "STOPPED");
  assert.equal(r.networkCapture.status, "UNAVAILABLE");
  assert.equal(r.receipts.length, 1);
  assert.throws(() => f.next());
  f.engine.handle("stop", { id: r.id, scope }, "https://example.test");
  assert.equal(samples, 1);
  assert.equal(f.taps, 1);
});
test("uncertain native outcome never triggers another private command or implicit cleanup", () => {
  let samples = 0;
  const f = fixture({
    start() {
      return { metadata: {}, selection: {} };
    },
    sample() {
      samples++;
      throw Error();
    },
  });
  f.start(approvedNetwork);
  f.break();
  const { r } = f.next();
  assert.equal(r.status, "UNCERTAIN");
  assert.equal(r.receipts.length, 0);
  assert.equal(samples, 0);
  f.engine.handle("stop", { id: r.id, scope }, "https://example.test");
  assert.equal(samples, 0);
  assert.equal(f.taps, 1);
});
test("explicit stop sends one guarded challenge, repeated stop and reads are passive", () => {
  let samples = 0;
  const f = fixture({
    start() {
      return { metadata: {}, selection: {} };
    },
    sample(c, op) {
      assert.equal(op, "STOP");
      samples++;
      return { metadata: {}, selection: {} };
    },
  });
  const r = f.start(approvedNetwork);
  for (let i = 0; i < 2; i++)
    f.engine.handle("stop", { id: r.id, scope }, "https://example.test");
  assert.equal(samples, 1);
  assert.equal(f.taps, 0);
});
test("one reviewed tap records actual target, request and explicit assertion", () => {
  const f = fixture();
  f.start();
  const { r, input } = f.next();
  assert.equal(f.taps, 1);
  assert.equal(r.status, "COMPLETED");
  assert.equal(r.receipts[0].requestId, input.requestId);
  assert.equal(r.receipts[0].assertion.passed, true);
  assert.equal(r.nativeExecutionIndependentlyVerified, false);
  assert.throws(() => f.engine.handle("next", input, "https://example.test"));
  assert.equal(f.taps, 1);
});
test("missing object gives review candidates and only explicit fresh bounded retry can act", () => {
  const f = fixture();
  f.plan.steps[0].locator.value = "old";
  f.start();
  const { r } = f.next();
  assert.equal(r.status, "REPAIR_REVIEW");
  assert.equal(f.taps, 0);
  assert.equal(r.candidates.length, 1);
  assert.throws(() =>
    f.next({ candidateId: r.candidates[0].id, retryApproved: false }),
  );
  assert.equal(f.taps, 0);
  const result = f.next({
    candidateId: r.candidates[0].id,
    retryApproved: true,
  }).r;
  assert.equal(result.status, "COMPLETED");
  assert.equal(result.receipts[0].repaired, true);
  assert.deepEqual(result.receipts[0].repairApproval, {
    candidateId: r.candidates[0].id,
    screenId: r.screen.id,
    reasons: ["SAME_LABEL"],
    retryApproved: true,
  });
  assert.equal(result.receipts[0].expectedResult, "Catalog is visible");
});
test("screen change after candidate review refuses retry without action", () => {
  const f = fixture();
  f.plan.steps[0].locator.value = "old";
  f.start();
  const { r } = f.next();
  f.before.id = hash("changed");
  assert.equal(
    f.next({ candidateId: r.candidates[0].id, retryApproved: true }).r.status,
    "STOPPED",
  );
  assert.equal(f.taps, 0);
});
test("assertion failure is evidence, never a locator healing invitation", () => {
  const f = fixture();
  f.after.controls[0].name = "Error";
  f.start();
  const { r } = f.next();
  assert.equal(r.status, "ASSERTION_FAILED");
  assert.equal(r.receipts[0].assertion.passed, false);
  assert.deepEqual(r.candidates, []);
  assert.throws(() =>
    f.next({ candidateId: hash("control"), retryApproved: true }),
  );
  assert.equal(f.taps, 1);
});
test("duplicate assertion labels do not pass", () => {
  const f = fixture();
  f.after.controls.push({ ...f.after.controls[0], id: hash("duplicate") });
  f.start();
  assert.equal(f.next().r.status, "ASSERTION_FAILED");
});
test("uncertain action consumes authority and blocks new same-device tickets", () => {
  const f = fixture();
  f.break();
  f.start();
  const { r } = f.next();
  assert.equal(r.status, "UNCERTAIN");
  assert.equal(f.taps, 1);
  assert.equal(
    f.engine.handle("stop", { id: r.id, scope }, "https://example.test").status,
    "UNCERTAIN",
  );
  assert.throws(() => f.start());
  assert.throws(() => f.next());
  assert.equal(f.taps, 1);
});
test("read retained state issues no native command", () => {
  const f = fixture();
  f.start();
  const { r } = f.next(),
    observations = f.observations;
  assert.deepEqual(
    f.engine.handle("read", { id: r.id, scope }, "https://example.test"),
    r,
  );
  assert.equal(f.observations, observations);
  assert.equal(f.taps, 1);
});
test("foreign origin/scope/revision/sequence cannot act", () => {
  for (const mutation of [
    { scope: { ...scope, actorId: "foreign" } },
    { revision: "b".repeat(64) },
    { sequence: 5 },
  ]) {
    const f = fixture();
    f.start();
    assert.throws(() => f.next(mutation));
    assert.equal(f.taps, 0);
  }
  const f = fixture();
  const r = f.start();
  assert.throws(() =>
    f.engine.handle("read", { id: r.id, scope }, "https://evil.test"),
  );
});
test("focus drift, expiry, protected content and geometry mismatch fail closed", () => {
  for (const kind of ["focus", "expiry", "protected", "geometry"]) {
    const f = fixture();
    f.start();
    if (kind === "focus") f.focus("com.foreign.app");
    if (kind === "expiry") f.clock(999999);
    if (kind === "protected") f.before.blocked = true;
    if (kind === "geometry") f.before.controls[0].bounds = [1, 1, 2, 2];
    try {
      f.next();
    } catch {
      /* Refusal before action is expected. */
    }
    assert.equal(f.taps, 0);
  }
});
test("ambiguous, sensitive and bounds-only objects cannot be repaired", () => {
  for (const kind of ["ambiguous", "sensitive", "bounds"]) {
    const f = fixture();
    f.plan.steps[0].locator.value = "old";
    if (kind === "ambiguous")
      f.before.controls.push({
        ...f.before.controls[0],
        id: hash("duplicate"),
      });
    if (kind === "sensitive") f.before.controls[0].name = "Delete catalog";
    if (kind === "bounds")
      f.before.controls[0].target.selector = {
        kind: "BOUNDS_ONLY",
        value: null,
      };
    f.start();
    assert.equal(f.next().r.candidates.length, 0);
    assert.equal(f.taps, 0);
  }
});
test("single-use start ticket cannot be reused", () => {
  const f = fixture();
  const t = f.engine.handle(
    "inspect",
    { serial: "synthetic", scope },
    "https://example.test",
  );
  const input = {
    ticket: t.ticket,
    scope,
    plan: f.plan,
    consent: {
      localObservation: true,
      oneRun: true,
      testAccount: true,
      assertionsReviewed: true,
    },
  };
  f.engine.handle("start", input, "https://example.test");
  assert.throws(() => f.engine.handle("start", input, "https://example.test"));
});
test("debug instrumentation records actual injected HTTP result without URL/header/body exposure", async () => {
  let calls = 0,
    time = 1000;
  const capture = createDebugAppNetworkEvidence({
    debugBuild: true,
    packageName: "com.example.qa",
    runId: "a".repeat(48),
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    now: () => time++,
    fetchImpl: async () => {
      calls++;
      return { status: 201, body: "private body" };
    },
  });
  await capture.request(
    "catalog",
    "https://example.test/private?token=secret",
    { method: "POST", headers: { Authorization: "secret" }, body: "private" },
  );
  const output = capture.exportMetadata();
  assert.equal(output.events[0].status, 201);
  assert.equal(output.events[0].method, "POST");
  assert.equal(calls, 1);
  assert.doesNotMatch(
    JSON.stringify(output),
    /secret|Authorization|private|https/,
  );
  await assert.rejects(() =>
    capture.request("unapproved", "https://example.test"),
  );
  assert.equal(calls, 1);
});
test("production instrumentation cannot be enabled and transport failure is retained", async () => {
  const opts = {
    debugBuild: true,
    packageName: "com.example.qa",
    runId: "a".repeat(48),
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    fetchImpl: async () => {
      throw Error("private error");
    },
  };
  assert.throws(() =>
    createDebugAppNetworkEvidence({ ...opts, debugBuild: false }),
  );
  const c = createDebugAppNetworkEvidence(opts);
  await assert.rejects(() => c.request("catalog", "https://example.test"));
  assert.deepEqual(
    c.exportMetadata().events.map((e) => [e.status, e.outcome]),
    [[null, "TRANSPORT_ERROR"]],
  );
  assert.doesNotMatch(JSON.stringify(c.exportMetadata()), /private error/);
});
test("downloaded connector embeds exact reviewed replay implementation", () => {
  const file = readFileSync(
    new URL(
      "../apps/web/public/connectors/vaettir-device-connector.mjs",
      import.meta.url,
    ),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const lib = readFileSync(
    new URL("./android-case-replay-lib.mjs", import.meta.url),
    "utf8",
  )
    .replaceAll("\r\n", "\n")
    .replace(
      "export function createAndroidCaseReplay",
      "function createAndroidCaseReplay",
    );
  assert.ok(file.includes("// BEGIN EMBEDDED ANDROID CASE REPLAY\n" + lib));
});

test("debug wrapper refuses Request objects before any request, retaining exact method provenance", async () => {
  let calls = 0;
  const c = createDebugAppNetworkEvidence({
    debugBuild: true,
    packageName: "com.example.qa",
    runId: "a".repeat(48),
    sourceId: "qa",
    approvedRouteKeys: ["catalog"],
    fetchImpl: async () => {
      calls++;
      return { status: 200 };
    },
  });
  await assert.rejects(() => c.request("catalog", { method: "DELETE" }));
  assert.equal(calls, 0);
  assert.deepEqual(c.exportMetadata().events, []);
});
test("replay HTTP requires original origin/pairing and refuses malformed or unknown session without native reads", async () => {
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const origin = "http://localhost:3000",
    pairing = randomBytes(16).toString("hex"),
    base = `http://127.0.0.1:${port}`;
  const child = spawn(
    process.execPath,
    [
      fileURLToPath(
        new URL(
          "../apps/web/public/connectors/vaettir-device-connector.mjs",
          import.meta.url,
        ),
      ),
      "--port",
      String(port),
      "--origin",
      origin,
      "--pairing-code",
      pairing,
    ],
    { stdio: ["ignore", "pipe", "pipe"], windowsHide: true },
  );
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(Error("Owned synthetic helper readiness timeout")),
        10000,
      );
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("Owned helper exited"));
      });
      child.stdout.on("data", (b) => {
        if (b.toString().includes("Listening only on this computer")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const headers = { origin, "x-vaettir-pairing-code": pairing };
    const caps = await fetch(base + "/case-replay/v1/capabilities", {
      headers,
    });
    assert.equal(caps.status, 200);
    assert.equal(caps.headers.get("cache-control"), "no-store");
    const capability = await caps.json();
    assert.equal(capability.appNetwork, "DEBUG_APP_EXPORT_ONLY");
    assert.deepEqual(capability.appNetworkCapture, {
      version: 2,
      transport: "APP_PRIVATE_FILES",
    });
    for (const [h, status] of [
      [{ ...headers, origin: "https://foreign.example" }, 403],
      [{ origin }, 401],
    ])
      assert.equal(
        (await fetch(base + "/case-replay/v1/capabilities", { headers: h }))
          .status,
        status,
      );
    for (const body of [
      '{"scope":{},"scope":{}}',
      "x".repeat(262145),
      JSON.stringify({ id: "unknown", scope }),
    ]) {
      const r = await fetch(base + "/case-replay/v1/read", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
      assert.equal(r.status, 400);
      assert.doesNotMatch(await r.text(), /unknown|pairing|serial/);
    }
  } finally {
    child.kill();
    await new Promise((r) => {
      if (child.exitCode !== null) r();
      else child.once("exit", r);
    });
  }
});
