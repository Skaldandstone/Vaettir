import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createAndroidExplorer } from "./android-exploration-lib.mjs";
const hash = (value) => createHash("sha256").update(value).digest("hex");
const scope = {
  projectId: "synthetic-project",
  organizationId: "synthetic-org",
  actorId: "synthetic-actor",
  sessionId: "synthetic-login",
};
const origin = "http://localhost:3000";
function fixture() {
  let clock = Date.UTC(2026, 9, 22),
    token = 0,
    screen = "Home",
    external = false,
    failed = false,
    failAfterAction = false,
    blockAfterAction = false,
    changed = false,
    actions = 0;
  const calls = [],
    stack = [];
  const screens = {
    Home: ["Browse", "About", "Delete"],
    Browse: ["Details", "Submit"],
    Details: [],
    About: [],
  };
  const native = {
    inspect(serial) {
      assert.equal(serial, "SYNTHETIC");
      calls.push("inspect");
      if (external) throw Error("PRIVATE FOREIGN BODY");
      return "com.vaettir.synthetic";
    },
    observe() {
      calls.push("observe");
      if (failed) throw Error("PRIVATE BODY");
      return {
        id: hash(changed ? "changed" : screen),
        label: screen,
        blocked: blockAfterAction && actions > 0,
        scroll: null,
        controls: screens[screen].map((name, index) => ({
          id: hash(name),
          name,
          role: "button",
          navigable: true,
          bounds: [index * 100, 0, (index + 1) * 100, 100],
          target: {
            packageName: "com.vaettir.synthetic",
            objectId: `com.vaettir.synthetic:id/${name}`,
            className: "android.widget.Button",
            selector: {
              kind: "RESOURCE_ID",
              value: `com.vaettir.synthetic:id/${name}`,
            },
            bounds: [index * 100, 0, (index + 1) * 100, 100],
          },
        })),
      };
    },
    tap(_serial, bounds) {
      calls.push("tap");
      actions++;
      const name = screens[screen][bounds[0] / 100];
      stack.push(screen);
      screen = name;
      if (failAfterAction) failed = true;
      return [
        "shell",
        "input",
        "tap",
        String(Math.floor((bounds[0] + bounds[2]) / 2)),
        String(Math.floor((bounds[1] + bounds[3]) / 2)),
      ];
    },
    back() {
      calls.push("back");
      actions++;
      screen = stack.pop();
      return ["shell", "input", "keyevent", "4"];
    },
    scroll() {
      throw Error("no scroll in fixture");
    },
  };
  const explorer = createAndroidExplorer(native, {
    hash,
    nonce: () => String(++token).padStart(48, "0"),
    now: () => clock,
  });
  let state, ticket;
  const handle = (command, input) => explorer.handle(command, input, origin);
  const inspect = () => {
    ticket = handle("inspect", { serial: "SYNTHETIC", scope });
    return ticket;
  };
  const start = (extra = {}) => {
    inspect();
    state = handle("start", {
      ticket: ticket.ticket,
      scope,
      consent: { localObservation: true, navigation: true, testAccount: true },
      navigationNames: ["Browse", "Details", "About"],
      limits: { actions: 12, screens: 8, seconds: 180 },
      ...extra,
    });
    return state;
  };
  const next = (extra = {}) => {
    state = handle("next", {
      id: state.id,
      scope,
      sequence: state.sequence,
      requestId: "11111111-1111-4111-8111-111111111111",
      ...extra,
    });
    return state;
  };
  return {
    handle,
    inspect,
    start,
    next,
    calls,
    get state() {
      return state;
    },
    get actions() {
      return actions;
    },
    setExternal() {
      external = true;
    },
    setFailure() {
      failed = true;
    },
    failAfterAction() {
      failAfterAction = true;
    },
    blockAfterAction() {
      blockAfterAction = true;
    },
    changeScreen() {
      changed = true;
    },
    native,
    advance(ms) {
      clock += ms;
    },
  };
}
test("single-file shipped engine exactly matches maintained pure source", () => {
  const file = readFileSync(
    new URL(
      "../apps/web/public/connectors/vaettir-device-connector.mjs",
      import.meta.url,
    ),
    "utf8",
  ).replaceAll("\r\n", "\n");
  const embedded = file
    .split("// BEGIN EMBEDDED ANDROID EXPLORER\n")[1]
    .split("// END EMBEDDED ANDROID EXPLORER\n")[0];
  const pure = readFileSync(
    new URL("./android-exploration-lib.mjs", import.meta.url),
    "utf8",
  )
    .replaceAll("\r\n", "\n")
    .replace(
      "export function createAndroidExplorer",
      "function createAndroidExplorer",
    );
  assert.equal(embedded, pure + "\n");
});
test("bounded DFS produces real multi-step journeys, returns through Back and excludes unapproved writes", () => {
  const f = fixture();
  f.start();
  while (f.state.status === "ACTIVE") f.next();
  assert.equal(f.state.status, "COMPLETED");
  assert.equal(f.state.reason, "APPROVED_NAVIGATION_EXHAUSTED");
  assert.deepEqual(
    f.state.journeys.map((j) => j.steps.map((s) => s.action.label)),
    [["Browse"], ["Browse", "Details"], ["About"]],
  );
  assert.deepEqual(
    f.state.journeys.map((j) => j.steps.at(-1).to.label),
    ["Browse", "Details", "About"],
  );
  assert.equal(f.actions, 6);
  assert.ok(f.calls.includes("back"));
  for (const j of f.state.journeys)
    assert.equal(j.id, hash(JSON.stringify(j.steps)));
  assert.equal(f.state.aiProcessingPerformed, false);
  const execution = f.state.journeys[0].steps[0].execution;
  assert.equal(execution.target.objectId, "com.vaettir.synthetic:id/Browse");
  assert.deepEqual(execution.commandArgs, [
    "shell",
    "input",
    "tap",
    "50",
    "50",
  ]);
  assert.equal(
    execution.connector.requestId,
    "11111111-1111-4111-8111-111111111111",
  );
  assert.deepEqual(execution.appNetwork, {
    status: "NOT_CAPTURED",
    reason: "APP_NETWORK_INSPECTION_NOT_CONNECTED",
  });
});

