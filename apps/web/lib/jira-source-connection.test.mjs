import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const source=name=>readFileSync(new URL('../components/'+name+'.tsx',import.meta.url),'utf8');
const component=source('JiraSourceConnection'),oauth=source('AtlassianOAuthConnection'),chips=source('SourceConnectionChips');

test('Jira starts browser authorization in place without asking for a token or registration URL',()=>{
 assert.match(chips,/projectId&&<Modal open=\{active==="jira"\} keepMounted dismissible=\{!busy\}/);
 assert.match(chips,/jiraVisited&&<JiraSourceConnection projectId=\{projectId\} onClose=\{close\} onDefectWorkingChange=\{setJiraWorking\}/);
 assert.match(component,/<AtlassianOAuthConnection[^>]*product="jira"/);
 assert.doesNotMatch(component,/apiToken|type="password"|jiraConnections\.verify|project\.addRepository/);
 assert.doesNotMatch(component,/window\.location\s*=|router\.push\(/);
});

test('Browser authorization keeps account and resource approvals separate with durable retry inputs',()=>{
 // Server scope, replay and membership races have real PostgreSQL tests;
 // the actual checkbox/selection/retry UI has its own mounted browser suite.
 assert.match(oauth,/metadataConsent/);assert.match(oauth,/scopeConsent/);
 assert.match(oauth,/approveMetadataAccess:true/);assert.match(oauth,/atlassianConnections\.selectSite/);
 assert.match(oauth,/version:listing\.version/);assert.match(oauth,/resourceIds:Object\.keys\(selected\)\.sort\(\)/);
 assert.match(oauth,/approve\.mutateAsync\(\{id,\.\.\.attempt,approved:true\}\)/);
 assert.match(oauth,/pending\.current\?\?/);assert.match(oauth,/startAttempt\.current\?\?/);
 assert.doesNotMatch(oauth,/localStorage|sessionStorage|type="password"/);
});

test('Existing access is resumable without recollecting secrets or discarding a pending import',()=>{
 assert.match(component,/Previous access/);assert.match(component,/Use browser sign-in to reconnect/);
 assert.match(component,/working\|\|row\.status!=="VERIFIED"\|\|!row\.approvedProjects\.length/);
 assert.match(component,/hidden=\{!active\} disabled=\{!active\}/);
 assert.match(component,/projects=\{selected\.approvedProjects\}/);
 assert.match(component,/onDefectWorkingChange=\{setIntakeWorking\}/);
 assert.doesNotMatch(component,/localStorage|sessionStorage|setApiToken|apiToken/);
 assert.match(oauth,/providerRevocation|Manage access|Remove the app in Atlassian/);
});
