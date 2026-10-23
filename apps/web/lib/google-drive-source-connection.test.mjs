import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const component=readFileSync(new URL('../components/GoogleDriveSourceConnection.tsx',import.meta.url),'utf8');
const callback=readFileSync(new URL('../app/connections/drive/callback/page.tsx',import.meta.url),'utf8');
const chips=readFileSync(new URL('../components/SourceConnectionChips.tsx',import.meta.url),'utf8');

test('Drive chip opens a focused native modal with explicit configured capabilities and metadata permission',()=>{
 assert.match(chips,/active==="drive"&&projectId\?<GoogleDriveSourceConnection/);
 assert.match(chips,/"Connect Google Drive"/);assert.match(component,/"authorize"\|"files"\|"review"\|"done"\|"exports"/);
 assert.match(component,/credentialStorageReady/);assert.match(component,/oauthAvailable/);assert.match(component,/if\(!consent\)return/);
 assert.match(component,/approveMetadataAccess:true/);assert.match(component,/File contents, document import and AI processing are not enabled/);
 assert.match(component,/Google authorization is not configured/);assert.doesNotMatch(component,/localStorage|sessionStorage|router\.push\(/);
});
test('Drive authorization popup is synchronous and its destination and callback messages are constrained',()=>{
 assert.ok(component.indexOf('window.open("about:blank"')<component.indexOf('await begin.mutateAsync'));
 assert.match(component,/url\.hostname!=="accounts\.google\.com"/);assert.match(component,/event\.origin!==window\.location\.origin\|\|event\.source!==popup\.current/);
 assert.match(component,/event\.data\.id!==connection\.current/);assert.match(component,/alive\.current\|\|current!==generation\.current/);
 assert.match(callback,/window\.history\.replaceState/);assert.match(callback,/if\(!isLoaded\|\|!isSignedIn\|\|started\.current\)return/);
 assert.match(callback,/complete\.mutate\(input/);assert.match(callback,/postMessage\(\{channel:"vaettir-drive-authorization",status:/);
 assert.doesNotMatch(callback,/postMessage\([^;]*(?:code:|state:|token:)/);
});
test('Drive metadata browsing, reviewed additive file scope and exact receipt retries preserve approved records',()=>{
 assert.match(component,/Search Drive metadata/);assert.match(component,/folderMime/);assert.match(component,/choices\.length>=100/);
 assert.match(component,/result\.catalogReset\?\{\}/);assert.match(component,/retry&&pageRequest\?pageRequest/);
 assert.match(component,/id:connectionId,\.\.\.attempt/);assert.match(component,/version:catalog\.version,fileIds:choices\.map/);
 assert.match(component,/requestId,approved:true/);assert.match(component,/Approve and save file scope/);
 assert.match(component,/previously approved files will be retained/);assert.match(component,/No recursive folder scope/);assert.match(component,/Cost: 0 AI credits/);
 assert.match(component,/Remove saved access/);assert.match(component,/myaccount\.google\.com\/connections/);assert.match(component,/confirmed:true/);
 assert.match(component,/Close and resume later/);assert.match(component,/Use an export instead/);
});
