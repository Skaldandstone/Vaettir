import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";

const source=readFileSync(new URL("../components/ProjectRepositories.tsx",import.meta.url),"utf8");

test("project overview offers one Connect repo entry; provider choices live inside its modal",()=>{
  assert.match(source,/<strong>Connect repo<\/strong>/);
  assert.equal(source.split("<strong>Connect repo</strong>").length-1,1);
  assert.ok(source.indexOf("repositoryProviders.map(([id,label])")>source.indexOf('<Modal open={open}'));
  assert.match(source,/aria-label="Repository providers"/);
  assert.match(source,/Back to providers/);
});

test("provider navigation keeps visited connector state mounted and gates stale access",()=>{
  assert.match(source,/visited\.map\(id=><div key={id} hidden=\{provider!==id\}><RepositoryConnectionContent/);
  assert.match(source,/if\(busy\|\|!canEdit\|\|!query\.isSuccess\)return/);
  assert.match(source,/hidden=\{!canEdit\|\|!query\.isSuccess\}/);
  assert.match(source,/dismissible=\{!busy\}/);
  assert.match(source,/isConnectionMutation\(key\)\|\|\(Array\.isArray\(route\)&&route\[0\]==="project"&&route\[1\]==="addRepository"\)/);
  assert.match(source,/if\(dialog\?\.open\)screenHeading\.current\?\.focus\(\)/);
});

test("picker distinguishes OAuth, token verification and export-only adapters without changing saved status",()=>{
  assert.match(source,/Authorize account, then choose repositories/);
  assert.match(source,/Verify a token, then choose repositories/);
  assert.match(source,/Import exports · native connection unavailable/);
  assert.match(source,/repo\.accessVerified\?"Registered · Access verified":"Registered · Access unverified"/);
  assert.match(source,/Review \$\{repo\.url\} connection options/);
});
