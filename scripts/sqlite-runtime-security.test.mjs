import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {manifest, digest, verifySourceBytes, downloadSource, fetchSources} from './fetch-sqlite-runtime-sources.mjs';
import {checkUpstreamLog, checkNegativeControl, checkExports, checkElfHeader, checkOptions, parseIdentity, checkConsumerInventory} from './check-sqlite-runtime.mjs';
import {restorePreSqliteDockerfileFixture, PRE_SQLITE_DOCKERFILE_SHA256} from './sqlite-dockerfile-inverse-fixture.mjs';

test('archive member bounds admit the measured pinned fuzz fixtures without widening total or path admission', () => {
  assert.equal(manifest.sources[0].maxMemberBytes, 17021952);
  assert.equal(manifest.sources[0].maxExpandedBytes, 150000000);
  assert.equal(manifest.sources[1].maxMemberBytes, 9515341);
  const builder = readFileSync(new URL('./build-sqlite-runtime.sh', import.meta.url), 'utf8');
  assert.ok(builder.includes("size<=row['maxMemberBytes']"));
  assert.ok(builder.includes("'..' not in path.parts"));
  assert.ok(builder.includes('stat.S_IFREG'));
});

test('retains the measured Debian maximum default page-size capability', () => {
  assert.ok(manifest.defines.includes('SQLITE_MAX_DEFAULT_PAGE_SIZE=32768'));
  checkOptions([...options, 'MAX_DEFAULT_PAGE_SIZE=32768'], [...options, 'MAX_DEFAULT_PAGE_SIZE=32768']);
  assert.throws(() => checkOptions([...options, 'MAX_DEFAULT_PAGE_SIZE=8192'],
    [...options, 'MAX_DEFAULT_PAGE_SIZE=32768']), /reduced/);
});

test('source bytes require both independent digests and exact length', () => {
  const bytes = Buffer.from('synthetic source');
  const pin = {size:bytes.length,sha256:digest(bytes),sha3_256:digest(bytes,'sha3-256')};
  verifySourceBytes(bytes,pin);
  for (const mutation of [{size:bytes.length+1},{sha256:'0'.repeat(64)},{sha3_256:'0'.repeat(64)}]) {
    assert.throws(()=>verifySourceBytes(bytes,{...pin,...mutation}),/mismatch/);
  }
});

test('unapproved source URLs never reach the transport', async () => {
  for (const url of ['http://sqlite.org/2026/x','https://example.org/source','https://sqlite.org/2026/sqlite-src-3540100.zip?token=x']) {
    await assert.rejects(downloadSource({...manifest.sources[0],url},()=>{throw Error('transport reached');}),/outside/);
  }
});

function response(overrides = {}) {
  return {ok:true,status:200,redirected:false,url:manifest.sources[0].url,headers:new Headers(),
    body:new ReadableStream({start(c){c.close();}}),...overrides};
}
test('redirects, alternate response origins, HTTP errors and absent bodies fail closed', async () => {
  for (const mutation of [{redirected:true},{url:'https://example.org/a'},{status:302},{status:403,ok:false},{body:null}]) {
    await assert.rejects(downloadSource(manifest.sources[0], async (_url,options)=>{
      assert.equal(options.redirect,'error'); assert.ok(options.signal); return response(mutation);
    }),/response/);
  }
});
test('declared and streamed oversized content stop before digest acceptance', async () => {
  await assert.rejects(downloadSource(manifest.sources[0],async()=>response({headers:new Headers({'content-length':'99999999'})})),/length/);
  let cancelled=false;
  const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(manifest.sources[0].size+1));},cancel(){cancelled=true;}});
  await assert.rejects(downloadSource(manifest.sources[0],async()=>response({body})),/exceeds/);
  assert.equal(cancelled,true);
});
test('compressed transport is not implicitly decoded into an admitted source', async () => {
  await assert.rejects(downloadSource(manifest.sources[0],async (_url,options)=>{
    assert.equal(options.headers['accept-encoding'],'identity');
    return response({headers:new Headers({'content-encoding':'gzip'})});
  }),/encoding/);
});
test('truncated and corrupt source bytes never produce a receipt', async () => {
  await assert.rejects(downloadSource(manifest.sources[0],async()=>response()),/mismatch/);
  const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(manifest.sources[0].size));c.close();}});
  await assert.rejects(downloadSource(manifest.sources[0],async()=>response({body})),/mismatch/);
});
test('transport failure is attempted once and a destination is never overwritten', async () => {
  const root=mkdtempSync(join(tmpdir(),'sqlite-synthetic-')); let calls=0;
  try {
    const destination=join(root,'attempt');
    await assert.rejects(fetchSources(destination,async()=>{calls++;throw Error('offline');}),/offline/);
    assert.equal(calls,1);
    await assert.rejects(fetchSources(destination,async()=>{calls++;}),/EEXIST/);
    assert.equal(calls,1);
  } finally { rmSync(root,{recursive:true,force:true}); }
});

