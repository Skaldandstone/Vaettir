import { actionName } from "../action-name.mjs";
// Actual report components, isolated synthetic transport; never hosted acceptance.
/* global document, innerWidth -- local fixture browser only */
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {readFile,mkdir,writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {fileURLToPath} from "node:url";
import path from "node:path";
const web=fileURLToPath(new URL("../../",import.meta.url));
const require=createRequire(path.join(web,"package.json"));
const viteRequire=createRequire(createRequire(require.resolve("vitest")).resolve("vite"));
const {build}=viteRequire("esbuild"),{chromium}=require("@playwright/test");
const output=(process.env.VAETTIR_E2E_OUTPUT_DIR ?? (path.resolve(web,"../../.local/report-builder-20261027")));await mkdir(output,{recursive:true});
const boundary=path.join(web,"e2e/report-builder/boundary.jsx");
const bundled=await build({entryPoints:[path.join(web,"e2e/report-builder/fixture.jsx")],bundle:true,write:false,jsx:"automatic",platform:"browser",nodePaths:[path.join(web,"node_modules")],alias:{"@":web},plugins:[{name:"synthetic-only",setup(builder){
 builder.onResolve({filter:/^(@clerk\/nextjs|.*\/trpcReact)$/},()=>({path:boundary}));
 builder.onResolve({filter:/^next\/link$/},()=>({path:path.join(web,"e2e/ui-workbench/link-boundary.tsx")}));
}}]});
const css=(await readFile(path.join(web,"app/globals.css"),"utf8")).replace(/^@import[^\r\n]+\r?\n/,"")+"\n"+await readFile(path.join(web,"app/workbench.css"),"utf8");
const server=createServer((req,res)=>{if(req.url==="/bundle.js"){res.setHeader("Content-Type","application/javascript");res.end(bundled.outputFiles[0].text);}else{res.setHeader("Content-Type","text/html");res.end(`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}</style></head><body><div id="root"></div><script src="/bundle.js"></script></body></html>`);}});
await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));const origin=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({headless:true});const errors=[],blocked=[];let checks=0;
const check=(value,note)=>{assert.ok(value,note);checks++;};
async function open(width=1280,theme="dark") {const page=await browser.newPage({viewport:{width,height:960},acceptDownloads:true,hasTouch:width===390});page.setDefaultTimeout(7000);page.on("pageerror",e=>{errors.push(e.message);console.error("Fixture browser error:",e.message)});await page.route("**/*",route=>{if(new URL(route.request().url()).origin===origin)return route.continue();blocked.push(route.request().url());return route.abort();});await page.goto(origin);await page.evaluate(t=>document.documentElement.dataset.theme=t,theme);try{await page.getByRole("button",{name:actionName("Create report"),exact:true}).waitFor();}catch(e){await writeFile(path.join(output,"fixture-load-failure.json"),JSON.stringify({errors,body:await page.locator("body").innerText()},null,2));throw e;}return page;}
const trigger=(page,name)=>page.getByRole("button",{name: actionName(name),exact:true,includeHidden:true}).dispatchEvent("click");
const next=page=>page.getByRole("button",{name:actionName("Continue"),exact:true}).click();
async function evidence(page){await trigger(page,"Refresh fixture evidence");await page.getByText("Synthetic transport evidence",{exact:true}).click();return JSON.parse(await page.getByTestId("fixture-evidence").innerText());}
async function overflow(page){check(await page.getByRole("dialog").evaluate(el=>el.scrollWidth<=el.clientWidth+1),"Dialog has no horizontal overflow");check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Page has no horizontal overflow");}
async function chartModel(page){return page.locator(".quality-visual").evaluateAll(figures=>figures.map(f=>({title:f.querySelector("h3").textContent,viewBox:f.querySelector("svg").getAttribute("viewBox"),legend:[...f.querySelectorAll("li")].map(li=>li.textContent.replace(/\s/g,"")),note:f.querySelector("p.text-muted").textContent.trim()})));}
try {
 for(const theme of ["dark","light"]) for(const width of [1280,390]) {
  const page=await open(width,theme);try{
   await page.getByRole("button",{name:actionName("Create report"),exact:true}).click();
   check(await page.getByRole("radio").count()===6,"Six meaningful report choices");
   check(await page.getByRole("radio").first().evaluate(el=>el===document.activeElement),"Initial keyboard focus enters report choices");
   await page.keyboard.press("ArrowRight");check(await page.getByRole("radio").nth(1).isChecked(),"Native radio keyboard navigation selects a template");
   await page.getByRole("radio",{name:/^Custom report/}).check();
   await page.getByRole("button",{name:actionName("Close report builder"),exact:true}).click();await page.getByRole("button",{name:actionName("Resume local report draft"),exact:true}).click();await page.getByRole("dialog").waitFor();
   check(await page.getByRole("radio",{name:/^Custom report/}).isChecked(),"Close/reopen retains the chosen report type");check(await page.getByRole("radio",{name:/^Custom report/}).evaluate(el=>el===document.activeElement),"Reopened report type receives keyboard focus");
   await page.getByRole("radio",{name:/^Quality status review/}).check();await overflow(page);
   if(width===390)check((await page.getByRole("button",{name:actionName("Continue"),exact:true}).boundingBox()).height>=44,"Touch footer action has a 44px target");
   await page.screenshot({path:path.join(output,`types-${theme}-${width}.png`),fullPage:true});
   await next(page);await page.getByLabel("Report title",{exact:true}).fill("Synthetic release review");await overflow(page);
   await next(page);await page.getByRole("checkbox",{name:/^Automation /}).check();
   await page.getByText("Choose specific tests or runs (optional)",{exact:true}).click();
   await page.getByRole("combobox",{name:"Plan",exact:true}).selectOption("plan-synthetic");
   await page.getByRole("combobox",{name:"Execution window",exact:true}).selectOption("custom");
   await page.getByLabel("Start date (UTC)",{exact:true}).fill("2026-10-10");await page.getByLabel("End date (UTC, inclusive)",{exact:true}).fill("2026-10-09");
   check(await page.getByRole("button",{name:actionName("Continue"),exact:true}).isDisabled(),"Reversed dates remain blocked");
   await page.getByLabel("End date (UTC, inclusive)",{exact:true}).fill("2026-10-20");await overflow(page);
   await page.screenshot({path:path.join(output,`content-${theme}-${width}.png`),fullPage:true});await next(page);
   await page.getByLabel("Summary (optional)",{exact:true}).fill("Synthetic summary kept through closing.");
   await page.getByLabel("Risks and blockers (optional)",{exact:true}).fill("One synthetic blocker to review.");
   await page.getByLabel("Next actions (optional)",{exact:true}).fill("Review remaining recorded checks.");
   await overflow(page);await page.screenshot({path:path.join(output,`notes-${theme}-${width}.png`),fullPage:true});
   await page.getByRole("button",{name:actionName("Close report builder"),exact:true}).click();await page.getByRole("button",{name:actionName("Resume local report draft"),exact:true}).click();
   await page.getByRole("dialog").waitFor(); await writeFile(path.join(output,"reopen-state.txt"),await page.locator("body").innerText()); await page.screenshot({path:path.join(output,"reopen-state.png"),fullPage:true});
   check(await page.getByLabel("Summary (optional)",{exact:true}).inputValue()==="Synthetic summary kept through closing.","Close/reopen retains notes and current step");
   await page.getByRole("button",{name:actionName("Save private preview"),exact:true}).click();
   await page.getByRole("heading",{name:"Review before sharing",exact:true}).waitFor();check(await page.locator(".quality-visual").count()===6,"Preview shows all six selected charts");await overflow(page);
   await page.screenshot({path:path.join(output,`review-${theme}-${width}.png`),fullPage:true});
   await page.getByRole("button",{name:actionName("Approve and share report"),exact:true}).click();await page.getByRole("dialog").waitFor({state:"hidden"});
   await trigger(page,"Show fixture approved report");
   check(await page.getByRole("button",{name:actionName("Download HTML"),exact:true}).isDisabled(),"Export still requires separate explicit review");
   await page.getByRole("checkbox",{name:/^I reviewed this report/}).check();
   const before=await chartModel(page);
   const [download]=await Promise.all([page.waitForEvent("download"),page.getByRole("button",{name:actionName("Download HTML"),exact:true}).click()]);
   const file=path.join(output,`report-${theme}-${width}.html`);await download.saveAs(file);const html=await readFile(file,"utf8");
   check(!/<script|<img|https?:\/\//i.test(html),"Portable report has no scripts or external assets");
   const portable=await browser.newPage({viewport:{width,height:1000}});try{await portable.route("**/*",r=>r.abort());await portable.setContent(html);
    assert.deepEqual(await chartModel(portable),before);checks++;
    check(await portable.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),"Portable HTML has no horizontal overflow");
    await portable.screenshot({path:path.join(output,`export-${theme}-${width}.png`),fullPage:true});
    if(width===1280){await portable.emulateMedia({media:"print"});await portable.screenshot({path:path.join(output,`print-${theme}.png`),fullPage:true});check(await portable.locator(".quality-visual").count()===6,"Print layout retains all chart figures");}
   }finally{await portable.close();}
   const calls=(await evidence(page)).calls;check(calls.filter(c=>c.path==="reportSnapshots.preview").length===1,"One private capture");check(calls.filter(c=>c.path==="reportSnapshots.approve").length===1,"One explicit sharing approval");
   const input=calls.find(c=>c.path==="reportSnapshots.preview").input;assert.equal(input.definition.executionScope.planId,"plan-synthetic");assert.deepEqual(input.definition.dateInterval,{start:"2026-10-10",end:"2026-10-20"});assert.equal(input.definition.summary,"Synthetic summary kept through closing.");checks++;
  }finally{await page.close();}
 }
 const page=await open();try{
  await page.getByRole("button",{name:actionName("Create report"),exact:true}).click();await next(page);await page.getByLabel("Report title",{exact:true}).fill("Private retained title");
  await trigger(page,"Switch fixture actor");await page.getByRole("dialog").waitFor({state:"hidden"});check(await page.getByRole("dialog").count()===0,"Account switch hides original draft");
  await trigger(page,"Switch fixture actor");await page.getByRole("dialog").waitFor();check(await page.getByLabel("Report title",{exact:true}).inputValue()==="Private retained title","Original account restores retained draft");
  await next(page);await next(page);await trigger(page,"Lose next fixture preview");await page.getByRole("button",{name:actionName("Save private preview"),exact:true}).click();
  await page.getByRole("button",{name:actionName("Retry same preview"),exact:true}).waitFor();await page.getByRole("button",{name:actionName("Retry same preview"),exact:true}).click();await page.getByRole("heading",{name:"Review before sharing",exact:true}).waitFor();
  await page.getByRole("button",{name:actionName("Close report builder"),exact:true}).click();const calls=(await evidence(page)).calls;
  assert.equal(calls.length,2);assert.deepEqual(calls[0].input,calls[1].input);checks++;
 }finally{await page.close();}
 check(errors.length===0,"No browser errors: "+errors.join("; "));check(blocked.length===0,"No attempted provider or external requests");
 await writeFile(path.join(output,"review.json"),JSON.stringify({at:new Date().toISOString(),passed:true,checks,themes:["dark","light"],widths:[390,1280],actualComponents:true,syntheticTransport:true,liveCustomerData:false,hostedAcceptance:false,providerCalls:false,physicalDeviceRun:false},null,2)+"\n");console.log(JSON.stringify({passed:true,checks,output}));
}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
