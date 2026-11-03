"""Pure exact source derivation; never invokes the metadata operator."""
from pathlib import Path
import hashlib,json
HERE=Path(__file__).resolve().parent
PARENT=HERE.parent/'final-application-producers-v1/stage_metadata.py'
PARENT_SHA='aec21400c8f4daa44ae4a0a9ddbc07555912ab733192d8b952467e4220603a6d'
def derive():
    raw=PARENT.read_bytes();assert hashlib.sha256(raw).hexdigest()==PARENT_SHA
    s=raw.decode().replace('\r\n','\n')
    def edit(a,b):
        nonlocal s
        assert s.count(a)==1,(a,s.count(a));s=s.replace(a,b)
    edit('def inspect_tar(path,layer):', '''def hardlink_pax(row):
    assert row['type']=='1' and set(row['pax'])<= {'path','linkpath'},'Unreviewed hardlink PAX metadata'
    for key,value in row['pax'].items():
        decoded=base64.b64decode(value,validate=True).decode('utf8')
        assert safe(decoded)==row['path' if key=='path' else 'link'],'PAX path/linkpath disagrees with parsed alias'
    return True

def inspect_tar(path,layer):''')
    edit("    with tarfile.open(path,mode='r:') as archive:","    with Path(path).open('rb') as raw,tarfile.open(path,mode='r:') as archive:")
    edit("            with Path(path).open('rb') as raw:\n                raw.seek(member.offset);header=raw.read(member.offset_data-member.offset)","            raw.seek(member.offset);header=raw.read(member.offset_data-member.offset)")
    edit("            entries.append(row)","            if typ=='1':hardlink_pax(row)\n            entries.append(row)")
    edit("            assert not row['pax'],'Hardlink PAX semantics require explicit successor review'","            hardlink_pax(row)")
    edit('def main():','def main(run):')
    edit('    value=model();verify_cached_layers(value)', '''    from metadata_reuse import admit_reuse,verify_sources
    value=model();reuse=admit_reuse(run,value,SETTINGS,HERE,OUT)
    verify_sources(value,reuse,verify_cached_layers)''')
    edit("output=HERE/'stage-metadata-proposal-v1'","output=HERE/'stage-metadata-proposal-v2'")
    start="        tarpath=output/('layer-'+str(row['index'])+'.tar');h=hashlib.sha256();total=0\n"
    end="        assert total==row['expanded'] and 'sha256:'+h.hexdigest()==row['diffId']\n"
    a=s.index(start);b=s.index(end,a)+len(end); original=s[a:b]
    replacement="""        if row['index'] in reuse:
            tarpath=reuse[row['index']];total=row['expanded'];expanded_sha=row['diffId'].split(':',1)[1]
        else:
"""+''.join('    '+line if line.strip() else line for line in original.splitlines(True))+"            expanded_sha=h.hexdigest()\n"
    edit(original,replacement)
    edit("assert pin(tarpath)=={'sha256':h.hexdigest(),'bytes':total}","assert pin(tarpath)=={'sha256':expanded_sha,'bytes':total}")
    edit("'uncompressed':{'path':tarpath.name,'sha256':h.hexdigest(),'bytes':total}","'uncompressed':{'path':str(tarpath),'sha256':expanded_sha,'bytes':total},'reusedRetainedTar':row['index'] in reuse")
    edit("'uncompressed':ref(output/r['uncompressed']['path'],{k:r['uncompressed'][k] for k in ('sha256','bytes')})", "'uncompressed':ref(Path(r['uncompressed']['path']),{k:r['uncompressed'][k] for k in ('sha256','bytes')})")
    edit("          'layers':proofs,'observation':obs,", "          'layers':proofs,'sourceAndReuseReviews':run['receiptRefs'],'observation':obs,")
    edit("    retained=[]", "    retained=[ref(p) for p in run['retainedInputs']]")
    edit("if __name__=='__main__':main()", "if __name__=='__main__':\n    from metadata_reuse import preflight\n    main(preflight(sys.argv[1:]))")
    return s.encode()
if __name__=='__main__':
    # Explicit source generation only, exclusive output supplied by the caller.
    import sys
    raw=derive();p=Path(sys.argv[1]);p.write_bytes(raw)
    print(json.dumps({'parentSha256':PARENT_SHA,'candidateSha256':hashlib.sha256(raw).hexdigest(),'sourceOnly':True}))
