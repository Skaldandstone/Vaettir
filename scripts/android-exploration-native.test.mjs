import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { createAndroidExplorer } from "./android-exploration-lib.mjs";
const source = readFileSync(
  new URL(
    "../apps/web/public/connectors/vaettir-device-connector.mjs",
    import.meta.url,
  ),
  "utf8",
);
const names = [
  "ROLE_BY_NATIVE_TYPE",
  "captureRefusal",
  "MAX_HIERARCHY_BYTES",
  "exactText",
  "decodeXml",
  "attributesOf",
  "hierarchyTags",
  "admitAndroidCaptureOptions",
  "requireAndroidForeground",
  "requireAndroidHierarchy",
  "androidCaptureOrigins",
  "completeCaptureJsonBytes",
  "captureAndroidWindow",
  "nativeRole",
  "eventForRole",
  "extractElementsFromHierarchy",
  "buildCaptureManifest",
  "listAndroidDevices",
  "inspectAndroidExplorerTarget",
  "androidExplorerBounds",
  "androidExplorerVisibleNodes",
  "androidExplorerFieldBoundary",
  "androidExplorerObjectTarget",
  "observeAndroidExplorerWindow",
  "performAndroidExplorerCommand",
];
const tree = ts.createSourceFile(
    "owned.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  ),
  printer = ts.createPrinter();
const selected = tree.statements.filter(
  (n) =>
    (ts.isFunctionDeclaration(n) && names.includes(n.name?.text)) ||
    (ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => names.includes(d.name.text))),
);
assert.equal(selected.length, names.length);
const declarations = selected
  .map((n) => printer.printNode(ts.EmitHint.Unspecified, n, tree))
  .join("\n");
function fixture() {
  const pkg = "com.vaettir.synthetic",
    focus = `mCurrentFocus=Window{123abc u0 ${pkg}/.MainActivity}\n`,
    calls = [];
  const button =
    '<node package="com.vaettir.synthetic" class="android.widget.Button" text="Browse" bounds="[0,100][200,180]" enabled="true" clickable="true" />';
  let xml = `<hierarchy><node package="${pkg}" class="android.widget.TextView" text="Home" bounds="[0,0][200,80]" /><node package="${pkg}" class="android.widget.ScrollView" scrollable="true" bounds="[0,80][400,800]">${button}</node></hierarchy>`,
    window = focus;
  const run = (_command, args) => {
    calls.push([...args]);
    if (args[0] === "devices")
      return "List of devices attached\nSYNTHETIC\tdevice model:Synthetic\n";
    if (args.includes("dumpsys")) return window;
    if (args.includes("cat")) return xml;
    if (args.includes("getprop")) return "Synthetic model\n";
    if (args.includes("dump") || args.includes("rm") || args.includes("input"))
      return "";
    throw Error("Unexpected native operation");
  };
  const api = new Function(
    "run",
    "createHash",
    "randomBytes",
    `${declarations}\nreturn {inspectAndroidExplorerTarget,observeAndroidExplorerWindow,androidExplorerBounds,performAndroidExplorerCommand};`,
  )(run, createHash, randomBytes);
  return {
    api,
    calls,
    pkg,
    get xml() {
      return xml;
    },
    set xml(v) {
      xml = v;
    },
    set window(v) {
      window = v;
    },
  };
}
test("actual native adapter admits accessible named navigation without resource IDs and unnamed scroll containers", () => {
  const f = fixture();
  assert.equal(f.api.inspectAndroidExplorerTarget("SYNTHETIC"), f.pkg);
  const observed = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  assert.equal(observed.label, "Home");
  assert.equal(
    observed.controls.find((c) => c.name === "Browse").navigable,
    true,
  );
  assert.deepEqual(observed.scroll.bounds, [0, 80, 400, 800]);
  assert.ok(
    f.calls
      .filter((args) => args.includes("dumpsys"))
      .every((args) => args.at(-1) === "displays"),
  );
  assert.equal(
    f.calls.some((a) => a.includes("input")),
    false,
  );
  const before = observed.id;
  f.xml = f.xml.replace('clickable="true"', 'clickable="true" selected="true"');
  assert.notEqual(
    f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg).id,
    before,
  );
});

