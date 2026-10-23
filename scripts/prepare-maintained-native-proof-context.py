#!/usr/bin/python3
"""Copy only fourteen-export proof inputs. No archive/native/font execution.

Original compiler files, ownership and protections stay untouched. This owned
data-only copy is producer byte custody, never native/image/deploy acceptance.
"""
import hashlib
import json
import os
import re
import stat
import sys
import time
import traceback

MAX_TOTAL = 256 * 1024**2
MAX_FILES = 1200
MANIFEST_SHA = 'f1cc5c7ca0c1a2778a7933b4384bc626a8623e8ec32db567c6891b52db0ee5ec'
BASE_JSON = {
    'glibc': ['glibc-source-proof.json', 'package-tests-proof.json', 'upstream-tests-proof.json', 'glibc-package-inventory.json', 'glibc-installed-elf-inventory.json'],
    'freetype': ['freetype-source-proof.json', 'freetype-corpus-proof.json', 'freetype-standard-test-proof.json', 'freetype-package-inventory.json', 'freetype-installed-elf-inventory.json'],
}
FIXED = {
    'glibc': ['libc6_2.41-12+deb13u4+vaettir1_amd64.deb', 'libc-bin_2.41-12+deb13u4+vaettir1_amd64.deb', 'glibc-source-signature.status', 'package-tests.sum', 'upstream-tests.sum', 'extract.log', 'package-build.log', 'upstream-check.log', 'upstream-abi.log', 'extended-regression.log', 'extended-test-result.log', 'extended-test-output.log'],
    'freetype': ['libfreetype6_2.13.3+dfsg-1+deb13u1+vaettir1_amd64.deb', 'freetype-source-signature.status', 'extract.log', 'package-build.log', 'meson-setup.log', 'meson-compile.log', 'meson-test.log', 'freetype-acceptance-gap.txt'],
}
CORPUS = {
    'original-corpus.zip': (10757, '09fceee7c335975a454500b000f75ee7f7b5c4f14b2dc241d6416f77967e9d1b'),
    'As.I.Lay.Dying.ttf': (23120, 'ef146bbc2673b38715afcc70dca484cc64457438da8627a27cf95680e982f0a6'),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def safe_relative(path):
    assert isinstance(path, str) and re.fullmatch('[A-Za-z0-9_./+-]+', path)
    assert not path.startswith('/') and all(p not in ['', '.', '..'] for p in path.split('/'))
    return path


def plan_files(manifest, json_names):
    assert manifest['version'] == 'runtime-security-sources/v1'
    assert set(manifest['components']) == {'glibc', 'freetype'}
    plan = {}

    def add(path, limit, expected=None):
        safe_relative(path)
        assert path not in plan
        plan[path] = dict(limit=limit, expected=expected)
        assert len(plan) <= MAX_FILES

    for component in ['glibc', 'freetype']:
        names = json_names[component]
        assert isinstance(names, list) and len(names) == len(set(names))
        assert set(BASE_JSON[component]).issubset(names)
        abi = [n for n in names if n not in BASE_JSON[component]]
        assert 0 < len(abi) <= 512
        for name in abi:
            assert re.fullmatch(component+'-abi-[A-Za-z0-9_+.-]+[.]json', name)
        for name in names:
            add('build/runtime-security/'+component+'/'+name, 4*1024**2)
        for name in FIXED[component]:
            limit = 128*1024**2 if name.endswith('.deb') else 64*1024**2 if name.endswith('.log') else 8*1024**2 if name.endswith('.sum') else 65536
            add('build/runtime-security/'+component+'/'+name, limit)
        item = manifest['components'][component]
        assert len(item['sourceFiles']) == (3 if component == 'glibc' else 7)
        assert len(item['patches']) == (22 if component == 'glibc' else 1)
        for pin in item['sourceFiles']+item['patches']:
            assert re.fullmatch('[A-Za-z0-9_.+-]+', pin['name'])
            assert re.fullmatch('[a-f0-9]{64}', pin['sha256'])
            assert isinstance(pin['bytes'], int) and 0 < pin['bytes'] <= 25000000
            add('build/'+component+'-sources/'+pin['name'], pin['bytes'], (pin['bytes'], pin['sha256']))
        for name in ['source-intent.json', 'source-manifest.json']:
            add('build/'+component+'-sources/'+name, 65536)
    for name, pin in CORPUS.items():
        add('build/freetype-standard-corpus/'+name, pin[0], pin)
    for name in ['corpus-intent.json', 'corpus-custody.json']:
        add('build/freetype-standard-corpus/'+name, 65536)
    return plan


def source_regular(root, relative, limit):
    safe_relative(relative)
    path = root
    for part in relative.split('/')[:-1]:
        path += '/'+part
        assert stat.S_ISDIR(os.lstat(path).st_mode) and os.path.realpath(path) == path
    path += '/'+relative.split('/')[-1]
    s = os.lstat(path)
    assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 < s.st_size <= limit
    assert stat.S_IMODE(s.st_mode) in [0o600, 0o644]
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(fd, 'rb') as f:
        opened = os.fstat(f.fileno())
        assert (opened.st_dev, opened.st_ino, opened.st_size) == (s.st_dev, s.st_ino, s.st_size)
        data = f.read(limit+1)
        after = os.fstat(f.fileno())
        assert (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns) == (s.st_dev, s.st_ino, s.st_size, s.st_mtime_ns)
    assert len(data) == s.st_size
    return data, s


def main():
    assert len(sys.argv) == 6 and os.getuid() == 0
    release, owner_text, commit, run_id, attempt = sys.argv[1:]
    assert re.fullmatch('/[A-Za-z0-9_./-]+/vaettir-native-host[.][A-Za-z0-9]{6,32}', release)
    assert all(part not in ['', '.', '..'] for part in release.split('/')[1:]) and os.path.realpath(release) == release
    assert re.fullmatch('[1-9][0-9]*', owner_text) and re.fullmatch('[a-f0-9]{40}', commit)
    assert re.fullmatch('[1-9][0-9]*', run_id) and re.fullmatch('[1-9][0-9]*', attempt)
    owner = int(owner_text)
    s = os.lstat(release)
    assert stat.S_ISDIR(s.st_mode) and s.st_uid == owner and stat.S_IMODE(s.st_mode) == 0o700
    root = release+'/rootfs'
    s = os.lstat(root)
    assert stat.S_ISDIR(s.st_mode) and s.st_uid == owner and os.path.realpath(root) == root
    review = json.loads(source_regular(release, 'root-review.json', 65536)[0])
    assert review['commit'] == commit and review['runId'] == run_id and review['attempt'] == int(attempt)
    assert review['ownerUid'] == owner and review['releaseDir'] == release
    assert 0 <= time.time()-review['createdAt'] <= 3600
    assert (review['rootfsDev'], review['rootfsIno']) == (s.st_dev, s.st_ino)
    assert review['acceptance'] == dict(native=False, installedFamily=False, cid=False, security=False, deployment=False)
    manifest_bytes = source_regular(root, 'build/scripts/runtime-security-sources.json', 65536)[0]
    assert sha(manifest_bytes) == MANIFEST_SHA
    json_names = {}
    for component in ['glibc', 'freetype']:
        path = root+'/build/runtime-security/'+component
        assert stat.S_ISDIR(os.lstat(path).st_mode) and os.path.realpath(path) == path
        json_names[component] = sorted(n for n in os.listdir(path) if n.endswith('.json'))
    plan = plan_files(json.loads(manifest_bytes), json_names)
    destination = release+'/proof-context'
    assert not os.path.lexists(destination)
    os.mkdir(destination, 0o700)
    os.chown(destination, owner, owner)
    records = []
    total = 0
    for path, spec in sorted(plan.items()):
        data, original = source_regular(root, path, spec['limit'])
        total += len(data)+2048
        assert total <= MAX_TOTAL
        digest = sha(data)
        if spec['expected'] is not None:
            assert (len(data), digest) == spec['expected']
        target = destination
        for part in path.split('/')[:-1]:
            target += '/'+part
            if not os.path.lexists(target):
                os.mkdir(target, 0o755)
                os.chown(target, owner, owner)
            assert stat.S_ISDIR(os.lstat(target).st_mode) and os.path.realpath(target) == target
        target += '/'+path.split('/')[-1]
        with open(target, 'xb') as f:
            assert f.write(data) == len(data)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(target, stat.S_IMODE(original.st_mode))
        os.chown(target, owner, owner)
        copied, _ = source_regular(destination, path, spec['limit'])
        assert copied == data
        records.append(dict(path=path, bytes=len(data), sha256=digest, mode=stat.S_IMODE(original.st_mode), originalUid=original.st_uid, originalGid=original.st_gid, destinationUid=owner, destinationGid=owner))
    record = dict(purpose='owned-native-proof-input-context-byte-custody/v1', commit=commit, runId=run_id, attempt=int(attempt), contextPath=destination, files=records, boundedBytesWithHeaderReserve=total, originalFilesAndProtectionsUntouched=True, copyingChangesOnlyDestinationOwner=True, nativeAccepted=False, abiAccepted=False, cidAccepted=False, imageSecurityAccepted=False, deploymentAccepted=False)
    with open(release+'/proof-context-custody.json', 'x') as f:
        os.chmod(f.fileno(), 0o600)
        json.dump(record, f, separators=(',', ':'))
        f.write('\n')
        f.flush()
        os.fsync(f.fileno())
    os.chown(release+'/proof-context-custody.json', owner, owner)
    print('Native proof input byte copy complete; all independent acceptance remains false')


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        location = traceback.extract_tb(error.__traceback__)[-1]
        print('Native proof context copy refused function='+location.name+' line='+str(location.lineno)+' class='+type(error).__name__, file=sys.stderr)
        sys.exit(1)
