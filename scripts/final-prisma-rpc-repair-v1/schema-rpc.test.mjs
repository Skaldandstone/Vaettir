import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { schemaRpc } from "./probes.mjs";

const success = { jsonrpc: "2.0", id: 1, result: { executedSteps: 1, warnings: [], unexecutable: [] } };
const failure = { jsonrpc: "2.0", id: 1, error: { code: 4466, message: "An error happened. Check the data field for details.",
  data: { is_panic: false, message: "Missing --datamodels\n", backtrace: null } } };
const frame = row => JSON.stringify(row) + "\n";

// Event delegates only: no child process, filesystem output or native engine.
function harness({ onRequest, onKill, onEnd } = {}) {
  const writes = new Map(), sent = [], kills = [], invocations = [];
  const child = new EventEmitter();
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.stdin = new EventEmitter();
  let ends = 0;
  child.stdin.write = raw => {
    const row = JSON.parse(raw); sent.push(row);
    if (row.method === "schemaPush") queueMicrotask(() => onRequest?.(child, row));
  };
  child.stdin.end = () => { ends++; onEnd?.(child); };
  child.kill = signal => {
    kills.push(signal);
    if (onKill) onKill(child, signal);
    else queueMicrotask(() => child.emit("close", null, signal));
    return true;
  };
  const io = {
    write: (path, raw) => { assert(!writes.has(path)); writes.set(path, raw); },
    spawnAsync: (binary, args, options) => { invocations.push({ binary, args, options }); return child; },
  };
  return { io, child, sent, kills, invocations, writes, ends: () => ends,
    record: () => JSON.parse(writes.get("/out/schema-command.json")) };
}

test("schema file is supplied at startup; fragmented success and print callback retain original RPC", async () => {
  const h = harness({ onRequest: (child, request) => {
    assert.deepEqual(request.params, { force: false, schema: { files: [{ path: "/out/schema.prisma", content: "model" }] } });
    child.stdout.emit("data", frame({ jsonrpc: "2.0", id: 7, method: "print", params: { content: "progress" } }));
    child.stderr.emit("data", "native log\n");
    const raw = frame(success); child.stdout.emit("data", raw.slice(0, 9)); child.stdout.emit("data", raw.slice(9));
  }, onEnd: child => queueMicrotask(() => child.emit("close", 0, null)) });
  assert.deepEqual(await schemaRpc(h.io, "/pinned/schema-engine", "model", "/out"), success.result);
  assert.equal(h.invocations.length, 1);
  assert.deepEqual(h.invocations[0].args, ["--datamodels", "/out/schema.prisma"]);
  assert.equal(h.invocations[0].options.cwd, "/out");
  assert.deepEqual(h.sent[1], { id: 7, jsonrpc: "2.0", result: {} });
  assert.deepEqual(h.kills, []); assert.equal(h.ends(), 1);
  assert.equal(h.record().stderr, "native log\n"); assert.deepEqual(h.record().response, success);
  assert.equal(h.record().exe, "/pinned/schema-engine");
  assert.deepEqual(h.record().args, h.invocations[0].args);
});

test("error response kills immediately without relying on stdin EOF or timeout and keeps full diagnostics", async () => {
  const h = harness({ onRequest: child => {
    child.stderr.emit("data", "engine revision log\n");
    child.stdout.emit("data", frame(failure));
    assert.deepEqual(h.kills, ["SIGKILL"]); assert.equal(h.ends(), 0);
  }, onKill: (child, signal) => {
    child.stdin.emit("error", Object.assign(Error("pipe closed after kill"), { code: "EPIPE" }));
    queueMicrotask(() => child.emit("close", null, signal));
  } });
  await assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"), /child failed/);
  assert.equal(h.invocations.length, 1); assert.equal(h.sent.length, 1);
  assert.deepEqual(h.record(), { exe: "/engine", args: ["--datamodels", "/out/schema.prisma"], code: null,
    signal: "SIGKILL", error: "Schema engine RPC error response", stdout: frame(failure),
    stderr: "engine revision log\n", response: failure });
});

test("RPC error remains failure even if child close reports zero without a signal", async () => {
  const h = harness({ onRequest: child => child.stdout.emit("data", frame(failure)),
    onKill: child => queueMicrotask(() => child.emit("close", 0, null)) });
  await assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"), /child failed/);
  assert.equal(h.record().code, 0); assert.equal(h.record().signal, null);
  assert.equal(h.record().response.error.code, 4466);
});

test("timeout cannot overwrite the original error response while waiting for child close", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness({ onRequest: child => child.stdout.emit("data", frame(failure)), onKill: () => {} });
  const completion = assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"), /child failed/);
  await Promise.resolve(); assert.deepEqual(h.kills, ["SIGKILL"]);
  t.mock.timers.tick(30000); h.child.emit("close", null, "SIGKILL");
  await completion;
  assert.equal(h.record().error, "Schema engine RPC error response");
  assert.deepEqual(h.record().response, failure);
});

test("silent child still has the original bounded timeout", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const h = harness();
  const completion = assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"), /child failed/);
  t.mock.timers.tick(29999); assert.deepEqual(h.kills, []);
  t.mock.timers.tick(1); await completion;
  assert.equal(h.record().error, "Schema engine timeout"); assert.equal(h.record().response, null);
});

test("successful RPC cannot hide a nonzero native exit", async () => {
  const h = harness({ onRequest: child => child.stdout.emit("data", frame(success)),
    onEnd: child => queueMicrotask(() => child.emit("close", 101, null)) });
  await assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"), /child failed/);
  assert.equal(h.record().code, 101); assert.deepEqual(h.record().response, success);
});

test("malformed or duplicate responses still fail and retain raw stdout", async () => {
  for (const raw of ["invalid json\n", frame(success) + frame(success)]) {
    const h = harness({ onRequest: child => child.stdout.emit("data", raw) });
    await assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"), /child failed/);
    assert.equal(h.record().stdout, raw); assert.deepEqual(h.kills, ["SIGKILL"]);
  }
});

test("success validators still reject no work, warnings and unexecutable steps", async () => {
  for (const result of [{ ...success.result, executedSteps: 0 }, { ...success.result, warnings: ["warning"] },
    { ...success.result, unexecutable: ["blocked"] }]) {
    const h = harness({ onRequest: child => child.stdout.emit("data", frame({ ...success, result })),
      onEnd: child => queueMicrotask(() => child.emit("close", 0, null)) });
    await assert.rejects(schemaRpc(h.io, "/engine", "model", "/out"));
    assert.deepEqual(h.kills, []); assert.equal(h.record().code, 0);
  }
});

test("all source outside schemaRpc and both support files remain byte-identical to frozen a88", () => {
  const read = path => readFileSync(new URL(path, import.meta.url));
  const old = read("../final-native-fixtures-v1/probes.mjs").toString();
  const current = read("./probes.mjs").toString();
  const cut = text => [text.slice(0, text.indexOf("export async function schemaRpc(")), text.slice(text.indexOf("export async function prisma("))];
  assert.deepEqual(cut(current), cut(old));
  for (const name of ["core.mjs", "elf.mjs"]) assert.deepEqual(read("./" + name), read("../final-native-fixtures-v1/" + name));
});
