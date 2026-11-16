// Actual component/controller and shared schemas; synthetic hooks, RPC and
// connector only. SSR does not establish browser geometry or device acceptance.
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import ts from "typescript";
import { controllerTranspile } from "./controller-transpile.fixture";
import { it, expect } from "vitest";
import * as schemas from "../../api/src/services/androidCaseReplaySchema";
import * as network from "../../api/src/services/androidNetworkEvidenceSchema";
import * as correlation from "../../api/src/services/androidNetworkCorrelation";
const source = readFileSync(
  new URL("../components/AndroidCaseReplay.tsx", import.meta.url),
  "utf8",
);
const compiled = controllerTranspile(source, {
  compilerOptions: {
    jsx: ts.JsxEmit.React,
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText;
type Element = React.ReactElement<Record<string, unknown>>;
function nodes(v: unknown, out: Element[] = []): Element[] {
  if (React.isValidElement(v)) {
    const e = v as Element;
    out.push(e);
    nodes(e.props.children, out);
  } else if (Array.isArray(v)) v.forEach((x) => nodes(x, out));
  return out;
}
const label = (v: unknown): string =>
  typeof v === "string"
    ? v
    : React.isValidElement(v)
      ? label((v as Element).props.children)
      : Array.isArray(v)
        ? v.map(label).join("")
        : "";
type CaptureMode = "approved" | "unapproved" | "unsolicited" | "wrongSource" | "unavailable" | "missing";
function fixture(stepCount = 1, captureMode?: CaptureMode) {
  let cursor = 0,
    epoch = "original",
    serial = "synthetic",
    access = true,
    dropNext = false,
    dropSave = false,
    denyRead = false,
    denySave = false,
    changedPlan = false,
    staleRead = false,
    scopeAfterNext = false,
    failedNext = false;
  let releaseNext: (() => void) | null = null;
  let heldNext: Promise<void> | null = null;
  const values: unknown[] = [],
    calls: { path: string; body?: unknown }[] = [],
    writes: unknown[] = [];
  let tree: React.ReactNode,
    local: schemas.AndroidReplayState | null = null;
  const tc: schemas.AndroidReplayCase = {
    id: "case",
    title: "Private synthetic case",
    revision: "a".repeat(64),
    packageName: "com.example.qa",
    steps: [
      {
        id: "step",
        order: 0,
        action: "Open catalog",
        expectedResult: "Catalog is visible",
        label: "Open catalog",
        locator: {
          kind: "RESOURCE_ID",
          value: "com.example.qa:id/catalog",
          className: "android.widget.Button",
        },
      },
    ],
  };
  for (let i = 1; i < stepCount; i++) tc.steps.push({ ...structuredClone(tc.steps[0]!), id: `step${i + 1}`, order: i });
  const catalog = { id: "qa_routes", revision: 1, routes: [{ routeKey: "catalog", method: "GET" as const, template: "/catalog" }] };
  let captureChanged = false;
  const capture = () => {
    const timestamp = Date.now();
    const sourceId = captureMode === "wrongSource" ? "other_source" : "qa_debug";
    const clockId = "e".repeat(48);
    return {
      status: "CAPTURED" as const,
      metadata: { version: 2 as const, capability: "DEBUG_APP_HTTP_CALLBACKS" as const, debugBuild: true as const,
        metadataOnly: true as const, packageName: tc.packageName!, runId: "b".repeat(48), sourceId,
        approvedRouteKeys: ["catalog"], catalog, clockId, pendingRequests: 0,
        events: captureChanged ? [{ routeKey: "catalog", method: "GET" as const, status: 200,
          startedAt: timestamp, durationMs: 0, outcome: "RESPONSE" as const }] : [] },
      selection: { sourceId, approvedRouteKeys: ["catalog"], startedAt: timestamp, endedAt: timestamp,
        correlation: { catalog, sourceReviewed: true as const, catalogReviewed: true as const,
          temporalOnlyReviewed: true as const, clockCalibration: null,
          captureClock: { domain: "APP_REPORTED" as const, clockId } } },
    };
  };
  const currentScope = () => ({
    scope: {
      projectId: "project",
      organizationId: "org",
      actorId: "clerk",
      sessionId: "session",
    },
    epochKey: epoch,
  });
  const props = {
    serial,
    connectionKey: "pair",
    available: true,
    accessAvailable: access,
    currentScope,
    nativeActorId: () => "native",
    request: async (path: string, body?: unknown) => {
      calls.push({ path, body });
      if (path.endsWith("capabilities"))
        return {
          version: 1,
          platform: "ANDROID",
          supportedActions: ["TAP"],
          assertions: ["VISIBLE_LABEL"],
          appNetwork: "DEBUG_APP_EXPORT_ONLY",
          appNetworkCapture: { version: 2, transport: "APP_PRIVATE_FILES" },
          backgroundNavigation: false,
        };
      if (path.endsWith("inspect"))
        return {
          ticket: "a".repeat(48),
          packageName: "com.example.qa",
          expiresAt: Date.now() + 120000,
        };
      if (path.endsWith("start")) {
        const input = body as { plan: schemas.AndroidReplayState["plan"] };
        local = {
          version: 1,
          id: "b".repeat(48),
          scope: currentScope().scope,
          plan: input.plan,
          planHash: createHash("sha256")
            .update(JSON.stringify(input.plan))
            .digest("hex"),
          status: "ACTIVE",
          reason: null,
          sequence: 0,
          index: 0,
          expiresAt: Date.now() + 300000,
          screen: { id: "c".repeat(64), label: "Home", controls: [] },
          receipts: [],
          candidates: [],
          lastRequestId: null,
          nativeExecutionIndependentlyVerified: false,
        };
        if (captureMode && !["unapproved", "missing"].includes(captureMode)) {
          local.networkCapture = captureMode === "unavailable"
            ? { status: "UNAVAILABLE", metadata: null, selection: null } : capture();
          if (captureMode === "unavailable") local.status = "STOPPED";
        }
        return structuredClone(local);
      }
      if (path.endsWith("next")) {
        const input = body as { requestId: string };
        const r = local!;
        const p = r.plan.steps[r.index]!;
        if (!failedNext) r.index++;
        r.status = failedNext ? "ASSERTION_FAILED" : r.index === r.plan.steps.length ? "COMPLETED" : "ACTIVE";
        r.sequence++;
        r.lastRequestId = input.requestId;
        r.receipts.push(
          {
            stepId: p.stepId,
            expectedResult: p.expectedResult,
            requestId: input.requestId,
            sequence: r.sequence,
            from: r.screen!.id,
            to: String.fromCharCode(99 + r.sequence).repeat(64),
            observedAt: Date.now(),
            originalLocator: p.locator,
            target: {
              packageName: "com.example.qa",
              objectId: p.locator.value,
              className: p.locator.className,
              selector: { kind: p.locator.kind, value: p.locator.value },
              bounds: [0, 0, 100, 100],
            },
            commandArgs: ["shell", "input", "tap", "50", "50"],
            assertion: { ...p.assertion, matches: failedNext ? 0 : 1, passed: !failedNext },
            repaired: false,
            repairApproval: null,
          },
        );
        r.screen!.id = r.receipts.at(-1)!.to;
        if (scopeAfterNext) epoch = "foreign";
        if (heldNext) await heldNext;
        if (dropNext) throw Error("synthetic lost next reply");
        return structuredClone(r);
      }
      if (path.endsWith("read")) {
        const result = structuredClone(local!);
        if (captureChanged && result.networkCapture?.status === "CAPTURED") result.networkCapture = capture();
        if (changedPlan)
          result.plan.steps[0]!.assertion.value = "Changed assertion";
        if (staleRead) {
          result.sequence = 0;
          result.lastRequestId = null;
        }
        return result;
      }
      if (path.endsWith("stop")) {
        local!.status = "STOPPED";
        return structuredClone(local);
      }
      throw Error("Unexpected local operation");
    },
  };
  const client = {
    liveAppGeneration: {
      replayCases: { query: async () => [{ id: tc.id, title: tc.title }] },
      replayCase: {
        query: async () => {
          if (denyRead) throw Error("denied");
          return tc;
        },
      },
      patchReplayCase: {
        mutate: async (
          input: typeof schemas.androidReplayPatchInput._output,
        ) => {
          writes.push(structuredClone(input));
          if (denySave)
            throw Object.assign(Error("denied"), {
              data: { code: "FORBIDDEN" },
            });
          if (dropSave) {
            dropSave = false;
            throw Error("synthetic lost save reply");
          }
          return {
            requestId: input.requestId,
            requestHash: "e".repeat(64),
            caseId: tc.id,
            priorRevision: tc.revision,
            newRevision: "f".repeat(64),
            versionNumber: 2,
            runId: input.runId,
            nativeExecutionIndependentlyVerified: false,
          };
        },
      },
    },
  };
  const hooks = {
    ...React,
    useState: (init: unknown) => {
      const i = cursor++;
      if (!(i in values))
        values[i] =
          typeof init === "function" ? (init as () => unknown)() : init;
      return [
        values[i],
        (next: unknown) => {
          values[i] =
            typeof next === "function"
              ? (next as (v: unknown) => unknown)(values[i])
              : next;
        },
      ];
    },
    useRef: (init: unknown) => {
      const i = cursor++;
      if (!(i in values)) values[i] = { current: init };
      return values[i];
    },
    useEffect: () => undefined,
  };
  const exports: { AndroidCaseReplay?: (p: typeof props) => React.ReactNode } =
    {};
  new Function("require", "exports", "React", "crypto", compiled)(
    (name: string) => {
      if (name === "react") return hooks;
      if (name === "@/lib/trpcReact")
        return { trpcReact: { useUtils: () => ({ client }) } };
      if (name.endsWith("androidCaseReplaySchema")) return schemas;
      if (name.endsWith("androidNetworkEvidenceSchema")) return network;
      if (name.endsWith("androidNetworkCorrelation")) return correlation;
      throw Error("Unexpected dependency: " + name);
    },
    exports,
    React,
    { randomUUID },
  );
  const render = () => {
    cursor = 0;
    props.serial = serial;
    props.accessAvailable = access;
    tree = exports.AndroidCaseReplay!(props);
    return renderToStaticMarkup(tree);
  };
  const find = (type: string, wanted: string) => {
    const n = nodes(tree).find(
      (n) =>
        n.type === type &&
        (label(n.props.children) === wanted ||
          n.props["aria-label"] === wanted),
    );
    if (!n) throw Error("Missing " + type + " " + wanted);
    return n;
  };
  const settle = async () => {
    for (let i = 0; i < 100; i++) await Promise.resolve();
    render();
  };
  const click = async (wanted: string) => {
    const n = find("button", wanted);
    expect(n.props.disabled).not.toBe(true);
    (n.props.onClick as () => void)();
    await settle();
  };
  const change = (n: Element, value: string | boolean) => {
    (n.props.onChange as (e: unknown) => void)({
      target: { value, checked: value },
    });
    render();
  };
  const checkbox = (contains: string) => {
    const parent = nodes(tree).find(
      (n) => n.type === "label" && label(n.props.children).includes(contains),
    );
    const input = nodes(parent).find((n) => n.type === "input")!;
    change(input, true);
  };
  const start = async (automatic = false) => {
    render();
    await click("Load existing cases");
    change(
      nodes(tree).find((n) => n.type === "select")!,
      "case",
    );
    await click("Review selected case");
    const area = find("textarea", "Reviewed replay plan");
    const plan = JSON.parse(String(area.props.value));
    for (const step of plan.steps) step.assertion.value = "Catalog";
    change(area, JSON.stringify(plan));
    if (!automatic) checkbox("Step by step");
    if (captureMode && captureMode !== "unsolicited") {
      const input = find("input", "App request setup");
      (input.props.onChange as (e: unknown) => void)({ target: {
        files: [{ size: 500, text: async () => JSON.stringify({ sourceId: "qa_debug", catalog }) }], value: "setup.json",
      } });
      await settle();
      if (captureMode !== "unapproved") checkbox("Include this debug source");
    }
    await click("Check selected device’s open app");
    checkbox("I approve this app");
    await click("Start reviewed run");
  };
  return {
    render,
    click,
    start,
    calls,
    writes,
    find,
    checkbox,
    settle,
    captureChanged: () => { captureChanged = true; },
    holdNext: () => { heldNext = new Promise<void>(resolve => { releaseNext = resolve; }); },
    releaseNext: () => { releaseNext?.(); heldNext = null; },
    failNext: () => { failedNext = true; },
    scopeAfterNext: () => { scopeAfterNext = true; },
    denySave: () => {
      denySave = true;
    },
    changedPlan: () => {
      changedPlan = true;
    },
    staleRead: () => {
      staleRead = true;
    },
    scope: () => {
      epoch = "foreign";
    },
    restore: () => {
      epoch = "original";
      access = true;
      serial = "synthetic";
    },
    device: () => {
      serial = "other";
    },
    deny: () => {
      denyRead = true;
    },
    access: () => {
      access = false;
    },
    dropNext: () => {
      dropNext = true;
    },
    dropSave: () => {
      dropSave = true;
    },
  };
}
it("renders initial supported scope without performing RPC/native/AI work", () => {
  const h = fixture();
  expect(h.render()).toContain("Run a case");
  expect(h.calls).toHaveLength(0);
  expect(h.writes).toHaveLength(0);
});
it("one approved Run advances multiple reviewed steps without more clicks or case writes", async () => {
  const h = fixture(2);
  await h.start(true);
  expect(h.calls.filter(c => c.path.endsWith("next"))).toHaveLength(2);
  expect(h.render()).toContain("COMPLETED");
  expect(h.render()).toContain("2 of 2 assertions matched");
  expect(h.writes).toHaveLength(0);
});
it("automatic execution stops at a failed assertion, lost reply or changed authority", async () => {
  for (const mode of ["failNext", "dropNext", "scopeAfterNext"] as const) {
    const h = fixture(2); h[mode](); await h.start(true);
    expect(h.calls.filter(c => c.path.endsWith("next"))).toHaveLength(1);
    expect(h.writes).toHaveLength(0);
    const html = h.render();
    expect(html).not.toContain("COMPLETED");
    if (mode === "scopeAfterNext") expect(html).not.toContain("Private synthetic case");
  }
});
it("Stop remains available during an action and prevents dispatching the next step", async () => {
  const h = fixture(2); h.holdNext(); await h.start(true);
  expect(h.calls.filter(c => c.path.endsWith("next"))).toHaveLength(1);
  await h.click("Stop run");
  h.releaseNext(); await h.settle();
  expect(h.calls.filter(c => c.path.endsWith("next"))).toHaveLength(1);
  expect(h.calls.filter(c => c.path.endsWith("stop"))).toHaveLength(1);
  expect(h.render()).toContain("STOPPED");
});
it("actual event handlers admit only an explicitly reviewed plan and one next action", async () => {
  const h = fixture();
  await h.start();
  expect(h.calls.map((c) => c.path)).toEqual([
    "/case-replay/v1/capabilities",
    "/case-replay/v1/inspect",
    "/case-replay/v1/start",
  ]);
  await h.click("Run next reviewed step");
  expect(h.render()).toContain("COMPLETED");
  expect(h.render()).toContain("Review changes");
  expect(h.writes).toHaveLength(0);
});
it("lost action response offers retained read, never another next dispatch", async () => {
  const h = fixture();
  await h.start();
  h.dropNext();
  await h.click("Run next reviewed step");
  expect(h.find("button", "Run next reviewed step").props.disabled).toBe(true);
  await h.click("Read retained result without acting");
  expect(h.render()).toContain("COMPLETED");
  expect(h.calls.filter((c) => c.path.endsWith("next"))).toHaveLength(1);
});
it("uncertain patch retry reuses exact reviewed payload and request ID", async () => {
  const h = fixture();
  await h.start();
  await h.click("Run next reviewed step");
  h.checkbox("Approve disclosure");
  h.checkbox("I reviewed the separate");
  h.dropSave();
  await h.click("Save reviewed technical case patch");
  await h.click("Recover exact patch receipt");
  expect(h.writes).toHaveLength(2);
  expect(h.writes[1]).toEqual(h.writes[0]);
  expect(h.render()).toContain("Version 2 saved for review");
  expect(h.calls.filter((c) => c.path.endsWith("next"))).toHaveLength(1);
});
it("scope or device change hides retained private evidence and blocks stale handlers", async () => {
  for (const change of ["scope", "device"] as const) {
    const h = fixture();
    await h.start();
    h[change]();
    expect(h.render()).not.toContain("Private synthetic case");
    expect(h.render()).toContain("Access changed. Start a new connection");
    expect(h.calls.filter((c) => c.path.endsWith("next"))).toHaveLength(0);
  }
});
it("current revision/access denial consumes run authority before any action and cannot be restored", async () => {
  const h = fixture();
  await h.start();
  h.deny();
  await h.click("Run next reviewed step");
  expect(h.render()).toContain("Access changed. Start a new connection");
  h.restore();
  expect(h.render()).toContain("Access changed. Start a new connection");
  expect(h.calls.filter((c) => c.path.endsWith("next"))).toHaveLength(0);
});

it("save authorization denial hides evidence and never restores pending write authority", async () => {
  const h = fixture();
  await h.start();
  await h.click("Run next reviewed step");
  h.checkbox("Approve disclosure");
  h.checkbox("I reviewed the separate");
  h.denySave();
  await h.click("Save reviewed technical case patch");
  expect(h.render()).toContain("Access changed. Start a new connection");
  h.restore();
  expect(h.render()).toContain("Access changed. Start a new connection");
  expect(h.writes).toHaveLength(1);
});
it("retained recovery refuses changed assertions and unacknowledged command sequence", async () => {
  for (const kind of ["changedPlan", "staleRead"] as const) {
    const h = fixture();
    await h.start();
    h.dropNext();
    await h.click("Run next reviewed step");
    h[kind]();
    await h.click("Read retained result without acting");
    expect(h.find("button", "Run next reviewed step").props.disabled).toBe(
      true,
    );
    expect(h.render()).toContain("Result unconfirmed");
    expect(h.calls.filter((c) => c.path.endsWith("next"))).toHaveLength(1);
  }
});

it("request tracing stays absent without separate one-run source and route approval", async () => {
  for (const captureMode of [undefined, "unapproved"] as const) {
    const h = fixture(1, captureMode); await h.start(true);
    const input = h.calls.find(c => c.path.endsWith("start"))!.body as Record<string, unknown>;
    expect(input).not.toHaveProperty("networkApproval");
    expect(h.writes).toHaveLength(0);
  }
});
it("approved request setup is pinned before run and retained unchanged for reviewed saving", async () => {
  const h = fixture(1, "approved"); await h.start(true);
  const input = h.calls.find(c => c.path.endsWith("start"))!.body as Record<string, unknown>;
  expect(input.networkApproval).toMatchObject({ sourceId: "qa_debug", debugMetadata: true,
    sourceReviewed: true, catalogReviewed: true, temporalOnlyReviewed: true });
  expect(h.render()).toContain("COMPLETED");
  expect(h.writes).toHaveLength(0);
  h.checkbox("Approve disclosure"); h.checkbox("I reviewed the separate");
  await h.click("Save reviewed technical case patch");
  expect(h.writes).toHaveLength(1);
  expect(h.writes[0]).toMatchObject({ network: { version: 2, sourceId: "qa_debug" },
    networkSelection: { correlation: { captureClock: { domain: "APP_REPORTED" } } } });
});
it("unsolicited, missing or changed-source capture stops before a navigation action", async () => {
  for (const mode of ["unsolicited", "missing", "wrongSource"] as const) {
    const h = fixture(2, mode); await h.start(true);
    expect(h.calls.filter(c => c.path.endsWith("next"))).toHaveLength(0);
    expect(h.writes).toHaveLength(0);
    expect(h.render()).toContain("Result unconfirmed");
  }
});
it("unavailable debug integration is visible and performs no subsequent navigation", async () => {
  const h = fixture(2, "unavailable"); await h.start(true);
  expect(h.calls.filter(c => c.path.endsWith("next"))).toHaveLength(0);
  expect(h.render()).toContain("App requests unavailable");
  expect(h.writes).toHaveLength(0);
});
it("new returned request metadata clears both disclosure and patch review", async () => {
  const h = fixture(1, "approved"); await h.start(true);
  h.checkbox("Approve disclosure"); h.checkbox("I reviewed the separate");
  h.captureChanged(); await h.click("Read retained result without acting");
  expect(h.find("button", "Save reviewed technical case patch").props.disabled).toBe(true);
  expect(h.writes).toHaveLength(0);
});
