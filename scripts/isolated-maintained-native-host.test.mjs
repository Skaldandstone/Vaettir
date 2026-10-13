import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const text=readFileSync(new URL('./isolated-maintained-native-host.sh',import.meta.url),'utf8');
const guard=text.split('\n').find(line=>line.startsWith('safe_absolute()'));
const bash=process.platform==='win32'&&existsSync('C:/Program Files/Git/bin/bash.exe')?'C:/Program Files/Git/bin/bash.exe':'/bin/bash';
// These tests NEVER run host-check, sudo, namespace/native code or archived files.
test('pure extracted Bash lexical guard accepts finite paths and refuses escape/injection',()=>{
 const values=['/tmp/vaettir-native-host.abcdef','/tmp/owned/rootfs','/tmp/../escape','/tmp/..','/tmp//other','/tmp/./other','relative','/tmp/a b','/tmp/$(id)','/tmp/a;id','/tmp/a\nother'];
 const literal=value=>"'"+value.replaceAll("'","'\"'\"'")+"'";
 const program=guard+'\nfor value in '+values.map(literal).join(' ')+'; do if safe_absolute "$value"; then printf "yes\\n"; else printf "no\\n"; fi; done\n';
 const r=spawnSync(bash,['--noprofile','--norc','-s'],{input:program,encoding:'utf8',timeout:10000,maxBuffer:4096});
 assert.equal(r.status,0,r.stderr);assert.equal(r.stdout,'yes\nyes\n'+Array(9).fill('no\n').join(''));
});
test('complete wrapper Bash syntax only, never an operational mode',()=>{
 const r=spawnSync(bash,['--noprofile','--norc','-n'],{input:text,encoding:'utf8',timeout:10000,maxBuffer:4096});assert.equal(r.status,0,r.stderr);
});
test('review, full rootfs byte inventory and fresh once-only admission precede native namespace setup',()=>{
 for(const literal of ["sha(raw)==pin","r['rootfsCopyProcedureReviewed'] is True","actual==expected","s.st_nlink==1","total<=8*1024**3","root+'/build/runtime-security'","with open(intent,'x')","os.fsync(f.fileno())","os.environ['GITHUB_SHA']==r['commit']","all(ns[k]!=previous['originalNamespaces'][k] for k in ns)"])assert.ok(text.includes(literal),literal);
 assert.ok(text.indexOf("with open(intent,'x')")<text.indexOf('exec /usr/bin/sudo'));
 assert.match(text,/os\.path\.realpath\(root\)==root/);assert.match(text,/stat\.S_IMODE\(s\.st_mode\)==0o700/);assert.match(text,/time\.time\(\)-r\['createdAt'\]<=3600/);
});
test('protected original compiler files get fixed passive root verification, never permission relaxation or native root execution',()=>{
 assert.ok(text.includes('reader_command=(/usr/bin/sudo --non-interactive /usr/bin/env -i'));
 assert.ok(text.includes('VAETTIR_NATIVE_OWNER_UID="$EUID"'));
 assert.ok(text.includes("os.getuid()==0 and os.environ['VAETTIR_NATIVE_OWNER_UID']==str(r['ownerUid'])"));
 assert.ok(text.includes("os.chown(intent,r['ownerUid'],r['ownerUid'])"));
 assert.ok(text.includes('GITHUB_SHA="$GITHUB_SHA" GITHUB_RUN_ID="$GITHUB_RUN_ID" GITHUB_RUN_ATTEMPT="$GITHUB_RUN_ATTEMPT"'));
 assert.ok(text.includes('"${reader_command[@]}" <<\'ADMIT\''));
 assert.ok(text.indexOf('"${reader_command[@]}"')<text.indexOf('/usr/bin/mount --make-rprivate /'));
 assert.ok(text.includes('setpriv --reuid=1000 --regid=1000 --groups=1000 --inh-caps=-all --ambient-caps=-all'));
 const commands=text.split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
 assert.doesNotMatch(commands,/chmod[^\n]*(?:["']\$rootfs|shadow|passwd)|sudo[^\n]*(?:\/node\b|\/build\/scripts)/);
});
test('exact reviewed build/watch/manifest/proof/corpus Git LF bytes pinned; no runtime rewrites',()=>{
 const extractor=readFileSync(new URL('./prepare-maintained-native-rootfs.py',import.meta.url),'utf8');
 for(const name of ['build-maintained-runtime.sh','runtime-build-proof.mjs','watch-native-build-logs.mjs','runtime-security-sources.json','fetch-freetype-test-corpus.mjs']){
  const raw=readFileSync(new URL('./'+name,import.meta.url));const lf=Buffer.from(raw.toString().replaceAll('\r\n','\n'));const hash=createHash('sha256').update(lf).digest('hex');assert.ok(text.includes("'"+name+"':'"+hash+"'"));
  assert.ok(extractor.includes("'"+name+"': '"+hash+"'"),'Whole-export reader source pin must agree with namespace admission and Git LF bytes: '+name);
 }
 assert.match(text,/manifest\['version'\]=='runtime-security-sources\/v1'/);assert.match(text,/p\['bytes'\].*p\['sha256'\]/);
 assert.ok(text.includes('09fceee7c335975a454500b000f75ee7f7b5c4f14b2dc241d6416f77967e9d1b'));assert.ok(text.includes('ef146bbc2673b38715afcc70dca484cc64457438da8627a27cf95680e982f0a6'));
});
test('temporary mount/PID/net isolation with loopback only; no host bind exposure',()=>{
 const launcher=readFileSync(new URL('./launch-maintained-native-namespace.py',import.meta.url),'utf8');
 // Ubuntu22's existing unshare lacks the newer multi-map CLI options. The
 // fixed owned-child launcher writes only its new namespace's exact map once.
 assert.ok(launcher.includes("['/usr/bin/unshare', '--user', '--keep-caps', '--mount', '--pid', '--fork', '--net', '--kill-child=KILL'"));
 assert.ok(text.includes('/usr/bin/python3 -I "$release/host-namespace-launcher.py" "$release" "$review_sha"'));
 assert.doesNotMatch(text,/--map-users=|--map-groups=/);
 assert.ok(text.includes("['mnt','pid','net','user']"));
 assert.ok(text.includes("f.read().split()==['0','0','65536']"));
 assert.doesNotMatch(text,/\/etc\/subuid|\/etc\/subgid|--map-auto|--map-users=auto|--map-groups=auto/);
 assert.match(text,/setpriv --reuid=1000 --regid=1000 --groups=1000[\s\S]*?unshare --user --map-root-user --mount --fork/);
 assert.ok(text.includes('mount --make-rprivate /'));assert.ok(text.includes('ip -o link show | /usr/bin/wc -l) == 1'));assert.ok(text.includes("'^[0-9]+: lo:'"));
 const binds=text.split('\n').filter(line=>line.includes('mount --bind')).map(line=>line.trim());assert.deepEqual(binds,['/usr/bin/mount --bind "$rootfs" "$rootfs"','/usr/bin/mount --bind "$release/virtual-devices" "$rootfs/dev"']);
 assert.match(text,/mount -t proc -o nosuid,nodev,noexec proc "\$rootfs\/proc"/);assert.match(text,/devpts -o newinstance/);
 assert.match(text,/tmpfs "\$rootfs\/sys"/);assert.match(text,/tmpfs "\$rootfs\/run"/);
 assert.match(text,/mount -t tmpfs -o mode=1777,nodev,size=2g tmpfs "\$rootfs\/tmp"/);
 const privateTmp=text.split('\n').find(line=>line.startsWith('/usr/bin/mount ')&&line.endsWith('"$rootfs/tmp"'));
 assert.ok(privateTmp);assert.doesNotMatch(privateTmp,/nosuid|noexec/);
});
test('fixed ordinary devices only, isolated devpts, no sockets or host devices',()=>{
 assert.ok(text.includes("('null',1,3),('zero',1,5),('random',1,8),('urandom',1,9),('full',1,7),('tty',5,0)"));assert.ok(text.includes('ln -s pts/ptmx'));assert.ok(text.includes('ln -s /proc/self/fd'));
 for(const fd of [0,1,2])assert.ok(text.includes('ln -s /proc/self/fd/'+fd));
 assert.match(text,/mount -t tmpfs -o mode=1777,nosuid,nodev,noexec,size=64m tmpfs "\$rootfs\/dev\/shm"/);
 assert.ok(text.includes('stat.S_ISCHR(s.st_mode) and s.st_nlink==1'));
 assert.ok(text.includes("s.st_rdev==os.makedev(major,minor)"));
 assert.doesNotMatch(text,/\/dev\/(?:kvm|fuse|mem|dri|nvidia|docker)|docker\.sock|--rbind/);
});

test('owned virtual directory preserves normal descriptor filesystem identity and bounded full-suite scratch space',()=>{
 assert.ok(text.includes('chmod 755 "$release/virtual-devices"'));
 assert.ok(text.includes('mount -o remount,bind,nosuid,noexec "$rootfs/dev"'));
 assert.ok(text.includes('for name in null zero random urandom full tty; do'));
 assert.ok(text.includes('stat -c %d "$rootfs/dev/$name") == "$device_fs"'));
 assert.ok(text.includes("df -Pk \"$rootfs/tmp\" | /usr/bin/awk 'NR == 2 {print $4}') -ge 1048576"));
 assert.ok(text.indexOf('stat -c %d "$rootfs/dev/$name"')<text.indexOf('/usr/bin/setpriv --reuid=1000'));
 assert.doesNotMatch(text,/mount --bind \/dev|mount --rbind|size=128m/);
});
test('native UID1000, clean env, combined timeout3500/four workers and original stderr/status',()=>{
 assert.ok(text.includes('setpriv --reuid=1000 --regid=1000 --groups=1000'));assert.ok(text.includes('test "$(id -u)" = 1000'));assert.ok(text.includes('cd /build && exec'));
 assert.ok(text.includes('/usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/node'));assert.ok(text.includes('VAETTIR_NATIVE_JOBS=4'));
 assert.ok(text.includes('/usr/bin/timeout --signal=TERM --kill-after=10 3500'));assert.ok(text.includes('> /dev/null\nstatus=$?'));
 assert.ok(text.includes('exit "$status"'));assert.doesNotMatch(text,/2>\s*\/dev\/null|2>&1/);
 assert.equal(text.split('/^Cap(Eff|Prm|Amb):/').length-1,2);
 assert.equal(text.split('if ($2 != "0000000000000000") exit 1; seen++').length-1,2);
});
test('private namespace root replaces chroot and detaches host root before driver or nested namespace tests',()=>{
 assert.ok(text.includes('/usr/sbin/pivot_root . .old-native-root'));
 assert.ok(text.includes('/usr/bin/umount -l /.old-native-root'));
 assert.ok(text.includes('[[ ! -e /.old-native-root/etc/passwd ]] || fail'));
 assert.ok(text.indexOf('/usr/bin/umount -l /.old-native-root')<text.indexOf('/usr/bin/setpriv --reuid=1000'));
 assert.doesNotMatch(text,/\/usr\/sbin\/chroot|chroot --userspec|--bounding-set/);
 assert.equal(text.split('--inh-caps=-all --ambient-caps=-all').length-1,2);
});
test('no host/account/security mutation, cleanup, acceptance, filtering or Root namespace privilege bypass',()=>{
 const commands=text.split('\n').filter(line=>!line.trimStart().startsWith('#')).join('\n');
 assert.doesNotMatch(commands,/\bsysctl\b|apparmor|seccomp|--privileged|useradd|groupadd|chmod\s+-R|chown\s+-R|rm\s+-|curl\s|wget\s|GH_TOKEN|GITHUB_TOKEN|LD_PRELOAD=|nocheck|stage2|tests=|subdirs=/);
 assert.ok(text.includes("dict(native=False,installedFamily=False,cid=False,security=False,deployment=False)"));assert.ok(text.includes('nativeAccepted=false deploymentAccepted=false'));
 assert.ok(text.includes(',$options, != *,nosuid,*'));assert.ok(text.includes(',$options, != *,noexec,*'));
});
test('admission failure location exposes only fixed source position, never inspected values',()=>{
 assert.ok(text.includes('traceback.extract_tb(error.__traceback__)[-1]'));
 assert.ok(text.includes("'NATIVE_HOST_ADMISSION_REFUSED function='+location.name+' line='+str(location.lineno)+' errorClass='+type(error).__name__"));
 assert.doesNotMatch(text,/print\([^\n]*(?:str\(error\)|repr\(error\)|traceback\.format|os\.environ|passwd|group|json\.dumps)/);
});
