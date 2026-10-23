// Actual modal/controller with synthetic request scheduling. No AI/network or
// authenticated browser acceptance is implied by these rendered checks.
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {expect,it,vi} from "vitest";

type Element=React.ReactElement<Record<string,unknown>>;
function elements(value:unknown):Element[]{if(Array.isArray(value))return value.flatMap(elements);if(!React.isValidElement(value))return [];const node=value as Element;return [node,...elements(node.props.children)];}
function text(value:unknown):string{return typeof value==="string"||typeof value==="number"?String(value):Array.isArray(value)?value.map(text).join(""):React.isValidElement(value)?text((value as Element).props.children):"";}
function fixture(){
  const source=readFileSync(new URL("../app/projects/[projectId]/test-plans/page.tsx",import.meta.url),"utf8"),ast=ts.createSourceFile("plans.tsx",source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const component=ast.statements.filter(ts.isFunctionDeclaration).find(node=>node.name?.text==="GenerateStrategyModal");if(!component)throw Error("Actual strategy modal required");
  const output=ts.transpileModule(component.getText(ast),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText;
  const slots:unknown[]=[];let cursor=0;const useState=(initial:unknown)=>{const index=cursor++;if(!(index in slots))slots[index]=initial;return[slots[index],(value:unknown)=>{slots[index]=value;}];};
  let outcome:()=>Promise<unknown>=async()=>({testPlanTypeId:"functional",riskAreas:["Payments"],environments:["Desktop"],entryCriteria:["Build available"],exitCriteria:["Cases pass"]});
  const generate={isPending:false,mutateAsync:vi.fn(async()=>{generate.isPending=true;try{return await outcome();}finally{generate.isPending=false;}})},create={isPending:false,mutateAsync:vi.fn(async()=>undefined)};
  const trpcReact={testPlans:{generateStrategyDraft:{useMutation:()=>generate},create:{useMutation:()=>create}}};
  const Modal=({open,children}:{open:boolean;children:React.ReactNode})=>open?React.createElement("div",null,children):null;
  const actual=new Function("React","useState","trpcReact","Modal",output+";return GenerateStrategyModal;")(React,useState,trpcReact,Modal) as (props:Record<string,unknown>)=>React.ReactNode;
  const props={open:true,onClose:vi.fn(),projectId:"synthetic-project",projectRepo:null,onCreated:vi.fn()};
  const render=()=>{cursor=0;return actual(props);};
  const button=(tree:unknown,label:string)=>elements(tree).find(node=>node.type==="button"&&text(node.props.children)===label)!;
  function prompt(value:string){const input=elements(render()).find(node=>node.type==="textarea")!;(input.props.onChange as (event:unknown)=>void)({target:{value}});}
  const submit=()=>{const node=button(render(),"Generate draft");return(node.props.onClick as ()=>Promise<void>)();};
  const html=()=>renderToStaticMarkup(render() as React.ReactElement);
  return{render,html,prompt,submit,button,generate,create,props,setOutcome:(next:typeof outcome)=>{outcome=next;}};
}
it("idle generation has no progress indicator or claimed percentage",()=>{const f=fixture();expect(elements(f.render()).some(x=>x.props.role==="progressbar")).toBe(false);expect(f.html()).not.toContain("Building your plan draft");});
it("real pending request shows visible accessible indeterminate progress until the draft arrives",async()=>{
  const f=fixture();let finish!:(value:unknown)=>void;f.setOutcome(()=>new Promise(resolve=>{finish=resolve;}));f.prompt("Reviewed checkout evidence");const request=f.submit();
  const tree=f.render(),progress=elements(tree).find(x=>x.props.role==="progressbar")!;expect(progress).toBeDefined();expect(progress.props["aria-label"]).toBe("Plan generation");expect(progress.props["aria-valuenow"]).toBeUndefined();expect(progress.props["aria-valuetext"]).toContain("percentage is not available");expect(text(tree)).toContain("up to three minutes");
  expect(elements(tree).find(x=>x.props.role==="status")?.props["aria-live"]).toBe("polite");expect(f.button(tree,"Generating…").props.disabled).toBe(true);expect(f.button(tree,"Generating…").props["aria-busy"]).toBe(true);expect(f.html()).toContain('class="plan-generation-progress"');expect(f.generate.mutateAsync).toHaveBeenCalledOnce();
  finish({testPlanTypeId:"functional",riskAreas:["Payments"],environments:[],entryCriteria:[],exitCriteria:[]});await request;expect(f.html()).not.toContain('role="progressbar"');expect(text(f.render())).toContain("Your plan draft is ready to review");expect(f.create.mutateAsync).not.toHaveBeenCalled();
});
it("failure clears progress, announces the error and retains the prompt without automatic retries",async()=>{
  const f=fixture();f.prompt("Retain this prompt");f.setOutcome(async()=>{throw Error("Synthetic generation unavailable");});await f.submit();const tree=f.render();expect(elements(tree).some(x=>x.props.role==="progressbar")).toBe(false);expect(text(elements(tree).find(x=>x.props.role==="alert"))).toContain("Synthetic generation unavailable");expect(elements(tree).find(x=>x.type==="textarea")?.props.value).toBe("Retain this prompt");expect(f.button(tree,"Generate draft").props.disabled).toBe(false);expect(f.generate.mutateAsync).toHaveBeenCalledOnce();expect(f.create.mutateAsync).not.toHaveBeenCalled();
});
it("a new pending generation never announces the old draft as ready and disables its create action",async()=>{
  const f=fixture();f.prompt("Original prompt");await f.submit();expect(text(f.render())).toContain("ready to review");let finish!:()=>void;f.setOutcome(()=>new Promise(resolve=>{finish=()=>resolve({testPlanTypeId:"functional",riskAreas:[],environments:[],entryCriteria:[],exitCriteria:[]});}));const request=f.submit();const tree=f.render();expect(text(tree)).not.toContain("ready to review");expect(f.button(tree,"Create QA strategy plan").props.disabled).toBe(true);finish();await request;
});
it("closing/reopening only changes visibility, not the in-flight request or an inferred cancellation",async()=>{
  const f=fixture();f.prompt("Original prompt");let finish!:()=>void;f.setOutcome(()=>new Promise(resolve=>{finish=()=>resolve({testPlanTypeId:"functional",riskAreas:[],environments:[],entryCriteria:[],exitCriteria:[]});}));const request=f.submit();f.props.open=false;expect(f.html()).toBe("");f.props.open=true;expect(f.html()).toContain('role="progressbar"');expect(f.generate.mutateAsync).toHaveBeenCalledOnce();finish();await request;
});
it("the actual progress styles include scoped reduced-motion and clipped responsive movement",()=>{
  const css=readFileSync(new URL("../app/globals.css",import.meta.url),"utf8");expect(css).toMatch(/\.plan-generation-progress\s*\{[^}]*overflow:\s*hidden/s);expect(css).toMatch(/\.plan-generation-status\s*\{[^}]*min-width:\s*0/s);expect(css).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{\s*\.plan-generation-status \.loading-indicator,\s*\.plan-generation-progress span\s*\{\s*animation:\s*none/s);
});
