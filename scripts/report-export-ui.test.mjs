import { actionName } from "../apps/web/e2e/action-name.mjs";
/* global innerWidth */
/* global document, window */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const { chromium } = require("@playwright/test");
const { build } = createRequire(
  createRequire(require.resolve("vitest")).resolve("vite"),
)("esbuild");
const fixture = readFileSync(root + "apps/web/lib/report-deck.test.ts", "utf8");
const report = fixture.slice(
  fixture.indexOf("const report ="),
  fixture.indexOf('describe("editable report deck"'),
);
const sourceReport = Function(
  report.replace(" as FrozenReportPayload", "") + ";return report;",
)();
const output = (process.env.VAETTIR_E2E_OUTPUT_DIR ?? (root + ".local/report-presentation-20261029"));
mkdirSync(output, { recursive: true });
const Zip = createRequire(new URL("../apps/api/package.json", import.meta.url))(
  "adm-zip",
);
const bundle = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './app/projects/[projectId]/reports/snapshots/[snapshotId]/page';
import {TRPCReactProvider,trpcReact} from './lib/trpcReact';${report}
window.exportFinished=0;window.importFinished=0;
const read=File.prototype.text;File.prototype.text=async function(){if(window.holdImport)await new Promise(r=>window.releaseImport=r);try{return await read.call(this)}finally{window.importFinished++}};
window.createdDownloads=[];const original=URL.createObjectURL;URL.createObjectURL=blob=>{window.createdDownloads.push({size:blob.size,type:blob.type});return original(blob)};
function App(){const u=trpcReact.useUtils();window.refreshExportAccess=()=>Promise.all([u.project.byId.invalidate(),u.organization.mine.invalidate(),u.reportSnapshots.get.invalidate()]);return <Page/>;}createRoot(document.getElementById('root')).render(<TRPCReactProvider><App/></TRPCReactProvider>);`,
    resolveDir: root + "apps/web",
    loader: "tsx",
  },
  bundle: true,
  write: false,
  platform: "browser",
  jsx: "automatic",
  define: {
    "process.env.NODE_ENV": '"development"',
    "process.env.NEXT_PUBLIC_API_URL": '"/api"',
  },
  plugins: [
    {
      name: "isolated-export-boundaries",
      setup(build) {
        build.onResolve(
          { filter: /^(@clerk\/nextjs|next\/navigation|next\/link)$/ },
          (a) => ({ path: a.path, namespace: "shell" }),
        );
        build.onLoad({ filter: /.*/, namespace: "shell" }, (a) => ({
          contents:
            a.path === "@clerk/nextjs"
              ? `import {useSyncExternalStore} from 'react';let s={isLoaded:true,isSignedIn:true,userId:'synthetic-actor',sessionId:'synthetic-session'};const listeners=new Set();function sync(){window.Clerk={loaded:true,session:{id:s.sessionId,user:{id:s.userId},getToken:async()=> 'synthetic-token'}}}sync();window.setSyntheticAuth=n=>{s={...s,...n};sync();for(const f of listeners)f()};export function useAuth(){return useSyncExternalStore(f=>{listeners.add(f);return()=>listeners.delete(f)},()=>s)}`
              : a.path === "next/navigation"
                ? `export const useParams=()=>({projectId:'synthetic-project',snapshotId:'synthetic-snapshot'});`
                : `import React from 'react';export default function Link(p){return React.createElement('a',p)}`,
          loader: "js",
          resolveDir: root + "apps/web",
        }));
        build.onResolve({ filter: /^@\/lib\/report-deck$/ }, () => ({
          path: "deck",
          namespace: "fixture",
        }));
        build.onResolve({ filter: /^@\/lib\/report-office$/ }, () => ({
          path: "office",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "deck"
              ? `import {renderReportDeck as render} from './lib/report-deck';export async function renderReportDeck(report,preset){await new Promise(resolve=>{window.releaseExport=resolve});try{return await render(report,preset)}finally{window.exportFinished++}}`
              : args.path === "office"
                ? `import {renderReportDocument as doc,renderReportWorkbook as book} from './lib/report-office';async function wait(){await new Promise(resolve=>{window.releaseExport=resolve});if(window.failExport)throw Error('synthetic recoverable failure');}export async function renderReportDocument(report,preset){try{await wait();return await doc(report,preset)}finally{window.exportFinished++}}export async function renderReportWorkbook(report,preset){try{await wait();return await book(report,preset)}finally{window.exportFinished++}}`
                : `export function ReportSnapshotEvidence(){return null}`,
          loader: "js",
          resolveDir: root + "apps/web",
        }));
      },
    },
  ],
});
test("browser Office exports work, recover from errors and discard output after access changes", async () => {
  const server = createServer((req, res) => {
    res.setHeader("Content-Type", "text/html");
    res.end('<!doctype html><div id="root"></div>');
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage(),
      origin = `http://127.0.0.1:${server.address().port}`,
      errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    let membership = true,
      payload = sourceReport,
      organizationId = "synthetic-org";
    const requests = [];
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/trpc/")) return route.continue();
      const paths = url.pathname.slice("/api/trpc/".length).split(",");
      await new Promise((r) => setTimeout(r, 15));
      const data = paths.map((path) => {
        requests.push({ path, method: route.request().method() });
        if (path === "project.byId")
          return {
            id: "synthetic-project",
            organizationId,
            name: "Synthetic reporting",
          };
        if (path === "organization.mine")
          return membership
            ? [{ id: organizationId, role: "OWNER", seatType: "FULL" }]
            : [];
        if (path === "reportSnapshots.get")
          return {
            id: "synthetic-snapshot",
            projectId: "synthetic-project",
            organizationId: "synthetic-org",
            payload,
          };
        throw Error("Unexpected procedure " + path);
      });
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(data.map((data) => ({ result: { data } }))),
      });
    });
    await page.goto(origin);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: actionName("Download editable PowerPoint", false) })
      .click();
    await page.waitForFunction(
      () => typeof window.releaseExport === "function",
    );
    membership = false;
    await page.evaluate(() => window.refreshExportAccess());
    let finished = await page.evaluate(() => window.exportFinished);
    await page.evaluate(() => window.releaseExport());
    await page.waitForFunction((n) => window.exportFinished > n, finished);
    await page.waitForFunction(
      () => !document.body.textContent.includes("Creating PowerPoint"),
    );
    assert.deepEqual(await page.evaluate(() => window.createdDownloads), []);
    membership = true;
    await page.evaluate(() => window.refreshExportAccess());
    await page.getByRole("checkbox").check();
    await page.evaluate(() => {
      window.releaseExport = null;
    });
    await page
      .getByRole("button", { name: actionName("Download editable PowerPoint", false) })
      .click();
    await page.waitForFunction(
      () => typeof window.releaseExport === "function",
    );
    payload = { ...sourceReport, title: "Another report" };
    await page.evaluate(() => window.refreshExportAccess());
    finished = await page.evaluate(() => window.exportFinished);
    await page.evaluate(() => window.releaseExport());
    await page.waitForFunction((n) => window.exportFinished > n, finished);
    await page.waitForFunction(
      () => !document.body.textContent.includes("Creating PowerPoint"),
    );
    assert.deepEqual(await page.evaluate(() => window.createdDownloads), []);
    assert.equal(await page.getByRole("checkbox").isChecked(), false);
    await page.getByRole("checkbox").check();
    await page
      .getByRole("button", { name: actionName("Download editable PowerPoint", false) })
      .click();
    await page.waitForFunction(
      () => typeof window.releaseExport === "function",
    );
    const download = page.waitForEvent("download");
    finished = await page.evaluate(() => window.exportFinished);
    await page.evaluate(() => window.releaseExport());
    await page.waitForFunction((n) => window.exportFinished > n, finished);
    const result = await download;
    assert.match(result.suggestedFilename(), /\.pptx$/);
    const created = await page.evaluate(() => window.createdDownloads);
    assert.equal(created.length, 1);
    assert.ok(created[0].size > 10000);
    for (const [label, extension] of [
      ["Word document", "docx"],
      ["Excel workbook", "xlsx"],
    ]) {
      await page.evaluate(() => {
        window.releaseExport = null;
      });
      await page.getByRole("button", { name: actionName(`Download ${label}`, false) }).click();
      await page.waitForFunction(
        () => typeof window.releaseExport === "function",
      );
      membership = false;
      await page.evaluate(() => window.refreshExportAccess());
      await page.getByRole("checkbox").waitFor({ state: "detached" });
      finished = await page.evaluate(() => window.exportFinished);
      await page.evaluate(() => window.releaseExport());
      await page.waitForFunction((n) => window.exportFinished > n, finished);
      await page.waitForFunction(
        () => !document.body.textContent.includes("Creating"),
      );
      assert.equal(
        (await page.evaluate(() => window.createdDownloads)).length,
        created.length,
      );
      membership = true;
      await page.evaluate(() => window.refreshExportAccess());
      await page.getByRole("checkbox").check();
      await page.evaluate(() => {
        window.releaseExport = null;
        window.failExport = true;
      });
        await page.getByRole("button", { name: actionName(`Download ${label}`, false) }).click();
      await page.waitForFunction(
        () => typeof window.releaseExport === "function",
      );
      finished = await page.evaluate(() => window.exportFinished);
      await page.evaluate(() => window.releaseExport());
      await page.waitForFunction((n) => window.exportFinished > n, finished);
      await page
        .getByRole("alert")
        .filter({ hasText: "could not be created" })
        .waitFor();
      await page.evaluate(() => {
        window.failExport = false;
        window.releaseExport = null;
      });
      await page.getByRole("button", { name: actionName(`Download ${label}`, false) }).click();
      await page.waitForFunction(
        () => typeof window.releaseExport === "function",
      );
      const officeDownload = page.waitForEvent("download");
      finished = await page.evaluate(() => window.exportFinished);
      await page.evaluate(() => window.releaseExport());
      await page.waitForFunction((n) => window.exportFinished > n, finished);
      assert.ok(
        (await officeDownload).suggestedFilename().endsWith(`.${extension}`),
      );
      created.push({});
      assert.equal(
        (await page.evaluate(() => window.createdDownloads)).length,
        created.length,
      );
    }
    const review = page.getByRole("checkbox");
    const count = () =>
      page.evaluate(
        () =>
          window.createdDownloads.filter((d) => d.type !== "application/json")
            .length,
      );
    const openPresentation = async () => {
      if (!(await page.getByLabel("Color palette").isVisible()))
        await page.getByText("Presentation", { exact: true }).click();
    };
    const start = async (extension) => {
      await review.check();
      const button = page.getByRole("button", {
        name:
          actionName(extension === "pptx"
            ? "Download editable PowerPoint"
            : extension === "docx"
              ? "Download Word document"
              : "Download Excel workbook", false),
      });
      if (!(await button.isVisible()))
          await page.evaluate(() => {
        window.releaseExport = null;
      });
      await button.click();
      await page.waitForFunction(
        () => typeof window.releaseExport === "function",
      );
    };
    const release = async () => {
      const n = await page.evaluate(() => window.exportFinished);
      await page.evaluate(() => window.releaseExport());
      await page.waitForFunction((n) => window.exportFinished > n, n);
      await page.waitForFunction(
        () => !document.body.textContent.includes("Creating"),
      );
    };
    assert.equal(await page.getByLabel("Color palette").isVisible(), false);
    // Change-and-restore fences each native format; original reviewed scope cannot revive.
    for (const extension of ["pptx", "docx", "xlsx"]) {
      await start(extension);
      const before = await count();
      await openPresentation();
      await page.getByLabel("Color palette").selectOption("navy");
      await page.getByLabel("Color palette").selectOption("evergreen");
      await release();
      assert.equal(await count(), before);
      assert.equal(await review.isChecked(), false);
      await page.getByLabel("Color palette").selectOption("navy");
      await page.getByLabel("Document font").selectOption("georgia");
      await start(extension);
      const next = page.waitForEvent("download");
      await release();
      const download = await next;
      assert.equal(
        download.suggestedFilename(),
        `vaettir-quality-update-2026-10-28.${extension}`,
      );
      const file = `${output}/styled-report.${extension}`;
      await download.saveAs(file);
      const zip = new Zip(readFileSync(file));
      const xml = zip
        .getEntries()
        .filter((e) => e.entryName.endsWith(".xml"))
        .map((e) => zip.readAsText(e.entryName))
        .join("\n");
      for (const text of [
        payload.title,
        payload.asOf,
        payload.definition.summary,
        payload.definition.risks,
        payload.definition.nextActions,
        payload.limitations[0],
      ])
        assert.ok(xml.includes(text), `${extension}: ${text}`);
      assert.ok(!xml.includes("PRIVATE_COHORT_ID"));
      if (extension === "pptx") {
        assert.equal(
          zip
            .getEntries()
            .filter((e) => /^ppt\/charts\/chart\d+\.xml$/.test(e.entryName))
            .length,
          4,
        );
        assert.equal(
          zip
            .getEntries()
            .filter((e) => /^ppt\/embeddings\/.*\.xlsx$/.test(e.entryName))
            .length,
          4,
        );
        assert.ok(
          xml.includes("<c:v>8</c:v>") &&
            xml.includes("<c:v>2</c:v>") &&
            xml.includes("2459A6"),
        );
      } else if (extension === "docx")
        assert.ok(xml.includes("<w:tbl>") && xml.includes("182B49"));
      else assert.ok(xml.includes("<v>12</v>") && xml.includes("FF182B49"));
    }
    // Actual actor A-B-A generation and foreign workspace result, through the page/provider.
    for (const change of ["actor", "transfer"]) {
      await start("pptx");
      const before = await count();
      if (change === "actor")
        await page.evaluate(() =>
          window.setSyntheticAuth({
            userId: "other-actor",
            sessionId: "other-session",
          }),
        );
      else {
        organizationId = "other-org";
        await page.evaluate(() => window.refreshExportAccess());
      }
      await review.waitFor({ state: "detached" });
      await release();
      assert.equal(await count(), before);
      if (change === "actor")
        await page.evaluate(() =>
          window.setSyntheticAuth({
            userId: "synthetic-actor",
            sessionId: "fresh-session",
          }),
        );
      organizationId = "synthetic-org";
      await page.evaluate(() => window.refreshExportAccess());
      await review.waitFor();
      assert.equal(await review.isChecked(), false);
    }
    await openPresentation();
    await review.check();
    const upload = (text) =>
      page
        .getByLabel("Load presentation preset")
        .setInputFiles({
          name: "preset.json",
          mimeType: "application/json",
          buffer: Buffer.from(text),
        });
    await upload(
      '{"version":1,"palette":"navy","font":"georgia","url":"https://example.invalid"}',
    );
    await page
      .getByRole("alert")
      .filter({ hasText: "preset could not be loaded" })
      .waitFor();
    assert.equal(await review.isChecked(), false);
    await upload(" ".repeat(513));
    await page
      .getByRole("alert")
      .filter({ hasText: "preset could not be loaded" })
      .waitFor();
    await upload('{"version":1,"palette":"plum","font":"arial"}');
    await page.waitForFunction(() =>
      Array.from(document.querySelectorAll("select")).some(
        (el) => el.value === "plum",
      ),
    );
    const presetDownload = page.waitForEvent("download");
    await page
      .getByRole("button", { name: actionName("Save presentation preset", false) })
      .click();
    const preset = await presetDownload;
    await preset.saveAs(`${output}/presentation.json`);
    assert.deepEqual(
      JSON.parse(readFileSync(`${output}/presentation.json`, "utf8")),
      { version: 1, palette: "plum", font: "arial" },
    );
    // Import start invalidates rendering output before the read completes. A later style wins.
    await start("pptx");
    const beforeImport = await count();
    await page.evaluate(() => {
      window.holdImport = true;
    });
    await upload('{"version":1,"palette":"navy","font":"georgia"}');
    await page.waitForFunction(
      () => typeof window.releaseImport === "function",
    );
    assert.equal(await review.isDisabled(), true);
    await release();
    assert.equal(await count(), beforeImport);
    await page.getByLabel("Color palette").selectOption("evergreen");
    const readCount = await page.evaluate(() => window.importFinished);
    await page.evaluate(() => {
      window.holdImport = false;
      window.releaseImport();
    });
    await page.waitForFunction((n) => window.importFinished > n, readCount);
    assert.equal(
      await page.getByLabel("Color palette").inputValue(),
      "evergreen",
    );
    assert.equal(await review.isChecked(), false);
    // A late import cannot cross a real actor/session transition and overwrite fresh defaults.
    await page.evaluate(() => {
      window.holdImport = true;
      window.releaseImport = null;
    });
    await upload('{"version":1,"palette":"plum","font":"arial"}');
    await page.waitForFunction(
      () => typeof window.releaseImport === "function",
    );
    await page.evaluate(() =>
      window.setSyntheticAuth({
        userId: "other-actor",
        sessionId: "import-other",
      }),
    );
    await review.waitFor({ state: "detached" });
    const lateRead = await page.evaluate(() => window.importFinished);
    await page.evaluate(() => {
      window.holdImport = false;
      window.releaseImport();
    });
    await page.waitForFunction((n) => window.importFinished > n, lateRead);
    await page.evaluate(() =>
      window.setSyntheticAuth({
        userId: "synthetic-actor",
        sessionId: "import-fresh",
      }),
    );
    await review.waitFor();
    await openPresentation();
    assert.equal(
      await page.getByLabel("Color palette").inputValue(),
      "evergreen",
    );
    assert.equal(await page.getByLabel("Document font").inputValue(), "aptos");
    assert.equal(await review.isChecked(), false);
    await page.addStyleTag({
      content:
        readFileSync(root + "apps/web/app/globals.css", "utf8").replace(
          /^@import.*$/gm,
          "",
        ) + readFileSync(root + "apps/web/app/workbench.css", "utf8"),
    });
    await page.getByLabel("Document font").focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(
      await page
        .getByLabel("Document font")
        .evaluate((el) => el === document.activeElement),
      true,
    );
    await page.keyboard.press("Tab");
    for (const [theme, width] of [
      ["light", 1280],
      ["dark", 1280],
      ["dark", 390],
    ]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
      }, theme);
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth + 1,
        ),
        true,
      );
      await page
        .locator('section[aria-label="Reviewed portable report export"]')
        .screenshot({
          path: `${output}/presentation-${theme}-${width}.png`,
          animations: "disabled",
        });
    }
    assert.ok(requests.every((r) => r.method === "GET"));
    assert.deepEqual(errors, []);
  } finally {
    try {
      await browser?.close();
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  }
});