test('upstream proof requires exact new regression markers and a nonzero count', () => {
  assert.equal(checkUpstreamLog('auth-9.3... Ok\n0 errors out of 12 tests on x86_64\n',['auth-9.3']),12);
  for (const text of ['0 errors out of 0 tests on x86_64\n','other... Ok\n0 errors out of 12 tests on x86_64\n',
    'auth-9.3... Ok\n1 errors out of 12 tests on x86_64\n','auth-9.3... skipped\n0 errors out of 12 tests on x86_64\n',
    'auth-9x3... Ok\n0 errors out of 12 tests on x86_64\n']) {
    assert.throws(()=>checkUpstreamLog(text,['auth-9.3']));
  }
});
test('sanitizer diagnostics override an apparently passing upstream summary', () => {
  for(const diagnostic of ['AddressSanitizer: heap-use-after-free','runtime error: invalid shift','Segmentation fault']) {
    assert.throws(()=>checkUpstreamLog(`case... Ok\n0 errors out of 4 tests on x86_64\n${diagnostic}`,['case']),/diagnostic/);
  }
});
test('duplicate upstream summaries are ambiguous and rejected', () => {
  assert.throws(()=>checkUpstreamLog('case... Ok\n0 errors out of 4 tests on x\n0 errors out of 4 tests on y\n',['case']),/success/);
});
test('negative control accepts only the exact observed defect, never a crash or timeout', () => {
  checkNegativeControl(42,'WAL_TAIL_UNINITIALIZED:3584\n','');
  for(const status of [0,1,124,139,null]) assert.throws(()=>checkNegativeControl(status,'WAL_TAIL_UNINITIALIZED:3584\n',''));
  assert.throws(()=>checkNegativeControl(42,'WAL_TAIL_ZEROED:3584\n',''));
  assert.throws(()=>checkNegativeControl(42,'WAL_TAIL_UNINITIALIZED:3584\n','unexpected diagnostic'));
});
function abiFixture() {
  const publicSymbols = Array.from({length:120},(_,i)=>`sqlite3_export_${i}`);
  const privateSymbols = ['sqlite3PrivateUnused','sqlite3PrivateConsumer'];
  const baseline = [...publicSymbols,...privateSymbols];
  const contract = {schemaVersion:1,baselineExports:baseline,headerDeclaredSymbols:publicSymbols,
    requiredPublicExports:publicSymbols,explicitlyPrivateExports:privateSymbols,
    consumers:[{path:'/usr/lib/test-consumer.so',sha256:'a'.repeat(64),undefinedSQLiteSymbols:['sqlite3PrivateConsumer']}]};
  return {publicSymbols,privateSymbols,baseline,contract};
}
test('ABI retains all baseline-header public exports and any consumer-used private symbol', () => {
  const {publicSymbols,baseline,contract} = abiFixture();
  checkExports([...baseline,'sqlite3_new'],baseline,contract);
  assert.throws(()=>checkExports([...baseline.slice(1),'sqlite3_replacement'],baseline,contract),/lost/);
  assert.throws(()=>checkExports(publicSymbols,baseline,contract),/sqlite3PrivateConsumer/);
  const delta = checkExports([...publicSymbols,'sqlite3PrivateConsumer'],baseline,contract);
  assert.deepEqual(delta.removedPrivateExports,['sqlite3PrivateUnused']);
  assert.throws(()=>checkExports(['sqlite3_open'],['sqlite3_open'],contract),/Incomplete/);
});
test('ABI never accepts an unreviewed baseline, ambiguous classification or changed consumer closure', () => {
  const {baseline,contract} = abiFixture();
  assert.throws(()=>checkExports(baseline,[...baseline.slice(1),'sqlite3_other'],contract),/Unreviewed/);
  assert.throws(()=>checkExports(baseline,baseline,{...contract,explicitlyPrivateExports:[]}),/Unclassified/);
  assert.throws(()=>checkExports(baseline,baseline,{...contract,requiredPublicExports:contract.requiredPublicExports.slice(1)}),/Unclassified/);
  assert.throws(()=>checkExports(baseline,baseline,{...contract,consumers:[{...contract.consumers[0],undefinedSQLiteSymbols:['sqlite3UnknownPrivate']}]}),/Unresolved/);
  assert.throws(()=>checkExports(baseline,baseline,{...contract,consumers:[{...contract.consumers[0],sha256:'unknown'}]}),/Invalid/);
});
test('production ABI contract pins matching baseline core, session and Rtree headers plus exact consumers', () => {
  const c = manifest.abiContract;
  assert.equal(c.baselineLibrarySha256,manifest.baselineLibrarySha256);
  assert.deepEqual(c.baselineHeaders.map(row=>row.path),['src/sqlite.h.in','ext/session/sqlite3session.h','ext/rtree/sqlite3rtree.h']);
  assert.equal(c.baselineExports.length,1427);assert.equal(c.requiredPublicExports.length,336);
  assert.equal(c.explicitlyPrivateExports.length,1091);
  assert.ok(c.requiredPublicExports.includes('sqlite3session_create'));
  assert.ok(c.requiredPublicExports.includes('sqlite3_rtree_query_callback'));
  assert.deepEqual(c.consumers.map(row=>row.undefinedSQLiteSymbols.length),[14,19]);
  checkExports(c.baselineExports,c.baselineExports);
});

