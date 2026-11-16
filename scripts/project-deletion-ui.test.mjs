import { actionName } from "../apps/web/e2e/action-name.mjs";
import { reactBrowserScripts, actionButtonBrowserSource } from "./test-support/react-browser-runtime.mjs";
// Actual React deletion wizard and native dialog, with synthetic RPC boundaries.
/* global window,document,innerWidth */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";
const require = createRequire(
  new URL("../apps/web/package.json", import.meta.url),
);
const ts = require("typescript"),
  { chromium } = require("@playwright/test");
function compile(path) {
  const source = ts.createSourceFile(
    path,
    readFileSync(new URL("../" + path, import.meta.url), "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const ast = ts.factory.updateSourceFile(
    source,
    source.statements.filter((statement) => !ts.isImportDeclaration(statement)),
  );
  return ts
    .transpileModule(ts.createPrinter().printFile(ast), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.ESNext,
        jsx: ts.JsxEmit.React,
      },
    })
    .outputText.replace(/^export /gm, "");
}
const compiled = actionButtonBrowserSource() + "\n" + [
  "apps/web/components/ui/DialogFrame.tsx",
  "apps/web/components/Modal.tsx",
  "apps/web/components/ProjectDeletionWizard.tsx",
]
  .map(compile)
  .join("\n");