test("native object evidence retains real ids and downgrades ambiguous selectors without inventing identifiers", () => {
  const f = fixture();
  f.xml = f.xml.replace(
    'text="Browse"',
    'text="Browse" resource-id="com.vaettir.synthetic:id/browse"',
  );
  let target = f.api
    .observeAndroidExplorerWindow("SYNTHETIC", f.pkg)
    .controls.find((c) => c.name === "Browse").target;
  assert.equal(target.objectId, "com.vaettir.synthetic:id/browse");
  assert.deepEqual(target.selector, {
    kind: "RESOURCE_ID",
    value: target.objectId,
  });
  assert.equal(target.className, "android.widget.Button");
  assert.deepEqual(target.bounds, [0, 100, 200, 180]);
  f.xml = f.xml.replace(
    "</hierarchy>",
    '<node package="com.vaettir.synthetic" class="android.widget.Button" text="Other" resource-id="com.vaettir.synthetic:id/browse" bounds="[0,200][200,280]" /></hierarchy>',
  );
  target = f.api
    .observeAndroidExplorerWindow("SYNTHETIC", f.pkg)
    .controls.find((c) => c.name === "Browse").target;
  assert.equal(target.objectId, "com.vaettir.synthetic:id/browse");
  assert.deepEqual(target.selector, { kind: "TEXT_CLASS", value: "Browse" });
  f.xml = f.xml.replace('text="Other"', 'text="Browse"');
  target = f.api
    .observeAndroidExplorerWindow("SYNTHETIC", f.pkg)
    .controls.find((c) => c.name === "Browse").target;
  assert.deepEqual(target.selector, { kind: "BOUNDS_ONLY", value: null });
  f.xml = f.xml.replace(
    'text="Browse" resource-id=',
    'text="Browse" content-desc="Open catalog" resource-id=',
  );
  target = f.api
    .observeAndroidExplorerWindow("SYNTHETIC", f.pkg)
    .controls.find((c) => c.name === "Browse").target;
  assert.deepEqual(target.selector, {
    kind: "ACCESSIBILITY_ID",
    value: "Open catalog",
  });
  assert.equal(
    f.calls.some((args) => args.includes("input")),
    false,
  );
});

