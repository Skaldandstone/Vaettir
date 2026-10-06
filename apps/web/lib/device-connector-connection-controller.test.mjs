import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as helpers from "./device-connector-connection.ts";
import { canEditProject } from "./membership.ts";

const source = readFileSync(new URL("../app/projects/[projectId]/live-app-generation/page.tsx", import.meta.url), "utf8"), ast = ts.createSourceFile("connection.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX), printer = ts.createPrinter();
const page = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "LiveAppGenerationPage");
const names = ["connectorRequest", "discoverAndroidDevices", "connectToDeviceConnector", "waitForDeviceConnector", "downloadConnectorLauncher", "cancelHelperSetupChecks", "reportBlockedWindowsHelper", "showPolicyPermittedManualSetup", "refreshAndroidDevices"];
const handlers = page.body.statements.filter(node => ts.isFunctionDeclaration(node) && names.includes(node.name?.text)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast)).join("\n");
const compiled = ts.transpileModule(handlers, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
function deferred() { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; }
async function drain() { for (let i = 0; i < 12; i++) await Promise.resolve(); }
function harness() {
  const requests = [], writes = [], downloads = [], timers = new Map(); let timerId = 0;
  const state = { connectorStatus: "idle", error: null, discoveringDevices: false, androidDevices: [], deviceSerial: "retained-device-choice", manualSetupOpen: true, manualSetupRevealed: true, helperMetadataCancellationEpoch: 0 };
  const h = { ...helpers, CONNECTOR_URL: "http://127.0.0.1:4774", AbortController, DOMException, connectionAttemptRef: { current: helpers.createDeviceConnectionGeneration() }, discoveryAttemptRef: { current: 0 }, pairingCode: "ABCDEF123456", connectorPlatform: "windows", captureMode: "android", capturing: false, generating: false, helperActorAllowed: true,
    window: { location: { origin: "https://vaettir.skaldandstone.com" }, setTimeout(callback, ms) { const id = ++timerId; if (ms === 1500) queueMicrotask(callback); else timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); } },
    fetch(url, options) { const response = deferred(); requests.push({ url, options, response }); return response.promise; },
    setPairingCode() { assert.fail("Reporting a block must not regenerate or discard the private pairing draft"); },
    buildDeviceConnectorLauncher: () => ({ filename: "synthetic.cmd", content: "synthetic-only", mimeType: "text/plain" }), downloadFile: (...args) => downloads.push(args),
  };
  for (const key of Object.keys(state)) h[`set${key[0].toUpperCase()}${key.slice(1)}`] = value => { const next = typeof value === "function" ? value(state[key]) : value; state[key] = next; h[key] = next; writes.push([key, next]); };
  Object.assign(h, state); vm.createContext(h); vm.runInContext(compiled, h);
  const reply = (index, payload, ok = true) => requests[index].response.resolve({ ok, status: ok ? 200 : 400, json: async () => payload });
  return { h, state, requests, writes, downloads, timers, reply };
}

