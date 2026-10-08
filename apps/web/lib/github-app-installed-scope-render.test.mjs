import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";

const source = readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("connection.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function find(predicate) {
  let result;
  function visit(node) { if (predicate(node)) result = node; else ts.forEachChild(node, visit); }
  visit(ast); assert.ok(result); return result;
}
function compile(code, sandbox) {
  vm.createContext(sandbox);
  vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None, jsx: ts.JsxEmit.React } }).outputText, sandbox);
}
function loader(result, options = {}) {
  const writes = [], requests = [];
  const sandbox = {
    connectionId: "connection", current: () => true, githubApp: true,
    appliedScope: undefined, appliedInstallationId: "", appliedInstallationPage: 1,
    listingOwner: { current: { generation: 0, inFlight: false } },
    saveOutcome: { current: { uncertain: false, inFlight: false } },
    privateScope: { current: {} }, frame: {},
    utils: { repositoryConnections: { list: { fetch: async input => { requests.push(input); return result; } } } },
    ...options,
  };
  for (const name of ["setLoading", "setError", "publishPrivateOwner", "setSelection", "setListing", "setPage", "setActiveSearch", "setAppliedScope", "setAppliedInstallationId", "setAppliedInstallationPage", "setStep", "setSearch"]) sandbox[name] = value => writes.push([name, value]);
  const node = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "load");
  compile(`this.load = ${node.initializer.arguments[0].getText(ast)};`, sandbox);
  return { sandbox, writes, requests };
}
const reply = (id = "41", reset = true) => ({ repositories: [{ id: "repo", scopeKey: JSON.stringify(["github-installation/v1", id]) }], scopeKey: JSON.stringify(["github-installation/v1", id]), githubInstallationRequired: false, catalogReset: reset });
test("actual loader binds native installation/page and resets choices only after exact acknowledgement", async () => {
  const h = loader(reply()); await h.sandbox.load(1, "", false, null, "41", 3);
  assert.equal(h.requests[0].githubInstallationId, "41");
  assert.equal(h.requests[0].githubInstallationPage, 3);
  assert.ok(h.writes.some(([name]) => name === "setSelection"));
  assert.ok(h.writes.some(([name, value]) => name === "setAppliedInstallationId" && value === "41"));
  assert.ok(h.writes.some(([name, value]) => name === "setAppliedInstallationPage" && value === 3));
});
test("actual loader retains choices for wrong scope, repository echo or missing reset", async () => {
  for (const result of [reply("42"), reply("41", false), { ...reply(), repositories: [{ id: "repo", scopeKey: null }] }]) {
    const h = loader(result); await h.sandbox.load(1, "", false, null, "41", 2);
    assert.equal(h.writes.some(([name]) => name === "setSelection" || name === "setListing"), false);
  }
  const uncertain = loader(reply(), { saveOutcome: { current: { uncertain: true, inFlight: false } } });
  await uncertain.sandbox.load(1, "", false, null, "41", 2);
  assert.equal(uncertain.requests.length, 0);
});
test("actual no-installation response is admitted only with empty unscoped repositories", async () => {
  const valid = { repositories: [], scopeKey: null, githubInstallationRequired: true, catalogReset: false };
  for (const [result, accepted] of [[valid, true], [{ ...valid, repositories: [{ id: "private" }] }, false], [{ ...valid, githubInstallationRequired: false }, false]]) {
    const h = loader(result); await h.sandbox.load();
    assert.equal(h.writes.some(([name]) => name === "setListing"), accepted);
  }
});
test("actual GitLab five-part scope still requires group identity and reset", async () => {
  const scope = { groupPath: "team/sub", includeSubgroups: true, includeShared: false };
  const scopeKey = JSON.stringify(["gitlab-group/v1", "team/sub", true, false, "17"]);
  const h = loader({ repositories: [{ id: "repo", scopeKey }], scopeKey, githubInstallationRequired: false, catalogReset: true }, { githubApp: false });
  await h.sandbox.load(1, "", false, scope);
  assert.equal(h.requests[0].githubInstallationId, undefined);
  assert.ok(h.writes.some(([name]) => name === "setListing"));
});
test("actual installed-account fieldset renders guidance and browses exact fresh descriptor", () => {
  const node = find(node => ts.isJsxElement(node) && node.openingElement.attributes.properties.some(attribute => attribute.getText(ast) === 'aria-label="GitHub installed account scope"'));
  const calls = [], sandbox = { React, busy: false, frame: { eligible: true }, field: {}, inputStyle: {}, actions: {}, installationUrl: "https://github.com/apps/synthetic/installations/new", installationLinkReady: true, installationsReady: true, githubInstallationId: "41", installationPage: 3, search: "", canEditSelection: () => true, load: (...args) => calls.push(args), installations: { data: { installations: [{ id: "41", accountLabel: "Synthetic account", repositorySelection: "selected", page: 3 }], hasMore: false, limitReached: false }, refetch: () => calls.push("refresh") }, setGithubInstallationId: () => {}, setInstallationPage: () => {} };
  compile(`this.render = () => (${node.getText(ast)});`, sandbox);
  const element = sandbox.render(), html = renderToStaticMarkup(element);
  assert.match(html, /Synthetic account · Selected repositories/);
  assert.match(html, /Install or manage the GitHub App on GitHub/);
  assert.equal(calls.length, 0, "render never installs or browses");
  function descendants(element) { return React.isValidElement(element) ? [element, ...React.Children.toArray(element.props.children).flatMap(descendants)] : []; }
  descendants(element).find(element => element.type === "button" && element.props.children === "Browse this installed account").props.onClick();
  assert.deepEqual(calls[0], [1, "", false, null, "41", 3]);
  sandbox.installationsReady = false;
  assert.doesNotMatch(renderToStaticMarkup(sandbox.render()), /Synthetic account/);
});
test("saved authorization kind comes from immutable connection snapshot, not origin inference", () => {
  assert.match(source, /connectionId \? status\.data\?\.authorizationKind : provider\?\.authorizationKind/);
  assert.match(source, /GitHub grants broad repository read\/write/);
  assert.match(source, /saveOutcome\.current\.uncertain\|\|saveOutcome\.current\.inFlight/);
  assert.match(source, /Retry the original approval before changing scope/);
  assert.match(source, /!listing\?\.githubInstallationRequired&&listing\?\.listingStatus==="end-of-scope"/);
});

