// Real ReactDOM controls, synthetic RPC only, with all external network blocked.
/* global React,ReactDOM,document */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { before, after, test } from "node:test";
const require = createRequire(new URL("../apps/web/package.json", import.meta.url));
const ts = require("typescript"), { chromium } = require("@playwright/test");
const source = readFileSync(new URL("../apps/web/components/WorkspaceAddressFields.tsx", import.meta.url), "utf8");
let compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.React } }).outputText;
compiled = compiled.replace(/^import .* from "@vaettir\/core";$/m, `const normalizeWorkspaceName=n=>n.trim().toLowerCase();const workspaceHostname=n=>normalizeWorkspaceName(n)+".vaettir.app";const workspaceNameError=n=>/^[a-z][a-z0-9-]{1,61}[a-z0-9]$/.test(normalizeWorkspaceName(n))&&!n.includes("--")&&n!=="api"?null:"Choose a valid workspace name.";`)
 .replace(/^import .* from "..\/lib\/trpcReact";$/m, "const trpcReact=window.trpc;");
assert.ok(!/^\s*import /m.test(compiled));
const scripts = {
  "/react.js": readFileSync(join(dirname(require.resolve("react/package.json")), "umd/react.development.js")),
  "/react-dom.js": readFileSync(join(dirname(require.resolve("react-dom/package.json")), "umd/react-dom.development.js")),
};
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
const html = `<!doctype html><html><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>${boot}</script><script type="module">${compiled}
function Harness(){const[name,setName]=React.useState(""),[confirmed,setConfirmed]=React.useState(false);return React.createElement("form",null,React.createElement(WorkspaceAddressFields,{name,onNameChange:setName,confirmed,onConfirmedChange:setConfirmed}),React.createElement("button",{type:"button",disabled:!confirmed},"Confirm address"))}
ReactDOM.createRoot(document.getElementById("root")).render(React.createElement(Harness));</script></body></html>`;
let server, browser, origin;
before(async () => {
  server=createServer((req,res)=>{res.setHeader("content-type",scripts[req.url]?"application/javascript":"text/html");res.end(scripts[req.url]??html)});
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));origin="http://127.0.0.1:"+server.address().port;
  browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
async function page(){const p=await browser.newPage();p.setDefaultTimeout(5000);await p.route("**/*",route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await p.goto(origin);await p.getByLabel("Workspace name",{exact:true}).waitFor();return p}
test("requires availability check, exact-address preview and explicit final confirmation",async()=>{
 const p=await page();try{
 await p.getByLabel("Workspace name",{exact:true}).fill("Synthetic-Team");
 assert.equal(await p.getByRole("button",{name:"Confirm address",exact:true}).isEnabled(),false);
 await p.getByRole("button",{name:"Check availability",exact:true}).click();
 await p.getByText("This address is available. Review it before confirming.",{exact:true}).waitFor();
 assert.equal(await p.getByText("https://synthetic-team.vaettir.app",{exact:true}).count(),1);
 await p.getByRole("checkbox").check();assert.equal(await p.getByRole("button",{name:"Confirm address",exact:true}).isEnabled(),true);
 await p.getByLabel("Workspace name",{exact:true}).fill("another-team");
 assert.equal(await p.getByRole("checkbox").isChecked(),false);
 assert.equal(await p.getByRole("button",{name:"Confirm address",exact:true}).isEnabled(),false);
 }finally{await p.close()}
});
test("unavailable names and failed lookups cannot be confirmed",async()=>{
 const p=await page();try{
 await p.getByLabel("Workspace name",{exact:true}).fill("taken-team");await p.getByRole("button",{name:"Check availability",exact:true}).click();
 await p.getByText("This address is unavailable. Choose another name.",{exact:true}).waitFor();assert.equal(await p.getByRole("checkbox").isEnabled(),false);
 await p.evaluate(()=>window.mode="error");await p.getByLabel("Workspace name",{exact:true}).fill("new-team");await p.getByRole("button",{name:"Check availability",exact:true}).click();
 await p.getByRole("alert").waitFor();assert.equal(await p.getByRole("checkbox").isEnabled(),false);
 }finally{await p.close()}
});
test("a late availability reply cannot confirm a name edited while the check was pending",async()=>{
 const p=await page();try{
 await p.evaluate(()=>window.mode="deferred");await p.getByLabel("Workspace name",{exact:true}).fill("first-team");
 await p.getByRole("button",{name:"Check availability",exact:true}).click();await p.getByLabel("Workspace name",{exact:true}).fill("second-team");
 await p.evaluate(()=>window.finish());assert.equal(await p.getByRole("checkbox").isEnabled(),false);
 assert.equal(await p.getByRole("button",{name:"Confirm address",exact:true}).isEnabled(),false);
 }finally{await p.close()}
});