test("native command receipt contains the exact dispatched ADB arguments while device selection remains local", () => {
  const f = fixture(),
    command = ["shell", "input", "tap", "100", "140"];
  assert.deepEqual(
    f.api.performAndroidExplorerCommand("SYNTHETIC", command),
    command,
  );
  assert.deepEqual(f.calls.at(-1), ["-s", "SYNTHETIC", ...command]);
});
test("actual adapter identifies form/password and embedded content stops; foreign hierarchy and unsupported bounds refuse", () => {
  for (const className of [
    "android.widget.EditText",
    "android.webkit.WebView",
  ]) {
    const f = fixture();
    f.xml = f.xml.replace("android.widget.Button", className);
    const blocked = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    assert.equal(blocked.blocked, true);
    assert.deepEqual(blocked.controls, []);
    assert.equal(blocked.label, "Manual interaction required");
    assert.doesNotMatch(JSON.stringify(blocked), /Browse|Home/);
  }
  const f = fixture();
  f.xml = f.xml.replace(
    'text="Browse"',
    'password="true" text="Synthetic secret"',
  );
  const password = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  assert.equal(password.blocked, true);
  assert.deepEqual(password.controls, []);
  assert.doesNotMatch(JSON.stringify(password), /Synthetic secret/);
  for (const bounds of ["[0,0][0,10]", "[0,0][99999,99999]", "unknown"])
    assert.throws(() => f.api.androidExplorerBounds(bounds));
  const foreign = fixture();
  foreign.xml = foreign.xml.replace(
    'text="Browse"',
    'package="foreign.app" text="Browse"',
  );
  assert.throws(() =>
    foreign.api.observeAndroidExplorerWindow("SYNTHETIC", foreign.pkg),
  );
});
test("ordinary search/filter fields are identified by stable metadata, omitted with their descendants, and never navigable", () => {
  for (const metadata of [
    'resource-id="com.vaettir.synthetic:id/searchInput"',
    'hint="Filter items"',
    'content-desc="Search items"',
  ]) {
    const f = fixture();
    f.xml = f.xml.replace(
      "</hierarchy>",
      `<node package="${f.pkg}" class="android.widget.EditText" ${metadata} text="PRIVATE QUERY ONE" bounds="[0,20][400,60]" focused="false" clickable="true"><node package="${f.pkg}" class="android.widget.TextView" text="PRIVATE CHILD ONE" /></node></hierarchy>`,
    );
    const observed = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    assert.equal(observed.blocked, false);
    assert.equal(
      observed.controls.some((c) => c.role === "textbox"),
      false,
    );
    assert.doesNotMatch(
      JSON.stringify(observed),
      /PRIVATE|Search items|Filter items|searchInput/,
    );
    assert.equal(
      observed.controls.find((c) => c.name === "Browse").navigable,
      true,
    );
    assert.ok(observed.scroll);
    f.xml = f.xml
      .replace("PRIVATE QUERY ONE", "PRIVATE QUERY TWO")
      .replace("PRIVATE CHILD ONE", "PRIVATE CHILD TWO");
    assert.equal(
      f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg).id,
      observed.id,
    );
  }
});
test("ordinary-input admission never permits password, authentication, payment, focused or unrecognized fields", () => {
  for (const attributes of [
    'text="Search"', // A field value or placeholder never establishes classification.
    'hint="Search" password="true"',
    'hint="Search" focused="true"',
    'resource-id="com.vaettir.synthetic:id/search_password"',
    'hint="Filter" content-desc="Verification code"',
    'hint="Search" resource-id="com.vaettir.synthetic:id/payment_card_number"',
  ]) {
    const f = fixture();
    f.xml = f.xml.replace(
      "</hierarchy>",
      `<node package="${f.pkg}" class="android.widget.EditText" ${attributes} bounds="[0,20][400,60]" /></hierarchy>`,
    );
    const result = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    assert.equal(result.blocked, true);
    assert.deepEqual(result.controls, []);
  }
  for (const heading of [
    "Sign in",
    "Verify your identity",
    "Payment details",
    "Checkout",
  ]) {
    const f = fixture();
    f.xml = f.xml.replace('text="Home"', `text="${heading}"`);
    const result = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    assert.equal(result.blocked, true);
    assert.deepEqual(result.controls, []);
  }
});
test("navigation tap and swipe geometry cannot target an excluded ordinary field", () => {
  const f = fixture();
  f.xml = f.xml.replace(
    "</hierarchy>",
    `<node package="${f.pkg}" class="android.widget.EditText" hint="Search" text="PRIVATE VALUE" bounds="[0,80][400,800]" /></hierarchy>`,
  );
  const result = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  assert.equal(result.blocked, false);
  assert.equal(
    result.controls.find((c) => c.name === "Browse").navigable,
    false,
  );
  assert.equal(result.scroll, null);
  assert.equal(
    f.calls.some((args) => args.includes("input")),
    false,
  );
});
test("hidden subtrees do not expose descendant source or affect retained screen identity", () => {
  const f = fixture();
  const before = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  f.xml = f.xml.replace(
    "</hierarchy>",
    `<node package="${f.pkg}" class="android.widget.FrameLayout" visible="false"><node package="${f.pkg}" class="android.widget.TextView" text="PRIVATE HIDDEN VALUE" /></node></hierarchy>`,
  );
  const after = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  assert.equal(after.id, before.id);
  assert.doesNotMatch(JSON.stringify(after), /PRIVATE HIDDEN VALUE/);
});

const decoration = (bounds = "[210,100][300,180]", extra = "") =>
  `<node package="com.vaettir.synthetic" class="android.widget.ImageView" resource-id="com.vaettir.synthetic:id/animation" text="" bounds="${bounds}" index="2" drawing-order="1" ${extra} />`;

