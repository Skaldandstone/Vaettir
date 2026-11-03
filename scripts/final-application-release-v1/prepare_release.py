"""Main-only offline source preparation. No build, database or cloud action.

The source archive is an already retained, independently bound input. Verify
every archive member against immutable Git blobs before creating a new root.
Never manufacture a prepared receipt from a pending source or CI run.
"""
import hashlib, io, os, re, subprocess, zipfile

MAX_SOURCE=512*1024**2

def verify_archive(raw, expected):
    assert len(raw)<=MAX_SOURCE and expected and len(expected)<=100000
    with zipfile.ZipFile(io.BytesIO(raw)) as archive:
        rows=archive.infolist();assert len(rows)<=200000
        names=[x.filename for x in rows];assert len(names)==len(set(names))
        files={};total=0
        for row in rows:
            name=row.filename;parts=name.rstrip('/').split('/')
            assert name and not name.startswith('/') and '\\' not in name and ':' not in name
            assert all(x not in ('','.','..','.git','.local','node_modules','assistant-history') for x in parts)
            assert not row.flag_bits & 1
            mode=(row.external_attr>>16)&0xffff
            if row.is_dir():
                assert mode&0o170000 in (0,0o040000)
                assert any(p.startswith(name) for p in expected)
                continue
            assert name in expected and mode&0o170000 in (0,0o100000)
            assert row.file_size==expected[name]['bytes']
            total+=row.file_size;assert total<=MAX_SOURCE
            value=archive.read(row)
            assert hashlib.sha256(value).hexdigest()==expected[name]['sha256']
            assert mode&0o777==expected[name]['mode']
            files[name]=expected[name]
        assert set(files)==set(expected),'Archive omitted or added Git members'
    return files

def main():
    from contracts import gate,bindings,ref,R,O,CONFIG,sha,dump
    value=gate('source');b=bindings();source=value['source']
    assert re.fullmatch('[a-f0-9]{40}',source)
    env=dict(os.environ,GIT_NO_REPLACE_OBJECTS='1',GIT_OPTIONAL_LOCKS='0')
    def git(*args):
        return subprocess.run(['git',*args],cwd=R,env=env,capture_output=True,timeout=120,check=True).stdout
    assert git('rev-parse',source+'^{tree}').decode().strip()==value['tree']
    rows=git('ls-tree','-rz','--full-tree',source).split(b'\0');expected={};total=0
    for row in filter(None,rows):
        head,name=row.split(b'\t',1);mode,kind,oid=head.decode().split();name=name.decode('utf-8')
        assert kind=='blob' and mode in ('100644','100755')
        size=int(git('cat-file','-s',oid));total+=size;assert total<=MAX_SOURCE
        data=git('cat-file','blob',oid);assert len(data)==size
        expected[name]={'sha256':sha(data),'bytes':size,'mode':int(mode,8)&0o777,'gitBlob':oid}
    a=b['application']['api']['sourceArchive'];w=b['application']['web']['sourceArchive']
    assert a==w
    archive=ref(a,MAX_SOURCE).read_bytes();members=verify_archive(archive,expected)
    prepared={'commit':source,'tree':value['tree'],'migrationCount':111,'newMigrationCount':1,
              'sourceArchiveSha256':sha(archive),'bindingsSha256':CONFIG['bindings']['sha256'],
              'releaseAccepted':False}
    # All source/admission checks precede output. Partial output is retained.
    O.mkdir(parents=False)
    (O/'source-preparation-intent.json').open('xb').write(dump({'source':source,'once':True}))
    (O/'source.zip').open('xb').write(archive)
    (O/'source-members.json').open('xb').write(dump(members))
    (O/'prepared.json').open('xb').write(dump(prepared))
    print(dump(prepared).decode(),end='')

if __name__=='__main__':main()
