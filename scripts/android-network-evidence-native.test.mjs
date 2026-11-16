import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { createAndroidNetworkEvidenceAdapter } from "./android-network-evidence-native.mjs";
import { createDebugAppNetworkFileBridge } from "./android-network-evidence-debug.mjs";
const id = () => randomBytes(24).toString("hex");
const catalog = {
  id: "qa",
  revision: 1,
  routes: [
    { routeKey: "catalog", method: "GET", template: "/v1/catalog/{item_id}" },
  ],
};
const source = readFileSync(
  new URL(
    "../apps/web/public/connectors/vaettir-device-connector.mjs",
    import.meta.url,
  ),
  "utf8",
);
// Exercise the shipped strict parser without starting a server or executing ADB.
const tree = ts.createSourceFile(
    "connector.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ),
  printer = ts.createPrinter();
const declarations = tree.statements
  .filter(
    (n) =>
      ts.isFunctionDeclaration(n) &&
      ["parseAndroidWindowJson", "exactText", "captureRefusal"].includes(
        n.name?.text,
      ),
  )
  .map((n) => printer.printNode(ts.EmitHint.Unspecified, n, tree))
  .join("\n");
const parse = new Function(
  "Buffer",
  declarations + ";return parseAndroidWindowJson;",
)(Buffer);
function fixture() {
  let tick = 1000,
    control = "",
    response = "",
    focused = "com.example.qa",
    approved = true,
    fault = null,
    fetches = 0;
  const calls = [],
    writes = [];
  const context = {
    serial: "SYNTHETIC",
    packageName: focused,
    runId: id(),
    origin: "https://example.test",
    scopeKey: '["p","o","a","s"]',
    clockId: id(),
    expiresAt: 301000,
    approval: {
      sourceId: "qa",
      catalog: structuredClone(catalog),
      debugMetadata: true,
      sourceReviewed: true,
      catalogReviewed: true,
      temporalOnlyReviewed: true,
    },
  };
  const sdk = createDebugAppNetworkFileBridge({
    debugBuild: true,
    packageName: focused,
    sourceId: "qa",
    catalog,
    now: () => tick - 500,
    nonce: id,
    approveRun: (r) =>
      approved && r.runId === context.runId && r.origin === context.origin,
    readControl: (path) => {
      assert.equal(path, "files/vaettir-debug-http/control.json");
      return control;
    },
    writeResponse: (path, text) => {
      assert.equal(path, "files/vaettir-debug-http/response.json");
      writes.push(text);
      response = text;
    },
    fetchImpl: async () => {
      fetches++;
      tick += 10;
      return { status: 204 };
    },
  });
  const native = createAndroidNetworkEvidenceAdapter({
    inspect: () => focused,
    parse,
    now: () => tick,
    nonce: id,
    sleep: (ms) => {
      tick += ms;
    },
    execute: (args, options) => {
      calls.push({ args, options });
      tick++;
      assert.deepEqual(args.slice(0, 5), [
        "-s",
        "SYNTHETIC",
        "exec-out",
        "run-as",
        "com.example.qa",
      ]);
      if (args[5] === "tee") {
        assert.equal(args[6], "files/vaettir-debug-http/control.json");
        control = options.input;
        if (fault === "unknown-write") throw Error("private stdout");
        if (fault !== "missing") sdk.poll();
        return control;
      }
      assert.equal(args[5], "cat");
      assert.equal(args[6], "files/vaettir-debug-http/response.json");
      if (fault === "oversize") return "x".repeat(65537);
      if (fault === "malformed") return "{";
      if (fault === "empty") return "";
      const value = JSON.parse(response);
      if (fault === "foreign") value.runId = id();
      if (fault === "nonce") value.challengeId = id();
      if (fault === "clock") value.metadata.clockId = id();
      if (fault === "private") value.metadata.events.push({ url: "private" });
      if (fault === "catalog") value.metadata.catalog.revision++;
      if (fault === "stale") value.clock.observedAt = 0;
      if (fault === "duplicate")
        return JSON.stringify(value).replace(
          '"version":1',
          '"version":1,"version":1',
        );
      return JSON.stringify(value);
    },
  });
  return {
    context,
    native,
    sdk,
    calls,
    writes,
    get fetches() {
      return fetches;
    },
    fault: (v) => (fault = v),
    advance: (v) => (tick += v),
    focus: (v) => (focused = v),
    approve: (v) => (approved = v),
    control: (v) => (control = v),
    readControl: () => control,
  };
}
test("actual producer and bounded host adapter exchange fresh challenges and only project symbolic metadata", async () => {
  const f = fixture();
  assert.equal(f.calls.length, 0);
  assert.equal(f.writes.length, 0);
  const first = f.native.start(f.context);
  assert.equal(first.selection.correlation.clockCalibration, null);
  f.advance(20);
  await f.sdk.request(
    "catalog",
    "https://api.example.test/v1/catalog/private-id?token=private",
    { headers: { Authorization: "private" } },
  );
  f.advance(20);
  const last = f.native.sample(f.context, "FINISH");
  assert.equal(last.metadata.events[0].status, 204);
  assert.equal(last.metadata.events[0].durationMs, 10);
  assert.equal(last.selection.correlation.clockCalibration.samples.length, 2);
  assert.notEqual(last.metadata.clockId, f.context.clockId);
  assert.equal(JSON.stringify(last).includes("private"), false);
  assert.equal(last.metadata.pendingRequests, 0);
  assert.equal(f.calls.filter((x) => x.args[5] === "tee").length, 2);
  const count = f.calls.length;
  assert.throws(() => f.native.sample(f.context));
  assert.equal(f.calls.length, count);
  await assert.rejects(() =>
    f.sdk.request("catalog", "https://api.example.test/v1/catalog/a"),
  );
});
for (const key of [
  "debugMetadata",
  "sourceReviewed",
  "catalogReviewed",
  "temporalOnlyReviewed",
])
  test("no " + key + " approval means zero private file I/O", () => {
    const f = fixture();
    f.context.approval[key] = false;
    assert.throws(() => f.native.start(f.context));
    assert.equal(f.calls.length, 0);
  });
for (const fault of [
  "unknown-write",
  "oversize",
  "malformed",
  "foreign",
  "nonce",
  "clock",
  "private",
  "catalog",
  "duplicate",
  "empty",
])
  test(fault + " is terminal without another write/read", () => {
    const f = fixture();
    f.native.start(f.context);
    f.advance(10);
    f.fault(fault);
    assert.throws(() => f.native.sample(f.context));
    const n = f.calls.length;
    assert.throws(() => f.native.sample(f.context));
    assert.equal(f.calls.length, n);
    assert.equal(f.calls.filter((c) => c.args[5] === "tee").length, 2);
    if (fault === "unknown-write") assert.equal(f.calls.at(-1).args[5], "tee");
  });
test("stale app clock and restored focus cannot revive refused capture", () => {
  const f = fixture();
  f.native.start(f.context);
  f.advance(10);
  f.fault("stale");
  assert.throws(() => f.native.sample(f.context));
  f.fault(null);
  const n = f.calls.length;
  assert.throws(() => f.native.sample(f.context));
  assert.equal(f.calls.length, n);
  const g = fixture();
  g.native.start(g.context);
  g.focus("com.other.app");
  assert.throws(() => g.native.sample(g.context));
  g.focus(g.context.packageName);
  const count = g.calls.length;
  assert.throws(() => g.native.sample(g.context));
  assert.equal(g.calls.length, count);
});
for (const field of ["origin", "scopeKey", "clockId", "packageName"])
  test(
    "changed " + field + " refuses before private I/O and remains refused",
    () => {
      const f = fixture();
      f.native.start(f.context);
      const changed = structuredClone(f.context);
      changed[field] =
        field === "clockId"
          ? id()
          : field === "origin"
            ? "https://other.test"
            : field === "packageName"
              ? "com.other.app"
              : "different";
      const n = f.calls.length;
      assert.throws(() => f.native.sample(changed));
      assert.throws(() => f.native.sample(f.context));
      assert.equal(f.calls.length, n);
    },
  );
test("expiry and missing debug integration are bounded, with no automatic replay", () => {
  const f = fixture();
  f.native.start(f.context);
  f.advance(300001);
  const n = f.calls.length;
  assert.throws(() => f.native.sample(f.context));
  assert.equal(f.calls.length, n);
  const g = fixture();
  g.fault("missing");
  assert.throws(() => g.native.start(g.context));
  assert.equal(g.calls.filter((c) => c.args[5] === "tee").length, 1);
  assert.ok(g.calls.length <= 5);
  assert.throws(() => g.native.start(g.context));
});
test("SDK revocation or malformed control stops requests and further response writes", async () => {
  const f = fixture();
  f.native.start(f.context);
  f.approve(false);
  assert.throws(() =>
    f.sdk.request("catalog", "https://api.example.test/v1/catalog/a"),
  );
  f.approve(true);
  const n = f.writes.length;
  assert.throws(() => f.sdk.poll());
  assert.equal(f.writes.length, n);
  assert.equal(f.fetches, 0);
  const g = fixture();
  g.native.start(g.context);
  g.control(g.readControl().replace('"version":1', '"version":1,"version":1'));
  assert.throws(() => g.sdk.poll());
  assert.throws(() =>
    g.sdk.request("catalog", "https://api.example.test/v1/catalog/a"),
  );
  assert.equal(g.fetches, 0);
});
test("catalog method/path mismatches refuse before fetch and budget is finite", async () => {
  const f = fixture();
  f.native.start(f.context);
  await assert.rejects(() =>
    f.sdk.request("catalog", "https://api.example.test/v1/catalog/a", {
      method: "POST",
    }),
  );
  await assert.rejects(() =>
    f.sdk.request("catalog", "https://api.example.test/v1/other/a"),
  );
  assert.equal(f.fetches, 0);
  for (let i = 0; i < 100; i++)
    await f.sdk.request("catalog", "https://api.example.test/v1/catalog/a");
  await assert.rejects(() =>
    f.sdk.request("catalog", "https://api.example.test/v1/catalog/a"),
  );
  assert.equal(f.fetches, 100);
});
test("SDK requires app approval before writing its first response", () => {
  const f = fixture();
  f.approve(false);
  assert.throws(() => f.native.start(f.context));
  assert.equal(f.writes.length, 0);
  assert.equal(f.fetches, 0);
});
test("empty and partial developer control files are idle until the complete frame", () => {
  const f = fixture();
  f.sdk.poll();
  assert.equal(f.writes.length, 0);
  f.control('{"version":');
  f.sdk.poll();
  assert.equal(f.writes.length, 0);
  f.native.start(f.context);
  const n = f.writes.length;
  f.sdk.poll();
  assert.equal(f.writes.length, n);
});
test("pending requests remain explicitly pending when the last snapshot closes capture", async () => {
  const f = fixture();
  f.native.start(f.context);
  f.advance(10);
  const pending = f.sdk.request(
    "catalog",
    "https://api.example.test/v1/catalog/a",
  );
  const last = f.native.sample(f.context, "FINISH");
  assert.equal(last.metadata.pendingRequests, 1);
  assert.equal(last.metadata.events.length, 0);
  await pending;
  await assert.rejects(() =>
    f.sdk.request("catalog", "https://api.example.test/v1/catalog/a"),
  );
});
test("shipped embedded adapter exactly matches reviewed source", () => {
  const library = readFileSync(
    new URL("./android-network-evidence-native.mjs", import.meta.url),
    "utf8",
  )
    .replaceAll("\r\n", "\n")
    .replace(
      "export function createAndroidNetworkEvidenceAdapter",
      "function createAndroidNetworkEvidenceAdapter",
    );
  assert.equal(
    source
      .replaceAll("\r\n", "\n")
      .split("// BEGIN EMBEDDED ANDROID NETWORK EVIDENCE\n")[1]
      .split("// END EMBEDDED ANDROID NETWORK EVIDENCE\n")[0],
    library + "\n",
  );
});
