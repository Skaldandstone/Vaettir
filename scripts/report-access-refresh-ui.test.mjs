import { actionName } from "../apps/web/e2e/action-name.mjs";
/* global window, document */
// Full Reports page, real tRPC hooks, auth QueryClient and React providers.
// Only Clerk/Next shell and HTTP responses are synthetic; no customer/provider data.
import assert from "node:assert/strict";
import { test } from "node:test";
// Register Office exports in this existing CI browser invocation.
import "./report-export-ui.test.mjs";
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
const listeners=new Set();
function session(){window.Clerk={loaded:true,session:{id:state.sessionId,user:{id:state.userId},getToken:async()=> 'synthetic-local-token'}}}session();
window.setSyntheticAuth=(next)=>{state={...state,...next};session();for(const fn of listeners)fn()};
export function useAuth(){return useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state)};`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
import Page from './app/projects/[projectId]/reports/page';
import {TRPCReactProvider,trpcReact} from './lib/trpcReact';
import {onlineManager} from '@tanstack/react-query';
function Probe(){const utils=trpcReact.useUtils();window.revalidateAccess=()=>Promise.all([utils.project.byId.invalidate(),utils.organization.mine.invalidate()]);window.setOnline=value=>onlineManager.setOnline(value);return <Page/>}
createRoot(document.getElementById('root')).render(<TRPCReactProvider><Probe/></TRPCReactProvider>);`, resolveDir: root + "apps/web", loader: "tsx" },
  bundle: true, write: false, outfile: "fixture.js", platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"', "process.env.NEXT_PUBLIC_API_URL": '"/api"' },
  plugins: [{ name: "synthetic-shell-only", setup(builder) {
    builder.onResolve({ filter: /^(@clerk\/nextjs|next\/navigation|next\/link)$/ }, args => ({ path: args.path, namespace: "shell" }));
    builder.onLoad({ filter: /.*/, namespace: "shell" }, args => ({ contents: args.path === "@clerk/nextjs" ? authModule : args.path === "next/navigation" ? `export const useParams=()=>({projectId:'synthetic-project'});export const useRouter=()=>({push(){},replace(){},refresh(){}});export const usePathname=()=>'/projects/synthetic-project/reports';` : `import React from 'react';export default function Link(props){return React.createElement('a',props)}`, loader: "js", resolveDir: root + "apps/web" }));
  } }],
});
const js = bundle.outputFiles.find(file => file.path.endsWith(".js")).text;
const css = bundle.outputFiles.find(file => file.path.endsWith(".css"))?.text ?? "";
const pin = { projectId: "synthetic-project", organizationId: "synthetic-org", clerkActorId: "synthetic-actor" };
const savedDefinition = { id: "synthetic-definition", name: "Private reusable settings", version: 1, visibility: "private", archived: false, canManage: true,
  definition: { audience: "stakeholders", templateId: "quality-status", windowDays: 30, sections: ["inventory", "execution"], summary: "Retained author notes", risks: "", nextActions: "" } };
const overview = { ...pin, asOf: "2026-10-29T20:00:00Z", windowStart: null, caseQuery: null,
  inventory: { active: 7, archived: 0, withSource: 0, riskAssessed: 0, flaky: 0, byType: [], byPriority: [], byReview: [] },
  execution: { runs: 1, results: 2, matchedResults: 2, byRunStatus: [], byResultStatus: [{ key: "PASS", count: 2 }] },
  requirements: { total: 0, withCriteria: 0, linkedCriteria: 0, criteria: [] }, recentRuns: [] };

