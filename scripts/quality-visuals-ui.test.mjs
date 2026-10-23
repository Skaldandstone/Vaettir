import assert from 'node:assert/strict';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {test} from 'node:test';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),ts=require('typescript'),{chromium}=require('@playwright/test');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function compile(path){
 const ast=ts.createSourceFile(path,read(path),ts.ScriptTarget.Latest,true,path.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS),printer=ts.createPrinter();
 const code=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast)).join('\n').replace(/export /g,'');
 return ts.transpileModule(code,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
}
const context=vm.createContext({React});
vm.runInContext(compile('packages/core/src/qualityVisuals.ts')+compile('apps/web/components/QualityVisualReport.tsx')+'\nthis.view=QualityVisualReport;this.build=buildQualityVisualReport;',context);
const source={definition:{sections:['automation','execution','inventory','traceability']},inventory:{active:10,automation:[{key:'AUTOMATED',count:7},{key:'MANUAL',count:3}],priority:[{key:'HIGH',count:4},{key:'MEDIUM',count:6}]},execution:{results:12,distinctCases:8,outcomes:[{key:'PASS',count:8},{key:'FAIL',count:3},{key:'BLOCKED',count:1}],plannedCaseRunPairs:15,notRecordedCaseRunPairs:3},traceability:{requirements:8,coveredRequirements:6}};
test('actual Vaettir charts render data, empty states and responsive layouts in both themes',async()=>{
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage();await page.route('**/*',r=>r.abort());
 for(const empty of [false,true])for(const theme of ['light','dark'])for(const width of [390,1280]){
  const data=empty?{...source,inventory:{active:0},execution:{results:0,distinctCases:0,outcomes:[]},traceability:{requirements:0,coveredRequirements:0}}:source;
  const html=renderToStaticMarkup(React.createElement(context.view,{model:context.build(data)}));
  await page.setViewportSize({width,height:1000});
  await page.setContent(`<!doctype html><html data-theme="${theme}"><head><style>${read('apps/web/app/globals.css').replace(/^@import.*$/m,'')}</style></head><body><main style="padding:24px;max-width:1280px;margin:auto"><h1>Quality Intelligence</h1><p>Synthetic visual verification</p>${html}</main></body></html>`);
  assert.equal(await page.locator('.quality-visual').count(),6);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  assert.equal(await page.locator('svg').count(),6);
  if(empty)assert.equal(await page.locator('circle[stroke-dasharray]').count(),0);
  else {assert.ok(await page.locator('circle[stroke-dasharray]').count()>6);assert.match(await page.locator('body').innerText(),/case\/run pairs/);assert.match(await page.locator('body').innerText(),/requirements/);}
  if(process.env.VAETTIR_UI_SCREENSHOTS){mkdirSync('.local/ui-overhaul',{recursive:true});await page.screenshot({path:`.local/ui-overhaul/quality-visuals-${empty?'empty':'data'}-${theme}-${width}.png`,fullPage:true});}
 }
 }finally{await browser.close()}
});
