import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const customer = readFileSync(new URL("../components/GitlabRepositoryConnection.tsx", import.meta.url), "utf8");
const admin = readFileSync(new URL("../components/RepositoryOAuthApplicationSetup.tsx", import.meta.url), "utf8");
const authorization=readFileSync(new URL("./repository-authorization.ts",import.meta.url),"utf8");

test("customer Connect flow never collects OAuth application or account credentials", () => {
  assert.doesNotMatch(customer, /Application ID|Application secret|configureGitlab|configureGithub|setClientSecret|type="password"/);
  assert.match(customer, /Connect \$\{providerName\}/);
  assert.match(customer, /existing sign-in/);
  assert.match(customer, /By connecting, you approve account verification and repository metadata listing only/);
  assert.match(customer, /No source files are read or sent to AI/);
  assert.match(customer, /settings\/integrations\/repositories\?projectId=/);
  assert.match(customer, /if\(providerId === "gitlab"\)\{cancelRepositoryAuthorization\(initialAuthorization\);return;\}/);
  assert.match(customer, /GitLab instance or project URL/);
  assert.match(customer, /c\.origin === \(providerId === "gitlab" \? instanceOrigin : "https:\/\/github.com"\)/);
  assert.doesNotMatch(customer, /availableConfigurations\.length === 1/);
  assert.match(customer, /Set up this GitLab instance/);
  assert.match(admin, /gitlabInstanceOrigin\(initialOrigin \?\? ""\)/);
});

test("blocked popup does not start OAuth; popup isolates opener before server-approved authorization", () => {
  const open = authorization.indexOf('window.open("about:blank"');
  const blocked = authorization.indexOf("if(!opened)");
  const isolate = authorization.indexOf("opened.opener=null");
  const begin = authorization.indexOf("await begin()");
  assert.ok(open > 0 && blocked > open && isolate > blocked && begin > isolate);
  assert.match(authorization.slice(blocked, isolate), /return;/);
  assert.match(customer, /configurationId:providerConfigurationId,approveMetadataAccess:true/);
  assert.match(customer,/if \(!providerConfigurationId \|\| !connectionReady \|\| busy \|\| !canConnect\) return/);
});

test("verified authorization automatically lists once, errors stay retryable and writes require review", () => {
  assert.match(customer, /automaticallyLoaded\.current === connectionId/);
  assert.match(customer, /!configurations\.isSuccess \|\| !configurations\.data\.canConnect \|\| !recent\.isSuccess/);
  assert.match(customer, /!status\.isSuccess \|\| status\.data\.status !== "VERIFIED"/);
  assert.match(customer, /automaticallyLoaded\.current = connectionId/);
  assert.match(customer, /void load\(1, ""\)/);
  assert.match(customer, /Retry repository list/);
  assert.match(customer, /catalogVersion: listing.catalogVersion, approved: true/);
  assert.match(customer, /Approve and connect/);
  assert.match(customer, /dialog\?\.open && heading\?\.getClientRects\(\).length/);
  assert.match(customer, /ref=\{screenHeading\} tabIndex=\{-1\}/);
});

test("administrator setup and removal preserve grant recovery with fresh permission gates", () => {
  assert.match(admin, /if \(!configurations\.isSuccess\) return/);
  assert.match(admin, /if \(!configurations\.data\.canConfigure\) return/);
  assert.match(admin, /enabled: configurations\.isSuccess && configurations\.data\.canConfigure/);
  assert.match(admin, /Application ID/);
  assert.match(admin, /Application secret/);
  assert.match(admin, /setClientSecret\(""\)/);
  assert.match(admin, /confirmed: true/);
  assert.match(admin, /removable = available.filter\(c => !c.id.startsWith\("platform:"\)\)/);
  assert.match(admin, /Provider revocation was not confirmed. The encrypted grant remains for retry/);
});