function explorationFixture() {
  const f = fixture();
  const scope = {
    projectId: "synthetic",
    organizationId: "org",
    actorId: "actor",
    sessionId: "login",
  };
  const origin = "http://localhost:3000";
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  const explorer = createAndroidExplorer(
    {
      inspect: f.api.inspectAndroidExplorerTarget,
      observe: f.api.observeAndroidExplorerWindow,
      tap: (serial, bounds) =>
        f.api.performAndroidExplorerCommand(serial, [
          "shell",
          "input",
          "tap",
          String((bounds[0] + bounds[2]) / 2),
          String((bounds[1] + bounds[3]) / 2),
        ]),
      scroll: () => {
        throw Error("No synthetic scroll expected");
      },
      back: () => {
        throw Error("No synthetic back expected");
      },
    },
    { hash, nonce: () => "a".repeat(48), now: () => Date.UTC(2026, 9, 23) },
  );
  f.xml = f.xml.replace("</hierarchy>", decoration() + "</hierarchy>");
  const ticket = explorer.handle(
    "inspect",
    { serial: "SYNTHETIC", scope },
    origin,
  );
  const state = explorer.handle(
    "start",
    {
      ticket: ticket.ticket,
      scope,
      consent: { localObservation: true, navigation: true, testAccount: true },
      navigationNames: ["Browse"],
      limits: { actions: 6, screens: 5, seconds: 90 },
    },
    origin,
  );
  assert.equal(state.status, "ACTIVE");
  return {
    f,
    next: () =>
      explorer.handle(
        "next",
        {
          id: state.id,
          scope,
          sequence: state.sequence,
          requestId: "11111111-1111-4111-8111-111111111111",
        },
        origin,
      ),
  };
}

test("passive animation geometry and paint bookkeeping do not change screen identity", () => {
  for (const className of [
    "ImageView",
    "ProgressBar",
    "TextView",
    "FrameLayout",
  ]) {
    const f = fixture();
    f.xml = f.xml.replace(
      "</hierarchy>",
      decoration().replace("ImageView", className) + "</hierarchy>",
    );
    const before = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    f.xml = f.xml
      .replace("[210,100][300,180]", "[220,110][310,190]")
      .replace('index="2" drawing-order="1"', 'drawing-order="3" index="4"');
    const after = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    assert.equal(after.id, before.id, className);
    assert.equal(
      after.controls.find((c) => c.name === "Browse").id,
      before.controls.find((c) => c.name === "Browse").id,
    );
  }
});

test("actual adapter and engine continue through passive animation and dispatch only the stable approved target", () => {
  const { f, next } = explorationFixture();
  f.xml = f.xml.replace("[210,100][300,180]", "[220,110][310,190]");
  const result = next();
  assert.equal(result.status, "ACTIVE");
  assert.equal(result.reason, null);
  assert.equal(result.actionCount, 1);
  assert.equal(result.screens.length, 1);
  assert.deepEqual(
    f.calls.filter((a) => a.includes("input")),
    [["-s", "SYNTHETIC", "shell", "input", "tap", "100", "140"]],
  );
});

test("stable screen identity never collapses distinct passive object observations", () => {
  const f = fixture();
  const first = decoration().replace('text=""', 'text="Decorative status"');
  const second = first
    .replace("[210,100][300,180]", "[310,100][400,180]")
    .replace('index="2"', 'index="3"');
  f.xml = f.xml.replace("</hierarchy>", first + second + "</hierarchy>");
  const before = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  const objects = before.controls.filter((c) => c.name === "Decorative status");
  assert.equal(objects.length, 2);
  assert.notEqual(objects[0].id, objects[1].id);
  f.xml = f.xml.replace("[210,100][300,180]", "[220,110][310,190]");
  const after = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
  assert.equal(after.id, before.id);
  const moved = after.controls.filter((c) => c.name === "Decorative status");
  assert.notEqual(moved[0].id, objects[0].id);
  assert.equal(moved[1].id, objects[1].id);
  assert.notEqual(moved[0].id, moved[1].id);
});

