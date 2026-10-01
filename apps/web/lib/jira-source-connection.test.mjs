import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const component=readFileSync(new URL('../components/JiraSourceConnection.tsx',import.meta.url),'utf8');
const chips=readFileSync(new URL('../components/SourceConnectionChips.tsx',import.meta.url),'utf8');
test('Jira chip opens native account verification in place, not URL registration or exported intake',()=>{
 assert.match(chips,/active==="jira"&&projectId\?<JiraSourceConnection/);
 assert.match(chips,/"Connect Jira"/);assert.match(component,/"access"\|"projects"\|"review"\|"done"\|"exports"/);
 assert.doesNotMatch(component,/window\.location\s*=|router\.push\(|project\.addRepository/);
});
test('Jira permission, metadata verification and reviewed selection precede scope approval',()=>{
 assert.match(component,/if\(!consent\)return/);assert.match(component,/approveMetadataAccess:true/);
 assert.match(component,/!consent\|\|!siteUrl\.trim\(\)\|\|!email\.trim\(\)\|\|!apiToken\.trim\(\)/);
 assert.match(component,/aria-pressed/);assert.match(component,/Filter this page/);assert.match(component,/Next page/);
 assert.match(component,/catalogReset\?\{\}/);assert.match(component,/version:listing\.version/);
 assert.match(component,/requestId:request,approved:true/);assert.match(component,/Approve and save source scope/);
});
test('Jira capabilities, token secrecy, resume and alternative intake remain explicit',()=>{
 assert.match(component,/Scoped tokens, browser OAuth and self-hosted Jira are not supported/);
 assert.match(component,/cannot prove a supplied token has no write permissions/);
 assert.match(component,/Issues have not been read or imported/);assert.match(component,/Cost: 0 AI credits/);
 assert.match(component,/type="password"/);assert.match(component,/setApiToken\(""\)/);
 assert.doesNotMatch(component,/localStorage|sessionStorage/);
 assert.match(component,/Previous connections/);assert.match(component,/Revoke the token in Atlassian/);
 assert.match(component,/Use an export instead/);assert.match(component,/<PopulationDocuments projectId=\{projectId\}/);
 assert.match(component,/Retry availability check/);assert.match(component,/A full editor seat is required/);
});
