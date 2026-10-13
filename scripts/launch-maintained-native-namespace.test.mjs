import test from 'node:test';import assert from 'node:assert/strict';import{readFileSync}from'node:fs';import{spawnSync}from'node:child_process';
const file=new URL('./launch-maintained-native-namespace.py',import.meta.url),text=readFileSync(file,'utf8');
test('namespace launcher is syntax/pure mapping fixtures only, never a root/kernel/native execution in this test',()=>{
 const code=String.raw`import ast,importlib.util,sys
sys.dont_write_bytecode=True
p=sys.argv[1]
with open(p,'r') as f: ast.parse(f.read())
s=importlib.util.spec_from_file_location('mapper',p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
m.require_identity_map(b'0 0 65536\n')
for bad in [b'',b'0 100000 65536\n',b'0 0 1\n',b'1000 1000 65536\n',b'0 0 65536\n1 1 1\n',b'0 0 65536;id\n']:
 try: m.require_identity_map(bad)
 except AssertionError: pass
 else: raise AssertionError('nonidentity/partial/additional mapping accepted')
print('pure mapper syntax/map fixtures passed; kernel/native NOT executed')
`;
 const command=process.platform==='win32'?'py':'python3',args=[...(process.platform==='win32'?['-3']:[]),'-I','-c',code,decodeURIComponent(file.pathname).replace(/^\/([A-Za-z]:)/,'$1')];
 const r=spawnSync(command,args,{encoding:'utf8',timeout:10000,maxBuffer:8192});assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/pure mapper syntax/);
});
test('only direct owned child proc-FD may receive once-only maps before a private pipe release',()=>{
 for(const token of ['child = subprocess.Popen(args','str(child.pid)','os.O_DIRECTORY | os.O_NOFOLLOW','int(fields[1]) == os.getpid()',"user_ns != intent['originalNamespaces']['user']",'child.poll() is None',"f.read(4096).strip() == b''",'f.write(UID_GID_MAP) == len(UID_GID_MAP)','require_identity_map(value)','child.stdin.write(READY) == len(READY)'])assert.ok(text.includes(token),token);
 assert.ok(text.indexOf('require_identity_map(value)')<text.indexOf('child.stdin.write(READY)'));
 assert.ok(text.includes("UID_GID_MAP = b'0 0 65536\\n'"));
 assert.ok(text.includes("'--kill-child=KILL'"));
 assert.doesNotMatch(text,/\/etc\/subuid|\/etc\/subgid|useradd|groupadd|newuidmap|newgidmap|sysctl|setcap|shell=True|os\.system/);
});
test('fixed clean host commands, exact launcher/wrapper identity and no untrusted script interpolation or process targets',()=>{
 for(const token of ["os.getuid() == 0",'review_sha',"review['launcherSha256']","review['wrapperSha256']","env=dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='C', LC_ALL='C')",'"$1/host-check.sh" --inside','child.terminate()','child.kill()','nativeAccepted=False, deploymentAccepted=False'])assert.ok(text.includes(token),token);
 assert.doesNotMatch(text,/GH_TOKEN|GITHUB_TOKEN|LD_PRELOAD|MAKEFLAGS|\bkill\(\s*(?:int\(|sys\.argv)/);
 assert.ok(text.includes("os.chmod(f.fileno(), 0o600)"));assert.ok(text.includes('os.fsync(f.fileno())'));
 assert.ok(text.includes("VIRTUAL_DEVICES = [('null', 1, 3), ('zero', 1, 5), ('random', 1, 8), ('urandom', 1, 9), ('full', 1, 7), ('tty', 5, 0)]"));
 assert.ok(text.includes("virtual = release+'/virtual-devices'"));assert.ok(text.includes('os.mknod(path, stat.S_IFCHR | 0o666, os.makedev(major, minor))'));
 assert.doesNotMatch(text,/\/dev\/(?:null|zero|random|urandom|tty|mem|dri|kvm|nvidia)|docker\.sock/);
 const operator=readFileSync(new URL('./build-maintained-native-host-proof.sh',import.meta.url),'utf8');assert.ok(operator.includes('cp scripts/launch-maintained-native-namespace.py "$release/host-namespace-launcher.py"'));assert.ok(operator.includes('launcherSha256:sha(fs.readFileSync(p+\'/host-namespace-launcher.py\'))'));
});