test('ELF admission rejects another architecture, class, type and invalid header', () => {
  const bytes=Buffer.alloc(64); Buffer.from([127,69,76,70,2,1]).copy(bytes);bytes.writeUInt16LE(3,16);bytes.writeUInt16LE(62,18);
  checkElfHeader(bytes);
  for(const [offset,value] of [[0,0],[4,1],[5,2],[16,2],[18,183]]) {
    const changed=Buffer.from(bytes);changed[offset]=value;assert.throws(()=>checkElfHeader(changed),/ELF/);
  }
  assert.throws(()=>checkElfHeader(Buffer.alloc(20)),/ELF/);
});
const options=['ENABLE_COLUMN_METADATA','ENABLE_FTS3','ENABLE_FTS3_PARENTHESIS','ENABLE_FTS4','ENABLE_FTS5','ENABLE_RTREE',
  'ENABLE_UNLOCK_NOTIFY','ENABLE_DBSTAT_VTAB','ENABLE_DBPAGE_VTAB','ENABLE_UPDATE_DELETE_LIMIT','ENABLE_LOAD_EXTENSION',
  'ENABLE_FTS3_TOKENIZER','ENABLE_PREUPDATE_HOOK','ENABLE_SESSION','ENABLE_STMTVTAB','SECURE_DELETE','SOUNDEX',
  'LIKE_DOESNT_MATCH_BLOBS','THREADSAFE=1','USE_URI','MAX_VARIABLE_NUMBER=250000'];
