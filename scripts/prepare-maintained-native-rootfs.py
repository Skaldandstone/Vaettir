#!/usr/bin/python3
"""Finite Docker export reader. No archive code, subprocess or generic extract.

Only an owned, never-started compiler container is input. Hardlinks are explicitly
materialized as separate, identical regular files for the isolation admission;
that transformation is recorded, not treated as byte-identical filesystem state.
This is producer custody, never native/security/Root artifact acceptance.
"""
import hashlib
import base64
import json
import os
import posixpath
import re
import stat
import sys
import traceback

MAX_ARCHIVE = 4 * 1024**3
MAX_TOTAL = 8 * 1024**3
MAX_FILE = 512 * 1024**2
MAX_ENTRIES = 100000
# Bounded original-byte failure custody, no reconstructed archive or acceptance.
FAILURE_CONTEXT = {}
PINS = {
    'build-maintained-runtime.sh': '633e3c977eef9d808ede8f6c9ba5ee78b5f96890fcb66cd7d3aaaad84a6cd07f',
    'runtime-build-proof.mjs': '49884a1626756a412f2920d232d0362d177a3383c2c0e1d286183ec0622069d1',
    'watch-native-build-logs.mjs': 'edf3d3816f11d7b7fbbc66a3afdfee1975ee0205db657a1a8570d371e52b4695',
    'runtime-security-sources.json': 'f1cc5c7ca0c1a2778a7933b4384bc626a8623e8ec32db567c6891b52db0ee5ec',
    'fetch-freetype-test-corpus.mjs': '1a3a851f6790b2dc12ef153cef32395e38046c9eea0ecec58505846be5532b30',
}


def digest_file(path):
    h = hashlib.sha256()
    with open(path, 'rb') as f:
        while True:
            b = f.read(1024**2)
            if not b:
                break
            h.update(b)
    return h.hexdigest()


def number(raw):
    value = raw.rstrip(b'\0 ').lstrip(b' ')
    assert value and re.fullmatch(b'[0-7]+', value)
    return int(value, 8)


def string(raw):
    value, _, tail = raw.partition(b'\0')
    assert not tail.strip(b'\0')
    return value.decode('ascii')


def path_name(value, directory=False):
    if value.startswith('./'):
        value = value[2:]
    if directory:
        value = value.rstrip('/')
    # Actual673 export header bb445ec9 is the standard coreutils `[` executable.
    # Admit that ONE literal path, not shell glob syntax or general brackets.
    # Actual170 also contains setuptools' ordinary "Lorem ipsum.txt" data file.
    # Internal literal spaces are data passed to filesystem APIs, never shell
    # interpolation. Controls, shell/glob syntax and path escapes still refuse.
    # The same verified export also has the ordinary "script (dev).tmpl" file.
    # Complete ec0 diagnostics found only libtool's literal lt~obsolete.m4.
    # Tilde here is filename data; no home or shell expansion is performed.
    assert value == 'usr/bin/[' or re.fullmatch('[A-Za-z0-9_ ./+@,=:()~-]+', value)
    assert not value.startswith('/') and all(p not in ('', '.', '..') and p == p.strip() for p in value.split('/'))
    return value


def pax_records(data):
    assert 0 < len(data) <= 65536
    records = {}
    while data:
        raw_len, sep, _ = data.partition(b' ')
        assert sep and re.fullmatch(b'[1-9][0-9]{0,5}', raw_len)
        length = int(raw_len)
        assert length <= len(data) and length > len(raw_len) + 3
        record, data = data[len(raw_len)+1:length], data[length:]
        assert record.endswith(b'\n')
        key, sep, value = record[:-1].partition(b'=')
        key = key.decode('ascii')
        assert sep and key not in records and key in ('path', 'linkpath', 'mtime', 'atime', 'ctime')
        records[key] = value.decode('ascii')
        if key not in ('path', 'linkpath'):
            assert re.fullmatch(r'-?[0-9]+(?:\.[0-9]+)?', records[key])
    return records


