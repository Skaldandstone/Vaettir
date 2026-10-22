import test from "node:test";
import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { spawn } from "node:child_process";
import { createServer } from "node:net";
import { fileURLToPath } from "node:url";
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
  "observeAndroidExplorerWindow",
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
    if (args.includes("dump") || args.includes("rm")) return "";
    throw Error("Unexpected native operation");
  };
  const api = new Function(
    "run",
    "createHash",
    "randomBytes",
    `${declarations}\nreturn {inspectAndroidExplorerTarget,observeAndroidExplorerWindow,androidExplorerBounds};`,
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
