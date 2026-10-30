import { actionName } from "../apps/web/e2e/action-name.mjs";
/* global innerWidth, requestAnimationFrame */
/* global document, window */
// Real Import page, wizard, queue, tRPC hooks and auth QueryClient. Synthetic
// HTTP responses only; database authorization and atomicity have separate proofs.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const { chromium } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const authModule = `import {useSyncExternalStore} from 'react';
let state={isLoaded:true,isSignedIn:true,userId:'synthetic-actor',sessionId:'synthetic-session'};
const listeners=new Set();function session(){window.Clerk={loaded:true,session:{id:state.sessionId,user:{id:state.userId},getToken:async()=> 'synthetic-local-token'}}}session();
window.setSyntheticAuth=next=>{state={...state,...next};session();for(const fn of listeners)fn()};
export function useAuth(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state)};
export function useSession(){const s=useAuth();return {isLoaded:s.isLoaded,session:s.isSignedIn?{id:s.sessionId,user:{id:s.userId}}:null}};`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import{createRoot}from'react-dom/client';import Page from './app/projects/[projectId]/import/page';
import{TRPCReactProvider,trpcReact}from'./lib/trpcReact';import{onlineManager}from'@tanstack/react-query';
function App(){const utils=trpcReact.useUtils();window.revalidateAccess=()=>utils.caseFields.get.invalidate();window.setOnline=value=>onlineManager.setOnline(value);return <Page/>}
createRoot(document.getElementById('root')).render(<TRPCReactProvider><App/></TRPCReactProvider>);`, resolveDir: root + "apps/web", loader: "tsx" },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' },
  plugins: [{ name: "synthetic-shell-only", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|next\/navigation|next\/link)$/ }, args => ({ path: args.path, namespace: "shell" }));
    builder.onLoad({ filter: /.*/, namespace: "shell" }, args => ({ contents: args.path === "@clerk/nextjs" ? authModule : args.path === "next/navigation" ? `export const useParams=()=>({projectId:'synthetic-project'});export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>'/projects/synthetic-project/import';` : `import React from 'react';export default function Link(props){return React.createElement('a',props)}`, loader: "js", resolveDir: root + "apps/web" }));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = readFileSync(root + "apps/web/app/globals.css", "utf8").replace(/^@import[^\n]+/gm, "");
const candidate = { rowNumber: 3, title: "", given: [], when: ["Open settings"], then: ["Settings opens"], priority: "LOW", tags: [], testType: "FUNCTIONAL", automationStatus: "MANUAL", externalId: "b" };
const sourceCsv = "ID,Title,Steps,Expected Result\na,Login,Open,Home\nb,,Open settings,Settings opens";

