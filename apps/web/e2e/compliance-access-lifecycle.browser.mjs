// Actual page/workflow/access hooks and tRPC React Query subscriptions; synthetic transport only.
/* global window, document */
import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
const require = createRequire(new URL("../package.json", import.meta.url));
const { chromium, expect } = require("@playwright/test");
const { build } = createRequire(createRequire(require.resolve("vitest")).resolve("vite"))("esbuild");
const root = fileURLToPath(new URL("../", import.meta.url));
const proof = resolve(process.env.VAETTIR_E2E_OUTPUT_DIR ?? fileURLToPath(new URL("../../../.local/compliance-access-lifecycle-20261030", import.meta.url)));
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  .replace(/^@import[^\r\n]*\r?\n/gm, "")
  + readFileSync(new URL("../app/workbench.css", import.meta.url), "utf8");
const boundary = `
import React,{useSyncExternalStore} from 'react';
import {createTRPCReact} from '@trpc/react-query';
import {observable} from '@trpc/server/observable';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
const listeners=new Set();let auth={isLoaded:true,isSignedIn:true,userId:'actor-a'};
export const state=window.fixture={requests:[],mutations:[],hold:false,denied:false,wrongActor:false,wrongOrg:false,canEdit:true,pending:[]};
export const useAuth=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>auth);
export const useParams=()=>({projectId:'project-a'});
export const useSearchParams=()=>new URLSearchParams();
const scope={projectId:'project-a',organizationId:'org-a',actorId:'native-a',actorClerkUserId:'actor-a'};
const unusedCase={id:'case-unused',title:'Unused synthetic music performance permission with territory and license evidence requiring review',reviewStatus:'PENDING_REVIEW',given:[],when:[],then:[],steps:[],tags:[]};
const draft={id:'draft-a',digest:'a'.repeat(64),state:'DRAFT',authorityGeneration:0,selection:[],receipt:null,fields:{schema:{version:1,fields:[]},version:0},scope:{scanned:2,total:2,omitted:0,archived:0,limit:2000,fields:'Synthetic procedure'},cases:[{id:'case-a',title:'Private synthetic case',reviewStatus:'PENDING_REVIEW',given:[],when:[],then:[],steps:[],tags:[]},unusedCase],proposals:[{controlId:'control-a',code:'SYNTH',title:'Private synthetic control',description:'Private criterion',existing:[],kind:'UNCERTAIN',matches:[{caseId:'case-a',title:'Private synthetic case',explanation:'Synthetic relevance',titleTerms:[],procedureTerms:[]}],outline:{title:'Synthetic case',prerequisite:'Synthetic setup',action:'Synthetic action',expectedResult:'Synthetic result',customFields:{}}}]};
function response(path,input){
 if(path==='caseFields.get')return {projectId:'project-a',organizationId:state.wrongOrg?'org-b':'org-a',caseId:null,readScope:{...scope,actorClerkUserId:state.wrongActor?'actor-b':'actor-a'},canEdit:state.canEdit,canConfigure:true};
 if(path==='project.byId')return {id:'project-a',organizationId:'org-a',qualityProfile:{complianceNeeds:[]}};
 if(path==='organization.mine')return [{id:'org-a',role:'OWNER',seatType:'FULL'}];
 if(path==='organization.byId')return {id:'org-a',dataRetentionYears:1};
 if(path==='compliance.reviewDrafts')return [{id:'draft-a',state:'DRAFT',createdAt:'2026-10-30T20:00:00Z'}];
 if(path==='compliance.reviewDraft')return draft;
 return [];
}
export const trpcReact=createTRPCReact();
const qc=new QueryClient({defaultOptions:{queries:{retry:false}}});
const client=trpcReact.createClient({links:[()=>({op})=>observable(observer=>{
 const entry={path:op.path,input:op.input,type:op.type};state.requests.push(entry);if(op.type==='mutation')state.mutations.push(entry);
 let canceled=false;
 const deliver=()=>{if(canceled)return;if(op.path==='caseFields.get'&&state.denied){observer.error(new Error('Synthetic access denied'));return;}observer.next({result:{data:response(op.path,op.input)}});observer.complete();};
 const timer=setTimeout(()=>{if(op.path==='caseFields.get'&&state.hold)state.pending.push(deliver);else deliver();},40);
 return()=>{canceled=true;clearTimeout(timer)};
})]});
state.refresh=()=>{void qc.invalidateQueries({predicate:q=>JSON.stringify(q.queryKey).includes('caseFields')});};
state.release=()=>{state.hold=false;const pending=state.pending.splice(0);pending.forEach(fn=>fn());};
state.actor=value=>{auth={...auth,userId:value};listeners.forEach(fn=>fn());};
export function Provider({children}){return <trpcReact.Provider client={client} queryClient={qc}><QueryClientProvider client={qc}>{children}</QueryClientProvider></trpcReact.Provider>;}
`;
const bundle = await build({
  stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';import Page from './app/projects/[projectId]/compliance/page';import {Provider} from 'fixture-boundary';createRoot(document.getElementById('root')).render(<Provider><Page/></Provider>);`, resolveDir: root, loader: "tsx" },
  bundle: true, write: false, platform: "browser", jsx: "automatic",
  define: { "process.env.NODE_ENV": '"development"' },
  plugins: [{ name: "synthetic-transport", setup(b) {
    b.onResolve({filter:/^(fixture-boundary|@clerk\/nextjs|next\/navigation|@\/lib\/trpcReact|\.\/trpcReact)$/},()=>({path:'boundary',namespace:'fixture'}));
    b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:boundary,resolveDir:root,loader:'tsx'}));
    b.onResolve({filter:/^@\//},args=>{const p=resolve(root,args.path.slice(2));return {path:existsSync(p+'.tsx')?p+'.tsx':p+'.ts'};});
  }}],
});
test("real compliance parent and child access settle and retain private review through revalidation", async () => {
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>');});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({viewport:{width:390,height:1000},hasTouch:true});const errors=[],external=[],responsive=[];
  page.on('pageerror',e=>errors.push(String(e)));
  await page.route('**/*',route=>{if(new URL(route.request().url()).origin!==origin){external.push(route.request().url());return route.abort();}return route.continue();});
  try {
    await page.goto(origin);
    await page.addStyleTag({content:css});
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    // A sustained observation catches the repeated 2-read child bootstrap storm.
    await page.waitForTimeout(1800);
    const bootstrap=await page.evaluate(()=>window.fixture.requests.filter(x=>x.path==='caseFields.get'));
    mkdirSync(proof,{recursive:true});writeFileSync(resolve(proof,'bootstrap.json'),JSON.stringify({bootstrap,errors,external},null,2));
    assert.ok(bootstrap.length<=4, 'Access bootstrap must settle; received '+bootstrap.length+' caseFields requests');
    await expect(page.getByRole('heading',{name:'Review coverage',exact:true})).toBeVisible();
    await page.getByRole('button',{name:'Open',exact:true}).click();
    const additional=page.getByRole('combobox',{name:'Additional scanned case',exact:true});
    await expect(additional.locator('option[value="case-unused"]')).toHaveText('Unused synthetic music performance permission with territory and license evidence requiring review');
    await expect(additional).toHaveValue('');
    // Native select intrinsic width must not let an unused long option widen the page.
    for(const theme of ['light','dark']){
      await page.evaluate(t=>{document.documentElement.dataset.theme=t;},theme);
      for(const width of [390,1280]){
        await page.setViewportSize({width,height:1000});
        const layout=await additional.evaluate(el=>{const box=el.getBoundingClientRect();return {viewport:window.innerWidth,clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,selectX:box.x,selectWidth:box.width,selectRight:box.right};});
        responsive.push({theme,width,...layout});
        writeFileSync(resolve(proof,'responsive.json'),JSON.stringify(responsive,null,2));
        await page.screenshot({path:resolve(proof,`review-${theme}-${width}.png`),fullPage:true});
        assert.ok(layout.selectX>=0&&layout.selectRight<=layout.clientWidth+1,'Additional scanned case must fit viewport: '+JSON.stringify(layout));
        assert.ok(layout.scrollWidth<=layout.clientWidth,'Long unused case option must not overflow page: '+JSON.stringify(layout));
      }
    }
    await page.setViewportSize({width:390,height:1000});
    const selected=page.getByRole('checkbox',{name:'Private synthetic case',exact:true});
    await selected.check();
    await page.evaluate(()=>{window.fixture.hold=true;window.fixture.refresh();});
    await expect(page.getByText('Compliance review drafts are hidden until original editor access is verified.',{exact:true})).toBeVisible();
    await expect(page.getByText('Private synthetic control',{exact:false})).toHaveCount(0);
    await expect(selected).toHaveCount(0);
    await page.evaluate(()=>window.fixture.release());
    await expect(selected).toBeChecked();
    // A server refusal and a read-only seat hide retained state without rebinding it.
    for(const flag of ['denied','wrongActor','wrongOrg','canEdit']){
      await page.evaluate(flag=>{window.fixture[flag]=flag!=='canEdit';window.fixture.refresh();},flag);
      await expect(selected).toHaveCount(0);
      await page.waitForTimeout(150);
      await expect(page.getByRole('button',{name:'Apply',exact:true})).toHaveCount(0);
      await page.evaluate(flag=>{window.fixture[flag]=flag==='canEdit';window.fixture.refresh();},flag);
      await expect(selected).toBeChecked();
    }
    await page.evaluate(()=>window.fixture.actor('actor-b'));
    await expect(selected).toHaveCount(0);
    await page.evaluate(()=>{window.fixture.actor('actor-a');window.fixture.hold=true;window.fixture.refresh();});
    await expect(selected).toHaveCount(0);
    await page.evaluate(()=>window.fixture.release());
    await expect(selected).toBeChecked();
    const before=await page.evaluate(()=>window.fixture.requests.filter(x=>x.path==='caseFields.get').length);
    await page.waitForTimeout(600);
    assert.equal(await page.evaluate(()=>window.fixture.requests.filter(x=>x.path==='caseFields.get').length),before);
    assert.deepEqual(await page.evaluate(()=>window.fixture.mutations),[]);
    assert.deepEqual(errors,[]);assert.deepEqual(external,[]);
    writeFileSync(resolve(proof,'acceptance.json'),JSON.stringify({passed:true,bootstrapRequests:bootstrap.length,finalRequests:before,realPage:true,realWorkflow:true,realAccessHook:true,realTrpcReactQuery:true,privateHiddenAndSelectionRetained:true,longUnusedOptionResponsive:responsive,errors,external},null,2));
  } finally {await browser.close();await new Promise(r=>server.close(r));}
});
