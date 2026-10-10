import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import { gitlabInstanceOrigin } from "./gitlab-instance-selection.ts";

function harness(file, name, props, initial = []) {
  const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
  const ast = ts.createSourceFile("component.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const printer = ts.createPrinter(), slots = [...initial], calls = [];
  let cursor = 0;
  const boundary = role => () => React.createElement("p", null, role);
  const sandbox = {
    React, gitlabInstanceOrigin,
    useId: () => "synthetic-source",
    useState: value => { const i = cursor++; if (!(i in slots)) slots[i] = value; return [slots[i], next => { slots[i] = next; }]; },
    repositoryProviders: [["github", "GitHub"], ["gitlab", "GitLab"], ["git", "Self-hosted Git"]],
    GuidedGitlabTokenSetup: boundary("guided"), TokenRepositoryConnection: boundary("token"), RepositoryOAuthConnection: boundary("oauth"), PopulationDocuments: boundary("documents"), MigrationWizard: boundary("tests"),
    IconButton: props => React.createElement("button", { "aria-label": props.label, onClick: props.onClick, disabled: props.disabled }, "Back"),
    trpcReact: { repositoryConnections: {configurations:{useQuery:()=>({isSuccess:true,data:{canConnect:true}})},mine:{useQuery:()=>({isSuccess:true,isFetching:false,isPaused:false,data:[]})}},project: { addRepository: { useMutation: () => ({ isPending: false, mutateAsync: () => { throw Error("No mutation in presentation fixture"); } }) } } },
    createRepositoryAuthorization: () => { throw Error("No authorization in presentation fixture"); }, cancelRepositoryAuthorization: () => {},
    window: { open: () => { throw Error("No popup in presentation fixture"); } },
  };
  const declarations = ast.statements.filter(node => ts.isFunctionDeclaration(node) || ts.isVariableStatement(node)).map(node => printer.printNode(ts.EmitHint.Unspecified, node, ast).replace(/\bexport\s+(?=function|const)/g, "")).join("\n");
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(`${declarations}\nthis.actual=${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, sandbox);
  return { render: () => { cursor = 0; return sandbox.actual(props); }, calls, props, sandbox };
}
function descendants(node) { return React.isValidElement(node) ? [node, ...React.Children.toArray(node.props.children).flatMap(descendants)] : []; }
function primary(element) { return descendants(element).filter(node => node.type === "button" && node.props.className === "btn-primary"); }
function notice(element) { return React.Children.toArray(element.props.children).find(node => node.props?.className === "repository-connection-notice"); }
const props = () => ({ projectId: "synthetic", active: true, onConnected: () => {}, onClose: () => {} });

test("actual GitLab choices retain one footer primary with alternatives disclosed and consent visible", () => {
  const h = harness("GitlabConnectionChoices", "GitlabConnectionChoices", props());
  const element = h.render(), nodes = descendants(element), html = renderToStaticMarkup(element);
  assert.equal(primary(element).length, 1);
  assert.equal(primary(nodes.find(node => node.type === "footer")).length, 1);
  assert.equal(nodes.find(node => node.type === "details").props.open, undefined);
  assert.match(renderToStaticMarkup(notice(element)), /read_api.*broader read access/);
  assert.match(html, /Other connection methods/);
  primary(element)[0].props.onClick();
  assert.match(renderToStaticMarkup(h.render()), /guided/);
});
test("existing GitLab OAuth replaces the primary action, without duplicating buttons or authorizing automatically",()=>{
  const h=harness("GitlabConnectionChoices","GitlabConnectionChoices",props());
  h.sandbox.trpcReact.repositoryConnections.mine.useQuery=()=>({isSuccess:true,isFetching:false,isPaused:false,data:[{provider:"gitlab",accessMethod:"oauth"}]});
  const element=h.render();assert.equal(primary(element).length,1);assert.equal(primary(primary(element)[0]).length,1);
  assert.equal(primary(element)[0].props.children,"Manage existing GitLab access");
  primary(element)[0].props.onClick();assert.match(renderToStaticMarkup(h.render()),/oauth/);
});
test("fetching, paused or inactive saved access never substitutes an unverified connection action",()=>{
  for(const state of [{isFetching:true},{isPaused:true},{isSuccess:false}]){
    const h=harness("GitlabConnectionChoices","GitlabConnectionChoices",props());
    h.sandbox.trpcReact.repositoryConnections.mine.useQuery=()=>({isSuccess:true,isFetching:false,isPaused:false,data:[{provider:"gitlab",accessMethod:"oauth"}],...state});
    assert.equal(primary(h.render())[0].props.children,"Connect self-hosted GitLab");
  }
  const h=harness("GitlabConnectionChoices","GitlabConnectionChoices",{...props(),active:false});
  assert.equal(primary(h.render())[0].props.disabled,true);
});
test("actual token guide validates host, keeps required permissions visible and has one verify primary", () => {
  const h = harness("GuidedGitlabTokenSetup", "GuidedGitlabTokenSetup", props());
  let element = h.render();
  assert.equal(primary(element).length, 1);
  assert.equal(primary(element)[0].props.disabled, true);
  descendants(element).find(node => node.type === "input").props.onChange({ target: { value: "https://GitLab.example.com/team" } });
  element = h.render();
  assert.equal(descendants(element).find(node => node.type === "a").props.href, "https://gitlab.example.com/-/user_settings/personal_access_tokens");
  assert.match(renderToStaticMarkup(notice(element)), /Do not select write permissions/);
  assert.match(renderToStaticMarkup(notice(element)), /broader reads than metadata/);
  assert.equal(descendants(element).find(node => node.type === "details").props.open, undefined);
  h.props.active = false;
  assert.equal(primary(h.render())[0].props.disabled, true);
  assert.equal(descendants(h.render()).some(node => node.type === "a"), false);
});
test("actual provider picker presents essential permission warning before single Connect action", () => {
  const connects = [], h = harness("RepositoryProviderPicker", "RepositoryProviderPicker", { value: "github", onChange: () => {}, onConnect: provider => connects.push(provider) });
  const element = h.render();
  assert.match(renderToStaticMarkup(notice(element)), /read\/write and organization permissions/);
  assert.equal(primary(element).length, 1);
  assert.equal(connects.length, 0);
  primary(element)[0].props.onClick(); assert.deepEqual(connects, ["github"]);
});
test("actual export fallback retains honest unsupported boundary and secondary paths without writes", () => {
  const h = harness("RepositoryConnectionContent", "RepositoryExportConnection", { ...props(), provider: "git" });
  const element = h.render(), html = renderToStaticMarkup(element);
  assert.match(html, /not implemented yet/);
  assert.equal(primary(element).length, 1);
  assert.equal(descendants(element).find(node => node.type === "details").props.open, undefined);
  assert.match(html, /Import exported test cases/);
  assert.match(html, /Add reference/);
  primary(element)[0].props.onClick();
  assert.match(renderToStaticMarkup(h.render()), /documents/);
});
test("actual reference form has one separated footer and never enables empty reference save", () => {
  const h = harness("RepositoryConnectionContent", "RepositoryExportConnection", { ...props(), provider: "git" });
  descendants(h.render()).find(node => node.type === "button" && node.props.children === "Add reference").props.onClick();
  const element = h.render();
  assert.equal(descendants(element).filter(node => node.type === "footer").length, 1);
  assert.equal(primary(element)[0].props.disabled, true);
  assert.match(renderToStaticMarkup(element), /Back to Self-hosted Git options/);
});
