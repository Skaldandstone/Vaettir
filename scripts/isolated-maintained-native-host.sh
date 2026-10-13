#!/bin/bash
# Root-reviewed copy/isolation PROCEDURE only, never artifact/native acceptance.
# The authorization record permits a pinned reviewed collection procedure.
# Its observed image/inventory tuple is producer custody, NOT Root artifact review.
set -euo pipefail
PATH=/usr/bin:/bin:/usr/sbin:/sbin
export PATH
fail() { printf '%s\n' 'Native host isolation admission refused' >&2; exit 1; }
safe_absolute() { [[ $1 =~ ^/[A-Za-z0-9_./-]+$ && $1 != *'/../'* && $1 != */.. && $1 != *'/./'* && $1 != *'//'* ]]; }
[[ $# == 4 ]] || fail
mode=$1; release=$2; review=$3; review_sha=$4
[[ $mode == --parent || $mode == --inside ]] || fail
safe_absolute "$release" && safe_absolute "$review" || fail
[[ $review == "$release/root-review.json" && $review_sha =~ ^[a-f0-9]{64}$ ]] || fail
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || fail
if [[ $mode == --parent ]]; then
  [[ $EUID != 0 && ${CI:-} == true && ${GITHUB_ACTIONS:-} == true && -n ${RUNNER_TEMP:-} ]] || fail
else
  [[ $EUID == 0 ]] || fail
fi
# Host Python is ONLY fixed validation code; no Root/corpus/package code import.
# All failures are generic; do not expose environment/config/credential values.
/usr/bin/python3 -I - "$mode" "$release" "$review" "$review_sha" <<'ADMIT'
import hashlib,json,os,re,stat,sys,time
def sha(b): return hashlib.sha256(b).hexdigest()
def regular(path,max_bytes):
 s=os.lstat(path); assert stat.S_ISREG(s.st_mode) and s.st_nlink==1 and 0<s.st_size<=max_bytes
 with open(path,'rb') as f: b=f.read(max_bytes+1)
 assert len(b)==s.st_size
 return b
def admission():
 mode,release,review,pin=sys.argv[1:]
 assert os.path.realpath(release)==release and os.path.realpath(review)==review
 raw=regular(review,65536); assert sha(raw)==pin
 r=json.loads(raw); assert set(r)==set(['purpose','commit','runId','attempt','releaseDir','rootfsDev','rootfsIno','ownerUid','createdAt','rootfsImageDigest','rootfsInventorySha256','wrapperSha256','jobs','rootfsCopyProcedureReviewed','acceptance'])
 assert r['purpose']=='reviewed-isolated-native-host-procedure/v1' and r['releaseDir']==release
 assert re.fullmatch('[a-f0-9]{40}',r['commit']) and re.fullmatch('[1-9][0-9]{0,19}',r['runId']) and type(r['attempt']) is int and 1<=r['attempt']<=100
 assert re.fullmatch('sha256:[a-f0-9]{64}',r['rootfsImageDigest']) and r['rootfsCopyProcedureReviewed'] is True
 assert all(type(r[k]) is int and r[k]>0 for k in ['rootfsDev','rootfsIno'])
 assert r['jobs']==4 and type(r['ownerUid']) is int and r['ownerUid']>0
 assert r['acceptance']==dict(native=False,installedFamily=False,cid=False,security=False,deployment=False)
 assert type(r['createdAt']) is int and 0<=time.time()-r['createdAt']<=3600
 s=os.lstat(release); assert stat.S_ISDIR(s.st_mode) and s.st_uid==r['ownerUid'] and stat.S_IMODE(s.st_mode)==0o700
 assert re.fullmatch(r'vaettir-native-host\.[A-Za-z0-9]{6,32}',os.path.basename(release))
 root=release+'/rootfs'; s=os.lstat(root)
 assert stat.S_ISDIR(s.st_mode) and os.path.realpath(root)==root and s.st_uid==r['ownerUid'] and stat.S_IMODE(s.st_mode)==0o755
 assert s.st_dev==r['rootfsDev'] and s.st_ino==r['rootfsIno']
 self_path=release+'/host-check.sh'; assert sha(regular(self_path,65536))==r['wrapperSha256']
 inventory_bytes=regular(release+'/rootfs.inventory.json',32*1024**2); assert sha(inventory_bytes)==r['rootfsInventorySha256']
 rows=json.loads(inventory_bytes); assert isinstance(rows,list) and 0<len(rows)<=100000
 expected={}; total=0
 for row in rows:
  assert set(row)==set(['path','type','mode','uid','gid','size','sha256','target'])
  p=row['path']; assert (p=='usr/bin/[' or re.fullmatch('[A-Za-z0-9_ ./+@,=:-]+',p)) and not p.startswith('/') and all(x not in ('','.','..') and x==x.strip() for x in p.split('/')) and p not in expected
  if p=='usr/bin/[': assert row['type']=='file' and row['mode']==0o755 and row['uid']==0 and row['gid']==0
  expected[p]=row
 actual={}
 for base,dirs,files in os.walk(root,followlinks=False):
  for name in dirs+files:
   path=os.path.join(base,name); p=os.path.relpath(path,root); s=os.lstat(path)
   if stat.S_ISREG(s.st_mode):
    assert s.st_nlink==1 and s.st_size<=512*1024**2
    total+=s.st_size; assert total<=8*1024**3
    h=hashlib.sha256()
    with open(path,'rb') as f:
     while True:
      b=f.read(1024**2)
      if not b: break
      h.update(b)
    kind,digest,target='file',h.hexdigest(),None
   elif stat.S_ISDIR(s.st_mode): kind,digest,target='dir',None,None
   elif stat.S_ISLNK(s.st_mode):
    kind,digest,target='symlink',None,os.readlink(path)
    assert re.fullmatch('[A-Za-z0-9_./+@,=:-]+',target)
    # Absolute links are interpreted under chroot, never host-realpath followed.
    logical=os.path.normpath(target if target.startswith('/') else '/'+os.path.dirname(p)+'/'+target)
    assert logical.startswith('/') and logical!='/' and not logical.startswith('/../')
   else: raise AssertionError()
   actual[p]=dict(path=p,type=kind,mode=stat.S_IMODE(s.st_mode),uid=s.st_uid,gid=s.st_gid,size=s.st_size,sha256=digest,target=target)
   assert len(actual)<=100000
 assert actual==expected
 pins={'build-maintained-runtime.sh':'633e3c977eef9d808ede8f6c9ba5ee78b5f96890fcb66cd7d3aaaad84a6cd07f','runtime-build-proof.mjs':'49884a1626756a412f2920d232d0362d177a3383c2c0e1d286183ec0622069d1','watch-native-build-logs.mjs':'edf3d3816f11d7b7fbbc66a3afdfee1975ee0205db657a1a8570d371e52b4695','runtime-security-sources.json':'f1cc5c7ca0c1a2778a7933b4384bc626a8623e8ec32db567c6891b52db0ee5ec','fetch-freetype-test-corpus.mjs':'1a3a851f6790b2dc12ef153cef32395e38046c9eea0ecec58505846be5532b30'}
 for name,pin in pins.items():
  path=root+'/build/scripts/'+name; assert os.path.realpath(path)==path and sha(regular(path,65536))==pin
 manifest=json.loads(regular(root+'/build/scripts/runtime-security-sources.json',65536))
 assert manifest['version']=='runtime-security-sources/v1' and set(manifest['components'])=={'glibc','freetype'}
 for component in ['glibc','freetype']:
  item=manifest['components'][component]
  for p in item['sourceFiles']+item['patches']:
   path=root+'/build/'+component+'-sources/'+p['name']; assert os.path.realpath(path)==path
   b=regular(path,128*1024**2); assert len(b)==p['bytes'] and sha(b)==p['sha256']
 for name,size,pin in [('original-corpus.zip',10757,'09fceee7c335975a454500b000f75ee7f7b5c4f14b2dc241d6416f77967e9d1b'),('As.I.Lay.Dying.ttf',23120,'ef146bbc2673b38715afcc70dca484cc64457438da8627a27cf95680e982f0a6')]:
  path=root+'/build/freetype-standard-corpus/'+name; assert os.path.realpath(path)==path
  b=regular(path,size); assert len(b)==size and sha(b)==pin
 assert not os.path.lexists(root+'/build/runtime-security')
 passwd=regular(root+'/etc/passwd',65536).decode('utf-8'); group=regular(root+'/etc/group',65536).decode('utf-8')
 assert len(re.findall(r'^node:x:1000:1000:[^\n]*:/home/node:/bin/bash$',passwd,re.M))==1
 assert len(re.findall(r'^node:x:1000:[^\n]*$',group,re.M))==1
 for p in ['proc','dev','sys','run','tmp','build','build/scripts']:
  path=root+'/'+p; assert os.path.realpath(path)==path and stat.S_ISDIR(os.lstat(path).st_mode)
 assert os.stat(root+'/build').st_uid==1000 and os.stat(root+'/build/scripts').st_uid==1000
 assert all(os.path.isfile(root+p) for p in ['/usr/bin/env','/usr/local/bin/node'])
 intent=release+'/host-once-intent.json'
 ns={k:os.readlink('/proc/self/ns/'+k) for k in ['mnt','pid','net']}
 if mode=='--parent':
  assert os.getuid()==r['ownerUid']
  rt=os.environ['RUNNER_TEMP']; assert os.path.realpath(rt)==rt and os.path.dirname(release)==rt
  assert os.environ['GITHUB_SHA']==r['commit'] and os.environ['GITHUB_RUN_ID']==r['runId'] and os.environ['GITHUB_RUN_ATTEMPT']==str(r['attempt'])
  with open(intent,'x') as f:
   os.chmod(intent,0o600); json.dump(dict(reviewSha256=sha(raw),rootfsDev=r['rootfsDev'],originalNamespaces=ns,nativeAccepted=False),f); f.flush(); os.fsync(f.fileno())
 else:
  previous=json.loads(regular(intent,4096)); assert previous['reviewSha256']==sha(raw) and previous['nativeAccepted'] is False
  assert all(ns[k]!=previous['originalNamespaces'][k] for k in ns)
try: admission()
except Exception:
 print('Native host source/identity admission refused',file=sys.stderr); sys.exit(1)
ADMIT
rootfs=$release/rootfs
if [[ $mode == --parent ]]; then
  # Exactly one bounded attempt. No GH_TOKEN or inherited loader/make settings.
  exec /usr/bin/sudo --non-interactive /usr/bin/env -i PATH="$PATH" LANG=C LC_ALL=C \
    /usr/bin/timeout --signal=TERM --kill-after=10 3500 \
    /usr/bin/unshare --mount --pid --fork --net --kill-child=TERM \
    /bin/bash --noprofile --norc "$release/host-check.sh" --inside "$release" "$review" "$review_sha"
fi
# PRIVATE namespaces only. No host bind mounts, /sys or whole /dev exposure.
/usr/bin/mount --make-rprivate /
[[ $(/usr/sbin/ip -o link show | /usr/bin/wc -l) == 1 ]] || fail
/usr/sbin/ip -o link show | /usr/bin/grep -Eq '^[0-9]+: lo:' || fail
/usr/sbin/ip link set lo up
/usr/bin/mount --bind "$rootfs" "$rootfs"
options=$(/usr/bin/findmnt -n -o OPTIONS --target "$rootfs")
[[ ,$options, != *,nosuid,* && ,$options, != *,noexec,* ]] || fail
/usr/bin/mount -t proc -o nosuid,nodev,noexec proc "$rootfs/proc"
/usr/bin/mount -t tmpfs -o mode=755,nosuid,noexec,size=16m tmpfs "$rootfs/dev"
for spec in 'null 1 3' 'zero 1 5' 'random 1 8' 'urandom 1 9' 'full 1 7' 'tty 5 0'; do
  read -r name major minor <<< "$spec"
  /usr/bin/mknod -m 666 "$rootfs/dev/$name" c "$major" "$minor"
done
/usr/bin/mkdir "$rootfs/dev/pts"
/usr/bin/mount -t devpts -o newinstance,ptmxmode=0666,mode=0620,gid=5,nosuid,noexec devpts "$rootfs/dev/pts"
/usr/bin/ln -s pts/ptmx "$rootfs/dev/ptmx"
/usr/bin/ln -s /proc/self/fd "$rootfs/dev/fd"
/usr/bin/ln -s /proc/self/fd/0 "$rootfs/dev/stdin"
/usr/bin/ln -s /proc/self/fd/1 "$rootfs/dev/stdout"
/usr/bin/ln -s /proc/self/fd/2 "$rootfs/dev/stderr"
# Normal POSIX shared-memory mount, private to this namespace, as in Docker.
/usr/bin/mkdir "$rootfs/dev/shm"
/usr/bin/mount -t tmpfs -o mode=1777,nosuid,nodev,noexec,size=64m tmpfs "$rootfs/dev/shm"
/usr/bin/mount -t tmpfs -o mode=755,nosuid,nodev,noexec,size=4m tmpfs "$rootfs/sys"
/usr/bin/mount -t tmpfs -o mode=755,nosuid,nodev,noexec,size=4m tmpfs "$rootfs/run"
# Original tst-origin-secure creates its normal suid helper under /tmp.
# Preserve that PRIVATE mount's ordinary suid/executable semantics too.
/usr/bin/mount -t tmpfs -o mode=1777,nodev,size=128m tmpfs "$rootfs/tmp"
# Check the actual pinned rootfs, original driver UID and ordinary nested user /
# mount namespaces BEFORE spending the full native compilation budget.
/usr/sbin/chroot --userspec=1000:1000 --groups=1000 "$rootfs" \
  /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/node LANG=C LC_ALL=C \
  /usr/bin/timeout 10 /usr/bin/unshare --user --map-root-user --mount --fork \
  /usr/bin/unshare --user --map-root-user --mount --fork /bin/true
printf '%s\n' 'NATIVE_HOST_PREREQUISITE nestedUserMountNamespacesPassed=true driverUid=1000 nativeAccepted=false deploymentAccepted=false' >&2
# Do not set no-new-privs/nosuid on the source root: original suid/nested-userns
# tests require ordinary isolated-host semantics. Driver UID1000 is preserved;
# original secure tests may become root INSIDE their own nested user namespace.
set +e
/usr/sbin/chroot --userspec=1000:1000 --groups=1000 "$rootfs" \
  /usr/bin/env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/home/node USER=node LOGNAME=node LANG=C LC_ALL=C VAETTIR_NATIVE_JOBS=4 \
  /bin/sh -c 'test "$(id -u)" = 1000 && test "$(id -g)" = 1000 && cd /build && exec /usr/local/bin/node /build/scripts/watch-native-build-logs.mjs /build/scripts/build-maintained-runtime.sh /build/scripts/runtime-security-sources.json /build/glibc-sources /build/freetype-sources /build/runtime-security /build/scripts/runtime-build-proof.mjs /build/freetype-standard-corpus' > /dev/null
status=$?
set -e
# Namespace teardown is automatic at init exit; no recursive removal/cleanup.
printf 'NATIVE_HOST_PROCEDURE_RESULT status=%s nativeAccepted=false deploymentAccepted=false\n' "$status" >&2
exit "$status"