test('feature and resource-limit compatibility fails on removals and new omissions', () => {
  checkOptions(options,options);
  assert.throws(()=>checkOptions(options.filter(v=>v!=='ENABLE_SESSION'),options),/lost/);
  assert.throws(()=>checkOptions([...options,'OMIT_AUTHORIZATION'],options),/OMIT/);
  assert.throws(()=>checkOptions([...options,'MAX_COLUMN=100'],[...options,'MAX_COLUMN=2000']),/reduced/);
  checkOptions([...options,'MAX_COLUMN=4000'],[...options,'MAX_COLUMN=2000']);
});
test('identity requires unique fields and actual compile option rows', () => {
  const text=`VERSION=3.54.1\nSOURCE_ID=exact\nLIBRARY=/usr/lib/sqlite.so\n${options.map(v=>`OPTION=${v}`).join('\n')}\n`;
  assert.equal(parseIdentity(text).version,'3.54.1');
  assert.throws(()=>parseIdentity(text+'VERSION=wrong\n'),/duplicate/);
  assert.throws(()=>parseIdentity(text+'OPTION=ENABLE_SESSION\n'),/duplicate/);
  assert.throws(()=>parseIdentity('VERSION=3.54.1\n'),/options/);
});
test('all image recipes use the same isolated security stage and retain final runtime gates', () => {
  const files=['Dockerfile.api','Dockerfile.web','Dockerfile.sqlite-security'].map(file=>readFileSync(new URL(`../${file}`,import.meta.url),'utf8'));
  const stage=text=>text.slice(0,text.indexOf('RUN --network=none sh /build/scripts/build-sqlite-runtime.sh'));
  assert.equal(stage(files[0]),stage(files[1]));assert.equal(stage(files[1]),stage(files[2]));
  for(const text of files.slice(0,2)) {
    assert.ok(text.lastIndexOf('dpkg --install /tmp/vaettir-sqlite.deb')>text.lastIndexOf('apt-get install'));
    assert.ok(text.includes('check-sqlite-runtime.mjs --installed'));
    assert.ok(text.includes('check-zlib-runtime.mjs --installed'));
  }
  assert.ok(files[0].lastIndexOf('check-browser-runtime.mjs')>files[0].indexOf('dpkg --install /tmp/vaettir-sqlite.deb'));
  assert.ok(files[0].lastIndexOf('check-prisma-runtime.mjs')>files[0].indexOf('dpkg --install /tmp/vaettir-sqlite.deb'));
  assert.ok(files[1].lastIndexOf('check-web-startup.mjs --image-build')>files[1].indexOf('dpkg --install /tmp/vaettir-sqlite.deb'));
});

test('historical inverse restores the exact full baseline and refuses every unrelated edit', () => {
  const current=Buffer.from(readFileSync(new URL('../Dockerfile.api',import.meta.url),'utf8').replaceAll('\r\n','\n'));
  const previous=restorePreSqliteDockerfileFixture(current);
  assert.equal(digest(previous),PRE_SQLITE_DOCKERFILE_SHA256);
  assert.equal(PRE_SQLITE_DOCKERFILE_SHA256,'3053480495dd451d4297717aadea4ad0f61e1923c1359c69ccd40b9f0e1aadda');
  for(const changed of [Buffer.concat([current,Buffer.from('# unrelated\n')]),previous,
    Buffer.from(current.toString().replaceAll('\n','\r\n')),
    Buffer.from(current.toString().replace('check-prisma-runtime.mjs','skip-prisma-runtime.mjs')),
    Buffer.from(current.toString().replace('sqlite-security','sqlite-other'))]) {
    assert.throws(()=>restorePreSqliteDockerfileFixture(changed));
  }
  assert.throws(()=>restorePreSqliteDockerfileFixture(current,'override'));
});

test('production checker and builder never import historical inverse fixtures', () => {
  for(const path of ['check-sqlite-runtime.mjs','fetch-sqlite-runtime-sources.mjs','build-sqlite-runtime.sh']) {
    assert.doesNotMatch(readFileSync(new URL(`./${path}`,import.meta.url),'utf8'),/dockerfile-inverse-fixture|historicalRuntimeDockerfileFixture/);
  }
});

test('complete consumer inventory rejects missing, extra, changed and role-crossed native users', () => {
  const api = manifest.abiContract.consumers.map(row=>structuredClone(row));
  const web = api.filter(row=>row.images.includes('web'));
  checkConsumerInventory(api,'api');checkConsumerInventory(web,'web');
  assert.throws(()=>checkConsumerInventory(web,'api'),/path set changed/);
  assert.throws(()=>checkConsumerInventory(api,'web'),/path set changed/);
  assert.throws(()=>checkConsumerInventory([...api,{...api[0],path:'/usr/lib/new-user.so'}],'api'),/path set changed/);
  assert.throws(()=>checkConsumerInventory([{...api[0],sha256:'b'.repeat(64)},api[1]],'api'),/bytes or closure changed/);
  assert.throws(()=>checkConsumerInventory([{...api[0],undefinedSQLiteSymbols:[]},api[1]],'api'),/bytes or closure changed/);
  assert.throws(()=>checkConsumerInventory(api,'unknown'),/role required/);
});
