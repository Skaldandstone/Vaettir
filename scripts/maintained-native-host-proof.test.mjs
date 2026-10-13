import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const shell = readFileSync(new URL('./build-maintained-native-host-proof.sh', import.meta.url), 'utf8');
const python = new URL('./prepare-maintained-native-rootfs.py', import.meta.url);
const bash = process.platform === 'win32' && existsSync('C:/Program Files/Git/bin/bash.exe') ? 'C:/Program Files/Git/bin/bash.exe' : '/bin/bash';
test('host operator syntax, whole combined3500 budget and unchanged scratch recipe', () => {
  const r = spawnSync(bash, ['--noprofile', '--norc', '-n'], { input: shell, encoding: 'utf8', timeout: 10000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(shell, /deadline=\$\(\(started \+ 3500\)\)/);
  assert.match(shell, /remaining=\$\(\(deadline - \$\(date \+%s\)\)\)/);
  assert.match(shell, /--target maintained-native-environment/);
  assert.match(shell, /--build-context "maintained-native=\$release\/rootfs"/);
  assert.match(shell, /--target runtime-security-proof/);
  assert.match(shell, /268435456/);
  assert.doesNotMatch(shell, /docker (?:push|run|start)|--privileged|--security-opt|\baws\b|\bsysctl\b|rm -|migrate deploy/);
});
test('compiler export is owned, never started, whole validated before isolated execution', () => {
  for (const token of ["a.equal(c.State.Status,'created')", "a.equal(c.State.Running,false)", "a.equal(c.HostConfig.Privileged,false)", "a.equal(c.HostConfig.Binds,null)", "a.deepEqual(c.Mounts,[])", 'unset GH_TOKEN GITHUB_TOKEN', 'docker export "$cid"', 'prepare-maintained-native-rootfs.py', 'rootfsCopyProcedureReviewed:true']) assert.ok(shell.includes(token), token);
  assert.ok(shell.indexOf('prepare-maintained-native-rootfs.py') < shell.indexOf('"$release/host-check.sh" --parent'));
  for (const name of ['runtime-security-sources.json', 'fetch-runtime-security-sources.mjs', 'fetch-freetype-test-corpus.mjs', 'build-maintained-runtime.sh', 'runtime-build-proof.mjs', 'watch-native-build-logs.mjs']) assert.ok(shell.includes("'"+name+"'"));
  assert.match(shell, /native:false,installedFamily:false,cid:false,security:false,deployment:false/);
});
test('pure finite tar parser accepts ordinary metadata and refuses unsafe or unrecognized archive input', () => {
  const program = String.raw`
import ast,importlib.util,io,sys,tarfile
sys.dont_write_bytecode=True
p=sys.argv[1]
with open(p,'r') as f: ast.parse(f.read())
s=importlib.util.spec_from_file_location('owned_reader',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
def archive(entries,format=tarfile.USTAR_FORMAT):
 b=io.BytesIO()
 with tarfile.open(fileobj=b,mode='w',format=format) as t:
  for name,kind,data,target in entries:
   x=tarfile.TarInfo(name);x.mode=0o755 if kind==tarfile.DIRTYPE or name=='usr/bin/[' else 0o644;x.type=kind;x.linkname=target;x.size=len(data)
   t.addfile(x,io.BytesIO(data))
 return b.getvalue()
def parse(b): return m.read_entries(io.BytesIO(b),len(b))
def refused(b):
 try: parse(b)
 except (AssertionError,UnicodeError,ValueError): return
 raise AssertionError('Unsafe archive admitted')
base=[('usr',tarfile.DIRTYPE,b'',''),('usr/bin',tarfile.DIRTYPE,b'',''),('usr/bin/tool',tarfile.REGTYPE,b'abc','')]
r=parse(archive(base));assert len(r)==3 and r[-1]['size']==3
assert m.path_name('usr/bin/[')=='usr/bin/['
assert m.path_name('usr/lib/python3/dist-packages/setuptools/_vendor/jaraco/text/Lorem ipsum.txt').endswith('Lorem ipsum.txt')
parse(archive(base+[('usr/bin/ordinary data.txt',tarfile.REGTYPE,b'plain synthetic data','')]))
assert m.path_name('usr/lib/python3/dist-packages/setuptools/script (dev).tmpl').endswith('script (dev).tmpl')
parse(archive(base+[('usr/bin/ordinary (dev).txt',tarfile.REGTYPE,b'plain synthetic data','')]))
assert m.path_name('usr/share/aclocal/lt~obsolete.m4')=='usr/share/aclocal/lt~obsolete.m4'
parse(archive(base+[('usr/bin/ordinary~literal.txt',tarfile.REGTYPE,b'plain synthetic data','')]))
parse(archive(base+[('usr/bin/[',tarfile.REGTYPE,b'owned coreutils fixture','')]))
refused(archive(base+[('usr/bin/[',tarfile.DIRTYPE,b'','')]))
refused(archive(base+[('usr/bin/[',tarfile.SYMTYPE,b'','usr/bin/tool')]))
for value in ['usr/bin/[other]','usr/bin/*','usr/[bin]/tool','usr/bin/$(id)','usr/bin/[;id','usr/bin/ leading','usr/bin/trailing ','usr/bin/tab\tfile','usr/bin/new\nfile','usr/bin/../escape']:
 try: m.path_name(value)
 except AssertionError: pass
 else: raise AssertionError('Bracket exception expanded beyond exact coreutils path')
r=parse(archive(base+[('usr/bin/tool-link',tarfile.LNKTYPE,b'','usr/bin/tool')]));assert r[-1]['target']=='usr/bin/tool'
parse(archive(base+[('bin',tarfile.SYMTYPE,b'','usr/bin')]))
for extra in [[('../escape',tarfile.REGTYPE,b'a','')],[('/outside',tarfile.REGTYPE,b'a','')],[('usr/bin/tool',tarfile.REGTYPE,b'a','')],[('usr/bin/fifo',tarfile.FIFOTYPE,b'','')],[('usr/bin/device',tarfile.CHRTYPE,b'','')],[('usr/bin/hard',tarfile.LNKTYPE,b'','../escape')],[('usr/bin/alias',tarfile.SYMTYPE,b'','usr/bin'),('usr/bin/alias/child',tarfile.REGTYPE,b'a','')],[('missing/parent',tarfile.REGTYPE,b'a','')],[('usr/bin/self',tarfile.LNKTYPE,b'','usr/bin/self')]]:
 refused(archive(base+extra))
b=archive(base);refused(b[:-9000]);refused(b[:148]+b'0000000\0'+b[156:]);refused(b[:-512]+b'X'+bytes(511))
refused(archive(base+[('usr/bin/unsafe*one',tarfile.REGTYPE,b'a',''),('usr/bin/unsafe;two',tarfile.REGTYPE,b'b','')]))
assert len(m.FAILURE_CONTEXT['rejectedPathHeaders'])==2
assert [x['pathPrefix'] for x in m.FAILURE_CONTEXT['rejectedPathHeaders']]==['usr/bin/unsafe*one','usr/bin/unsafe;two']
parse(archive(base));assert 'rejectedPathHeaders' not in m.FAILURE_CONTEXT
long='usr/bin/'+('x'*110);parse(archive(base+[(long,tarfile.REGTYPE,b'ok','')],tarfile.PAX_FORMAT))
try: m.pax_records(b'31 SCHILY.xattr.security.cap=x\n')
except AssertionError: pass
else: raise AssertionError('Unreviewed xattr admitted')
print('finite parser fixtures passed; extraction/native execution NOT performed')
`;
  const command = process.platform === 'win32' ? 'py' : 'python3';
  const args = [...(process.platform === 'win32' ? ['-3'] : []), '-I', '-c', program, decodeURIComponent(python.pathname).replace(/^\/(?:([A-Za-z]:))/, '$1')];
  const r = spawnSync(command, args, { encoding: 'utf8', timeout: 10000, maxBuffer: 8192 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /finite parser fixtures passed/);
});
test('finite rootfs extractor never uses generic extraction or executes archived code', () => {
  const source = readFileSync(python, 'utf8');
  assert.doesNotMatch(source, /(?:^|\n)(?:import|from) (?:tarfile|subprocess|shutil)|\.extractall\(|os\.system\(|\bexec\(/);
  assert.match(source, /rows = read_entries\(f, s\.st_size\)[\s\S]*?changed = extract_owned/);
  assert.match(source, /MAX_ENTRIES = 100000/); assert.match(source, /MAX_TOTAL = 8 \* 1024\*\*3/);
  assert.match(source, /source\.get\('kind'\) in \('0', '\\0'\)/);
  assert.match(source, /materializedHardlinks=changed/);
  assert.match(source, /rootArtifactAcceptance=False, deploymentAcceptance=False/);
});
test('optional isolated job keeps full CI, original proof lane and failsafe evidence', () => {
  const ci = readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');
  const job = ci.slice(ci.indexOf('  maintained-native-host-proof:'), ci.indexOf('  llvm-configure-diagnostic:'));
  assert.match(ci, /maintained_native_host_proof:[\s\S]*?default: false/);
  assert.match(job, /runs-on: ubuntu-22\.04/); assert.match(job, /timeout-minutes: 60/);
  assert.match(job, /persist-credentials: false/); assert.match(job, /contents: read/);
  assert.match(job, /if: always\(\)/); assert.match(job, /tst-wordexp-tilde\.out/); assert.match(job, /tst-origin-secure\.out/);
  assert.match(job, /retention-days: 1/); assert.match(job, /compression-level: 0/);
  assert.match(ci, /  build:\n    runs-on: ubuntu-latest/);
  assert.match(ci, /  maintained-native-proof:\n/);
  assert.match(ci, /name: Verify standalone native image receipt packaging/);
  assert.doesNotMatch(job, /id-token: write|secrets\.|\baws\b|--privileged|--security-opt|migrate deploy/);
});
