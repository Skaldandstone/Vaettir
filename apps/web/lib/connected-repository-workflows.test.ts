import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { it, expect } from "vitest";

function fixture(state:{isSuccess:boolean;isFetching?:boolean;isPaused?:boolean;error?:unknown;data?:unknown[]},readable=true) {
  const file=readFileSync(new URL("../components/ConnectedRepositoryPicker.tsx",import.meta.url),"utf8");
  const ast=ts.createSourceFile("picker.tsx",file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),printer=ts.createPrinter();
  const changes:unknown[]=[];const reads:unknown[]=[];
  const sandbox={React,Link:({children,...props}:{children:React.ReactNode})=>React.createElement("a",props,children),
    SourceConnectionChips:()=>React.createElement("button",null,"Connect repo"),useCaseFieldAccess:()=>({readable,origin:{projectId:"synthetic"},owns:()=>readable}),
    trpcReact:{project:{repositories:{useQuery:(input:unknown)=>{reads.push(input);return state;}}}},
  };
  vm.createContext(sandbox);const declarations=ast.statements.filter(ts.isFunctionDeclaration).map(node=>printer.printNode(ts.EmitHint.Unspecified,node,ast).replace("export function","function")).join("\n");
  vm.runInContext(ts.transpileModule(declarations+"\nthis.actual=ConnectedRepositoryPicker;",{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,sandbox);
  const render=(sandbox as typeof sandbox&{actual:(props:unknown)=>React.ReactElement}).actual;
  const element=render({projectId:"synthetic",selectedId:"repo-2",onSelect:(value:unknown)=>changes.push(value)});
  return {element,html:renderToStaticMarkup(element),changes,reads};
}
function descendants(node:React.ReactNode):React.ReactElement[]{return React.isValidElement(node)?[node,...React.Children.toArray((node.props as {children?:React.ReactNode}).children).flatMap(descendants)]:[];}
const repositories=Array.from({length:14},(_,i)=>({id:`repo-${i}`,projectId:"synthetic",provider:"gitlab",url:`https://gitlab.synthetic.example/microservices/service-${i}`,accessVerified:true,revision:null}));
it("actual shared picker recognizes every connected microservice and offers no reconnect button",()=>{
  const rendered=fixture({isSuccess:true,data:repositories});expect(rendered.html).toContain("14 project repositories");expect(rendered.html.match(/<option/g)).toHaveLength(15);expect(rendered.html).not.toContain("Connect repo</button>");expect(rendered.html).toContain("No reconnect required");expect(rendered.reads).toEqual([{projectId:"synthetic"}]);
});
it("selection returns the registered object, never constructs an arbitrary URL or authorizes a provider",()=>{
  const rendered=fixture({isSuccess:true,data:repositories});const select=descendants(rendered.element).find(node=>node.type==="select")!;
  (select.props as {onChange:(event:unknown)=>void}).onChange({target:{value:"repo-5"}});expect(rendered.changes).toEqual([repositories[5]]);
  (select.props as {onChange:(event:unknown)=>void}).onChange({target:{value:"foreign"}});expect(rendered.changes[1]).toBe(null);
});
it("cached repository names are withheld on errors, refetch, pause and original access loss",()=>{
  for(const state of [{isSuccess:true,data:repositories,isFetching:true},{isSuccess:true,data:repositories,isPaused:true},{isSuccess:true,data:repositories,error:Error("stale")},{isSuccess:false,data:repositories}])expect(fixture(state).html).not.toContain("service-2");
  expect(fixture({isSuccess:true,data:repositories},false).html).not.toContain("service-2");
});
it("empty project alone offers connection setup, expired saved references remain visible",()=>{
  expect(fixture({isSuccess:true,data:[]}).html).toContain("No repositories connected");expect(fixture({isSuccess:true,data:[]}).html).toContain("Connect repo");
  const rows=repositories.map(repo=>({...repo,accessVerified:false}));const rendered=fixture({isSuccess:true,data:rows});expect(rendered.html).toContain("access needs review");expect(rendered.html).not.toContain("No repositories connected");
});
it("Reverse Engineer, Requirements and review use one project query rather than the legacy single URL gate",()=>{
  for(const name of ["reverse-engineer","requirements"]){const source=readFileSync(new URL(`../app/projects/[projectId]/${name}/page.tsx`,import.meta.url),"utf8");expect(source).toContain("<ConnectedRepositoryPicker");expect(source).toContain("selectedRepository?.id");expect(source).not.toMatch(/!projectRepoUrl\s*&&\s*<SourceConnectionChips|creationSource === "Connected repository" && !repoUrl/);}
  const review=readFileSync(new URL("../components/RepositoryProcessingReview.tsx",import.meta.url),"utf8");expect(review).toContain("<ConnectedRepositoryPicker");expect(review).toContain('selectedRepository?.provider==="gitlab"?{repositoryId:selectedRepository.id}');
});
it("source comparison is a separate explicitly approved no-AI action and requirement links remain distinct",()=>{
  const source=readFileSync(new URL("../components/RepositoryCoverageReview.tsx",import.meta.url),"utf8");expect(source).toContain("approveSourceRead:true");expect(source).not.toContain("approveAiProcessing:true");expect(source).toContain("Manual cases may still test the same behavior");expect(source).toContain("/requirement-coverage");expect(source).toContain("access.owns(original");
});
it("release discovery checks project references automatically in bounded batches, withholding stale metadata",()=>{
  const file=readFileSync(new URL("../components/RepositoryReleaseDiscovery.tsx",import.meta.url),"utf8");
  const ast=ts.createSourceFile("releases.tsx",file,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX),printer=ts.createPrinter();
  const declarations=ast.statements.filter(ts.isFunctionDeclaration).map(node=>printer.printNode(ts.EmitHint.Unspecified,node,ast).replace("export function","function")).join("\n");
  const data={projectId:"synthetic",offset:0,nextOffset:5,repositories:[{repositoryId:"repo-1",url:repositories[1]!.url,status:"CHECKED",releases:[{tag:"v1",name:"Synthetic release",url:repositories[1]!.url+"/-/releases/v1",commitSha:"a".repeat(40),releasedAt:"2026-10-09T12:00:00Z"}],hasMore:true}]};
  function render(overrides:Record<string,unknown>={},readable=true){
    const reads:unknown[]=[];const sandbox={React,useState:()=>[0,()=>{}],useCaseFieldAccess:()=>({readable,canEdit:readable,origin:null}),trpcReact:{repositoryIntelligence:{projectReleases:{useQuery:(input:unknown)=>{reads.push(input);return {data,isSuccess:true,isFetching:false,isPaused:false,error:null,...overrides};}}}}};
    vm.createContext(sandbox);vm.runInContext(ts.transpileModule(declarations+"\nthis.actual=ProjectReleaseBatch;",{compilerOptions:{jsx:ts.JsxEmit.React,target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None}}).outputText,sandbox);
    const element=(sandbox as typeof sandbox&{actual:(props:unknown)=>React.ReactElement}).actual({projectId:"synthetic"});return{html:renderToStaticMarkup(element),reads};
  }
  expect(render().reads).toEqual([{projectId:"synthetic",offset:0}]);expect(render().html).toContain("Synthetic release");expect(render().html).toContain("Next repositories");
  for(const state of [{isFetching:true},{isPaused:true},{error:Error("stale")},{data:{...data,projectId:"other"}},{data:{...data,offset:5}}])expect(render(state).html).not.toContain("Synthetic release");
  expect(render({},false).html).not.toContain("Synthetic release");
});
