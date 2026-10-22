// Real component, parser and exploration engine. Native device and hosted save
// are explicit synthetic boundaries; this does not prove a physical app or deploy.
/* global window,document */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { createAndroidExplorer } from "../../../../scripts/android-exploration-lib.mjs";
const web = path.resolve(fileURLToPath(new URL("../../", import.meta.url)));
const require = createRequire(path.join(web, "package.json"));
const viteRequire = createRequire(
  createRequire(require.resolve("vitest")).resolve("vite"),
);
const { build } = viteRequire("esbuild"),
  { chromium } = require("@playwright/test");
const output = path.resolve(
  process.argv[2] ??
    path.join(web, "../../.local/android-exploration-20261022/browser"),
);
await mkdir(output, { recursive: true });
const files = [
  "components/AndroidAppExploration.tsx",
  "lib/deviceConnectorLauncher.ts",
  "lib/download.ts",
  "app/projects/[projectId]/live-app-generation/page.tsx",
  "../api/src/services/androidExplorationSchema.ts",
  "../../scripts/android-exploration-lib.mjs",
  "public/connectors/vaettir-device-connector.mjs",
  "e2e/android-exploration/fixture.jsx",
  "e2e/android-exploration/boundary.jsx",
  "e2e/android-exploration/run.mjs",
];
const hash = (v) => createHash("sha256").update(v).digest("hex");
const sourceHashes = Object.fromEntries(
  await Promise.all(
    files.map(async (f) => [f, hash(await readFile(path.join(web, f)))]),
  ),
);
const bundle = await build({
  entryPoints: [path.join(web, "e2e/android-exploration/fixture.jsx")],
  bundle: true,
  write: false,
  jsx: "automatic",
  platform: "browser",
  nodePaths: [path.join(web, "node_modules")],
  alias: { "@": web },
  plugins: [
    {
      name: "synthetic-save",
      setup(b) {
        b.onResolve({ filter: /\/trpcReact$/ }, () => ({
          path: path.join(web, "e2e/android-exploration/boundary.jsx"),
        }));
      },
    },
  ],
});
const css =
  (await readFile(path.join(web, "app/globals.css"), "utf8")).replace(
    /^@import[^\r\n]+\r?\n/,
    "",
  ) +
  "\n" +
  (await readFile(path.join(web, "app/workbench.css"), "utf8"));