test("full import page confirms ready rows once, retains mappings, and hides stale private views", async () => {
  const server = createServer((_req, res) => { res.setHeader("content-type", "text/html"); res.end(`<style>${css}</style><div id="root"></div><script>${script}</script>`); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
    page.setDefaultTimeout(10000);
    const origin = `http://127.0.0.1:${server.address().port}`, requests = [], errors = [];
    let batch = null, imported = false, resolved = false, loseConfirm = true, deny = false, organizationId = "synthetic-org", holdResolve = false, releaseResolve;
    let signalResolveStarted; const resolveStarted = new Promise(r => { signalResolveStarted = r; });
    const digest = () => (imported ? "b" : "a").repeat(64);
    const summary = () => ({ id: batch, sourceLabel: "synthetic.csv", state: imported ? "CONFIRMED" : "DRAFT", readyCount: imported ? 0 : 1,
      pendingCount: resolved ? 0 : 1, contextCount: 0, historyCount: 0, importedCount: imported ? resolved ? 2 : 1 : 0, digest: digest() });
    const receipt = () => ({ batchId: batch, createdCount: 1, updatedCount: 0, pendingCount: resolved ? 0 : 1, historyCount: 0, importedCount: resolved ? 2 : 1 });
    const reply = (path, input) => {
      if (path === "project.byId") return { id: "synthetic-project", organizationId, name: "Synthetic project", defaultBranch: "main" };
      if (path === "organization.mine") return [{ id: organizationId, role: "OWNER", seatType: "FULL" }];
      if (path === "caseFields.get") return { projectId: "synthetic-project", caseId: null, organizationId, canEdit: true, canConfigure: true,
        readScope: { projectId: "synthetic-project", organizationId, actorId: "synthetic-native", actorClerkUserId: "synthetic-actor" } };
      if (path === "caseSuggestions.configuration") return { enabled: false, canAnalyze: false, reason: "Synthetic test: no provider calls" };
      if (path === "importJobs.list") return [];
      if (path === "importJobs.mappingQueues") return batch && !resolved ? [{ id: batch, sourceLabel: "synthetic.csv", createdAt: "2026-10-29T22:00:00Z" }] : [];
      if (path === "importJobs.previewCsv" || path === "importJobs.previewWithMapping") return { headers: ["ID", "Title", "Steps", "Expected Result"], rowCount: 2,
        suggestedMapping: { title: "Title", when: "Steps", then: "Expected Result", externalId: "ID" },
        previewRows: [{ ...candidate, rowNumber: 2, title: "Login", externalId: "a" }], incompleteRows: [candidate], previewSkipped: [{ rowNumber: 3, reason: "missing title" }] };
      if (path === "importJobs.prepareMapping") { batch = input.requestId; return summary(); }
      if (path === "importJobs.confirmMapping") { imported = true; return receipt(); }
      if (path === "importJobs.cancelMapping") { batch = null; return { cancelled: true }; }
      if (path === "importJobs.resolveMapping") { resolved = true; return receipt(); }
      if (path === "importJobs.mappingQueue") return { ...summary(), rows: resolved ? [] : [{ id: "synthetic-row", sheet: "", originalRowNumber: 3, state: "MAPPING", reasons: ["Map a case title."], candidate,
        original: { headers: ["ID", "Title", "Steps", "Expected Result"], cells: ["b", "", "Open settings", "Settings opens"] }, caseId: null }] };
      throw Error("Unexpected procedure: " + path);
    };
    page.on("pageerror", e => errors.push(String(e)));
    await page.route("**/*", async route => {
      const url = new URL(route.request().url());
      if (url.origin !== origin) return route.abort();
      if (!url.pathname.startsWith("/api/trpc/")) return route.continue();
      const paths = url.pathname.slice("/api/trpc/".length).split(",");
      const inputs = JSON.parse(route.request().method() === "POST" ? route.request().postData() ?? "{}" : url.searchParams.get("input") ?? "{}");
      paths.forEach((path, i) => requests.push({ path, input: inputs[i] }));
      if (paths.includes("importJobs.resolveMapping") && holdResolve) await new Promise(resolve => { releaseResolve = resolve; signalResolveStarted(); });
      const result = paths.map((path, i) => deny && ["caseFields.get", "importJobs.mappingQueue"].includes(path)
        ? { error: { message: "Synthetic access denied", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, path } } }
        : { result: { data: reply(path, inputs[i]) } });
      if (paths.includes("importJobs.confirmMapping") && loseConfirm) { loseConfirm = false; return route.abort("failed"); }
      await route.fulfill({ contentType: "application/json", body: JSON.stringify(result) });
    });
    await page.goto(origin);
    await page.getByRole("button", { name: actionName(/^Upload export:/, false) }).click();
    await page.getByRole("button", { name: actionName(/Smart import/, false) }).click();
    await page.locator('input[type="file"]').first().setInputFiles({ name: "synthetic.csv", mimeType: "text/csv", buffer: Buffer.from(sourceCsv) });
    await page.getByRole("button", { name: actionName("Review"), exact: true }).click();
    const review = page.getByRole("region", { name: "Import summary" });
    await review.getByText("1 ready · 1 need mapping · 0 context rows", { exact: true }).waitFor();
    assert.equal(requests.filter(r => r.path === "importJobs.confirmMapping").length, 0);
    await review.getByRole("button", { name: actionName("Import"), exact: true }).click();
    await review.getByRole("button", { name: actionName("Retry"), exact: true }).waitFor();
    await review.getByRole("button", { name: actionName("Retry"), exact: true }).click();
    await review.getByRole("status").filter({ hasText: "1 created" }).waitFor();
    const confirmations = requests.filter(r => r.path === "importJobs.confirmMapping");
    assert.equal(confirmations.length, 2); assert.deepEqual(confirmations[0].input, confirmations[1].input);
    assert.equal(confirmations[0].input.originalOrganizationId, "synthetic-org");
    assert.equal(confirmations[0].input.expectedClerkActorId, "synthetic-actor");
    const queue = page.getByRole("region", { name: "Mapping queue", exact: true });
    await queue.getByRole("combobox").selectOption(batch);
    await queue.getByText("Source · Row 3 · Needs mapping", { exact: true }).click();
    await queue.getByText("Source", { exact: true }).click();
    await queue.getByRole("definition").filter({ hasText: "Settings opens" }).waitFor();
    await queue.getByLabel("Title", { exact: true }).fill("Repaired settings");
    await queue.getByLabel("Include row").check();
    assert.equal(requests.filter(r => r.path === "importJobs.resolveMapping").length, 0);
    const out = (process.env.VAETTIR_E2E_OUTPUT_DIR ?? (root + ".local/import-mapping-queue-20261029")); mkdirSync(out, { recursive: true });
    for (const [theme, width] of [["light",1100],["dark",1100],["dark",390]]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate(async t => {
        document.documentElement.dataset.theme = t;
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        await Promise.allSettled(document.getAnimations().map(animation => animation.finished));
      }, theme);
      await queue.locator('button:not(:disabled)').filter({ hasText: /^Import$/ }).waitFor();
      await queue.scrollIntoViewIfNeeded(); await page.screenshot({ path: `${out}/mapping-${theme}-${width}.png`, fullPage: true });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true);
    }
    deny = true; await page.evaluate(() => window.revalidateAccess());
    await queue.getByText("Queue details are hidden until original access is verified.").waitFor();
    assert.equal(await queue.getByLabel("Title", { exact: true }).count(), 0);
    deny = false; await page.evaluate(() => window.revalidateAccess());
    await queue.getByText("Source · Row 3 · Repaired settings", { exact: true }).click();
    await queue.getByLabel("Title", { exact: true }).waitFor();
    assert.equal(await queue.getByLabel("Title", { exact: true }).inputValue(), "Repaired settings");
    organizationId = "foreign-org"; await page.evaluate(() => window.revalidateAccess());
    await queue.getByText("Queue details are hidden until original access is verified.").waitFor();
    organizationId = "synthetic-org"; await page.evaluate(() => window.revalidateAccess());
    await queue.getByText("Source · Row 3 · Repaired settings", { exact: true }).click();
    await queue.getByLabel("Title", { exact: true }).waitFor();
    holdResolve = true; await queue.getByRole("button", { name: actionName("Import"), exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Saving…'));
    await Promise.race([resolveStarted, new Promise((_, reject) => setTimeout(() => reject(Error("Resolve was not dispatched")), 5000))]);
    await page.evaluate(() => window.setSyntheticAuth({ userId: "foreign-actor", sessionId: "session-b" }));
    await page.waitForFunction(() => ![...document.querySelectorAll('input')].some(i => i.value === 'Repaired settings'));
    releaseResolve();
    await page.evaluate(() => window.setSyntheticAuth({ userId: "synthetic-actor", sessionId: "session-a-new" }));
    await page.getByRole("heading", { name: "Mapping queue", exact: true }).waitFor();
    assert.equal(requests.filter(r => r.path === "importJobs.resolveMapping").length, 1);
    assert.equal(requests.some(r => /commitCsv|commitXlsx|commitGoogleSheets|recommend|applyReviewed/.test(r.path)), false);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
});
