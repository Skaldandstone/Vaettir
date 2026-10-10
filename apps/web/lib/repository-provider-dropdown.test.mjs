import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read=name=>readFileSync(new URL(`../components/${name}.tsx`,import.meta.url),'utf8');
const picker=read('RepositoryProviderPicker');
const oauth=read('GitlabRepositoryConnection');
const authorization=readFileSync(new URL('./repository-authorization.ts',import.meta.url),'utf8');
test('native provider dropdown always uses all seven providers, with a separate explicit Connect action',()=>{
  const catalog=read('RepositoryConnectionContent');
  for(const provider of ['github','gitlab','bitbucket','azure-devops','git','perforce','svn'])assert.match(catalog,new RegExp(`"${provider}"`));
  assert.match(picker,/<select id=\{id\} value=\{value\} disabled=\{disabled\}/);
  assert.match(picker,/repositoryProviders.map\(\(\[provider,label\]\)=>.*<option/);
  assert.match(picker,/disabled=\{disabled\|\|!value\} onClick=\{connect\}>Connect/);
  const selection=picker.slice(picker.indexOf('onChange={event=>'),picker.indexOf('style={{width:',picker.indexOf('onChange={event=>')));
  assert.match(selection,/onChange\(provider\)/);assert.doesNotMatch(selection,/window.open|onConnect\(/);
});
test('provider selection never flashes a premature popup; actual authorization is a later checked provider action',()=>{
  assert.doesNotMatch(picker,/window.open|createRepositoryAuthorization/);
  assert.match(picker,/onConnect\(value\)/);
  assert.match(oauth,/onClick=\{\(\) => void authorize\(\)\}/);
  assert.match(oauth,/if \(!canEditSelection\(\) \|\| !providerConfigurationId \|\| !connectionReady \|\| busy \|\| !canConnect\) return/);
  assert.match(picker,/Account authorization opens only after you select the host/);
  assert.match(picker,/repository metadata only; no source files or AI processing/);
});

test('configuration recheck is read-only, overlap guarded and publishes visible owner-bound feedback',()=>{
  const handler=oauth.slice(oauth.indexOf('async function recheckConfiguration'),oauth.indexOf('const currentConfigurationCheck'));
  assert.match(handler,/recheckingConfiguration.current\|\|busy\|\|!canEditSelection/);
  assert.match(handler,/await configurations.refetch\(\)/);
  assert.match(handler,/result.isSuccess&&!result.error&&!result.isFetching&&!result.isPaused/);
  assert.match(handler,/result.data\?\.organizationId===owner.organizationId/);
  assert.match(handler,/reader.owns\(owner,"edit"\)/);
  assert.match(handler,/sameAuthScope/);
  assert.doesNotMatch(handler,/mutateAsync|window.open|authorizeRepositoryAccount/);
  assert.match(oauth,/role="status" aria-live="polite".*Checking \$\{providerName\} authorization setup/);
  assert.match(oauth,/authorization is still not enabled/);
});
test('click receipt is one-use and fresh-access bound, inactive/denied/closed windows cannot authorize',()=>{
  assert.match(oauth,/if\(!initialAuthorization\)return/);
  assert.match(oauth,/if\(!active\|\|initialAuthorization.isCancelled\(\)\)/);
  assert.match(oauth,/if\(!initialAuthorization.claim\(\)\)return/);
  assert.match(oauth,/accessState!=="ready"\|\|!connectionReady\|\|!providerConfigurationId\|\|connectionId/);
  assert.match(oauth,/preopened:initialAuthorization.window\(\)/);
  assert.match(authorization,/const opened=preopened\?\?window.open/);
  const closed=authorization.indexOf('if(opened.closed)');
  assert.ok(closed>0&&closed<authorization.indexOf('await begin()'));
  assert.match(authorization.slice(closed,authorization.indexOf('opened.opener=null')),/return;/);
});
test('wizard forwards browser-only click receipt without persisting it into the saved draft',()=>{
  assert.match(read('PopulationWizard'),/onRepository\(provider,intent\)/);
  assert.match(read('PopulationSetup'),/onScreen\(provider,intent\)/);
  assert.match(read('ProjectPopulationModal'),/initialAuthorization=\{authorizations\[provider\]\}/);
  assert.match(read('ProjectPopulationModal'),/active=\{screen===provider&&!closing&&canEdit\}/);
  assert.doesNotMatch(read('PopulationWizard'),/providers:.*intent|objective:.*intent/);
});
