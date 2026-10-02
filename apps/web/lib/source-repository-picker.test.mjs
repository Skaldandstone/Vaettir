import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const chips=readFileSync(new URL('../components/SourceConnectionChips.tsx',import.meta.url),'utf8');
test('source wizard shows one filtered repository entry and a same-page provider picker',()=>{
 assert.match(chips,/sources.filter\(\(\[id\]\)=>!only\|\|only.includes\(id\)\)/);
 assert.match(chips,/repositoryChoices=filtered.filter\(\(\[id\]\)=>repoIds.includes\(id\)\)/);
 assert.match(chips,/otherSources=filtered.filter\(\(\[id\]\)=>!repoIds.includes\(id\)\)/);
 assert.match(chips,/repositoryChoices.length>0/);assert.match(chips,/<strong>Connect repo<\/strong>/);
 assert.match(chips,/aria-label="Repository providers"/);
 assert.match(chips,/!repositoryChoices.some\(\(\[id\]\)=>id===provider\)/);
});
test('callback handoff closes the picker before parent opens connection and visited native children remain mounted',()=>{
 assert.match(chips,/if\(callback\)\{close\(\);callback\(\);return;\}/);
 assert.match(chips,/onRepository\?\(\)=>onRepository\(provider\):provider==="github"\?onGithub:provider==="gitlab"\?onGitlab/);
 assert.match(chips,/setVisitedRepositories\(current=>current.includes\(provider\)\?current:\[\.\.\.current,provider\]\)/);
 assert.match(chips,/visitedRepositories.map\(provider=><div key=\{`\$\{projectId\}:\$\{provider\}`\} hidden=\{selectedRepository!==provider\}/);
 assert.match(chips,/onClick=\{\(\)=>\{if\(!busy\)setSelectedRepository\(null\);\}\}/);
 assert.match(chips,/account discovery is not available in this intake/);
});
test('repository and export writes lock modal dismissal and provider changes without trapping unrelated actions',()=>{
 assert.match(chips,/isConnectionMutation\(key\)\|\|\(Array.isArray\(route\)&&route\[0\]==="project"&&route\[1\]==="addRepository"\)/);
 assert.match(chips,/dismissible=\{!busy\}/);assert.match(chips,/function close\(\)\{\s*if\(busy\)return/);
 assert.match(chips,/function chooseRepository\(provider:RepositoryProvider\)\{\s*if\(busy/);
 assert.match(chips,/<fieldset disabled=\{busy\}/);
 assert.doesNotMatch(chips,/active==="drive"\|\|!busy/);
 assert.match(chips,/dialog\?\.open&&heading.getClientRects\(\).length/);
 assert.match(chips,/heading.focus\(\)/);
 assert.match(chips,/\[active,selectedRepository\]/);
});
