/* global document, window, requestAnimationFrame, innerWidth */
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const viteRequire = createRequire(
  createRequire(require.resolve("vitest")).resolve("vite"),
);
const { build } = viteRequire("esbuild"),
  { chromium } = require("@playwright/test");
const root = fileURLToPath(new URL("../", import.meta.url));
const fixture = `import React from 'react';
const listeners=new Set();
const catalog={projectId:'synthetic-project',organizationId:'synthetic-org',clerkActorId:'synthetic-actor',dashboards:[],schedules:[],projects:[{id:'synthetic-project',name:'Current project'},{id:'second-project',name:'Second portfolio project'}]};
const harness=window.harness={requests:[],failNext:false,ready:true,notify(){for(const fn of listeners)fn();}};
function useRefresh(){const [,tick]=React.useState(0);React.useEffect(()=>{const fn=()=>tick(v=>v+1);listeners.add(fn);return()=>listeners.delete(fn)},[]);}
function query(data){useRefresh();return{data,isFetching:false,isPaused:false,error:null,refetch:async()=>({data,error:null})};}
function mutation(kind){const [isPending,setPending]=React.useState(false);return{isPending,mutateAsync:async request=>{setPending(true);harness.requests.push(JSON.parse(JSON.stringify(request)));await new Promise(r=>setTimeout(r,10));const rows=kind==='dashboard'?catalog.dashboards:catalog.schedules;let row=rows.find(r=>r.id===request.id);if(!row){row={...request,version:1,editable:true,runs:[],nextRunAt:'2026-10-29T09:00:00Z'};rows.push(row);}harness.notify();setPending(false);if(harness.failNext){harness.failNext=false;throw Error('synthetic lost response')}return{id:row.id,version:row.version,...(kind==='schedule'?{enabled:row.enabled}:{})}}};}
export const trpcReact={reportWorkflows:{list:{useQuery:()=>query(catalog)},preview:{useQuery:({config})=>query({...catalog,asOf:'2026-10-28T21:00:00Z',columns:config.columns,limitations:['Synthetic component proof; not hosted acceptance.'],widgets:config.widgets.map(widget=>({...widget,visual:{id:widget.id,title:widget.id,kind:'bars',unit:'records',note:'Recorded synthetic counts',empty:'No data',rows:[{label:'PASS',value:8,color:'#167d70'},{label:'FAIL',value:2,color:'#c25964'}]}}))})},saveDashboard:{useMutation:()=>mutation('dashboard')},saveSchedule:{useMutation:()=>mutation('schedule')}}};`;
const result = await build({
  stdin: {
    contents: `import React from 'react';import {createRoot} from 'react-dom/client';import {ReportWorkspace} from './components/ReportWorkspace';function App(){const [ready,setReady]=React.useState(true);window.changeAccess=setReady;return <ReportWorkspace projectId="synthetic-project" organizationId="synthetic-org" clerkActorId="synthetic-actor" ready={ready} editable={true}/>};createRoot(document.getElementById('root')).render(<App/>);`,
    resolveDir: root + "apps/web",
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outfile: "fixture.js",
  platform: "browser",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [
    {
      name: "synthetic-boundaries",
      setup(build) {
        build.onResolve({ filter: /^@\/lib\/trpcReact$/ }, () => ({
          path: "trpc",
          namespace: "fixture",
        }));
        build.onResolve({ filter: /^next\/link$/ }, () => ({
          path: "link",
          namespace: "fixture",
        }));
        build.onResolve({ filter: /ReportDefinitionSettingsEditor$/ }, () => ({
          path: "editor",
          namespace: "fixture",
        }));
        build.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
          contents:
            args.path === "trpc"
              ? fixture
              : args.path === "link"
                ? `import React from 'react';export default function Link(props){return React.createElement('a',props)}`
                : `import React from 'react';export function ReportDefinitionSettingsEditor(){return React.createElement('p',null,'Scope editor is covered separately.')}`,
          loader: "js",
          resolveDir: root + "apps/web",
        }));
      },
    },
  ],
});
const js = result.outputFiles.find((file) => file.path.endsWith(".js")).text,
  css = result.outputFiles.find((file) => file.path.endsWith(".css")).text;