const scripts = {
  ...reactBrowserScripts(),


};
const css = readFileSync(
  new URL("../apps/web/app/globals.css", import.meta.url),
);
const screenshots = process.env.VAETTIR_DELETION_SCREENSHOT_DIR;
if (screenshots) mkdirSync(screenshots, { recursive: true });
const boot = `
const {useState,useEffect,useLayoutEffect,useRef,useId,useSyncExternalStore}=React,{createPortal}=ReactDOM;
const Link=({href,children,...props})=>React.createElement("a",{href,...props},children);
window.submissions=[];window.deleted=0;window.cancelCount=0;window.mode="ok";
window.preview={id:"synthetic-project",organizationId:"synthetic-org",name:"Synthetic project",fingerprint:"a".repeat(64),hasContents:true,blocked:false,rows:[
 {key:"testRuns",count:1,label:"Test runs",blocksDeletion:false},{key:"importJobs",count:1,label:"Import history",blocksDeletion:false}]};
const trpcReact={project:{deletionPreview:{useQuery:()=>{
 const [result,setResult]=useState({data:window.preview,isFetching:false,isError:false,error:null});
 useEffect(()=>{window.setReview=setResult},[]);
 return {...result,refetch:async()=>{setResult({data:undefined,isFetching:true,isError:false,error:null});await Promise.resolve();setResult({data:window.preview,isFetching:false,isError:false,error:null})}};
}},deleteReviewed:{useMutation:({onSuccess})=>{
 const [state,setState]=useState({isPending:false,error:null});
 return {...state,reset:()=>setState({isPending:false,error:null}),mutate:input=>{
  window.submissions.push(input);setState({isPending:true,error:null});
  const finish=()=>{if(window.mode==="error")setState({isPending:false,error:{message:"Synthetic connection failure"}});else{setState({isPending:false,error:null});onSuccess()}};
  if(window.mode==="pending")window.finish=finish;else setTimeout(finish,20);
 }};
}}}};
`;
const html = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="/globals.css"></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">${boot}\n${compiled}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(ProjectDeletionWizard,{projectId:"synthetic-project",onClose:()=>window.cancelCount++,onDeleted:()=>window.deleted++}));</script></body></html>`;
let server, browser, origin;
before(async () => {
  server = createServer((req, res) => {
    res.setHeader(
      "content-type",
      req.url === "/globals.css"
        ? "text/css"
        : scripts[req.url]
          ? "application/javascript"
          : "text/html",
    );
    res.end(req.url === "/globals.css" ? css : (scripts[req.url] ?? html));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = "http://127.0.0.1:" + server.address().port;
  browser = await chromium.launch({ headless: true });
});
after(async () => {
  await browser?.close();
  await new Promise((resolve) => server?.close(resolve));
});
async function page() {
  const p = await browser.newPage();
  p.setDefaultTimeout(5000);
  const errors = [];
  p.on("pageerror", (error) => errors.push(error.message));
  await p.route("**/*", (route) =>
    new URL(route.request().url()).origin === origin
      ? route.continue()
      : route.abort(),
  );
  await p.goto(origin);
  try {
    await p.getByRole("dialog").waitFor();
  } catch (error) {
    throw Error(JSON.stringify(errors), { cause: error });
  }
  return p;
}
async function confirm(p) {
  await p.getByRole("button", { name: actionName("Continue to confirmation", false) }).click();
  await p
    .getByLabel("Project name confirmation", { exact: true })
    .fill("Synthetic project");
  await p.getByRole("checkbox").check();
}
test("reviews contents before requiring both the exact project name and explicit content deletion", async () => {
  const p = await page();
  try {
    await p
      .getByLabel("Project name confirmation")
      .waitFor({ state: "hidden" });
    assert.equal(await p.getByText("1 Test runs", { exact: true }).count(), 1);
    assert.equal(
      await p.getByText("1 Import history", { exact: true }).count(),
      1,
    );
    await p.getByRole("button", { name: actionName("Continue to confirmation", false) }).click();
    const submit = p.getByRole("button", {
      name: actionName("Delete project and contents"),
      exact: true,
    });
    assert.equal(await submit.isEnabled(), false);
    await p
      .getByLabel("Project name confirmation", { exact: true })
      .fill("Synthetic project");
    assert.equal(await submit.isEnabled(), false);
    await p.getByRole("checkbox").check();
    assert.equal(await submit.isEnabled(), true);
    await p
      .getByLabel("Project name confirmation", { exact: true })
      .fill("Wrong name");
    assert.equal(await submit.isEnabled(), false);
    await p
      .getByLabel("Project name confirmation", { exact: true })
      .fill("Synthetic project");
    await submit.click();
    await p.waitForFunction(() => window.deleted === 1);
    const sent = await p.evaluate(() => window.submissions);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].includeContents, true);
    assert.equal(sent[0].expectedName, "Synthetic project");
    assert.equal(sent[0].previewFingerprint, "a".repeat(64));
  } finally {
    await p.close();
  }
});
test("loading, permission failures, protected records and changed previews cannot submit", async () => {
  const p = await page();
  try {
    await p.evaluate(() =>
      window.setReview({ isFetching: true, isError: false, data: undefined }),
    );
    assert.equal(
      await p
        .getByRole("button", { name: actionName("Continue to confirmation", false) })
        .isEnabled(),
      false,
    );
    await p.evaluate(() =>
      window.setReview({
        isFetching: false,
        isError: true,
        error: { message: "Synthetic permission denied" },
      }),
    );
    await p.getByRole("alert").waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: actionName("Continue to confirmation", false) })
        .isEnabled(),
      false,
    );
    await p.evaluate(() =>
      window.setReview({
        data: {
          ...window.preview,
          blocked: true,
          rows: [
            {
              key: "recordedResults",
              label: "Recorded test results",
              count: 2,
              blocksDeletion: true,
            },
          ],
        },
        isFetching: false,
        isError: false,
      }),
    );
    await p.getByText(/Recorded test results/).waitFor();
    assert.equal(
      await p
        .getByRole("button", { name: actionName("Continue to confirmation", false) })
        .isEnabled(),
      false,
    );
    await p.evaluate(() =>
      window.setReview({
        data: window.preview,
        isFetching: false,
        isError: false,
      }),
    );
    await confirm(p);
    await p.evaluate(() =>
      window.setReview({
        data: { ...window.preview, fingerprint: "b".repeat(64) },
        isFetching: false,
        isError: false,
      }),
    );
    await p
      .getByLabel("Project name confirmation")
      .waitFor({ state: "hidden" });
    assert.equal(await p.evaluate(() => window.submissions.length), 0);
  } finally {
    await p.close();
  }
});
test("pending deletion prevents duplicate submissions and failed retries keep their durable request identity", async () => {
  const p = await page();
  try {
    await p.evaluate(() => (window.mode = "pending"));
    await confirm(p);
    await p
      .getByRole("button", { name: actionName("Delete project and contents"), exact: true })
      .click();
    const status = await p.evaluate(() => ({
      submissions: window.submissions,
      mode: window.mode,
      content: document.querySelector("dialog").textContent,
    }));
    assert.equal(status.submissions.length, 1, JSON.stringify(status));
    assert.ok(status.content.includes("Deleting…"), JSON.stringify(status));
    assert.equal(
      await p
        .getByRole("button", { name: actionName("Deleting…"), exact: true })
        .isEnabled(),
      false,
      JSON.stringify(status),
    );
    assert.equal(
      await p.getByRole("button", { name: actionName("Cancel"), exact: true }).isEnabled(),
      false,
    );
    await p.evaluate(() => {
      window.mode = "error";
      window.finish();
    });
    await p.getByRole("alert").waitFor();
    await p
      .getByRole("button", { name: actionName("Retry deletion"), exact: true })
      .click();
    await p.getByRole("alert").waitFor();
    const sent = await p.evaluate(() => window.submissions);
    assert.equal(sent.length, 2);
    assert.deepEqual(sent[0], sent[1]);
    await p
      .getByRole("button", { name: actionName("Refresh contents and start a new review", false) })
      .click();
    assert.equal(await p.getByLabel("Project name confirmation").count(), 0);
  } finally {
    await p.close();
  }
});
test("contents and confirmations fit the application's mobile and desktop dialogs", async () => {
  const p = await page();
  try {
    for (const width of [390, 1280]) {
      await p.setViewportSize({ width, height: 900 });
      if (width === 1280)
        await p.getByRole("button", { name: actionName("Back"), exact: true }).click();
      await confirm(p);
      const bounds = await p
        .getByRole("dialog")
        .evaluate((node) => ({
          left: node.getBoundingClientRect().left,
          right: node.getBoundingClientRect().right,
          width: innerWidth,
          overflow: node.scrollWidth > node.clientWidth + 1,
        }));
      assert.ok(
        bounds.left >= 0 && bounds.right <= width + 1 && !bounds.overflow,
        JSON.stringify(bounds),
      );
      if (screenshots)
        await p.screenshot({
          path: join(screenshots, `project-deletion-${width}.png`),
          fullPage: true,
        });
    }
  } finally {
    await p.close();
  }
});
