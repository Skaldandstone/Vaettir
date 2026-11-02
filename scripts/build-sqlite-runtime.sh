#!/bin/sh
set -eu
unset LD_PRELOAD LD_LIBRARY_PATH
# Image-owned directories only. This entrypoint is never run by a source lane.
test "$#" = 3
test "$1" = /build/sqlite-inputs
test "$2" = /build/sqlite-native
test "$3" = /build/scripts
inputs=$1
root=$2
scripts=$3
test ! -e "$root"
node -e 'if(!/^[a-f0-9]{40}$/.test(process.env.VAETTIR_SQLITE_SOURCE_COMMIT||""))process.exit(1)'
mkdir -m 700 "$root"
mkdir "$root/logs" "$root/baseline"
test "$(dpkg --print-architecture)" = amd64
test "$(dpkg-query -W -f='${Version}' libsqlite3-0)" = '3.46.1-7+deb13u2'
cp /usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6 "$root/baseline/libsqlite3.so.0"

# Admit every member before extraction. No archive-supplied links, modes,
# ownership or paths are applied. Preserve failed attempts; never auto-retry.
python3 - "$inputs" "$root" "$scripts" <<'PY'
import hashlib,json,pathlib,stat,sys,tarfile,zipfile
inputs,root,scripts=map(pathlib.Path,sys.argv[1:])
m=json.loads((scripts/'sqlite-runtime-sources.json').read_text())
assert json.loads((inputs/'source-manifest.json').read_text())==m
for row in m['sources']:
    raw=(inputs/row['file']).read_bytes()
    assert len(raw)==row['size']
    assert hashlib.sha256(raw).hexdigest()==row['sha256']
    assert hashlib.sha3_256(raw).hexdigest()==row['sha3_256']
    archive=zipfile.ZipFile(inputs/row['file']) if row['file'].endswith('.zip') else tarfile.open(inputs/row['file'],'r:gz')
    members=archive.infolist() if isinstance(archive,zipfile.ZipFile) else archive.getmembers()
    assert 0<len(members)<=row['maxMembers']
    seen=set(); total=0; admitted=[]
    for entry in members:
        zipped=isinstance(archive,zipfile.ZipFile)
        name=entry.filename if zipped else entry.name
        path=pathlib.PurePosixPath(name)
        assert '\\' not in name and not path.is_absolute() and '..' not in path.parts
        assert path.parts and path.parts[0]==row['prefix'] and name not in seen
        seen.add(name)
        directory=entry.is_dir() if zipped else entry.isdir()
        if zipped:
            kind=stat.S_IFMT(entry.external_attr>>16)
            assert kind in (0,stat.S_IFDIR,stat.S_IFREG)
            size=entry.file_size
        else:
            assert entry.isfile() or directory
            size=entry.size
        total+=size
        assert total<=row['maxExpandedBytes'] and size<=row['maxMemberBytes']
        admitted.append((entry,path,directory))
    for entry,path,directory in admitted:
        target=root.joinpath(*path.parts)
        if directory: target.mkdir(parents=True,exist_ok=True); continue
        target.parent.mkdir(parents=True,exist_ok=True)
        data=archive.read(entry) if isinstance(archive,zipfile.ZipFile) else archive.extractfile(entry).read()
        with target.open('xb') as output: output.write(data)
        mode=(entry.external_attr>>16) if isinstance(archive,zipfile.ZipFile) else entry.mode
        target.chmod(0o755 if mode&0o111 else 0o644)
    archive.close()
source=root/m['sources'][0]['prefix']
assert (source/'manifest.uuid').read_text().strip()==m['sourceId'].split()[-1]
for test in m['upstreamTests']:
    assert hashlib.sha256((source/test['path']).read_bytes()).hexdigest()==test['sha256']
(root/'defines.txt').write_text(' '.join('-D'+item for item in m['defines'])+'\n')
PY

source="$root/sqlite-src-3540100"
defines=$(cat "$root/defines.txt")
common="-fno-strict-aliasing -fno-omit-frame-pointer -D_FILE_OFFSET_BITS=64 $defines"
for mode in release sanitizer; do
  mkdir "$root/$mode"
  cd "$root/$mode"
  if test "$mode" = release; then
    flags="-O2 -fstack-protector-strong -D_FORTIFY_SOURCE=2 $common"
    link='-Wl,-z,relro,-z,now'
  else
    flags="-O1 -g -fsanitize=address,undefined -fno-sanitize-recover=all $common"
    link='-fsanitize=address,undefined'
  fi
  # Canonical source regenerates the parser with UPDATE/DELETE LIMIT enabled.
  # The official generic amalgamation is not substituted for this parser.
  timeout 120 env CFLAGS="$flags" LDFLAGS="$link" sh "$source/configure" \
    --enable-all --enable-update-limit --enable-threadsafe --soname=legacy \
    --with-tcl=/usr/lib/x86_64-linux-gnu/tcl8.6 --with-tclsh=/usr/bin/tclsh8.6 \
    > "$root/logs/configure-$mode.log" 2>&1
  timeout 1200 make -j2 sqlite3.c sqlite3.h testfixture > "$root/logs/build-$mode.log" 2>&1
  # Instrument the SQLite library itself, not just the regression caller.
  timeout 300 cc $flags -fPIC -shared sqlite3.c -Wl,-soname,libsqlite3.so.0 $link \
    -lm -ldl -pthread -o libsqlite3.so.0.8.6
  ln -s libsqlite3.so.0.8.6 libsqlite3.so.0
  timeout 120 cc $flags -I . "$scripts/sqlite-runtime-regression.c" ./libsqlite3.so.0.8.6 \
    $link -ldl -o sqlite-runtime-regression
  timeout 300 cc $flags -DVAETTIR_SQLITE_INTERNAL -I . "$scripts/sqlite-runtime-regression.c" \
    $link -lm -ldl -pthread -o sqlite-wal-regression
  export ASAN_OPTIONS=detect_leaks=1:halt_on_error=1:abort_on_error=1
  export UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1
  mkdir "$root/$mode/wal"
  (cd "$root/$mode/wal"; timeout 60 ../sqlite-wal-regression) > "$root/logs/wal-$mode.log" 2>&1
  timeout 120 env LD_LIBRARY_PATH="$root/$mode" ./sqlite-runtime-regression > "$root/logs/functional-$mode.log" 2>&1
  # One fresh directory/process per upstream file. Disabled-feature zero-test
  # output is rejected by the checker, including the exact new case markers.
  python3 - "$scripts/sqlite-runtime-sources.json" <<'PY' > "$root/tests.txt"