test("full reporting access settles and withholds bodies during genuine access changes", async () => {
  const server = createServer((_request, response) => { response.setHeader("Content-Type", "text/html"); response.end('<html><body><div id="root"></div></body></html>'); });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.setDefaultTimeout(5000);
  const requests = [], errors = [], held = [];
  let holdAccess = false, holdPreview = false, membership = true, organizationId = pin.organizationId, failAccess = false, scopeOrganizationId = pin.organizationId;
  const reply = (path, input) => {
    if (path === "project.byId") return { id: pin.projectId, organizationId, name: "Synthetic reporting project" };
    if (path === "organization.mine") return membership ? [{ id: organizationId, name: "Synthetic workspace", role: "OWNER", seatType: "FULL" }] : [];
    if (path === "reports.overview") return overview;
    if (["testCaseViews.list", "reportSnapshots.definitions", "reportSnapshots.drafts"].includes(path)) return [];
    if (path === "reportSnapshots.catalog") return { ...pin, items: [], total: 0, page: 0, pageSize: 20, requestKey: JSON.stringify([input.projectId, input.page, input.search, input.audience, input.purpose, input.sort, input.capturedInterval?.start ?? null, input.capturedInterval?.end ?? null]), limitations: [] };
    if (path === "reportSnapshots.definitionCatalog") return { ...pin, page: input.page, includeArchived: input.includeArchived, items: [savedDefinition], total: 1, hasMore: false, limitations: [] };
    if (path === "reportSnapshots.definitionHistory") return { ...pin, id: savedDefinition.id, page: input.page, current: savedDefinition, items: [], canManage: true, canShare: true, hasMore: false, limitation: "Synthetic retained history" };
    if (path === "reportWorkflows.list") return { ...pin, dashboards: [], schedules: [], projects: [{ id: pin.projectId, name: "Synthetic reporting project" }] };
    if (path === "reportWorkflows.preview") return { ...pin, asOf: overview.asOf, columns: input.config.columns, limitations: [], widgets: input.config.widgets.map(widget => ({ ...widget, visual: { id: widget.id, title: "Synthetic private chart", kind: "bars", unit: "records", rows: [{ label: "PASS", value: 2, color: "#167d70" }], note: "Synthetic evidence", empty: "No data" } })) };
    if (path === "reportSnapshots.scopeOptions") return { ...pin, organizationId: scopeOrganizationId, plans: [{ id: "synthetic-plan", name: "Private recorded plan" }], runs: [], platforms: [], environments: [], builds: [], releases: [] };
    throw Error("Unexpected procedure: " + path);
  };
  page.on("pageerror", error => errors.push(String(error)));
  await page.route("**/*", async route => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (!url.pathname.startsWith("/api/trpc/")) return route.continue();
    const paths = url.pathname.slice("/api/trpc/".length).split(",");
    const inputs = JSON.parse(url.searchParams.get("input") ?? "{}");
    paths.forEach((path, index) => requests.push({ path, input: inputs[index], method: route.request().method() }));
    if (paths.some(path => holdAccess && ["project.byId", "organization.mine"].includes(path) || holdPreview && path === "reportWorkflows.preview")) await new Promise(resolve => held.push(resolve));
    // Response is deliberately asynchronous, matching real HTTP observer lifecycles.
    await new Promise(resolve => setTimeout(resolve, 20));
    await route.fulfill({ contentType: "application/json", body: JSON.stringify(paths.map((path, index) => failAccess && ["project.byId", "organization.mine"].includes(path) ? { error: { message: "Synthetic access failure", code: -32003, data: { code: "FORBIDDEN", httpStatus: 403, path } } } : { result: { data: reply(path, inputs[index]) } })) });
  });
  const release = () => { for (const resolve of held.splice(0)) resolve(); };
  const stable = async () => {
    await page.locator(".quality-visual-report").first().waitFor({ state: "visible", timeout: 5000 });
    const count = requests.length;
    await page.waitForTimeout(400); // well below the intentional 60s metric refresh
    assert.equal(requests.length, count, "settled page must not keep polling access/catalog/preview");
  };
  try {
    await page.goto(origin);
    await page.addStyleTag({ content: readFileSync(root + "apps/web/app/globals.css", "utf8").replace(/^@import.*$/gm, "") + readFileSync(root + "apps/web/app/workbench.css", "utf8") + css });
    await page.addScriptTag({ content: js });
    await page.getByText("Dashboards and scheduled reports", { exact: true }).click();
    await stable();
    assert.equal(await page.getByRole("button", { name: actionName("Create report"), exact: true }).isEnabled(), true);
    assert.deepEqual(errors, []);
    const workspace = page.locator("details").filter({ has: page.locator(":scope > summary", { hasText: "Dashboards and scheduled reports" }) });
    await workspace.getByLabel("Name", { exact: true }).fill("Retained private draft");
    // Genuine access refresh still hides the entire workspace and all chart bodies.
    holdAccess = true;
    await page.evaluate(() => { void window.revalidateAccess(); });
    await page.getByText(/Verifying current report access/).waitFor();
    assert.equal(await workspace.isVisible(), false);
    assert.equal(await page.locator(".quality-visual-report:visible").count(), 0);
    holdAccess = false; release();
    await stable();
    assert.equal(await workspace.getByLabel("Name", { exact: true }).inputValue(), "Retained private draft");
    // Refreshing metrics hides stale charts, without triggering parent access reads.
    holdPreview = true;
    const accessCount = requests.filter(row => ["project.byId", "organization.mine"].includes(row.path)).length;
    await workspace.getByRole("button", { name: actionName("Refresh"), exact: true }).click();
    await workspace.getByText("Refreshing current metrics…").waitFor();
    assert.equal(await page.locator(".quality-visual-report").count(), 0);
    holdPreview = false; release(); await stable();
    assert.equal(requests.filter(row => ["project.byId", "organization.mine"].includes(row.path)).length, accessCount);
    // Membership revoke, failed access read, and project transfer deny old drafts/bodies.
    membership = false; await page.evaluate(() => window.revalidateAccess());
    await page.getByText(/Verifying current report access/).waitFor();
    assert.equal(await workspace.isVisible(), false);
    membership = true; await page.evaluate(() => window.revalidateAccess()); await stable();
    failAccess = true; await page.evaluate(() => window.revalidateAccess());
    assert.equal(await workspace.isVisible(), false);
    failAccess = false; await page.getByRole("button", { name: actionName("Retry report access"), exact: true }).click(); await stable();
    await page.evaluate(() => { window.setOnline(false); void window.revalidateAccess(); });
    await page.getByText(/Verifying current report access/).waitFor();
    assert.equal(await workspace.isVisible(), false);
    await page.evaluate(() => window.setOnline(true)); await stable();
    organizationId = "synthetic-other-org"; await page.evaluate(() => window.revalidateAccess());
    await page.getByText(/Report query drafts remain retained but hidden/).waitFor();
    assert.equal(await workspace.isVisible(), false);
    organizationId = pin.organizationId; await page.evaluate(() => window.revalidateAccess()); await stable();
    // Session changes use the production generation cache; actor B cannot see A's draft.
    holdPreview = true;
    await workspace.getByRole("button", { name: actionName("Refresh"), exact: true }).click();
    await workspace.getByText("Refreshing current metrics…").waitFor();
    await page.evaluate(() => window.setSyntheticAuth({ userId: "synthetic-other-actor", sessionId: "synthetic-session-B" }));
    await page.getByText(/Report query drafts remain retained but hidden/).waitFor();
    assert.equal(await workspace.isVisible(), false);
    assert.equal(await page.locator(".quality-visual-report:visible").count(), 0);
    holdPreview = false; release();
    await page.waitForTimeout(100);
    assert.equal(await page.locator(".quality-visual-report:visible").count(), 0, "late A response cannot display in B");
    await page.evaluate(() => window.setSyntheticAuth({ userId: "synthetic-actor", sessionId: "synthetic-session-C" }));
    await stable();
    assert.equal(await workspace.getByLabel("Name", { exact: true }).inputValue(), "Retained private draft");
    // Actual scope editor remains functional and rejects foreign workspace options.
    await workspace.getByText("More report settings", { exact: true }).click();
    await workspace.getByRole("button", { name: actionName("Next settings screen"), exact: true }).focus();
    await page.keyboard.press("Enter");
    await workspace.getByRole("button", { name: actionName("Next settings screen"), exact: true }).click();
    const plan = workspace.getByRole("combobox", { name: /^Plan \(optional\)/ });
    await plan.locator('option[value="synthetic-plan"]').waitFor({ state: "attached" });
    assert.equal(await plan.isEnabled(), true);
    await stable();
    scopeOrganizationId = "synthetic-foreign-org";
    await workspace.getByRole("button", { name: actionName("Previous settings screen"), exact: true }).click();
    await workspace.getByRole("button", { name: actionName("Next settings screen"), exact: true }).click();
    await page.waitForTimeout(100);
    assert.equal(await plan.isDisabled(), true);
    assert.equal(await plan.locator('option[value="synthetic-plan"]').count(), 0);
    scopeOrganizationId = pin.organizationId;
    await workspace.getByRole("button", { name: actionName("Previous settings screen"), exact: true }).click();
    await workspace.getByRole("button", { name: actionName("Next settings screen"), exact: true }).click();
    await plan.locator('option[value="synthetic-plan"]').waitFor({ state: "attached" });
    // The second real editor caller also settles when the settings editor mounts.
    await page.getByText("Manage saved report settings", { exact: true }).click();
    await page.getByRole("button", { name: actionName("Manage / history"), exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Review reusable report definition" });
    await dialog.getByRole("combobox", { name: /^Change/ }).selectOption("settings");
    await dialog.getByRole("button", { name: actionName("Next settings screen"), exact: true }).click();
    await dialog.getByRole("button", { name: actionName("Next settings screen"), exact: true }).click();
    await dialog.getByRole("combobox", { name: /^Plan \(optional\)/ }).locator('option[value="synthetic-plan"]').waitFor({ state: "attached" });
    await stable();
    holdAccess = true;
    await page.evaluate(() => { void window.revalidateAccess(); });
    await page.getByText(/Verifying current report access/).waitFor();
    assert.equal(await dialog.isVisible(), false);
    holdAccess = false; release();
    await dialog.getByRole("combobox", { name: /^Change/ }).waitFor();
    await dialog.getByRole("button", { name: actionName("Close"), exact: true }).click();
    await stable();
    await workspace.locator(":scope > summary").click();
    const closedCount = requests.length;
    await page.waitForTimeout(400);
    assert.equal(requests.length, closedCount, "closing a cached dashboard must not restart access reads");
    // Reopening intentionally refetches stale catalog/preview; wait for that
    // real response instead of mistaking pre-toggle cached markup for settled UI.
    const reopened = page.waitForResponse(response => new URL(response.url()).pathname.includes("reportWorkflows.preview"));
    await workspace.locator(":scope > summary").click();
    await reopened;
    await stable();
    assert.equal(requests.filter(row => row.method !== "GET").length, 0, "no mutations or implicit writes");
    for (const row of requests.filter(row => row.path.startsWith("reportWorkflows."))) {
      assert.equal(row.input.expectedOrganizationId, pin.organizationId);
      assert.equal(row.input.expectedClerkActorId, pin.clerkActorId);
    }
    assert.deepEqual(errors, []);
    const evidence = (process.env.VAETTIR_E2E_OUTPUT_DIR ?? (root + ".local/reporting-refresh-20261029"));
    mkdirSync(evidence, { recursive: true });
    await workspace.getByText("More report settings", { exact: true }).click();
    await page.getByText("Manage saved report settings", { exact: true }).click();
    for (const theme of ["dark", "light"]) {
      await page.evaluate(theme => document.documentElement.setAttribute("data-theme", theme), theme);
      await workspace.screenshot({ path: `${evidence}/${theme}.png`, animations: "disabled" });
    }
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
    await workspace.screenshot({ path: `${evidence}/narrow.png`, animations: "disabled" });
  } catch (error) {
    console.log((await page.locator("body").innerText()).slice(-10000));
    throw error;
  } finally {
    holdAccess = false; holdPreview = false; release();
    console.log(JSON.stringify({ procedures: requests.reduce((counts, row) => ({ ...counts, [row.path]: (counts[row.path] ?? 0) + 1 }), {}), errors }));
    await browser.close(); await new Promise(resolve => server.close(resolve));
  }
});