test("report workspace saves, retries, validates and reorders through real browser controls", async () => {
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html");
    response.end("<!doctype html><html><body></body></html>");
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(),
      errors = [];
    page.on("pageerror", (error) => errors.push(String(error)));
    await page.route("**/*", (route) =>
      route
        .request()
        .url()
        .startsWith(origin + "/")
        ? route.continue()
        : route.abort(),
    );
    await page.goto(origin);
    const globalCss =
      readFileSync(root + "apps/web/app/globals.css", "utf8").replace(
        /^@import.*$/gm,
        "",
      ) + readFileSync(root + "apps/web/app/workbench.css", "utf8");
    await page.setContent(
      `<html data-theme="light"><head><style>${globalCss}\n${css}</style></head><body><main style="max-width:1200px;margin:auto;padding:16px"><h1>Reporting workspace</h1><p>Synthetic component verification</p><div id="root"></div></main></body></html>`,
    );
    await page.addScriptTag({ content: js });
    await page
      .getByText("Dashboards and scheduled reports", { exact: true })
      .click();
    await page
      .getByLabel("Name", { exact: true })
      .fill("Release quality overview");
    await page.getByText("Customize charts", { exact: true }).click();
    await page
      .getByRole("button", { name: "Move Execution coverage up", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    assert.match(
      await page.locator("li").first().innerText(),
      /Execution coverage/,
    );
    assert.equal(
      await page
        .getByRole("button", {
          name: "Move Execution coverage up",
          exact: true,
        })
        .evaluate((node) => node === document.activeElement),
      true,
    );
    await page.getByLabel("Add chart").selectOption("custom-1");
    await page.getByLabel("Data source").selectOption("results");
    await page.getByLabel("Group by").selectOption("week");
    await page.getByText("Include other projects", { exact: true }).click();
    await page.getByLabel("Second portfolio project", { exact: true }).check();
    await page.getByText("Include other projects", { exact: true }).click();
    await page.evaluate(() => {
      window.harness.failNext = true;
    });
    await page
      .getByRole("button", { name: "Save dashboard", exact: true })
      .click();
    await page.getByText(/Save was not confirmed/).waitFor();
    await page
      .getByRole("button", { name: "Retry same save", exact: true })
      .click();
    await page.getByText("Dashboard saved.", { exact: true }).waitFor();
    const requests = await page.evaluate(() => window.harness.requests);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests[0], requests[1]);
    assert.deepEqual(requests[0].config.additionalProjectIds, ["second-project"]);
    assert.equal(requests[0].config.widgets[0].id, "coverage");
    assert.equal(requests[0].config.widgets.at(-1).query.dimension, "week");
    await page.getByText("Customize charts", { exact: true }).click();
    for (const theme of ["light", "dark"])
      for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 1000 });
        await page.evaluate((theme) => {
          document.documentElement.dataset.theme = theme;
        }, theme);
        await page.evaluate(
          () =>
            new Promise((resolve) =>
              requestAnimationFrame(() => requestAnimationFrame(resolve)),
            ),
        );
        assert.equal(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
          true,
        );
        if (process.env.VAETTIR_UI_SCREENSHOTS) {
          mkdirSync(root + ".local/reporting-parity-20261028/visuals", {
            recursive: true,
          });
          await page.screenshot({
            path:
              root +
              `.local/reporting-parity-20261028/visuals/dashboard-${theme}-${width}.png`,
            fullPage: true,
          });
        }
      }
    await page.getByRole("button", { name: "Schedules", exact: true }).click();
    await page.getByLabel("Time zone", { exact: true }).fill("Mars/Olympus");
    await page
      .getByRole("button", { name: "Save paused schedule", exact: true })
      .click();
    await page
      .getByText("Choose a supported time zone", { exact: true })
      .waitFor();
    assert.equal(await page.evaluate(() => window.harness.requests.length), 2);
    await page
      .getByLabel("Time zone", { exact: true })
      .fill("America/Los_Angeles");
    await page
      .getByLabel("Enable recurring private captures using my current access")
      .check();
    await page.getByLabel("Also deliver selected inventory and result totals to the configured workspace Slack destination").check();
    await page
      .getByRole("button", { name: "Enable schedule", exact: true })
      .click();
    await page.getByText(/Schedule enabled/).waitFor();
    const scheduleRequest = await page.evaluate(() => window.harness.requests.at(-1));
    assert.equal(scheduleRequest.config.delivery, "slack");
    assert.equal(scheduleRequest.approveRecurringDelivery, true);
    await page.evaluate(() => window.changeAccess(false));
    assert.equal(
      await page.getByLabel("Name", { exact: true }).isVisible(),
      false,
    );
    await page.evaluate(() => window.changeAccess(true));
    assert.equal(
      await page.getByLabel("Name", { exact: true }).inputValue(),
      "Weekly quality review",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
});
