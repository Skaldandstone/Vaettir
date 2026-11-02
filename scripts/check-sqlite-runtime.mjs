import {readFileSync, realpathSync, writeFileSync, readdirSync} from 'node:fs';
import {execFileSync} from 'node:child_process';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {manifest, digest} from './fetch-sqlite-runtime-sources.mjs';

const assert = (condition, message) => { if (!condition) throw Error(message); };
const hashFile = path => digest(readFileSync(path));
const run = (exe, args, options = {}) => execFileSync(exe, args, {encoding:'utf8', timeout:120000, maxBuffer:16*1024*1024, ...options});

export function parseIdentity(text) {
  const lines = text.trim().split(/\r?\n/);
  const field = name => {
    const values = lines.filter(line => line.startsWith(`${name}=`));
    assert(values.length === 1, `Missing or duplicate ${name}`);
    return values[0].slice(name.length + 1);
  };
  const options = lines.filter(line => line.startsWith('OPTION=')).map(line => line.slice(7));
  assert(options.length > 10 && new Set(options).size === options.length, 'Missing or duplicate SQLite options');
  return {version:field('VERSION'), sourceId:field('SOURCE_ID'), library:field('LIBRARY'), options};
}

export function checkOptions(candidate, baseline) {
  const required = ['ENABLE_COLUMN_METADATA','ENABLE_FTS3','ENABLE_FTS3_PARENTHESIS','ENABLE_FTS4','ENABLE_FTS5',
    'ENABLE_RTREE','ENABLE_UNLOCK_NOTIFY','ENABLE_DBSTAT_VTAB','ENABLE_DBPAGE_VTAB','ENABLE_UPDATE_DELETE_LIMIT',
    'ENABLE_LOAD_EXTENSION','ENABLE_FTS3_TOKENIZER','ENABLE_PREUPDATE_HOOK','ENABLE_SESSION','ENABLE_STMTVTAB',
    'SECURE_DELETE','SOUNDEX','LIKE_DOESNT_MATCH_BLOBS','THREADSAFE=1','USE_URI','MAX_VARIABLE_NUMBER=250000'];
  for (const option of new Set([...required, ...baseline.filter(value => /^(ENABLE_|SECURE_DELETE|SOUNDEX|LIKE_DOESNT_MATCH_BLOBS|THREADSAFE=|USE_URI)/.test(value))])) {
    assert(candidate.includes(option), `SQLite capability lost: ${option}`);
  }
  assert(!candidate.some(option => option.startsWith('OMIT_') && !baseline.includes(option)), 'New SQLite OMIT option');
  for (const option of baseline.filter(value => /^MAX_[A-Z_]+=\d+$/.test(value))) {
    const [key, floor] = option.split('=');
    const value = candidate.find(row => row.startsWith(`${key}=`));
    assert(value && Number(value.split('=')[1]) >= Number(floor), `SQLite limit reduced: ${key}`);
  }
}

export function checkUpstreamLog(text, markers) {
  assert(text.length < 16*1024*1024, 'Test log too large');
  assert(!/AddressSanitizer|UndefinedBehaviorSanitizer|runtime error:|FAILED|Segmentation fault|ERROR SUMMARY: [1-9]/i.test(text), 'Native regression diagnostic');
  const summaries = [...text.matchAll(/^(\d+) errors out of (\d+) tests on .+$/gm)];
  assert(summaries.length === 1 && Number(summaries[0][1]) === 0 && Number(summaries[0][2]) > 0, 'Missing nonempty upstream test success');
  for (const marker of markers) {
    const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert(new RegExp(`^${escaped}\\.{3}\\s*Ok\\s*$`, 'm').test(text), `Required regression did not run: ${marker}`);
  }
  return Number(summaries[0][2]);
}

export function checkExports(candidate, baseline) {
  assert(baseline.length > 100 && candidate.length >= baseline.length, 'Incomplete SQLite symbol inventory');
  for (const symbol of baseline) assert(candidate.includes(symbol), `SQLite ABI export lost: ${symbol}`);
}

export function checkElfHeader(bytes) {
  assert(bytes.length >= 64 && bytes.subarray(0,4).equals(Buffer.from([127,69,76,70])) &&
    bytes[4] === 2 && bytes[5] === 1 && bytes.readUInt16LE(16) === 3 && bytes.readUInt16LE(18) === 62,
  'Expected x86-64 little-endian shared ELF');
}

export function checkNegativeControl(status, stdout, stderr = '') {
  assert(status === 42 && stdout.trim() === 'WAL_TAIL_UNINITIALIZED:3584' && stderr === '', 'Negative control did not reproduce the exact WAL defect');
}

function candidateIdentity(text, baseline) {
  const identity = parseIdentity(text);
  assert(identity.version === manifest.version && identity.sourceId === manifest.sourceId, 'SQLite compiled source identity mismatch');
  checkOptions(identity.options, baseline.options);
  return identity;
}