test("animation tolerance never admits changed actionable geometry, semantics, input boundaries or overlays", () => {
  const changes = [
    (xml) => xml.replace("[0,100][200,180]", "[10,100][210,180]"),
    (xml) => xml.replace("[0,80][400,800]", "[0,90][400,800]"),
    (xml) => xml.replace('text="Home"', 'text="Different screen"'),
    (xml) => xml.replace('text="Browse"', 'text="Delete"'),
    (xml) =>
      xml.replace('clickable="true"', 'clickable="true" selected="true"'),
    (xml) => xml.replace('enabled="true"', 'enabled="false"'),
    (xml) => xml.replace("id/animation", "id/different_object"),
    (xml) => xml.replace('index="2"', 'index="2" clickable="true"'),
    (xml) => xml.replace('index="2"', 'index="2" long-clickable="true"'),
    (xml) => xml.replace('index="2"', 'index="2" focusable="true"'),
    (xml) =>
      xml.replace(
        "</hierarchy>",
        '<node package="com.vaettir.synthetic" class="android.widget.EditText" hint="Search" bounds="[0,100][200,180]" /></hierarchy>',
      ),
    (xml) =>
      xml.replace(
        "</hierarchy>",
        '<node package="com.vaettir.synthetic" class="android.widget.Button" text="Browse" bounds="[0,100][200,180]" clickable="true" /></hierarchy>',
      ),
  ];
  for (const change of changes) {
    const { f, next } = explorationFixture();
    f.xml = change(f.xml);
    assert.equal(next().reason, "SCREEN_CHANGED_REVIEW_REQUIRED");
    assert.equal(
      f.calls.some((a) => a.includes("input")),
      false,
    );
  }
  // Geometry remains strict even for an unnamed interactive/focusable object.
  for (const attribute of [
    'clickable="true"',
    'long-clickable="true"',
    'focusable="true"',
    'checkable="true"',
    'scrollable="true"',
  ]) {
    const f = fixture();
    f.xml = f.xml.replace(
      "</hierarchy>",
      decoration("[210,100][300,180]", attribute) + "</hierarchy>",
    );
    const before = f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg);
    f.xml = f.xml.replace("[210,100][300,180]", "[220,110][310,190]");
    assert.notEqual(
      f.api.observeAndroidExplorerWindow("SYNTHETIC", f.pkg).id,
      before.id,
    );
  }
});

test("animation does not bypass protected content or foreign foreground admission", () => {
  for (const change of [
    (xml) => xml.replace('text="Home"', 'text="Sign in"'),
    (xml) => xml.replace("android.widget.ImageView", "android.webkit.WebView"),
    (xml) => xml.replace('text="Browse"', 'password="true" text="Browse"'),
  ]) {
    const { f, next } = explorationFixture();
    f.xml = change(f.xml).replace("[210,100][300,180]", "[220,110][310,190]");
    assert.equal(next().reason, "SCREEN_CHANGED_REVIEW_REQUIRED");
    assert.equal(
      f.calls.some((a) => a.includes("input")),
      false,
    );
  }
  const { f, next } = explorationFixture();
  f.window = "mCurrentFocus=Window{123abc u0 foreign.app/.Activity}\n";
  assert.equal(next().reason, "TARGET_OR_OBSERVATION_UNAVAILABLE");
  assert.equal(
    f.calls.some((a) => a.includes("input")),
    false,
  );
});
test("real helper HTTP keeps exact origin/pairing, strict version and duplicate/oversize request refusal without native reads", async () => {
  const listener = createServer();
  await new Promise((r) => listener.listen(0, "127.0.0.1", r));
  const port = listener.address().port;
  await new Promise((r) => listener.close(r));
  const pairing = randomBytes(16).toString("hex"),
    origin = "http://localhost:3000",
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
        () => reject(Error("Owned helper did not become ready")),
        10000,
      );
      child.once("error", reject);
      child.once("exit", () => {
        clearTimeout(timer);
        reject(Error("Owned helper exited before readiness"));
      });
      child.stdout.on("data", (b) => {
        if (b.toString().includes("Listening only on this computer")) {
          clearTimeout(timer);
          resolve();
        }
      });
    });
    const headers = { origin, "x-vaettir-pairing-code": pairing };
    const caps = await fetch(base + "/exploration/v1/capabilities", {
      headers,
    });
    assert.equal(caps.status, 200);
    assert.equal(caps.headers.get("cache-control"), "no-store");
    assert.equal((await caps.json()).aiProcessing, false);
    assert.equal(
      (
        await fetch(base + "/exploration/v1/capabilities", {
          headers: { ...headers, origin: "https://foreign.example" },
        })
      ).status,
      403,
    );
    assert.equal(
      (
        await fetch(base + "/exploration/v1/capabilities", {
          headers: { origin },
        })
      ).status,
      401,
    );
    for (const body of [
      '{"scope":{},"scope":{}}',
      "x".repeat(8193),
      '{"id":"unknown","scope":{"projectId":"p","organizationId":"o","actorId":"a","sessionId":"s"}}',
    ]) {
      const response = await fetch(base + "/exploration/v1/read", {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body,
      });
      assert.equal(response.status, 400);
      assert.doesNotMatch(await response.text(), /unknown|pairing|serial/);
    }
  } finally {
    child.kill();
    await new Promise((r) => {
      if (child.exitCode !== null) r();
      else child.once("exit", r);
    });
  }
});
