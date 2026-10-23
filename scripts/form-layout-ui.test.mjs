import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync,mkdirSync} from 'node:fs';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {after,before,test} from 'node:test';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const ts=require('typescript'),{chromium}=require('@playwright/test');
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
function compile(source){
 const ast=ts.createSourceFile('fixture.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),printer=ts.createPrinter();
 const local=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast)).join('\n');
 return ts.transpileModule(local,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.React}}).outputText.replace(/export /g,'');
}
// Render the actual ReportBuilder commentary subtree, not a second form model.
// Auth, capture, save and publish handlers are outside this layout-only harness.
const report=read('apps/web/components/ReportBuilder.tsx');
const ast=ts.createSourceFile('ReportBuilder.tsx',report,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
let commentary;
function visit(node){
 if(ts.isJsxExpression(node)&&node.expression&&ts.isBinaryExpression(node.expression)&&node.expression.left.getText(ast)==='step === 3'&&node.expression.right.getText(ast).includes('className="report-commentary"'))commentary=node.expression.right.getText(ast);
 ts.forEachChild(node,visit);
}
visit(ast);assert.ok(commentary,'Actual commentary subtree exists');
const fixture=compile(`function Scenario(){
 const [definition,setDefinition]=useState({templateId:'quality-status',summary:'',risks:'',nextActions:''});const frozen=false,title='Synthetic stakeholder report';
 const [value,setValue]=useState('long');
 return <DialogFrame open={true} onClose={()=>{}} className="modal-panel" label="Create stakeholder report" style={{width:'min(900px, calc(100vw - 32px))',maxWidth:'calc(100vw - 32px)'}}>
 <div className="modal-header"><h2>Create stakeholder report</h2><button className="btn-secondary modal-close" aria-label="Close report builder">×</button></div>
 <div className="report-builder-content"><p className="eyebrow">Step 4 of 5 · Commentary</p>{${commentary}}
 <label>Release<ReadableSelect value={value} onChange={e=>setValue(e.target.value)}><option value="long">Synthetic release with a deliberately long descriptive name for verifying that the full selected text remains available on a narrow screen</option><option value="short">Short release</option></ReadableSelect></label>
 <div className="wizard-footer"><button className="btn-secondary">Back</button><button className="btn-secondary">Save definition</button><button className="btn-primary">Capture private preview</button></div></div></DialogFrame>;
}`);
const scripts={
 '/react.js':readFileSync(join(dirname(require.resolve('react/package.json')),'umd/react.development.js')),
 '/react-dom.js':readFileSync(join(dirname(require.resolve('react-dom/package.json')),'umd/react-dom.development.js')),
 '/styles.css':read('apps/web/app/globals.css').replace(/^@import.*$/m,'')+'\n'+read('apps/web/app/workbench.css'),
};
const html=`<!doctype html><html data-theme="dark"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles.css"></head><body><div id="root"></div><script src="/react.js"></script><script src="/react-dom.js"></script><script type="module">
const {useState,useEffect,useLayoutEffect,useRef,useSyncExternalStore}=React;const createPortal=ReactDOM.createPortal;
${compile(read('apps/web/components/ui/ReadableSelect.tsx'))}
${compile(read('apps/web/components/ui/DialogFrame.tsx'))}
${compile(read('apps/web/lib/report-templates.ts'))}
${fixture}
ReactDOM.createRoot(document.getElementById('root')).render(React.createElement(Scenario));</script></body></html>`;
let server,browser,origin;
before(async()=>{
 server=createServer((req,res)=>{res.setHeader('content-type',req.url==='/styles.css'?'text/css':scripts[req.url]?'application/javascript':'text/html');res.end(scripts[req.url]??html)});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));origin='http://127.0.0.1:'+server.address().port;browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();await new Promise(resolve=>server?.close(resolve))});
async function page(width=1280,height=1000){const p=await browser.newPage({viewport:{width,height}});p.setDefaultTimeout(5000);p.on('pageerror',e=>console.error(e.message));await p.route('**/*',r=>new URL(r.request().url()).origin===origin?r.continue():r.abort());await p.goto(origin);await p.getByRole('dialog').waitFor();return p}
test('actual report commentary fields stack full-width beneath their labels in both themes and viewport sizes',async()=>{
 const p=await page();try{
 for(const theme of ['light','dark'])for(const width of [390,1280]){
  await p.setViewportSize({width,height:1000});await p.evaluate(t=>document.documentElement.dataset.theme=t,theme);
  for(const title of ['Summary (optional)','Risks and impediments (optional)','Next actions (optional)']){
   const field=p.getByLabel(title,{exact:true});
   assert.equal(await field.evaluate(el=>{
    const field=el.getBoundingClientRect(),label=el.parentElement.getBoundingClientRect();const range=document.createRange();range.selectNodeContents(el.parentElement.firstChild);const text=range.getBoundingClientRect();
    return field.width>=label.width-1&&field.top>=text.bottom&&field.height>=112;
   }),true,title+' uses the label-above-control layout');
  }
  assert.equal(await p.getByRole('dialog').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
  if(process.env.VAETTIR_UI_SCREENSHOTS){mkdirSync('.local/ui-overhaul',{recursive:true});await p.getByRole('dialog').evaluate(el=>el.scrollTop=0);await p.screenshot({path:`.local/ui-overhaul/report-${theme}-${width}.png`,animations:'disabled'});}
 }
 }finally{await p.close()}
});
test('long selected values wrap in a full-value caption, while ordinary values do not duplicate text',async()=>{
 const p=await page(390);try{
 await p.locator('.readable-select-value').waitFor();
 assert.match(await p.locator('.readable-select-value').innerText(),/full selected text remains available/);
 assert.equal(await p.locator('.readable-select-value').evaluate(el=>el.scrollWidth<=el.clientWidth),true);
 await p.getByRole('combobox',{name:/^Release/}).selectOption('short');await p.locator('.readable-select-value').waitFor({state:'detached'});
 assert.equal(await p.getByRole('combobox',{name:/^Release/}).inputValue(),'short');
 }finally{await p.close()}
});
test('short-height dialogs retain scroll and keyboard access to all actions without horizontal overflow',async()=>{
 const p=await page(390,568);try{
 await p.getByRole('button',{name:'Capture private preview',exact:true}).focus();
 const bounds=await p.getByRole('button',{name:'Capture private preview',exact:true}).boundingBox();assert.ok(bounds.y>=0&&bounds.y+bounds.height<=568);
 assert.equal(await p.getByRole('dialog').evaluate(el=>el.scrollHeight>el.clientHeight&&el.scrollWidth<=el.clientWidth),true);
 await p.keyboard.press('Tab');await p.getByRole('button',{name:'Close report builder'}).evaluate(el=>{if(el!==document.activeElement)throw Error('Focus did not wrap inside native dialog')});
 }finally{await p.close()}
});