function record(root) {
  const baselinePath = join(root,'baseline','libsqlite3.so.0');
  assert(hashFile(baselinePath) === manifest.baselineLibrarySha256, 'Unreviewed baseline SQLite bytes');
  const library = join(root,'libsqlite3.so.0.8.6');
  checkElfHeader(readFileSync(library));
  const baseline = parseIdentity(readFileSync(join(root,'baseline-identity.txt'),'utf8'));
  assert(baseline.version === '3.46.1', 'Unexpected baseline version');
  const identityText = run(join(root,'sqlite-runtime-regression'), [], {env:{...process.env,LD_LIBRARY_PATH:root}});
  const candidate = candidateIdentity(identityText, baseline);
  assert(realpathSync(candidate.library) === realpathSync(library), 'Probe loaded another SQLite library');
  assert(identityText.includes('COUNT_VALUES_REJECTED:400000\nSQLITE_FUNCTIONAL_OK'), 'Missing functional regressions');
  const exportsOf = path => run('nm',['-D','--defined-only','--format=posix',path]).trim().split('\n').map(line=>line.split(/\s/)[0]).sort();
  const baselineExports = exportsOf(baselinePath), candidateExports = exportsOf(library);
  checkExports(candidateExports, baselineExports);
  const dynamic = run('readelf',['--dynamic','--wide',library]);
  assert(dynamic.includes('Library soname: [libsqlite3.so.0]') && !/\((?:RPATH|RUNPATH)\)/.test(dynamic), 'SQLite SONAME or loader path mismatch');
  const tests = [];
  for (const mode of ['release','sanitizer']) for (const test of manifest.upstreamTests) {
    const file = `${mode}-${test.path.replaceAll('/','_')}.log`;
    const bytes = readFileSync(join(root,'logs',file));
    tests.push({file,sha256:digest(bytes),count:checkUpstreamLog(bytes.toString('utf8'),test.requiredMarkers)});
  }
  for (const name of ['wal-release','wal-sanitizer']) {
    assert(readFileSync(join(root,'logs',`${name}.log`),'utf8').trim() === 'WAL_TAIL_ZEROED:3584', 'WAL positive regression failed');
  }
  checkNegativeControl(Number(readFileSync(join(root,'logs','wal-negative.status'),'utf8')),
    readFileSync(join(root,'logs','wal-negative.log'),'utf8'),readFileSync(join(root,'logs','wal-negative.stderr'),'utf8'));
  const sanitized = readFileSync(join(root,'logs','functional-sanitizer.log'),'utf8');
  assert(sanitized.includes('COUNT_VALUES_REJECTED:400000\nSQLITE_FUNCTIONAL_OK') &&
    !/AddressSanitizer|runtime error:/.test(sanitized), 'Sanitized functional regression failed');
  assert(readFileSync(join(root,'logs','nss-dynamic.txt'),'utf8').includes('Shared library: [libsqlite3.so.0]'), 'NSS dependency proof absent');
  assert(readFileSync(join(root,'logs','nss-list.log'),'utf8').includes('Certificate Nickname'), 'NSS certificate store proof absent');
  const logs = readdirSync(join(root,'logs')).sort().map(file=>({file,sha256:hashFile(join(root,'logs',file))}));
  const proof = {schemaVersion:1, sourceCommit:process.env.VAETTIR_SQLITE_SOURCE_COMMIT, logs,
    manifestSha256:hashFile(new URL('./sqlite-runtime-sources.json',import.meta.url)),
    librarySha256:hashFile(library), probeSha256:hashFile(join(root,'sqlite-runtime-regression')),
    packageSha256:hashFile(join(root,'libsqlite3-0_3.54.1-0+vaettir1_amd64.deb')),
    generatedSourceSha256:hashFile(join(root,'release','sqlite3.c')),
    baselineLibrarySha256:hashFile(baselinePath),baseline,candidate,baselineExports,candidateExports,tests};
  writeFileSync(join(root,'sqlite-runtime-proof.json'), `${JSON.stringify(proof,null,2)}\n`, {flag:'wx'});
}

function installed(directory) {
  const proof = JSON.parse(readFileSync(join(directory,'sqlite-runtime-proof.json'),'utf8'));
  assert(proof.schemaVersion === 1 && proof.manifestSha256 === hashFile(new URL('./sqlite-runtime-sources.json',import.meta.url)) &&
    proof.baselineLibrarySha256 === manifest.baselineLibrarySha256, 'SQLite proof identity mismatch');
  assert(proof.tests.length === 16 && proof.tests.every(row=>row.count>0 && /^[a-f0-9]{64}$/.test(row.sha256)), 'Incomplete upstream proof');
  checkExports(proof.candidateExports, proof.baselineExports);
  checkElfHeader(readFileSync(manifest.libraryPath));
  assert(hashFile(manifest.libraryPath) === proof.librarySha256, 'Installed SQLite differs from tested artifact');
  const probe = join(directory,'sqlite-runtime-regression');
  assert(hashFile(probe) === proof.probeSha256, 'SQLite probe hash mismatch');
  const identity = candidateIdentity(run(probe,['--identity'],{env:{...process.env,LD_LIBRARY_PATH:'',LD_PRELOAD:''}}), proof.baseline);
  assert(realpathSync(identity.library) === realpathSync(manifest.libraryPath), 'Runtime loads another SQLite library');
  const pkg = run('dpkg-query',['-W','-f=${Status}\n${Version}\n${source:Version}\n${Architecture}\n','libsqlite3-0']).trim();
  assert(pkg === `install ok installed\n${manifest.packageVersion}\n${manifest.packageVersion}\namd64`, 'SQLite package metadata mismatch');
  assert(run('dpkg-query',['-S',manifest.libraryPath]).trim() === `libsqlite3-0:amd64: ${manifest.libraryPath}`, 'SQLite package ownership mismatch');
  console.log(JSON.stringify({version:identity.version,sourceId:identity.sourceId,librarySha256:proof.librarySha256}));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert(process.argv.length === 4, 'Use --record BUILD_ROOT or --installed PROOF_DIRECTORY');
  if (process.argv[2] === '--record') record(process.argv[3]);
  else if (process.argv[2] === '--installed') installed(process.argv[3]);
  else throw Error('Unknown SQLite checker mode');
}