test("actual fresh-next action crosses a 500-repository batch only on explicit current-scope click", async () => {
  let resolve;
  const requests = [];
  const h = loader(reply(), {
    appliedInstallationId: "41", appliedInstallationPage: 3,
    utils: { repositoryConnections: { list: { fetch: input => { requests.push(input); return new Promise(yes => { resolve = yes; }); } } } },
  });
  h.sandbox.continuationFrame = { eligible: true, page: 10, activeSearch: "retained filter" };
  h.sandbox.continuation = { current: h.sandbox.continuationFrame };
  const action = find(node => ts.isFunctionDeclaration(node) && node.name?.text === "continueCatalogue");
  compile(`${action.getText(ast)};this.next=continueCatalogue;`, h.sandbox);
  assert.equal(requests.length, 0, "no automatic traversal after a 500-repository batch");
  const pending = h.sandbox.next();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].page, 11);
  assert.equal(requests[0].search, "retained filter");
  assert.equal(requests[0].restartCatalogue, true);
  assert.equal(requests[0].githubInstallationId, "41");
  assert.equal(requests[0].githubInstallationPage, 3);
  assert.equal(h.writes.some(([name]) => name === "setSelection"), false);
  resolve(reply("41", false)); await pending;
  assert.equal(h.writes.some(([name]) => name === "setSelection"), false, "missing reset ACK retains choices");
  const admitted = h.sandbox.next(); resolve(reply()); await admitted;
  assert.ok(h.writes.some(([name]) => name === "setSelection"));
  h.sandbox.saveOutcome.current.uncertain = true;
  await h.sandbox.next(); assert.equal(requests.length, 2, "unknown approval cannot be replaced by a fresh batch");
  h.sandbox.saveOutcome.current.uncertain = false;
  h.sandbox.continuation.current = null;
  await h.sandbox.next(); assert.equal(requests.length, 2, "stale uncommitted action cannot browse");
});

test("actual continuation admits only GitLab or GitHub App, within verified page bounds", () => {
  const declaration = find(node => ts.isVariableDeclaration(node) && node.name.getText(ast) === "continuationFrame");
  const sandbox = { step: "done", page: 10, activeSearch: "", listing: { hasMore: true }, providerId: "github", githubApp: true, frame: { eligible: true }, busy: false, status: { isSuccess: true, data: { status: "VERIFIED" }, error: null, isFetching: false, isPaused: false } };
  compile(`this.check = ${declaration.initializer.arguments[0].getText(ast)};`, sandbox);
  assert.equal(sandbox.check().eligible, true);
  sandbox.githubApp = false; assert.equal(sandbox.check().eligible, false);
  sandbox.providerId = "gitlab"; assert.equal(sandbox.check().eligible, true);
  sandbox.page = 100; assert.equal(sandbox.check().eligible, false);
  sandbox.page = 10; sandbox.status.isFetching = true; assert.equal(sandbox.check().eligible, false);
  assert.equal([...source.matchAll(/\(providerId === "gitlab" \|\| githubApp\) && listing\?\.hasMore && page < 100/g)].length, 2, "selection and acknowledged-save screens both expose explicit fresh-next");
});
