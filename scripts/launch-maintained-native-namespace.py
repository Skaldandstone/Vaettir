#!/usr/bin/python3
"""Existing Ubuntu22 unshare with an owned-child, once-only pass-through map.

No account/subuid/policy edit, namespace persistence or archived-code import.
Native execution still enters the separately pinned wrapper/chroot as UID1000.
"""
import hashlib
import json
import os
import re
import stat
import subprocess
import sys
import time


READY = b'VAETTIR_NATIVE_NAMESPACE_MAP_READY\n'
UID_GID_MAP = b'0 0 65536\n'


def require_identity_map(value):
    assert isinstance(value, bytes) and len(value) <= 4096
    assert value.split() == [b'0', b'0', b'65536']


def regular(path, limit):
    s = os.lstat(path)
    assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 < s.st_size <= limit
    with open(path, 'rb') as f:
        b = f.read(limit+1)
    assert len(b) == s.st_size
    return b


def launch():
    assert len(sys.argv) == 3 and os.getuid() == 0
    release, review_sha = sys.argv[1:]
    assert re.fullmatch('/[A-Za-z0-9_./-]+', release) and os.path.realpath(release) == release
    assert re.fullmatch('[a-f0-9]{64}', review_sha)
    raw = regular(release+'/root-review.json', 65536)
    assert hashlib.sha256(raw).hexdigest() == review_sha
    review = json.loads(raw)
    assert review['releaseDir'] == release and review['acceptance'] == dict(native=False, installedFamily=False, cid=False, security=False, deployment=False)
    assert 0 <= time.time()-review['createdAt'] <= 3600
    assert hashlib.sha256(regular(release+'/host-namespace-launcher.py', 32768)).hexdigest() == review['launcherSha256']
    assert hashlib.sha256(regular(release+'/host-check.sh', 65536)).hexdigest() == review['wrapperSha256']
    intent = json.loads(regular(release+'/host-once-intent.json', 4096))
    assert intent['reviewSha256'] == review_sha and intent['nativeAccepted'] is False
    # Fixed host shell waits on a private pipe, not source/corpus/native code.
    # Positional parameters are data, never interpolated into the shell program.
    program = 'IFS= read -r ready; test "$ready" = VAETTIR_NATIVE_NAMESPACE_MAP_READY; exec /bin/bash --noprofile --norc "$1/host-check.sh" --inside "$1" "$1/root-review.json" "$2"'
    # util-linux2.37 already supports keep-caps: preserve only the new user
    # namespace's setup capabilities across the host-shell pipe wait/exec.
    # The separately checked chroot driver drops all caps at UID/GID1000.
    args = ['/usr/bin/unshare', '--user', '--keep-caps', '--mount', '--pid', '--fork', '--net', '--kill-child=KILL', '/bin/sh', '-eu', '-c', program, 'vaettir-native-owned-child', release, review_sha]
    child = subprocess.Popen(args, stdin=subprocess.PIPE, stdout=None, stderr=None,
                             env=dict(PATH='/usr/bin:/bin:/usr/sbin:/sbin', LANG='C', LC_ALL='C'))
    proc_fd = None
    try:
        # The PID comes only from this direct Popen child, never an input PID.
        # Pin its proc directory FD and direct parent before any mapping write.
        for _ in range(250):
            assert child.poll() is None
            try:
                fd = os.open('/proc/'+str(child.pid), os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
                with open('/proc/'+str(child.pid)+'/stat', 'r') as f:
                    fields = f.read().rsplit(')', 1)[1].split()
                assert int(fields[1]) == os.getpid()
                user_ns = os.readlink('ns/user', dir_fd=fd)
                if user_ns != intent['originalNamespaces']['user']:
                    proc_fd = fd
                    break
                os.close(fd)
            except FileNotFoundError:
                pass
            time.sleep(0.02)
        assert proc_fd is not None and child.poll() is None
        maps = {}
        for kind in ('uid', 'gid'):
            name = kind+'_map'
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=proc_fd)
            with os.fdopen(fd, 'rb') as f:
                assert f.read(4096).strip() == b''
            # Exactly one write to this OWNED NEW namespace. No retry/rebinding.
            fd = os.open(name, os.O_WRONLY | os.O_NOFOLLOW, dir_fd=proc_fd)
            with os.fdopen(fd, 'wb', buffering=0) as f:
                assert f.write(UID_GID_MAP) == len(UID_GID_MAP)
            fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=proc_fd)
            with os.fdopen(fd, 'rb') as f:
                value = f.read(4096)
            require_identity_map(value)
            maps[kind] = value.decode('ascii')
        record = dict(purpose='owned-temporary-native-namespace-map/v1', childPid=child.pid,
                      reviewSha256=review_sha, userNamespace=user_ns, maps=maps,
                      existingNumericIdsPreserved=True, accountOrPolicyChanged=False,
                      nativeAccepted=False, deploymentAccepted=False)
        with open(release+'/namespace-map-custody.json', 'x') as f:
            os.chmod(f.fileno(), 0o600)
            json.dump(record, f, separators=(',', ':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.chown(release+'/namespace-map-custody.json', review['ownerUid'], review['ownerUid'])
        assert child.stdin.write(READY) == len(READY)
        child.stdin.flush(); child.stdin.close()
        return child.wait()
    finally:
        if proc_fd is not None:
            os.close(proc_fd)
        if child.poll() is None:
            # Terminate only this exact owned namespace init; --kill-child and
            # PID-namespace exit handle descendants. Never kill a supplied PID.
            child.terminate()
            try:
                child.wait(timeout=5)
            except subprocess.TimeoutExpired:
                child.kill(); child.wait(timeout=5)


if __name__ == '__main__':
    try:
        sys.exit(launch())
    except Exception as error:
        print('Owned native namespace launch refused errorClass='+type(error).__name__, file=sys.stderr)
        sys.exit(1)