def read_entries(f, archive_size):
    """Validate the complete raw archive before creating any output rootfs."""
    rows, seen, pax, total, rejected_paths = [], set(), {}, 0, []
    FAILURE_CONTEXT.pop('rejectedPathHeaders', None)
    while True:
        block = f.read(512)
        FAILURE_CONTEXT['lastHeader'] = dict(offset=f.tell()-len(block), bytes=len(block),
            sha256=hashlib.sha256(block).hexdigest(), base64=base64.b64encode(block).decode('ascii'))
        assert len(block) == 512
        if block == bytes(512):
            assert f.read(512) == bytes(512) and not pax
            while True:
                remaining = f.read(1024**2)
                if not remaining:
                    break
                assert not remaining.strip(b'\0')
            break
        assert block[257:263] == b'ustar\0' and block[263:265] == b'00'
        assert sum(block[:148]) + 8*32 + sum(block[156:]) == number(block[148:156])
        kind = block[156:157]
        assert kind in (b'0', b'\0', b'1', b'2', b'5', b'x')
        size = number(block[124:136])
        assert size <= MAX_FILE and f.tell()+((size+511)//512)*512 <= archive_size
        if kind == b'x':
            assert not pax and 0 < size <= 65536
            raw_pax = f.read(size)
            FAILURE_CONTEXT['lastPax'] = dict(offset=f.tell()-len(raw_pax), bytes=len(raw_pax),
                sha256=hashlib.sha256(raw_pax).hexdigest(), base64=base64.b64encode(raw_pax).decode('ascii'))
            pax = pax_records(raw_pax)
            assert f.read((-size) % 512) == bytes((-size) % 512)
            continue
        name = string(block[:100])
        prefix = string(block[345:500])
        name = pax.get('path', (prefix+'/' if prefix else '')+name)
        link = pax.get('linkpath', string(block[157:257]))
        metadata = pax
        pax = {}
        if name in ('.', './') and kind == b'5':
            assert size == 0
            continue
        try:
            name = path_name(name, kind == b'5')
        except AssertionError:
            # Observe remaining finite headers only, NEVER admit/extract paths.
            # This avoids repeated builds to discover one ordinary name at a
            # time. Every lexical rejection remains fatal before any extraction.
            assert len(rejected_paths) < 128 and len(name) <= 4096
            rejected_paths.append(dict(pathPrefix=name[:512], completePathBytes=len(name),
                pathSha256=hashlib.sha256(name.encode('ascii')).hexdigest(),
                header=dict(FAILURE_CONTEXT['lastHeader'])))
            FAILURE_CONTEXT['rejectedPathHeaders'] = rejected_paths
        assert name not in seen and len(rows) < MAX_ENTRIES
        seen.add(name)
        mode, uid, gid = number(block[100:108]), number(block[108:116]), number(block[116:124])
        assert mode <= 0o7777 and uid <= 65535 and gid <= 65535
        if name == 'usr/bin/[':
            assert kind in (b'0', b'\0') and mode == 0o755 and uid == 0 and gid == 0
        if kind in (b'1', b'2', b'5'):
            assert size == 0
        if kind == b'1':
            link = path_name(link)
        elif kind == b'2':
            assert re.fullmatch('[A-Za-z0-9_./+@,=:-]+', link)
            logical = posixpath.normpath(link if link.startswith('/') else '/'+posixpath.dirname(name)+'/'+link)
            assert logical.startswith('/') and logical != '/' and not logical.startswith('/../')
        else:
            assert not link
        rows.append(dict(path=name, kind=kind.decode('ascii'), mode=mode, uid=uid, gid=gid,
                         size=size, offset=f.tell(), target=link or None, pax=metadata))
        total += size
        assert total <= MAX_TOTAL
        f.seek(((size+511)//512)*512, 1)
    assert not rejected_paths
    by_name = {r['path']: r for r in rows}
    for row in rows:
        parents = row['path'].split('/')[:-1]
        for i in range(1, len(parents)+1):
            assert by_name.get('/'.join(parents[:i]), {}).get('kind') == '5'
        if row['kind'] == '1':
            source = by_name.get(row['target'], {})
            assert source.get('kind') in ('0', '\0')
            assert (row['mode'], row['uid'], row['gid']) == (source['mode'], source['uid'], source['gid'])
            total += source['size']
            assert total <= MAX_TOTAL
    assert len(rows) > 0
    return rows


def extract_owned(f, root, rows):
    assert os.getuid() == 0 and not os.path.lexists(root)
    os.mkdir(root, 0o755)
    by_name = {r['path']: r for r in rows}
    materialized = []
    for row in sorted((r for r in rows if r['kind'] == '5'), key=lambda r: (r['path'].count('/'), r['path'])):
        os.mkdir(root+'/'+row['path'], 0o700)
    for row in rows:
        if row['kind'] in ('0', '\0', '1'):
            source = by_name[row['target']] if row['kind'] == '1' else row
            f.seek(source['offset'])
            h = hashlib.sha256()
            with open(root+'/'+row['path'], 'xb') as out:
                remaining = source['size']
                while remaining:
                    b = f.read(min(1024**2, remaining))
                    assert b and len(b) <= remaining
                    h.update(b); out.write(b); remaining -= len(b)
            if row['kind'] == '1':
                materialized.append(dict(path=row['path'], source=row['target'], bytes=source['size'], sha256=h.hexdigest()))
        elif row['kind'] == '2':
            os.symlink(row['target'], root+'/'+row['path'])
    for row in sorted(rows, key=lambda r: -r['path'].count('/')):
        p = root+'/'+row['path']
        os.chown(p, row['uid'], row['gid'], follow_symlinks=False)
        if row['kind'] != '2':
            os.chmod(p, row['mode'], follow_symlinks=False)
    return materialized


def inventory(root):
    result, total = [], 0
    for base, dirs, files in os.walk(root, followlinks=False):
        for name in dirs+files:
            p = base+'/'+name; s = os.lstat(p)
            if stat.S_ISREG(s.st_mode):
                assert s.st_nlink == 1 and s.st_size <= MAX_FILE
                total += s.st_size; assert total <= MAX_TOTAL
                kind, sha, target = 'file', digest_file(p), None
            elif stat.S_ISDIR(s.st_mode):
                kind, sha, target = 'dir', None, None
            else:
                assert stat.S_ISLNK(s.st_mode)
                kind, sha, target = 'symlink', None, os.readlink(p)
            result.append(dict(path=os.path.relpath(p, root), type=kind, mode=stat.S_IMODE(s.st_mode),
                               uid=s.st_uid, gid=s.st_gid, size=s.st_size, sha256=sha, target=target))
            assert len(result) <= MAX_ENTRIES
    return sorted(result, key=lambda r: r['path'])


def main():
    assert len(sys.argv) == 3 and os.getuid() == 0
    release, owner = sys.argv[1], int(sys.argv[2])
    assert owner > 0 and os.path.realpath(release) == release
    s = os.lstat(release)
    assert stat.S_ISDIR(s.st_mode) and s.st_uid == owner and stat.S_IMODE(s.st_mode) == 0o700
    archive = release+'/environment.tar'
    s = os.lstat(archive)
    assert stat.S_ISREG(s.st_mode) and s.st_nlink == 1 and 0 < s.st_size <= MAX_ARCHIVE
    archive_sha = digest_file(archive)
    FAILURE_CONTEXT.update(release=release, owner=owner, archiveBytes=s.st_size, archiveSha256=archive_sha)
    with open(archive, 'rb') as f:
        rows = read_entries(f, s.st_size)
        changed = extract_owned(f, release+'/rootfs', rows)
    root = release+'/rootfs'
    os.chown(root, owner, owner); os.chmod(root, 0o755)
    for name, pin in PINS.items():
        assert digest_file(root+'/build/scripts/'+name) == pin
    records = inventory(root)
    for name, value in [('rootfs.inventory.json', records), ('rootfs-copy-custody.json', dict(
            purpose='validated-owned-compiler-rootfs-copy/v1', archiveBytes=s.st_size, archiveSha256=archive_sha,
            entries=len(records), materializedHardlinks=changed, nativeAcceptance=False, securityAcceptance=False,
            rootArtifactAcceptance=False, deploymentAcceptance=False))]:
        with open(release+'/'+name, 'x') as f:
            json.dump(value, f, separators=(',', ':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
        os.chown(release+'/'+name, owner, owner); os.chmod(release+'/'+name, 0o600)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        location = traceback.extract_tb(error.__traceback__)[-1]
        if 'release' in FAILURE_CONTEXT:
            try:
                record = dict(FAILURE_CONTEXT, purpose='original-compiler-export-admission-failure/v1',
                    errorClass=type(error).__name__, sourceFunction=location.name, sourceLine=location.lineno,
                    nativeAcceptance=False, rootArtifactAcceptance=False, deploymentAcceptance=False)
                name = FAILURE_CONTEXT['release']+'/rootfs-copy-failure.json'
                with open(name, 'x') as f:
                    json.dump(record, f, separators=(',', ':')); f.write('\n'); f.flush(); os.fsync(f.fileno())
                os.chown(name, FAILURE_CONTEXT['owner'], FAILURE_CONTEXT['owner']); os.chmod(name, 0o600)
            except Exception:
                print('Original compiler export failure custody unavailable', file=sys.stderr)
        print('Refused source location: '+location.name+':'+str(location.lineno), file=sys.stderr)
        print('Owned compiler export validation/extraction refused', file=sys.stderr)
        sys.exit(1)
