import { actionName } from "../apps/web/e2e/action-name.mjs";
import { reactBrowserScripts } from "./test-support/react-browser-runtime.mjs";
// Real ReactDOM controls, synthetic RPC only, with all external network blocked.
/* global document,window,innerWidth */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { join } from "node:path";
import { readFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript"), { chromium } = require("@playwright/test");
const source = readFileSync(new URL("../apps/web/components/WorkspaceAddressFields.tsx", import.meta.url), "utf8");
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
compiled = compiled.replace(/^import .* from "@vaettir\/core";$/m, `const normalizeWorkspaceName=n=>n.trim().toLowerCase();const workspaceHostname=n=>normalizeWorkspaceName(n)+".vaettir.app";const workspaceNameError=n=>/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(normalizeWorkspaceName(n))&&!n.includes("--")&&n!=="api"?null:"Choose a valid workspace name.";`)
 .replace(/^import .* from "..\/lib\/trpcReact";$/m, "const trpcReact=window.trpc;");
assert.ok(!/^\s*import /m.test(compiled));
const scripts = {
  ...reactBrowserScripts(),


};
const stylesheet = readFileSync(new URL("../apps/web/app/globals.css", import.meta.url));
const screenshots = process.env.VAETTIR_DOMAIN_SCREENSHOT_DIR;
if (screenshots) mkdirSync(screenshots, { recursive: true });
const boot = `
window.checkedNames=[];window.mode="ok";
window.trpc={organization:{domainAvailability:{useQuery:({name})=>{
 const [data,setData]=React.useState(null),[isFetching,setFetching]=React.useState(false),[error,setError]=React.useState(null);
 const refetch=async()=>{window.checkedNames.push(name);setFetching(true);setError(null);try{
 if(window.mode==="deferred")await new Promise(resolve=>window.finish=resolve);
 if(window.mode==="error")throw Error("Synthetic unavailable");
 setData({name,available:name!=="taken-team"});}catch(e){setError(e)}finally{setFetching(false)}};
 return {data,isFetching,error,refetch};
}}}};
`;
const html = `<!doctype html><html><head><link rel="stylesheet" href="/globals.css"></head><body><div id="root" class="workspace-panel onboarding-card" style="max-width:600px;margin:16px"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>${boot}</script><script type="module">${compiled}
function Harness(){const[name,setName]=React.useState(""),[confirmed,setConfirmed]=React.useState(false);return React.createElement("form",{className:"form-stack"},React.createElement(WorkspaceAddressFields,{name,onNameChange:setName,confirmed,onConfirmedChange:setConfirmed}),React.createElement("button",{type:"button",disabled:!confirmed},"Confirm address"))}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Harness));</script></body></html>`;
let server, browser, origin;
before(async () => {
  server=createServer((req,res)=>{res.setHeader("content-type",req.url==="/globals.css"?"text/css":scripts[req.url]?"application/javascript":"text/html");res.end(req.url==="/globals.css"?stylesheet:scripts[req.url]??html)});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+server.address().port;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
async function page(){const p=await browser.newPage();p.setDefaultTimeout(5000);await p.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await p.goto(origin);await p.getByLabel("Workspace name",{exact:true}).waitFor();return p}
test("requires availability check, exact-address preview and explicit final confirmation",async()=>{
 const p=await page();try{
 await p.getByLabel("Workspace name",{exact:true}).fill("Synthetic-Team");
 assert.equal(await p.getByRole("button",{name:actionName("Confirm address"),exact:true}).isEnabled(),false);
 await p.getByRole("button",{name:actionName("Check availability"),exact:true}).click();
 await p.getByText("This address is available. Review it before confirming.",{exact:true}).waitFor();
 assert.equal(await p.getByText("https://synthetic-team.vaettir.app",{exact:true}).count(),1);
 await p.getByRole("checkbox").check();assert.equal(await p.getByRole("button",{name:actionName("Confirm address"),exact:true}).isEnabled(),true);
 await p.getByLabel("Workspace name",{exact:true}).fill("another-team");
 assert.equal(await p.getByRole("checkbox").isChecked(),false);
 assert.equal(await p.getByRole("button",{name:actionName("Confirm address"),exact:true}).isEnabled(),false);
 }finally{await p.close()}
});
test("unavailable names and failed lookups cannot be confirmed",async()=>{
 const p=await page();try{
 await p.getByLabel("Workspace name",{exact:true}).fill("taken-team");await p.getByRole("button",{name:actionName("Check availability"),exact:true}).click();
 await p.getByText("This address is unavailable. Choose another name.",{exact:true}).waitFor();assert.equal(await p.getByRole("checkbox").isEnabled(),false);
 await p.evaluate(()=>window.mode="error");await p.getByLabel("Workspace name",{exact:true}).fill("new-team");await p.getByRole("button",{name:actionName("Check availability"),exact:true}).click();
 await p.getByRole("alert").waitFor();assert.equal(await p.getByRole("checkbox").isEnabled(),false);
 }finally{await p.close()}
});
test("a late availability reply cannot confirm a name edited while the check was pending",async()=>{
 const p=await page();try{
 await p.evaluate(()=>window.mode="deferred");await p.getByLabel("Workspace name",{exact:true}).fill("first-team");
 await p.getByRole("button",{name:actionName("Check availability"),exact:true}).click();await p.getByLabel("Workspace name",{exact:true}).fill("second-team");
 await p.evaluate(()=>window.finish());assert.equal(await p.getByRole("checkbox").isEnabled(),false);
 assert.equal(await p.getByRole("button",{name:actionName("Confirm address"),exact:true}).isEnabled(),false);
 }finally{await p.close()}
});
test("the full permanent address and confirmation text remain visible in mobile and desktop application styles", async()=>{
 const p=await page();try{
 for(const width of [390,1280])for(const theme of ["light","dark"]){
  await p.setViewportSize({width,height:900});
  await p.evaluate(theme=>document.documentElement.dataset.theme=theme,theme);
  await p.getByLabel("Workspace name",{exact:true}).fill("synthetic"+"x".repeat(54));
  await p.getByRole("button",{name:actionName("Check availability"),exact:true}).click();
  await p.getByRole("status").waitFor();
  const result=await p.evaluate(()=>{
   const field=document.querySelector("fieldset");
   const items=[...field.querySelectorAll("p,legend,button,.workspace-address-confirmation span")];
   return {right:field.getBoundingClientRect().right,width:innerWidth,
    clipped:items.filter(item=>{const range=document.createRange();range.selectNodeContents(item);return [...range.getClientRects()].some(rect=>rect.left<0||rect.right>innerWidth||rect.right>field.getBoundingClientRect().right)}).map(item=>item.textContent),
    previewFits:document.getElementById("workspace-address-preview").scrollWidth<=document.getElementById("workspace-address-preview").clientWidth+1};
  });
  assert.ok(result.right<=width,JSON.stringify(result));
  assert.deepEqual(result.clipped,[]);assert.equal(result.previewFits,true);
  if(screenshots)await p.screenshot({path:join(screenshots,`address-long-${width}-${theme}.png`),fullPage:true,animations:"disabled"});
 }
 await p.setViewportSize({width:390,height:900});await p.evaluate(()=>document.documentElement.dataset.theme="light");
 await p.getByLabel("Workspace name",{exact:true}).fill("skaldandstone");await p.getByRole("button",{name:actionName("Check availability"),exact:true}).click();await p.getByRole("status").waitFor();
 await p.getByRole("checkbox").check();
 if(screenshots)await p.screenshot({path:join(screenshots,"address-preview-390.png"),fullPage:true,animations:"disabled"});
 }finally{await p.close()}
});
