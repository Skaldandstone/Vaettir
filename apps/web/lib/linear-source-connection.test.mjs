import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const component=readFileSync(new URL('../components/LinearSourceConnection.tsx',import.meta.url),'utf8');
const chips=readFileSync(new URL('../components/SourceConnectionChips.tsx',import.meta.url),'utf8');
test('Linear chip opens native connection in the existing modal, not exported intake',()=>{
 assert.match(chips,/active==="linear"&&projectId\?<LinearSourceConnection/);
 assert.match(chips,/"Connect Linear"/);
 assert.match(component,/"access"\|"projects"\|"review"\|"done"/);
 assert.doesNotMatch(component,/window\.location\s*=|router\.push\(/);
});
test('Linear metadata permission and focused review precede saved scope',()=>{
 assert.match(component,/approveMetadataAccess:true/);assert.match(component,/!consent\|\|!apiKey\.trim\(\)/);
 assert.match(component,/version:listing\.version/);assert.match(component,/requestId:request,approved:true/);
 assert.match(component,/aria-pressed/);assert.match(component,/Verify and choose projects/);
 assert.match(component,/Approve and save source scope/);assert.match(component,/Back/);
});
test('Linear capability and credential limitations remain honest and private',()=>{
 assert.match(component,/Linear OAuth is not available/);assert.match(component,/cannot prove a supplied key has no write permissions/);
 assert.match(component,/Issues have not been read or imported/);assert.match(component,/Cost: 0 AI credits/);
 assert.match(component,/Secure credential storage is unavailable/);assert.match(component,/A full editor seat is required/);
 assert.match(component,/type="password"/);assert.match(component,/setApiKey\(""\)/);assert.doesNotMatch(component,/localStorage|sessionStorage/);
 assert.match(component,/Start new verification attempt/);
});
