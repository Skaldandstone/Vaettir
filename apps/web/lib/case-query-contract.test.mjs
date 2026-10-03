import {readFileSync} from 'node:fs';import {test} from 'node:test';import assert from 'node:assert/strict';
const component=readFileSync(new URL('../components/CaseQueryExplorer.tsx',import.meta.url),'utf8');
test('typed query explorer rejects stale/failed/paused cache and binds visible request identity',()=>{
  for(const guard of ['!query.error','!query.isFetching','!query.isPaused','query.data?.requestId === applied.requestId','key={projectId}'])assert.ok(component.includes(guard),guard);
});
test('query scope/columns are disclosed separate from saved views, selection, bulk actions and exports',()=>{
  for(const text of ['These criteria and columns are not','saved or shared','Existing saved views, selected cases, bulk','caseQuerySchema.safeParse','crypto.randomUUID()','Query cases'])assert.ok(component.includes(text),text);
  assert.ok(component.includes('All groups must match (AND)'));assert.ok(component.includes('Any group may match (OR)'));
  assert.ok(component.includes('All conditions (AND)'));assert.ok(component.includes('Any condition (OR)'));
});
test('query metadata links native cases and retains explicit null-risk/clipping/limits',()=>{
  for(const text of ['test-cases/${encodeURIComponent(row.id)}','encodeURIComponent(projectId)','Not assessed','titleClipped','suiteClipped','limitations'])assert.ok(component.includes(text),text);
  assert.ok(!component.includes('useMutation'));
});