const server = createServer((req, res) => {
  if (req.url === "/bundle.js") {
    res.setHeader("content-type", "application/javascript");
    res.end(bundle.outputFiles[0].text);
  } else {
    res.setHeader("content-type", "text/html");
    res.end(
      `<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`,
    );
  }
});
// The real launcher intentionally permits only explicit development origins.
// Refuse an occupied fixture port rather than weakening that production rule.
await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(3001, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`,
  browser = await chromium.launch({ headless: true }),
  page = await browser.newPage({ viewport: { width: 1280, height: 960 } });
const requests = [],
  errors = [],
  checks = [];
let holdNext = false,
  releaseNext = null,
  heldNext = null;
let current = "Home",
  nonce = 0;
const stack = [];
const names = {
  Home: ["Browse", "About", "Delete"],
  Browse: ["Details", "Submit"],
  Details: [],
  About: [],
};
const explorer = createAndroidExplorer(
  {
    inspect: () => "com.vaettir.synthetic",
    observe: () => ({
      id: hash(current),
      label: current,
      blocked: false,
      scroll: null,
      controls: names[current].map((name, index) => ({
        id: hash(name),
        name,
        role: "button",
        navigable: true,
        bounds: [index * 100, 0, (index + 1) * 100, 100],
      })),
    }),
    tap: (_serial, bounds) => {
      stack.push(current);
      current = names[current][bounds[0] / 100];
    },
    back: () => {
      current = stack.pop();
    },
    scroll: () => {
      throw Error("No scrolling in synthetic native boundary");
    },
  },
  { hash, nonce: () => String(++nonce).padStart(48, "0"), now: Date.now },
);
page.on("pageerror", (e) => errors.push(e.message));
await page.route("http://127.0.0.1:4775/**", async (route) => {
  const request = route.request(),
    url = new URL(request.url());
  if (request.method() === "OPTIONS") {
    await route.fulfill({
      status: 204,
      headers: {
        "access-control-allow-origin": origin,
        "access-control-allow-headers": "content-type,x-vaettir-pairing-code",
        "access-control-allow-methods": "GET, POST, OPTIONS",
      },
    });
    return;
  }
  assert.equal(request.headers()["x-vaettir-pairing-code"], "ABCDEF123456");
  requests.push(url.pathname);
  let value;
  if (url.pathname.endsWith("/capabilities"))
    value = {
      version: 1,
      platform: "ANDROID",
      localNavigation: true,
      aiProcessing: false,
      maxActions: 24,
      maxScreens: 12,
      maxSeconds: 300,
    };
  else if (url.pathname === "/devices")
    value = {
      devices: [
        {
          id: "SYNTHETIC",
          name: "Synthetic Android",
          status: "device",
          ready: true,
        },
      ],
    };
  else
    value = explorer.handle(
      url.pathname.split("/").at(-1),
      request.postDataJSON(),
      origin,
    );
  if (url.pathname.endsWith("/next") && holdNext) {
    holdNext = false;
    await new Promise((resolve) => {
      releaseNext = resolve;
      heldNext?.();
    });
  }
  await route.fulfill({
    status: 200,
    contentType: "application/json",
    headers: { "access-control-allow-origin": origin },
    body: JSON.stringify(value),
  });
});
try {
  await page.goto(origin);
  assert.equal(requests.length, 0);
  checks.push("No helper calls on mount");
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download Android connector", exact: true })
    .click();
  const artifact = await download;
  assert.match(artifact.suggestedFilename(), /\.sh$|\.cmd$|\.command$/);
  assert.match(
    await readFile(await artifact.path(), "utf8"),
    /'--port','4775'/,
  );
  assert.equal(requests.length, 0);
  checks.push("Download exact dedicated-port launcher without dispatch");
  await page
    .getByRole("button", { name: "Connect Android app", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Exploration device", exact: true })
    .selectOption("SYNTHETIC");
  await page
    .getByRole("button", { name: "Use the open test app", exact: true })
    .click();
  await page
    .getByRole("heading", {
      name: "Explore com.vaettir.synthetic",
      exact: true,
    })
    .waitFor();
  assert.ok(!requests.some((p) => p.endsWith("/start")));
  checks.push("Observed target and explicit local consent before start");
  await page
    .getByRole("checkbox", { name: /I approve local screen observation/ })
    .check();
  await page
    .getByRole("button", { name: "Explore normal navigation", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Exploration completed", exact: true })
    .waitFor({ timeoutMs: 15000 });
  assert.equal(requests.filter((p) => p.endsWith("/next")).length, 7);
  assert.equal(await page.getByRole("article").count(), 3);
  checks.push(
    "Real engine drives observed multi-step navigation and returns through Back",
  );
  assert.equal(
    await page.evaluate(() => window.explorationFixture.commits.length),
    0,
  );
  checks.push("No hosted disclosure or case creation during exploration");
  await page
    .getByRole("button", { name: "Pause", exact: true })
    .waitFor({ state: "hidden" });
  for (const theme of ["dark", "light"])
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: 960 });
      await page.evaluate(
        (t) => (document.documentElement.dataset.theme = t),
        theme,
      );
      assert.ok(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth + 1,
        ),
      );
      await page.screenshot({
        path: path.join(output, `review-${theme}-${width}.png`),
      });
    }
  checks.push(
    "Both themes and 1280/390 layouts rendered without document overflow",
  );
  await page.setViewportSize({ width: 1280, height: 960 });
  await page
    .getByRole("checkbox", { name: "Navigate to Details", exact: true })
    .check();
  await page
    .getByRole("checkbox", {
      name: /I approve sending these selected journey labels/,
    })
    .check();
  await page
    .getByRole("button", { name: "Add selected proposed tests", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Recover add result", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "Recover add result", exact: true })
    .click();
  await page
    .getByText("1 selected proposed tests recorded as pending review.", {
      exact: true,
    })
    .waitFor();
  const commits = await page.evaluate(() => window.explorationFixture.commits);
  assert.equal(commits.length, 2);
  assert.deepEqual(commits[0], commits[1]);
  assert.equal(commits[0].journeys.length, 1);
  assert.deepEqual(
    commits[0].journeys[0].steps.map((s) => s.action.label),
    ["Browse", "Details"],
  );
  checks.push(
    "Only explicitly selected evidence uploaded; lost save reply reuses exact durable request",
  );
  // Even a still-mounted original actor must not use a cached membership view.
  await page.evaluate(() => {
    window.explorationFixture.accessDenied = true;
  });
  const beforeDenial = requests.length;
  await page
    .getByRole("button", {
      name: "Read retained session without navigation",
      exact: true,
    })
    .click();
  await page.getByText(/Restore the original signed-in account/).waitFor();
  assert.equal(requests.length, beforeDenial);
  assert.equal(await page.getByRole("article").count(), 0);
  await page.evaluate(() => {
    window.explorationFixture.accessDenied = false;
  });
  await page
    .getByRole("button", {
      name: "Recheck original project access",
      exact: true,
    })
    .click();
  await page
    .getByRole("checkbox", { name: "Navigate to Details", exact: true })
    .waitFor();
  checks.push(
    "Fresh membership denial blocks local requests and hides source; explicit same-scope read restores without navigation",
  );
  const before = requests.length;
  await page.evaluate(() => {
    window.explorationFixture.scope = {
      ...window.explorationFixture.scope,
      actorId: "other",
    };
    window.explorationFixture.epochKey = "other-epoch";
    window.explorationFixture.render();
  });
  await page.getByText(/Restore the original signed-in account/).waitFor();
  assert.equal(await page.getByRole("article").count(), 0);
  assert.equal(requests.length, before);
  checks.push(
    "Changed actor hides retained private journeys without rebinding or dispatch",
  );
  current = "Home";
  stack.length = 0;
  await page.goto(origin);
  await page
    .getByRole("button", { name: "Connect Android app", exact: true })
    .click();
  await page
    .getByRole("combobox", { name: "Exploration device", exact: true })
    .selectOption("SYNTHETIC");
  await page
    .getByRole("button", { name: "Use the open test app", exact: true })
    .click();
  await page
    .getByRole("checkbox", { name: /I approve local screen observation/ })
    .check();
  const held = new Promise((resolve) => {
    heldNext = resolve;
  });
  holdNext = true;
  const beforePause = requests.filter((p) => p.endsWith("/next")).length;
  await page
    .getByRole("button", { name: "Explore normal navigation", exact: true })
    .click();
  await held;
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  releaseNext();
  await page
    .getByRole("heading", { name: "Exploration paused", exact: true })
    .waitFor();
  assert.equal(
    requests.filter((p) => p.endsWith("/next")).length,
    beforePause + 1,
  );
  await page
    .getByRole("button", { name: "Resume exploration", exact: true })
    .click();
  await page
    .getByRole("heading", { name: "Exploration completed", exact: true })
    .waitFor();
  assert.equal(await page.getByRole("article").count(), 3);
  checks.push(
    "Pause admits at most the in-flight command, then explicit resume finishes without replay",
  );
  await page
    .getByText("Review detected navigation for another exploration", {
      exact: true,
    })
    .click();
  await page.getByRole("checkbox", { name: "About", exact: true }).check();
  const beforeScopeReview = requests.length;
  await page
    .getByRole("button", {
      name: "Use selected navigation in a new exploration",
      exact: true,
    })
    .click();
  await page
    .getByRole("heading", {
      name: "Explore com.vaettir.synthetic",
      exact: true,
    })
    .waitFor();
  assert.equal(requests.length, beforeScopeReview + 1);
  assert.ok(requests.at(-1).endsWith("/inspect"));
  assert.equal(
    await page
      .getByRole("checkbox", { name: /I approve local screen observation/ })
      .isChecked(),
    false,
  );
  assert.equal(
    await page
      .getByRole("button", { name: "Explore normal navigation", exact: true })
      .isDisabled(),
    true,
  );
  assert.equal(await page.getByRole("article").count(), 0);
  await page
    .getByText("Review or change allowed navigation", { exact: true })
    .click();
  assert.equal(
    await page
      .getByRole("textbox", { name: "Allowed navigation labels", exact: true })
      .inputValue(),
    "About",
  );
  checks.push(
    "Observed navigation selection uses a new target ticket and clears prior local/disclosure consent without issuing navigation",
  );
  assert.deepEqual(errors, []);
  await writeFile(
    path.join(output, "evidence.json"),
    JSON.stringify(
      {
        at: new Date().toISOString(),
        sourceHashes,
        checks,
        errors,
        requests,
        nativeBoundary: "synthetic",
        hostedSaveBoundary: "synthetic",
        physicalDeviceAcceptance: false,
        productionAcceptance: false,
      },
      null,
      2,
    ),
  );
  console.log(
    JSON.stringify({ passed: true, checks: checks.length, errors, output }),
  );
} catch (error) {
  await page
    .screenshot({ path: path.join(output, "failure.png") })
    .catch(() => {});
  throw error;
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