import json,sys
for row in json.load(open(sys.argv[1]))['upstreamTests']: print(row['path'])
PY
  while IFS= read -r testfile; do
    label=$(printf '%s' "$testfile" | tr '/' '_')
    mkdir "$root/$mode/test-$label"
    (cd "$root/$mode/test-$label"; timeout 600 ../testfixture "$source/$testfile") \
      > "$root/logs/$mode-$label.log" 2>&1
  done < "$root/tests.txt"
done
cmp "$root/release/sqlite3.c" "$root/sanitizer/sqlite3.c"

# Genuine older upstream source, isolated negative control, never packaged.
mkdir "$root/negative"
cd "$root/negative"
timeout 300 cc -O1 -DVAETTIR_SQLITE_INTERNAL -I "$root/sqlite-autoconf-3530400" \
  "$scripts/sqlite-runtime-regression.c" -lm -ldl -pthread -o sqlite-wal-negative
set +e
timeout 60 ./sqlite-wal-negative > "$root/logs/wal-negative.log" 2> "$root/logs/wal-negative.stderr"
negative_status=$?
set -e
printf '%s\n' "$negative_status" > "$root/logs/wal-negative.status"
test "$negative_status" = 42
test "$(cat "$root/logs/wal-negative.log")" = 'WAL_TAIL_UNINITIALIZED:3584'
test ! -s "$root/logs/wal-negative.stderr"

cp "$root/release/libsqlite3.so.0.8.6" "$root/libsqlite3.so.0.8.6"
ln -s libsqlite3.so.0.8.6 "$root/libsqlite3.so.0"
cp "$root/release/sqlite-runtime-regression" "$root/sqlite-runtime-regression"
env LD_LIBRARY_PATH="$root/baseline" "$root/sqlite-runtime-regression" --identity > "$root/baseline-identity.txt"

# A real replacement package owning the actual compiled library, with honest
# upstream and local versions. No fake dpkg scanner metadata or disabled NSS.
mkdir -p "$root/package/DEBIAN" "$root/package/usr/lib/x86_64-linux-gnu" "$root/package/usr/share/doc/libsqlite3-0"
cp "$root/libsqlite3.so.0.8.6" "$root/package/usr/lib/x86_64-linux-gnu/"
ln -s libsqlite3.so.0.8.6 "$root/package/usr/lib/x86_64-linux-gnu/libsqlite3.so.0"
cp "$source/LICENSE.md" "$root/package/usr/share/doc/libsqlite3-0/copyright"
cat > "$root/package/DEBIAN/control" <<'CONTROL'
Package: libsqlite3-0
Source: sqlite3 (3.54.1-0+vaettir1)
Version: 3.54.1-0+vaettir1
Architecture: amd64
Multi-Arch: same
Section: libs
Priority: optional
Maintainer: Vaettir Runtime Build <runtime-build@skaldandstone.com>
Depends: libc6 (>= 2.41)
Description: SQLite 3.54.1 runtime built from pinned upstream canonical source
 Retains Debian runtime features and libsqlite3.so.0 ABI; local security rebuild.
CONTROL
printf '%s\n' 'activate-noawait ldconfig' > "$root/package/DEBIAN/triggers"
(cd "$root/package"; find usr -type f -print0 | sort -z | xargs -0 md5sum) > "$root/package/DEBIAN/md5sums"
timeout 60 dpkg-deb --root-owner-group --build "$root/package" "$root/libsqlite3-0_3.54.1-0+vaettir1_amd64.deb"
timeout 60 dpkg --install "$root/libsqlite3-0_3.54.1-0+vaettir1_amd64.deb"
test -z "$(dpkg --audit)"
cmp "$root/libsqlite3.so.0.8.6" /usr/lib/x86_64-linux-gnu/libsqlite3.so.0.8.6
mkdir "$root/nss"
timeout 30 certutil -N -d "sql:$root/nss" --empty-password > "$root/logs/nss-create.log" 2>&1
timeout 30 certutil -L -d "sql:$root/nss" > "$root/logs/nss-list.log" 2>&1
test -s "$root/nss/cert9.db"
test -s "$root/nss/key4.db"
readelf --dynamic --wide /usr/lib/x86_64-linux-gnu/libsoftokn3.so > "$root/logs/nss-dynamic.txt"
grep -F 'Shared library: [libsqlite3.so.0]' "$root/logs/nss-dynamic.txt"
ldd /usr/lib/x86_64-linux-gnu/libsoftokn3.so > "$root/logs/nss-loader.txt"
grep -E 'libsqlite3.so.0 => /lib/x86_64-linux-gnu/libsqlite3.so.0|libsqlite3.so.0 => /usr/lib/x86_64-linux-gnu/libsqlite3.so.0' "$root/logs/nss-loader.txt"
node "$scripts/check-sqlite-runtime.mjs" --record "$root"
node "$scripts/check-sqlite-runtime.mjs" --installed "$root"
