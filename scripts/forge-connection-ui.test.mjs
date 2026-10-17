// Actual ReactDOM interaction test with synthetic Clerk/RPC boundaries.
// No external network, browser profile, real sign-in or customer write is used.
/* global calls, document, mode:writable, auth:writable, catalog:writable, redraw, finish */
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {after,before,test} from 'node:test';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const ts=require('typescript'),{chromium}=require('@playwright/test');
const source=readFileSync(new URL('../apps/web/components/AtlassianConnectWorkflow.tsx',import.meta.url),'utf8');
let compiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText;
compiled=compiled.replace(/^import .* from "react";$/m,'const {useEffect,useRef,useState}=React;')
 .replace(/^import .* from "@clerk\/nextjs";$/m,'const useAuth=()=>window.auth;')
 .replace(/^import .* from "next\/navigation";$/m,'const useSearchParams=()=>new URLSearchParams("request="+window.token);')
 .replace(/^import .* from "@\/lib\/trpcReact";$/m,'const trpcReact=window.trpc;');
assert.ok(!/^\s*import /m.test(compiled),'All external imports must be mocked');
const scripts={
 '/react.js':readFileSync(join(dirname(require.resolve('react/package.json')),'umd/react.development.js')),
 '/react-dom.js':readFileSync(join(dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js')),
};
const boot=`
window.token='x'.repeat(90);
window.auth={userId:'human-a',sessionId:'session-a',isLoaded:true,isSignedIn:true};
window.calls=[]; window.mode='ok';
window.catalog={actorClerkUserId:'human-a',requestDigest:'digest-a',targetLabel:'Company Jira (DEMO)',expiresAt:'2099-01-01T00:00:00.000Z',
 binding:{siteOrigin:'https://company.atlassian.net',product:'jira'},organizations:[{id:'org-a',name:'Company'}],
 projects:[{id:'project-one',organizationId:'org-a',name:'Synthetic one'},{id:'project-two',organizationId:'org-a',name:'Synthetic two'}],catalogLimited:false};
const optionsCall=async input=>{window.calls.push(['options',input]);return structuredClone(window.catalog)};
const connectCall=async input=>{
 window.calls.push(['connect',input]);
 const response={actorClerkUserId:input.expectedClerkActorId,organizationId:input.organizationId,projectId:input.projectId,requestDigest:'digest-a',connectionKey:'synthetic-key',state:window.mode==='revoked'?'REVOKED':'APPROVED'};
 if(window.mode==='lost'){window.mode='ok';throw Error('Synthetic lost response')}
 if(window.mode==='deferred')return new Promise(resolve=>window.finish=()=>resolve(response));
 return response;
};
function mutation(call){const[isPending,setPending]=React.useState(false);const mutateAsync=React.useCallback(async input=>{setPending(true);try{return await call(input)}finally{setPending(false)}},[]);return{isPending,mutateAsync}}
window.trpc={atlassianQuality:{connectionOptions:{useMutation:()=>mutation(optionsCall)},connectProject:{useMutation:()=>mutation(connectCall)}}};
`;
const html=`<!doctype html><html><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script>${boot}</script><script type="module">${compiled}
const root=ReactDOM.createRoot(document.getElementById('root'));window.redraw=()=>root.render(React.createElement(AtlassianConnectWorkflow));window.redraw();</script></body></html>`;
let server,browser,origin;
before(async()=>{
 server=createServer((request,response)=>{response.setHeader('content-type',scripts[request.url]?'application/javascript':'text/html');response.end(scripts[request.url]??html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
const projectSelect=p=>p.getByRole('combobox',{name:/^Vaettir project/});
async function page(){const p=await browser.newPage();p.setDefaultTimeout(5000);p.on('pageerror',error=>console.error('Synthetic browser error: '+error.message));await p.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());await p.goto(origin);try{await projectSelect(p).waitFor()}catch(error){console.error(await p.locator('body').innerText());await p.close();throw error}return p}
test('requires a specific choice, displays consent and connects only that project',async()=>{
 const p=await page();try{
 assert.equal(await p.getByRole('button',{name:'Connect project',exact:true}).isEnabled(),false);
 assert.equal(await p.evaluate(()=>calls.filter(c=>c[0]==='connect').length),0);
 await projectSelect(p).selectOption('project-two');
 await p.getByRole('heading',{name:'Read-only access for Synthetic two'}).waitFor();
 await p.getByRole('button',{name:'Connect project',exact:true}).click();
 await p.getByRole('heading',{name:'Project connected',exact:true}).waitFor();
 assert.equal(await p.evaluate(()=>calls.find(c=>c[0]==='connect')[1].projectId),'project-two');
 assert.match(await p.getByRole('link',{name:'Manage this project’s connection'}).getAttribute('href'),/\/projects\/project-two\/settings\/integrations/);
 }finally{await p.close()}
});
test('filtering retains focus and never turns a stale selection into a different project',async()=>{
 const p=await page();try{
 await projectSelect(p).selectOption('project-one');
 await p.getByLabel('Find a project').fill('Synthetic');
 assert.equal(await p.getByLabel('Find a project').evaluate(el=>el===document.activeElement),true);
 await p.waitForTimeout(350);
 assert.equal(await p.getByLabel('Find a project').evaluate(el=>el===document.activeElement),true);
 assert.equal(await p.evaluate(()=>calls.filter(c=>c[0]==='connect').length),0);
 }finally{await p.close()}
});
test('a lost response locks the project and retries the exact request, without reviving revoked sharing',async()=>{
 const p=await page();try{
 await projectSelect(p).selectOption('project-one');await p.evaluate(()=>mode='lost');
 await p.getByRole('button',{name:'Connect project',exact:true}).click();
 await p.getByRole('button',{name:'Confirm connection status',exact:true}).waitFor();
 assert.equal(await projectSelect(p).isEnabled(),false);
 await p.evaluate(()=>mode='revoked');await p.getByRole('button',{name:'Confirm connection status',exact:true}).click();
 await p.getByRole('heading',{name:'Connection is stopped',exact:true}).waitFor();
 const inputs=await p.evaluate(()=>calls.filter(c=>c[0]==='connect').map(c=>c[1]));assert.equal(inputs.length,2);assert.deepEqual(inputs[0],inputs[1]);
 }finally{await p.close()}
});
test('an account switch hides a late acknowledgement and cannot adopt the retained save',async()=>{
 const p=await page();try{
 await projectSelect(p).selectOption('project-one');await p.evaluate(()=>mode='deferred');
 await p.getByRole('button',{name:'Connect project',exact:true}).click();await p.waitForFunction(()=>typeof finish==='function');
 await p.evaluate(()=>{auth={...auth,userId:'human-b',sessionId:'session-b'};catalog={...catalog,actorClerkUserId:'human-b'};redraw();finish()});
 await p.waitForTimeout(400);assert.equal(await p.getByRole('heading',{name:'Project connected',exact:true}).count(),0);
 assert.equal(await p.evaluate(()=>calls.filter(c=>c[0]==='connect').length),1);
 }finally{await p.close()}
});