test("malformed command identifiers and mismatched native target geometry refuse before acting", () => {
  for (const requestId of [
    "------------------------------------",
    "11111111-1111-1111-1111-111111111111",
  ]) {
    const f = fixture();
    f.start();
    const count = f.calls.length;
    assert.throws(() => f.next({ requestId }));
    assert.equal(f.calls.length, count);
    assert.equal(f.actions, 0);
  }
  for (const mutation of [
    (c) => {
      c.target = null;
    },
    (c) => {
      c.target.packageName = "com.other.synthetic";
    },
    (c) => {
      c.target.bounds = [0, 0, 200, 100];
    },
    (c) => {
      c.target.bounds = c.bounds = [0, 0, 0, 100];
    },
  ]) {
    const f = fixture();
    f.start();
    const observe = f.native.observe;
    f.native.observe = () => {
      const value = observe();
      mutation(value.controls[0]);
      return value;
    };
    f.next();
    assert.equal(f.actions, 0);
    assert.equal(f.state.reason, "TARGET_OR_OBSERVATION_UNAVAILABLE");
    assert.equal(f.state.journeys.length, 0);
  }
});

test("a command adapter mismatch after a tap is uncertain and cannot produce evidence or replay", () => {
  const f = fixture();
  f.start();
  const tap = f.native.tap;
  f.native.tap = (...args) => {
    tap(...args);
    return ["shell", "input", "tap", "999", "999"];
  };
  f.next();
  assert.equal(f.actions, 1);
  assert.equal(f.state.reason, "ACTION_OUTCOME_UNCERTAIN_NO_RETRY");
  assert.equal(f.state.journeys.length, 0);
  assert.throws(() => f.next());
  assert.equal(f.actions, 1);
});
test("original actor, workspace, project, login and origin pins cannot be rebound", () => {
  const f = fixture();
  f.start();
  const before = f.calls.length;
  for (const key of Object.keys(scope))
    assert.throws(() =>
      f.handle("next", {
        id: f.state.id,
        scope: { ...scope, [key]: "different" },
        sequence: 0,
        requestId: "11111111-1111-4111-8111-111111111111",
      }),
    );
  assert.equal(f.calls.length, before);
  assert.equal(f.actions, 0);
});
test("consent, bounded limits and action labels admitted before source observation", () => {
  for (const extra of [
    {
      consent: { localObservation: false, navigation: true, testAccount: true },
    },
    { limits: { actions: 25, screens: 8, seconds: 180 } },
    { navigationNames: ["Delete"] },
    { navigationNames: ["Browse", "Browse"] },
  ]) {
    const f = fixture();
    assert.throws(() => f.start(extra));
    assert.equal(f.calls.filter((c) => c === "observe").length, 0);
    assert.equal(f.actions, 0);
  }
});
test("Pause/Stop/read never dispatch a device command and resume rechecks stale screen", () => {
  const f = fixture();
  f.start();
  const before = f.calls.length;
  assert.equal(f.handle("pause", { id: f.state.id, scope }).status, "PAUSED");
  assert.throws(() => f.next());
  f.handle("read", { id: f.state.id, scope });
  assert.equal(f.calls.length, before);
  f.handle("resume", { id: f.state.id, scope });
  f.changeScreen();
  f.next();
  assert.equal(f.state.reason, "SCREEN_CHANGED_REVIEW_REQUIRED");
  assert.equal(f.actions, 0);
  assert.equal(f.handle("stop", { id: f.state.id, scope }).status, "STOPPED");
});
test("stale sequence and failed pre-action observation cannot issue another action", () => {
  const f = fixture();
  f.start();
  const first = f.next();
  const n = f.actions;
  assert.throws(() => f.next({ sequence: 0 }));
  assert.equal(f.actions, n);
  f.setFailure();
  f.next();
  assert.equal(f.state.status, "STOPPED");
  assert.equal(f.state.reason, "TARGET_OR_OBSERVATION_UNAVAILABLE");
  assert.equal(f.actions, n);
  assert.equal(first.journeys.length, 1);
});
test("failed post-action observation stops with an uncertain outcome and never replays the attempted tap", () => {
  const f = fixture();
  f.start();
  f.failAfterAction();
  f.next();
  assert.equal(f.actions, 1);
  assert.equal(f.state.actionCount, 1);
  assert.equal(f.state.sequence, 1);
  assert.equal(f.state.reason, "ACTION_OUTCOME_UNCERTAIN_NO_RETRY");
  assert.deepEqual(f.state.lastOperation, {
    requestId: "11111111-1111-4111-8111-111111111111",
    sequence: 1,
    actionAttempted: true,
    outcome: "UNVERIFIED",
  });
  const before = f.calls.length;
  assert.throws(() => f.next());
  const recovered = f.handle("read", { id: f.state.id, scope });
  assert.equal(recovered.journeys.length, 0);
  assert.equal(f.actions, 1);
  assert.equal(f.calls.length, before);
});
test("device/app loss refuses before another action; deadlines and action limits terminate", () => {
  const f = fixture();
  f.start();
  f.setExternal();
  f.next();
  assert.equal(f.actions, 0);
  assert.equal(f.state.status, "STOPPED");
  const timed = fixture();
  timed.start();
  timed.advance(180001);
  assert.throws(() => timed.next());
  assert.equal(timed.actions, 0);
  const bounded = fixture();
  bounded.start({ limits: { actions: 1, screens: 8, seconds: 180 } });
  bounded.next();
  bounded.next();
  assert.equal(bounded.actions, 1);
  assert.equal(bounded.state.reason, "ACTION_LIMIT");
});
test("a reached manual-interaction screen stops without retaining its labels or making a proposal", () => {
  const f = fixture();
  f.start();
  f.blockAfterAction();
  f.next();
  assert.equal(f.state.reason, "FORM_AUTH_OR_EMBEDDED_CONTENT");
  assert.equal(f.actions, 1);
  assert.equal(f.state.screens.length, 1);
  assert.equal(f.state.screens[0].label, "Home");
  assert.equal(f.state.journeys.length, 0);
  assert.equal(f.state.lastOperation.actionAttempted, true);
  assert.equal(f.state.lastOperation.outcome, "OBSERVED");
});
test("a changed view and malformed request cannot authorize a tap", () => {
  const f = fixture();
  f.start();
  f.changeScreen();
  f.next();
  assert.equal(f.actions, 0);
  assert.equal(f.state.reason, "SCREEN_CHANGED_REVIEW_REQUIRED");
  assert.throws(() => f.handle("start", { anything: true }));
});
