import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { connectionAccessState } from "./connection-access.ts";

const capabilities = { isSuccess: true, error: null, data: { canConnect: true } };
const saved = { isSuccess: true, error: null };

test("connection actions require both current permissions and successful saved-access lookup", () => {
  assert.equal(connectionAccessState(capabilities, saved), "ready");
  assert.equal(connectionAccessState({ ...capabilities, isSuccess: false }, saved), "checking-permissions");
  assert.equal(connectionAccessState(capabilities, { ...saved, isSuccess: false }), "checking-connections");
});

test("cached positive permissions and access do not survive a failed refresh as actionable proof", () => {
  const failure = new Error("Synthetic refresh failed");
  assert.equal(connectionAccessState({ ...capabilities, isSuccess: false, error: failure }, saved), "permission-error");
  assert.equal(connectionAccessState(capabilities, { ...saved, isSuccess: false, error: failure }), "connection-error");
  assert.equal(connectionAccessState({ ...capabilities, data: { canConnect: false } }, saved), "denied");
  assert.equal(connectionAccessState({ ...capabilities, data: undefined }, saved), "denied");
  assert.equal(connectionAccessState({ ...capabilities, data: { canConnect: false } }, { isSuccess: false, error: null }), "denied");
});

test("all credential and OAuth modules gate every screen and retry permissions before saved access", () => {
  for (const file of ["TokenRepositoryConnection", "LinearSourceConnection", "JiraSourceConnection", "GitlabRepositoryConnection"]) {
    const source = readFileSync(new URL(`../components/${file}.tsx`, import.meta.url), "utf8");
    assert.match(source, /connectionAccessState\(/);
    assert.match(source, /if\s*\(accessState\s*!==\s*"ready"\)\s*return <ConnectionAccessGate/);
    assert.match(source, /enabled:\s*(?:capabilities|configurations)\.isSuccess\s*&&\s*(?:capabilities|configurations)\.data\.canConnect/);
    assert.match(source, /if\s*\(refreshed\.isSuccess\s*&&\s*refreshed\.data\.canConnect\)\s*await recent\.refetch\(\)/);
  }
});

test("Drive snapshot recovery requires successful fresh permission and snapshot reads, while exports remain independent", () => {
  const source = readFileSync(new URL("../components/GoogleDriveSourceConnection.tsx", import.meta.url), "utf8");
  assert.match(source, /enabled:capabilities\.isSuccess&&capabilities\.data\.canConnect/);
  assert.match(source, /enabled:!!id&&capabilities\.isSuccess&&capabilities\.data\.canConnect/);
  assert.match(source, /snapshot\.isSuccess&&capabilities\.isSuccess&&capabilities\.data\.canConnect\?snapshot\.data:undefined/);
  assert.match(source, /if\(!result\.isSuccess\|\|!result\.data\)/);
  assert.match(source, /step==="exports"\?\{isSuccess:true,error:null\}:recent/);
  assert.match(source, /step!=="exports"&&step!=="done"&&!snapshot\.isSuccess/);
});

test("OAuth status and administrator revocation chips do not trust failed cached reads", () => {
  const source = readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8");
  assert.match(source, /status\.isSuccess && status\.data\.status === "VERIFIED" && <button/);
  const administration = readFileSync(new URL("../components/RepositoryOAuthApplicationSetup.tsx", import.meta.url), "utf8");
  assert.match(administration, /revocations\.isSuccess && Boolean\(revocations\.data\?\.length\)/);
  assert.match(administration, /Retry authorization list/);
  assert.match(administration, /if \(!configurations\.isSuccess\) return/);
  assert.match(administration, /if \(!configurations\.data\.canConfigure\) return/);
  assert.match(administration, /enabled: configurations\.isSuccess && configurations\.data\.canConfigure/);
});
