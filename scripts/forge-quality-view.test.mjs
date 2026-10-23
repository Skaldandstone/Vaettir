import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import {test} from 'node:test';
const require=createRequire(new URL('../apps/web/package.json',import.meta.url));
const React=require('react'),{renderToStaticMarkup}=require('react-dom/server'),ts=require('typescript');
const source=readFileSync(new URL('../integrations/atlassian/src/quality.tsx',import.meta.url),'utf8');
const ast=ts.createSourceFile('quality.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
const printer=ts.createPrinter();
const code=ast.statements.filter(n=>!ts.isImportDeclaration(n)).map(n=>printer.printNode(ts.EmitHint.Unspecified,n,ast)).join('\n').replace(/export function /g,'function ');
function render(kind,execution={},visuals){
 const charts=[],bars=[],cards=[];
 const simple=tag=>({children})=>React.createElement(tag,null,children);
 const context=vm.createContext({React,useState:React.useState,useEffect:React.useEffect,xcss:x=>x,
  createQualityTransport:()=>({}),invokeRemote:()=>{throw Error('No network allowed')},
  Box:({children,backgroundColor})=>{if(backgroundColor)cards.push(backgroundColor);return React.createElement('section',null,children)},
  Heading:({as,children})=>React.createElement(as,null,children),Text:simple('p'),Stack:simple('div'),Inline:simple('div'),Lozenge:simple('span'),HelperMessage:simple('small'),
  SectionMessage:({title,children})=>React.createElement('section',null,React.createElement('h3',null,title),children),
  Button:simple('button'),Link:({href,children})=>React.createElement('a',{href},children),Select:()=>null,
  DonutChart:props=>{charts.push(props);return React.createElement('figure',{'aria-label':props.title})},
  HorizontalBarChart:props=>{charts.push(props);return React.createElement('figure',{'aria-label':props.title})},
  ProgressBar:props=>{bars.push(props.value);return React.createElement('progress',{value:props.value,max:1})},
 });
 vm.runInContext(ts.transpileModule(code+'\nthis.views={QualitySnapshotView,ReleaseView};',{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText,context);
 const quality={protocol:'vaettir-quality/v1',mode:'LATEST_APPROVED',reportUrl:'https://example.invalid/report',runLinks:[],available:[],notice:'Synthetic notice',snapshot:{title:'Synthetic review',projectName:'Synthetic project',asOf:'2026-10-16T00:00:00Z',limitations:['Detailed caveat should be behind disclosure'],execution:{runs:0,results:0,distinctCases:0,outcomes:[],...execution}}};
 const release={protocol:'vaettir-release-quality/v1',mode:'LIVE',releaseName:'Synthetic release',jiraVersionName:'1.0',capturedAt:'2026-10-16T00:00:00Z',notice:'Synthetic notice',counts:{planned:0,recorded:0,pass:0,fail:0,blocked:0,skipped:0,flaky:0,mixed:0,ambiguous:0,notRecorded:0},tests:[],runs:[],risks:[],recordedFailures:0,failedRuns:0,unmatchedObservations:0,outsideCohortObservations:0,totalAttention:0,...execution};
 return {html:renderToStaticMarkup(React.createElement(context.views[kind],{data:{...(kind==='ReleaseView'?release:quality),visuals}})),charts,bars,cards};
}
test('native views display Vaettir-owned chart rows without calculating replacement metrics',()=>{
 const rows=[{label:'Automated',value:7,color:'#337CB8'},{label:'Manual',value:3,color:'#8264CF'}];
 const visuals={version:1,charts:[{id:'automation',title:'Automation mix',kind:'donut',unit:'cases',note:'Recorded labels',empty:'No labels',rows},{id:'priority',title:'Test priority',kind:'bars',unit:'cases',note:'Captured priorities',empty:'No priorities',rows}]};
 for(const kind of ['QualitySnapshotView','ReleaseView']){
  const view=render(kind,{},visuals);
  assert.equal(view.charts.length,2);assert.deepEqual(JSON.parse(JSON.stringify(view.charts[0].data)),rows);
  assert.deepEqual(JSON.parse(JSON.stringify(view.charts[1].data)),rows);
  assert.equal(view.cards.length,0);assert.deepEqual(view.bars,[]);assert.match(view.html,/Automation mix/);
 }
});
test('empty approved capture has visual metric sections but no invented donut or zero-denominator progress',()=>{
 const view=render('QualitySnapshotView',{plannedCaseRunPairs:0,notRecordedCaseRunPairs:0});
 assert.match(view.html,/No results yet/);assert.match(view.html,/Readiness has not been assessed/);
 assert.match(view.html,/Failed observations/);assert.match(view.html,/Validation runs/);
 assert.equal(view.charts.length,0);assert.deepEqual(view.bars,[]);assert.equal(view.cards.length,4);
 assert.doesNotMatch(view.html,/Detailed caveat should be behind disclosure/);assert.match(view.html,/About these metrics and limitations/);
});
test('populated approved capture renders exact outcomes and planning denominator, not a pass-rate readiness claim',()=>{
 const view=render('QualitySnapshotView',{runs:2,results:9,distinctCases:6,outcomes:[{key:'PASS',count:5},{key:'FAIL',count:3},{key:'BLOCKED',count:1},{key:'SKIP',count:0}],plannedCaseRunPairs:12,notRecordedCaseRunPairs:4});
 assert.equal(view.charts.length,1);assert.deepEqual(JSON.parse(JSON.stringify(view.charts[0].data)),[{outcome:'Pass',count:5},{outcome:'Fail',count:3},{outcome:'Blocked',count:1}]);
 assert.equal(view.bars[0],1-4/12);assert.match(view.html,/8.*of.*12.*planned case\/run pairs/);
});
test('missing or inconsistent planning counts cannot be presented as full progress',()=>{
 for(const counts of [{plannedCaseRunPairs:12},{plannedCaseRunPairs:12,notRecordedCaseRunPairs:15},{notRecordedCaseRunPairs:0}]){
  const view=render('QualitySnapshotView',counts);assert.deepEqual(view.bars,[]);assert.match(view.html,/Planned progress is unavailable/);
 }
});
test('empty release has metric sections and an actionable unassessed state instead of 0 of 0 progress',()=>{
 const view=render('ReleaseView');assert.equal(view.cards.length,4);assert.deepEqual(view.bars,[]);assert.equal(view.charts.length,0);assert.match(view.html,/No planned tests yet/);
});
test('Jira released but missing capture remains explicitly current, not historical',()=>{
 const view=render('ReleaseView',{mode:'RELEASED_CAPTURE_UNAVAILABLE'});assert.match(view.html,/Historical capture unavailable/);assert.match(view.html,/current, not reconstructed/);
});