function scopeActivation(host) {
  const declaration = name => { let value; for (const statement of page.body.statements) if (ts.isVariableStatement(statement)) for (const node of statement.declarationList.declarations) if (node.name.getText(ast) === name) value = printer.printNode(ts.EmitHint.Expression, node.initializer, ast); assert.ok(value); return value; };
  const layout = page.body.statements.find(node => ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(ast) === "useLayoutEffect").expression.arguments[0];
  const body = printer.printNode(ts.EmitHint.Unspecified, layout.body, ast);
  const declarations = ["helperAuthReady", "helperOrganizationId", "helperMember", "helperReadFresh", "eligibleActor"].map(name => `const ${name}=${declaration(name)};`).join("\n");
  const code = ts.transpileModule(`function activateActualScope(){ ${declarations} helperActorAllowed=${declaration("helperActorAllowed")}; ${body} }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None } }).outputText;
  host.h.actor = { isLoaded: true, isSignedIn: true, userId: "synthetic-original", sessionId: "synthetic-session-A" }; host.h.projectId = "synthetic-project"; host.h.readOnly = false; host.h.pairingOrigin = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-original" };
  host.h.helperProject = { data: { id: "synthetic-project", organizationId: "synthetic-org" }, error: null, isFetching: false, isPaused: false, isFetchedAfterMount: true };
  host.h.helperOrganizations = { data: [{ id: "synthetic-org", role: "EDITOR", seatType: "FULL" }], error: null, isFetching: false, isPaused: false, isFetchedAfterMount: true };
  host.h.canEditProject = canEditProject;
  vm.runInContext(code, host.h); return () => host.h.activateActualScope();
}

test("pure connection ownership aborts only registered health/discovery requests and explicit retry creates a new generation", () => {
  const value = helpers.createDeviceConnectionGeneration(), epoch = helpers.beginDeviceConnection(value), first = new AbortController(), second = new AbortController(), independentCapture = new AbortController();
  helpers.registerDeviceConnectionRequest(value, epoch, first); helpers.registerDeviceConnectionRequest(value, epoch, second);
  helpers.revokeDeviceConnection(value, { blocked: true }); assert.equal(first.signal.aborted, true); assert.equal(second.signal.aborted, true); assert.equal(independentCapture.signal.aborted, false);
  assert.equal(value.controllers.size, 0); assert.equal(helpers.currentDeviceConnection(value, epoch), false);
  const retry = helpers.beginDeviceConnection(value); assert.ok(retry > epoch); assert.equal(helpers.currentDeviceConnection(value, retry), true);
  helpers.revokeDeviceConnection(value, { active: false }); assert.equal(helpers.beginDeviceConnection(value), null);
});

test("actual manual health completion after reported Windows refusal cannot reconnect or start discovery", async () => {
  const host = harness(), task = host.h.connectToDeviceConnector(); assert.equal(host.requests.length, 1);
  host.h.reportBlockedWindowsHelper(); assert.equal(host.requests[0].options.signal.aborted, true); host.reply(0, { connected: true }); await task;
  assert.equal(host.state.connectorStatus, "blocked"); assert.equal(host.requests.length, 1); assert.equal(host.state.error, null); assert.equal(host.h.pairingCode, "ABCDEF123456");
  assert.equal(host.state.manualSetupOpen, false); assert.equal(host.state.manualSetupRevealed, false); assert.equal(host.timers.size, 0);
});

test("actual waiting poll completion after reported block is ignored with no next poll or device request", async () => {
  const host = harness(), epoch = helpers.beginDeviceConnection(host.h.connectionAttemptRef.current), task = host.h.waitForDeviceConnector(epoch);
  host.h.reportBlockedWindowsHelper(); host.reply(0, { connected: true }); await task;
  assert.equal(host.state.connectorStatus, "blocked"); assert.equal(host.requests.length, 1); assert.equal(host.state.error, null);
});
test("actual waiting poll failure after reported block cannot resume retries or replace the blocked outcome", async () => {
  const host = harness(), task = host.h.waitForDeviceConnector(helpers.beginDeviceConnection(host.h.connectionAttemptRef.current));
  host.h.reportBlockedWindowsHelper(); host.requests[0].response.reject(Error("Synthetic late health failure")); await task;
  assert.equal(host.requests.length, 1); assert.equal(host.state.connectorStatus, "blocked"); assert.equal(host.state.error, null);
});

test("actual pending discovery success is ignored after reported block and cannot replace device choices", async () => {
  const host = harness(), task = host.h.connectToDeviceConnector(); host.reply(0, { connected: true }); await drain();
  assert.equal(host.requests.length, 2); assert.equal(host.state.discoveringDevices, true);
  host.h.reportBlockedWindowsHelper(); assert.equal(host.requests[1].options.signal.aborted, true);
  host.reply(1, { devices: [{ id: "late-device", name: "Synthetic device", ready: true }] }); await task;
  assert.deepEqual(host.state.androidDevices, []); assert.equal(host.state.deviceSerial, "retained-device-choice"); assert.equal(host.state.connectorStatus, "blocked"); assert.equal(host.state.discoveringDevices, false);
});

test("old discovery error/finally cannot clobber a newer explicitly reconnected discovery", async () => {
  const host = harness(), original = host.h.connectToDeviceConnector(); host.reply(0, { connected: true }); await drain();
  host.h.reportBlockedWindowsHelper(); const retry = host.h.connectToDeviceConnector(); host.reply(2, { connected: true }); await drain();
  assert.equal(host.requests.length, 4); assert.equal(host.state.discoveringDevices, true);
  host.requests[1].response.reject(Error("Synthetic old private provider error")); await original;
  assert.equal(host.state.discoveringDevices, true); assert.equal(host.state.error, null);
  host.reply(3, { devices: [{ id: "new-device", name: "Synthetic selected device", ready: true }] }); await retry;
  assert.equal(host.state.deviceSerial, "new-device"); assert.equal(host.state.discoveringDevices, false); assert.equal(host.state.connectorStatus, "connected");
});

test("actual explicit device refresh refusal after reported block cannot replace status/errors", async () => {
  const host = harness(); host.h.connectorStatus = "connected"; const task = host.h.refreshAndroidDevices();
  host.h.reportBlockedWindowsHelper(); host.requests[0].response.reject(Error("Synthetic late discovery failure")); await task;
  assert.equal(host.state.error, null); assert.equal(host.state.connectorStatus, "blocked"); assert.deepEqual(host.state.androidDevices, []);
});
test("same-connection older discovery error/finally cannot overwrite the newest explicit refresh", async () => {
  const host = harness(); host.h.connectorStatus = "connected"; const first = host.h.refreshAndroidDevices(), second = host.h.refreshAndroidDevices();
  host.requests[0].response.reject(Error("Synthetic stale refresh error")); await first;
  assert.equal(host.state.discoveringDevices, true); assert.equal(host.state.error, null);
  host.reply(1, { devices: [{ id: "latest-device", name: "Synthetic latest", ready: true }] }); await second;
  assert.equal(host.state.deviceSerial, "latest-device"); assert.equal(host.state.discoveringDevices, false);
});

test("scope/unmount generation revocation prevents manual health result and device discovery side effects", async () => {
  const host = harness(), task = host.h.connectToDeviceConnector(); helpers.revokeDeviceConnection(host.h.connectionAttemptRef.current, { active: false }); host.reply(0, { connected: true }); await task;
  assert.equal(host.state.connectorStatus, "connecting"); assert.equal(host.requests.length, 1); assert.equal(host.requests[0].options.signal.aborted, true);
  assert.match(source, /const connection = connectionAttemptRef.current/);
  assert.match(source, /return \(\) => \{ revokeDeviceConnection\(connection, \{ active: false \}\)/);
  assert.match(source, /\[projectId, captureMode, pairingCode, readOnly, actor.isLoaded, actor.isSignedIn, actor.userId, actor.sessionId, helperReadFresh, helperOrganizationId, helperActorAllowed\]/);
});
test("actual loaded/seat/session activation revokes pending health on session loss and keeps original pairing private", async () => {
  const host = harness(), activate = scopeActivation(host); let cleanup = activate(); const task = host.h.connectToDeviceConnector();
  host.h.actor.isSignedIn = false; cleanup(); cleanup = activate();
  assert.equal(host.h.connectionAttemptRef.current.active, false); assert.equal(host.requests[0].options.signal.aborted, true);
  host.reply(0, { connected: true }); await task; assert.equal(host.state.connectorStatus, "idle"); assert.equal(host.requests.length, 1); assert.equal(host.h.pairingCode, "ABCDEF123456");
  host.h.connectToDeviceConnector(); host.h.downloadConnectorLauncher(); assert.equal(host.requests.length, 1); assert.equal(host.downloads.length, 0);
  host.h.actor.isSignedIn = true; host.h.actor.sessionId = "synthetic-session-renewed"; cleanup(); activate();
  assert.equal(host.h.connectionAttemptRef.current.active, true); assert.equal(host.h.pairingCode, "ABCDEF123456"); assert.equal(host.state.manualSetupOpen, false);
});
test("actual A-B-A scope changes and same-actor session change cannot revive an older health/discovery completion", async () => {
  const host = harness(), activate = scopeActivation(host); let cleanup = activate(); const task = host.h.connectToDeviceConnector();
  host.reply(0, { connected: true }); await drain(); assert.equal(host.requests.length, 2);
  host.h.actor.userId = "synthetic-other-actor"; cleanup(); cleanup = activate(); assert.equal(host.h.helperActorAllowed, false);
  host.h.actor.userId = "synthetic-original"; cleanup(); cleanup = activate();
  host.reply(1, { devices: [{ id: "stale-after-return", name: "Synthetic stale", ready: true }] }); await task;
  assert.deepEqual(host.state.androidDevices, []); assert.equal(host.state.deviceSerial, "retained-device-choice"); assert.equal(host.h.pairingCode, "ABCDEF123456");
  const second = host.h.connectToDeviceConnector(); host.h.actor.sessionId = "synthetic-session-B"; cleanup(); activate(); host.reply(2, { connected: true }); await second;
  assert.equal(host.requests.length, 3); assert.equal(host.state.connectorStatus, "idle");
});
test("actual full-seat/project/original-actor predicate refuses connection/download and private manual reveal", () => {
  for (const mode of ["loading", "session", "seat", "actor", "project"]) {
    const host = harness(), activate = scopeActivation(host);
    if (mode === "loading") host.h.actor.isLoaded = false;
    if (mode === "session") host.h.actor.sessionId = null;
    if (mode === "seat") host.h.readOnly = true;
    if (mode === "actor") host.h.actor.userId = "other";
    if (mode === "project") host.h.projectId = "other-project";
    activate(); host.h.connectToDeviceConnector(); host.h.downloadConnectorLauncher(); host.h.showPolicyPermittedManualSetup();
    assert.equal(host.requests.length, 0, mode); assert.equal(host.downloads.length, 0, mode); assert.equal(host.state.manualSetupRevealed, false, mode); assert.equal(host.h.pairingCode, "ABCDEF123456", mode);
  }
});
test("actual protected project/member read admission refuses error/fetch/paused/uncompleted cache and wrong original organization", () => {
  for (const [query, flag, value] of [["helperProject", "error", Error("synthetic")], ["helperProject", "isFetching", true], ["helperProject", "isPaused", true], ["helperProject", "isFetchedAfterMount", false], ["helperOrganizations", "error", Error("synthetic")], ["helperOrganizations", "isFetching", true], ["helperOrganizations", "isPaused", true], ["helperOrganizations", "isFetchedAfterMount", false]]) {
    const host = harness(), activate = scopeActivation(host); host.h[query][flag] = value; activate(); host.h.connectToDeviceConnector(); host.h.downloadConnectorLauncher();
    assert.equal(host.h.helperActorAllowed, false, `${query}.${flag}`); assert.equal(host.requests.length, 0); assert.equal(host.downloads.length, 0);
  }
  for (const state of ["wrong-project", "wrong-org", "read-only", "viewer"]) {
    const host = harness(), activate = scopeActivation(host);
    if (state === "wrong-project") host.h.helperProject.data.id = "other";
    if (state === "wrong-org") { host.h.helperProject.data.organizationId = "other"; host.h.helperOrganizations.data = [{ id: "other", role: "OWNER", seatType: "FULL" }]; }
    if (state === "read-only") host.h.helperOrganizations.data[0].seatType = "READ_ONLY";
    if (state === "viewer") host.h.helperOrganizations.data[0].role = "VIEWER";
    activate(); host.h.connectToDeviceConnector(); host.h.downloadConnectorLauncher(); assert.equal(host.requests.length, 0, state); assert.equal(host.downloads.length, 0, state);
  }
});

test("actual health false is not connectivity; polling timeout states only no paired response and preserves privacy", async () => {
  const manual = harness(), task = manual.h.connectToDeviceConnector(); manual.reply(0, { connected: false }); await task;
  assert.equal(manual.state.connectorStatus, "idle"); assert.equal(manual.requests.length, 1); assert.match(manual.state.error, /No paired helper response/);
  const poll = harness(); poll.h.fetch = async () => { throw Error("Synthetic no health response"); }; await poll.h.waitForDeviceConnector(helpers.beginDeviceConnection(poll.h.connectionAttemptRef.current));
  assert.match(poll.state.error, /No paired helper response/); assert.doesNotMatch(poll.state.error, /helper did not start|ABCDEF123456|Synthetic no health/);
  assert.equal(poll.h.connectionAttemptRef.current.controllers.size, 0); assert.equal(poll.timers.size, 0);
});

test("actual blocked setup markup hides pairing/code and raw download until an explicit policy-permitted reveal", () => {
  let details;
  function visit(node) { if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "details" && node.openingElement.getText(ast).includes("manualSetupOpen")) details = node; ts.forEachChild(node, visit); } visit(page);
  assert.ok(details);
  const jsx = printer.printNode(ts.EmitHint.Unspecified, details, ast), code = ts.transpileModule(`function SetupFixture(){ return (${jsx}); }`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText;
  const h = { React, connectorStatus: "blocked", manualSetupOpen: false, manualSetupRevealed: false, pairingCode: "ABCDEF123456", helperActorAllowed: true, setManualSetupOpen() {} }; vm.createContext(h); vm.runInContext(code, h);
  let html = renderToStaticMarkup(React.createElement(h.SetupFixture)); assert.ok(!html.includes("ABCDEF123456")); assert.ok(!html.includes("Download raw connector")); assert.match(html, /Pairing code and private setup command are hidden/);
  h.manualSetupRevealed = true; h.manualSetupOpen = true; html = renderToStaticMarkup(React.createElement(h.SetupFixture)); assert.match(html, /ABCDEF123456/); assert.match(html, /only if your policy permits/); assert.ok(!html.includes("Unblock-File"));
  h.helperActorAllowed = false; assert.ok(!renderToStaticMarkup(React.createElement(h.SetupFixture)).includes("ABCDEF123456"));
  const host = harness(); host.h.reportBlockedWindowsHelper(); host.h.showPolicyPermittedManualSetup(); assert.equal(host.requests.length, 0); assert.equal(host.state.manualSetupOpen, true); assert.equal(host.state.manualSetupRevealed, true); assert.equal(host.state.connectorStatus, "blocked");
});

test("reported block is unavailable during an existing capture/generation and never claims automatic Windows diagnosis", () => {
  const host = harness(); host.h.capturing = true; host.h.reportBlockedWindowsHelper(); assert.equal(host.state.connectorStatus, "idle");
  assert.match(source, /Windows launch blocked \(reported by you\)/);
  assert.match(source, /<DeviceHelperBlockedLaunchGuidance reportedBlocked=\{true\}/);
  const guidance = readFileSync(new URL("../components/DeviceHelperBlockedLaunchGuidance.tsx", import.meta.url), "utf8");
  assert.match(guidance, /Windows refused launch \(reported by you\)/);
  assert.match(guidance, /blocking policy or product is unknown/);
  assert.match(source, /Downloading is not proof of launch/);
  assert.doesNotMatch(handlers, /Unblock-File|ExecutionPolicy|RunAs|Add-MpPreference|Start-Process/);
});
