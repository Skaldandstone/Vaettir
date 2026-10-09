import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import vm from "node:vm";
import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import ts from "typescript";
function declaration(file,name) {const source=readFileSync(new URL(file,import.meta.url),"utf8"),ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);return ast.statements.find(node=>ts.isFunctionDeclaration(node)&&node.name?.text===name).getText(ast).replace(/^export /,"");}
function fixture(props={}) {
  const state=[];let cursor=0;
  const scope=vm.createContext({React,useId:()=>"synthetic-tooltip",useState: initial=>{const index=cursor++;if(!(index in state))state[index]=initial;return [state[index],value=>state[index]=value];}});
  vm.runInContext(ts.transpileModule(declaration("../components/ui/Workspace.tsx","Icon")+declaration("../components/ui/IconButton.tsx","IconButton"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText,scope);
  return {render:()=>{cursor=0;return scope.IconButton({label:"Copy folder",icon:"copy",...props});}};
}
test("actual icon control preserves native attributes, accessible name and original action",()=>{
  const action=()=>{},h=fixture({disabled:true,onClick:action,"aria-describedby":"original-help"}),node=h.render(),button=node.props.children[0],html=renderToStaticMarkup(node);
  assert.equal(button.type,"button");assert.equal(button.props.type,"button");assert.equal(button.props.disabled,true);assert.equal(button.props.onClick,action);assert.equal(button.props["aria-label"],"Copy folder");assert.equal(button.props["aria-describedby"],"original-help");assert.match(html,/<svg/);assert.doesNotMatch(html,/role="tooltip"|title=/);
});
test("actual tooltip opens on hover or focus, preserves the existing description and dismisses on Escape",()=>{
  const h=fixture({"aria-describedby":"original-help"});let node=h.render();node.props.onPointerEnter();node=h.render();assert.equal(node.props.children[1].props.role,"tooltip");assert.equal(node.props.children[0].props["aria-describedby"],"original-help synthetic-tooltip");
  let stopped=0;node.props.children[0].props.onKeyDown({key:"Escape",stopPropagation:()=>stopped++});assert.equal(stopped,1);assert.equal(h.render().props.children[1],false);
  node=h.render();node.props.onPointerLeave();node.props.children[0].props.onFocus({});node=h.render();assert.equal(node.props.children[1].props.children,"Copy folder");node.props.children[0].props.onBlur({});assert.equal(h.render().props.children[1],false);
});
test("actual focus/blur/key callbacks remain forwarded without making a tooltip an approval",()=>{
  const events=[],h=fixture({onFocus:()=>events.push("focus"),onBlur:()=>events.push("blur"),onKeyDown:e=>events.push(e.key)});let node=h.render();node.props.children[0].props.onFocus({});node=h.render();node.props.children[0].props.onKeyDown({key:"Enter"});node.props.children[0].props.onBlur({});assert.deepEqual(events,["focus","Enter","blur"]);
});
