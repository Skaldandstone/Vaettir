// Whole actual TSX controller and callbacks, with modeled hook scheduling and
// synthetic native/SDK boundaries. Not browser, provider or live acceptance.
import {readFileSync} from "node:fs";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
import {expect,it,vi} from "vitest";
import {currentSessionScope,sameAuthScope} from "./auth-query-cache";
import {retainedTraceabilityReceipt} from "./traceability-receipt";

type Element=React.ReactElement<Record<string,unknown>>;
function elements(value:unknown,result:Element[]=[]):Element[]{if(React.isValidElement(value)){const element=value as Element;result.push(element);elements(element.props.children,result);}else if(Array.isArray(value))for(const child of value)elements(child,result);return result;}
function text(value:unknown):string{return typeof value==="string"||typeof value==="number"?String(value):React.isValidElement(value)?text((value as Element).props.children):Array.isArray(value)?value.map(text).join(""):"";}
function scheduler(){const slots:unknown[]=[];let cursor=0;const effects:Array<()=>void>=[];const same=(a:unknown[],b:unknown[])=>a.length===b.length&&a.every((v,i)=>Object.is(v,b[i]));return{reset:()=>{cursor=0;},commit:()=>{for(const effect of effects.splice(0))effect();},hooks:{...React,
  useState:(initial:unknown)=>{const i=cursor++;if(!(i in slots))slots[i]=typeof initial==="function"?(initial as ()=>unknown)():initial;return[slots[i],(value:unknown)=>{slots[i]=typeof value==="function"?(value as (previous:unknown)=>unknown)(slots[i]):value;}];},
  useRef:(initial:unknown)=>{const i=cursor++;return slots[i]??(slots[i]={current:initial});},
  useMemo:(factory:()=>unknown,deps:unknown[])=>{const i=cursor++,old=slots[i] as {deps:unknown[];value:unknown}|undefined;if(!old||!same(old.deps,deps))slots[i]={deps,value:factory()};return(slots[i] as {value:unknown}).value;},
  useLayoutEffect:(effect:()=>void|(()=>void),deps:unknown[])=>{const i=cursor++,old=slots[i] as {deps:unknown[];cleanup?:()=>void}|undefined;if(!old||!same(old.deps,deps))effects.push(()=>{old?.cleanup?.();slots[i]={deps,cleanup:effect()};});},
}};}
type Input={projectId:string;name:string;testPlanTypeId?:string};
function fixture(){
  const schedule=scheduler(),auth={isLoaded:true,isSignedIn:true,userId:"clerk-original",sessionId:"session-original"};
  const browser={Clerk:{loaded:true,session:{id:"session-original",user:{id:"clerk-original"}}}};
  const access={readable:true,canEdit:true,origin:{projectId:"project-original",organizationId:"org-original",clerkActorId:"clerk-original",caseId:null},fresh:{readScope:{actorId:"native-original"}},owns:vi.fn(()=>true)};
  const custom={allows:vi.fn(()=>false),owns:vi.fn(()=>false),retry:vi.fn()};
  const types={isSuccess:true,error:null as unknown,isFetching:false,isPaused:false,data:[] as Array<{id:string;name:string}>,refetch:vi.fn(async()=>undefined)};
  let outcome:(input:Input)=>Promise<unknown>=async input=>({id:"plan-created",name:input.name});
  const mutate=vi.fn((input:Input)=>outcome(input)),onCreated=vi.fn(async()=>undefined),noop=()=>null;
  const modules:Record<string,unknown>={react:schedule.hooks,"@clerk/nextjs":{useAuth:()=>auth},"next/navigation":{useParams:()=>({projectId:"project-original"})},"@/lib/trpcReact":{trpcReact:{testPlans:{types:{useQuery:()=>types},create:{useMutation:()=>({mutateAsync:mutate})}}}},"@/lib/use-case-field-access":{useCaseFieldAccess:()=>access},"@/lib/auth-query-cache":{currentSessionScope,sameAuthScope},"@/lib/traceability-receipt":{retainedTraceabilityReceipt},"@/components/Drawer":{Drawer:noop},"@/components/Modal":{Modal:noop},"@/components/TestPlanDetailContent":{TestPlanDetailContent:noop},"@vaettir/core":{resolveQualityExperience:noop}};
  // Header tooltip is outside this manual-controller fixture. Its component
  // behavior has separate icon-button tests; register only this unused import.
  modules["@/components/ui/IconButton"]={IconButton:noop};
  // List presentation imports are not executed by this manual-create controller.
  modules["@/components/ui/Workspace"]={Icon:noop,StatusPill:noop};
  modules["@/lib/case-inspector"]={inspectorLabel:noop};
  modules["@/lib/use-project-custom-actions"]={useProjectCustomActions:()=>custom};
  const source=readFileSync(new URL("../app/projects/[projectId]/test-plans/page.tsx",import.meta.url),"utf8");
  const output=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.React}}).outputText;
  const exports:Record<string,unknown>={};new Function("require","exports","React","window",output+"\nexports.manual=ManualPlanCreate;")((name:string)=>{if(!(name in modules))throw Error("Unreviewed fixture dependency: "+name);return modules[name];},exports,React,browser);
  const actual=exports.manual as (props:{projectId:string;readOnly:boolean;onCreated:typeof onCreated})=>React.ReactNode;
  const props={projectId:"project-original",readOnly:false,onCreated};
  function render(){schedule.reset();actual(props);schedule.commit();schedule.reset();const tree=actual(props);schedule.commit();return tree;}
  function name(value:string){const field=elements(render()).find(node=>node.type==="input")!;(field.props.onChange as (event:unknown)=>void)({target:{value}});return render();}
  function type(value:string){const field=elements(render()).find(node=>node.type==="select")!;(field.props.onChange as (event:unknown)=>void)({target:{value}});return render();}
  function submit(tree=render()){const form=elements(tree).find(node=>node.type==="form")!;return(form.props.onSubmit as (event:{preventDefault:()=>void})=>Promise<void>)({preventDefault:()=>{}});}
  return{render,name,type,submit,types,props,access,custom,auth,browser,mutate,onCreated,setOutcome:(next:typeof outcome)=>{outcome=next;},source};
}
it("scoped custom plan authors can create without broad native edit authority",async()=>{
  const f=fixture();f.access.canEdit=false;f.access.owns.mockImplementation((_origin?:unknown,mode?:string)=>mode==="read");
  f.custom.allows.mockReturnValue(true);f.custom.owns.mockReturnValue(true);
  await f.submit(f.name("Scoped plan"));expect(f.mutate).toHaveBeenCalledWith({projectId:"project-original",name:"Scoped plan"});
  expect(f.custom.owns).toHaveBeenCalledWith("plans.write","org-original");
});
it("custom permission revocation rejects a captured submit without dropping its private draft",async()=>{
  const f=fixture();f.access.canEdit=false;f.access.owns.mockImplementation((_origin?:unknown,mode?:string)=>mode==="read");
  f.custom.allows.mockReturnValue(true);f.custom.owns.mockReturnValue(true);
  const tree=f.name("Retained scoped plan");f.custom.allows.mockReturnValue(false);f.custom.owns.mockReturnValue(false);f.render();
  await f.submit(tree);expect(f.mutate).not.toHaveBeenCalled();
  f.custom.allows.mockReturnValue(true);f.custom.owns.mockReturnValue(true);f.render();await f.submit(tree);expect(f.mutate).not.toHaveBeenCalled();
  expect(elements(f.render()).find(node=>node.type==="input")!.props.value).toBe("Retained scoped plan");
  await f.submit();expect(f.mutate).toHaveBeenCalledOnce();
});
it("manual creation is standalone, labelled and defaults to built-in Functional without a missing-seed silent no-op",async()=>{
  const f=fixture(),tree=f.name("  Release <literal> regression  ");
  expect(text(tree)).toContain("Create test plan");expect(text(tree)).toContain("Plan name");expect(text(tree)).toContain("Plan type");expect(text(tree)).toContain("Functional (default)");expect(text(tree)).toContain("No other plan types");
  expect(elements(tree).find(node=>node.type==="details")!.props.open).toBeUndefined();expect(renderToStaticMarkup(tree)).toContain("&lt;literal&gt;");
  await f.submit(tree);expect(f.mutate).toHaveBeenCalledWith({projectId:"project-original",name:"Release <literal> regression"});expect(Object.hasOwn(f.mutate.mock.calls[0]![0],"testPlanTypeId")).toBe(false);expect(f.onCreated).toHaveBeenCalledOnce();expect(text(f.render())).toContain("Test plan created");expect(elements(f.render()).find(node=>node.type==="input")!.props.value).toBe("");
  expect(f.source).toContain("<ManualPlanCreate projectId={projectId}");expect(f.source).toContain("Generate strategy with AI");expect(f.source).not.toContain("if (!testPlanTypeId || !name.trim()) return");
});
it.each(["loading","fetching","paused","error"])("%s types have a named Functional fallback and do not block ordinary manual creation",async state=>{
  const f=fixture();f.types.isSuccess=state!=="loading";f.types.isFetching=state==="fetching";f.types.isPaused=state==="paused";f.types.error=state==="error"?Error("private type failure"):null;
  const tree=f.name("Manual plan");expect(text(tree)).toContain("Functional (default)");expect(text(tree)).not.toContain("private type failure");await f.submit(tree);expect(f.mutate).toHaveBeenCalledWith({projectId:"project-original",name:"Manual plan"});
});
it("type read failure has original guarded retry and preserves chosen custom type instead of silently changing the request",async()=>{
  const f=fixture();f.types.data=[{id:"custom",name:"Compliance custom"}];f.name("Named plan");f.type("custom");f.types.error=Error("private");
  const tree=f.render();expect(elements(tree).find(node=>node.type==="select")!.props.value).toBe("custom");expect(text(tree)).toContain("refresh required");await f.submit(tree);expect(f.mutate).not.toHaveBeenCalled();expect(text(f.render())).toContain("selected plan type is unavailable");
  const retry=elements(f.render()).find(node=>node.type==="button"&&text(node.props.children)==="Retry plan types")!;(retry.props.onClick as ()=>void)();expect(f.types.refetch).toHaveBeenCalledOnce();f.access.owns.mockReturnValue(false);(retry.props.onClick as ()=>void)();expect(f.types.refetch).toHaveBeenCalledOnce();
  f.access.owns.mockReturnValue(true);f.types.error=null;await f.submit();expect(f.mutate).toHaveBeenCalledWith({projectId:"project-original",name:"Named plan",testPlanTypeId:"custom"});
});
it("programmatic blank/too-long form submit gives actionable validation, not a silent no-op",async()=>{
  const f=fixture();f.name("   ");await f.submit();expect(text(f.render())).toContain("Enter a plan name");expect(f.mutate).not.toHaveBeenCalled();f.name("n".repeat(201));await f.submit();expect(text(f.render())).toContain("200 characters or fewer");expect(f.mutate).not.toHaveBeenCalled();
});
it("rapid double submission and captured handler after ACK cannot create duplicates",async()=>{
  const f=fixture();let resolve!:(result:unknown)=>void;f.setOutcome(()=>new Promise(done=>{resolve=done;}));const tree=f.name("Original plan"),first=f.submit(tree);await f.submit(tree);expect(f.mutate).toHaveBeenCalledOnce();expect(elements(f.render()).find(node=>node.type==="input")!.props.disabled).toBe(true);resolve({id:"created",name:"Original plan"});await first;await f.submit(tree);expect(f.mutate).toHaveBeenCalledOnce();
});
it.each(["project","organization","native","actor","session","readonly","fetching"])("original captured submission refuses %s loss and ABA restoration, retaining private draft until original scope returns",async fault=>{
  const f=fixture(),tree=f.name("Original private plan");
  if(fault==="project")f.props.projectId="foreign";if(fault==="organization")f.access.origin.organizationId="foreign";if(fault==="native")f.access.fresh.readScope.actorId="foreign";if(fault==="actor")f.auth.userId="foreign";if(fault==="session")f.browser.Clerk.session.id="foreign";if(fault==="readonly")f.props.readOnly=true;if(fault==="fetching")f.access.readable=false;
  expect(text(f.render())).not.toContain("Original private plan");await f.submit(tree);expect(f.mutate).not.toHaveBeenCalled();
  f.props.projectId="project-original";f.access.origin.organizationId="org-original";f.access.fresh.readScope.actorId="native-original";f.auth.userId="clerk-original";f.browser.Clerk.session.id="session-original";f.props.readOnly=false;f.access.readable=true;f.render();await f.submit(tree);expect(f.mutate).not.toHaveBeenCalled();expect(elements(f.render()).find(node=>node.type==="input")!.props.value).toBe("Original private plan");await f.submit();expect(f.mutate).toHaveBeenCalledOnce();
});
it.each(["transport","forged-name","forged-id","extra"])("%s uncertain creation retains the original draft and does not resend after a later refusal",async kind=>{
  const f=fixture();f.name("Retained plan");f.setOutcome(async()=>{if(kind==="transport")throw Error("private transport error");return kind==="forged-name"?{id:"created",name:"wrong"}:kind==="forged-id"?{id:"",name:"Retained plan"}:{id:"created",name:"Retained plan",extra:true};});await f.submit();expect(text(f.render())).toContain("not acknowledged");expect(text(f.render())).not.toContain("private transport error");expect(elements(f.render()).find(node=>node.type==="input")!.props.value).toBe("Retained plan");f.setOutcome(async()=>{throw{data:{code:"FORBIDDEN"}};});await f.submit();expect(f.mutate).toHaveBeenCalledOnce();expect(f.onCreated).not.toHaveBeenCalled();
});
it("late exact ACK after permission loss/restoration stays UNKNOWN, not a confirmed close or an automatic retry",async()=>{
  const f=fixture();let resolve!:(result:unknown)=>void;f.setOutcome(()=>new Promise(done=>{resolve=done;}));const tree=f.name("Original plan"),first=f.submit(tree);f.access.canEdit=false;f.render();f.access.canEdit=true;f.render();resolve({id:"created",name:"Original plan"});await first;expect(f.onCreated).not.toHaveBeenCalled();expect(text(f.render())).toContain("unacknowledged");await f.submit();expect(f.mutate).toHaveBeenCalledOnce();
});
it("known native creation is not changed into 'not submitted' by a failed list refresh, and definitive first refusal preserves edits",async()=>{
  const f=fixture();f.name("Reviewed plan");f.setOutcome(async()=>{throw{data:{code:"BAD_REQUEST"}};});await f.submit();expect(text(f.render())).toContain("name and type are retained");f.setOutcome(async input=>({id:"created",name:input.name}));f.onCreated.mockRejectedValueOnce(Error("private read failure"));await f.submit();expect(text(f.render())).toContain("created, but the list could not be refreshed");expect(text(f.render())).not.toContain("private read failure");expect(elements(f.render()).find(node=>node.type==="a")!.props.href).toBe("/projects/project-original/test-plans/created");
});
