import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const component=readFileSync(new URL('../components/JiraIssueIntake.tsx',import.meta.url),'utf8');
const connection=readFileSync(new URL('../components/JiraSourceConnection.tsx',import.meta.url),'utf8');

test('Jira issue reads are separate literal permission within an in-page approved scope flow',()=>{
 assert.match(connection,/"issues"/);assert.match(connection,/<JiraIssueIntake connectionId=\{id\}/);
 assert.match(connection,/Preview or resume Jira issues/);assert.match(connection,/recent\.isSuccess/);
 assert.match(component,/if\(!permission\|\|!chosenProjects\.length\)return/);
 assert.match(component,/approveIssueRead:true/);assert.match(component,/chosenProjects\.length>=20/);
 assert.match(component,/aria-pressed/);assert.match(component,/Only issue identity, title, status, updated time and source link/);
 assert.match(component,/descriptions, comments, attachments and code are excluded/);
 assert.doesNotMatch(component,/window\.location\s*=|router\.push\(|localStorage|sessionStorage/);
});

test('Preview paging is bounded and manually initiated, with retry identity and frozen selection review',()=>{
 assert.match(component,/five pages and 100 issue summaries/);assert.match(component,/Read next issue page/);
 assert.match(component,/Finish preview and review/);assert.match(component,/Approve selected additions/);
 assert.match(component,/version:request\.version,requestId:request\.id/);
 assert.match(component,/!current\.nextPageAvailable&&!pageRequest/);
 assert.match(component,/current=run\.isSuccess\?run\.data:undefined/);
 assert.match(component,/current\.status==="READING"&&!current\.readInFlight/);
 assert.match(component,/setError\(""\);setPageRequest\(null\);void refresh\(\)/);
 assert.match(component,/issueIds:request\.ids,requestId:request\.id,approved:true/);
 assert.match(component,/approvalRequest\?\?\{id:crypto\.randomUUID\(\),version:current\.version,ids:\[\.\.\.selected\]\}/);
 assert.match(component,/issue\.classification!=="new"/);assert.match(component,/human edits stay unchanged/);
 assert.doesNotMatch(component,/setInterval|refetchInterval|while\s*\(|useEffect/);
});

test('Durable runs expose resumable batch progress and explicit cancellation without duplicate or completion claims',()=>{
 assert.match(component,/Previous intake runs/);assert.match(component,/Refresh saved status/);
 assert.match(component,/Process next batch \(up to 10\)/);assert.match(component,/process\.mutateAsync\(\{runId\}\)/);
 assert.match(component,/confirmed:true/);assert.match(component,/Keep this run/);assert.match(component,/Confirm cancellation/);
 assert.match(component,/cancelBusy=start\.isPending\|\|finish\.isPending\|\|approve\.isPending\|\|process\.isPending\|\|cancel\.isPending/);
 assert.match(component,/disabled=\{cancelBusy\} onClick=\{\(\)=>setConfirmCancel\(true\)/);
 assert.match(component,/Completed requirements and staged source evidence are preserved/);
 assert.match(component,/Other Jira issues were not imported/);assert.match(component,/No ongoing sync is enabled/);
 assert.match(component,/Cost: 0 AI credits/);assert.match(component,/No AI service is used/);
 assert.match(component,/role="alert"/);assert.match(component,/rel="noopener noreferrer"/);
});
