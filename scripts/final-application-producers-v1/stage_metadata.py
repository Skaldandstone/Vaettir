"""Main-only offline metadata proposals from retained OCI layer bytes; never extracts files.

Uses the Python standard-library TAR parser, preserving the original TARs and
header offsets for independent parser/alias/whiteout/extended-metadata review.
No output is an accepted filesystem, native, runtime or release receipt.
"""
from pathlib import Path,PurePosixPath
import base64,gzip,hashlib,json,sys,tarfile,platform

LIMIT=8_000_000_000
def safe(value,root=False):
    assert isinstance(value,str) and len(value.encode('utf8'))<=4096
    assert '\x00' not in value and '\\' not in value and not value.startswith('/')
    while value.startswith('./'):value=value[2:]
    value=value.rstrip('/')
    if value in ('','.'):assert root;return ''
    assert all(p not in ('','..','.') for p in value.split('/'))
    return str(PurePosixPath(value))

def pin(path):
    h=hashlib.sha256();n=0
    with Path(path).open('rb') as f:
        while b:=f.read(1024*1024):n+=len(b);assert n<=12_000_000_000;h.update(b)
    return {'sha256':h.hexdigest(),'bytes':n}

def inspect_tar(path,layer):
    """Read ordinary and raw PAX metadata, with exact retained TAR byte ranges."""
    entries=[];end=0
    with tarfile.open(path,mode='r:') as archive:
        for member in archive:
            assert len(entries)<600000 and member.size<=LIMIT
            assert not member.sparse and not any(k.startswith('GNU.sparse') for k in member.pax_headers)
            name=safe(member.name,True)
            typ=member.type.decode('ascii');typ='0' if typ=='\x00' else typ
            assert typ in ('0','1','2','5'),'Unsupported inode requires a reviewed parser successor'
            assert typ=='0' or member.size==0
            assert 0<=member.mode<=0o7777 and 0<=member.uid<=2**53-1 and 0<=member.gid<=2**53-1
            assert 0<=member.offset<=member.offset_data and member.offset_data-member.offset<=1024*1024
            row={'path':name,'type':typ,'size':member.size,'mode':member.mode,'uid':member.uid,'gid':member.gid,
                 'mtime':str(member.mtime),'layer':layer,'layerEntry':len(entries)+1,
                 'headerOffset':member.offset,'dataOffset':member.offset_data,
                 'pax':{k:base64.b64encode(v.encode('utf8','surrogateescape')).decode() for k,v in member.pax_headers.items()},
                 'uname':member.uname,'gname':member.gname,'devmajor':member.devmajor,'devminor':member.devminor}
            with Path(path).open('rb') as raw:
                raw.seek(member.offset);header=raw.read(member.offset_data-member.offset)
            row['headerBytes']=len(header);row['headerSha256']=hashlib.sha256(header).hexdigest()
            if typ=='0':
                h=hashlib.sha256();count=0
                with archive.extractfile(member) as content:
                    while block:=content.read(1024*1024):count+=len(block);assert count<=member.size;h.update(block)
                assert count==member.size;row['sha256']=h.hexdigest();row['inode']=str(layer)+':'+str(row['layerEntry'])
            elif typ in ('1','2'):
                assert '\x00' not in member.linkname and len(member.linkname.encode('utf8'))<=4096
                row['link']=safe(member.linkname) if typ=='1' else member.linkname
            entries.append(row)
            end=max(end,member.offset_data+((member.size+511)//512)*512)
    size=Path(path).stat().st_size
    assert 1024<=size-end<=1024*1024,'TAR terminator/padding bounds'
    with Path(path).open('rb') as raw:
        raw.seek(end);assert not any(raw.read()),'Trailing payload after TAR end'
    return entries

def merge_layer(merged,entries,layer):
    """Conservative OCI whiteout and inode alias model, always requiring review."""
    events=[];roots=[]
    # Whiteouts apply to lower layers regardless of their order in this TAR.
    lower=set(merged)
    for row in entries:
        path=row['path'];name=path.rsplit('/',1)[-1];parent=path.rsplit('/',1)[0] if '/' in path else ''
        if not name.startswith('.wh.'):continue
        assert row['type']=='0' and row['size']==0
        target=(parent+'/' if parent else '')+name[4:]
        if name=='.wh..wh..opq':
            victims=[p for p in lower if (not parent or p.startswith(parent+'/'))]
        else:
            safe(target);victims=[p for p in lower if p==target or p.startswith(target+'/')]
        for p in victims:merged.pop(p,None)
        events.append({'kind':'whiteout','layer':layer,'header':row,'removed':sorted(victims)})
    descendants={}
    def ancestors(path):
        parts=path.split('/');return ['/'.join(parts[:n]) for n in range(1,len(parts))]
    for path in merged:
        for parent in ancestors(path):descendants.setdefault(parent,set()).add(path)
    def remove(path):
        merged.pop(path,None);descendants.pop(path,None)
        for parent in ancestors(path):descendants.get(parent,set()).discard(path)
    for source in entries:
        row=dict(source);path=row['path'];name=path.rsplit('/',1)[-1]
        if name.startswith('.wh.'):continue
        if not path:roots.append(row);continue
        parts=path.split('/')
        for n in range(1,len(parts)):
            parent='/'.join(parts[:n])
            assert parent not in merged or merged[parent]['type']=='5','Write through non-directory/symlink requires review'
        if row['type']=='1':
            target=merged.get(row['link'])
            assert target and target['type']=='0','Forward/missing/nonregular hardlink requires a successor'
            assert all(row[k]==target[k] for k in ('mode','uid','gid')),'Ambiguous hardlink ownership/mode'
            assert not row['pax'],'Hardlink PAX semantics require explicit successor review'
            row={**target,'path':path,'hardlinkHeader':source,'layer':layer,'layerEntry':source['layerEntry']}
            events.append({'kind':'hardlink','path':path,'target':source['link'],'inode':target['inode'],'header':source})
        if row['type']!='5':
            for p in list(descendants.get(path,())):remove(p)
        merged[path]=row
        for parent in ancestors(path):descendants.setdefault(parent,set()).add(path)
    assert len(merged)<=1_000_000
    return events,roots

def ordinary(merged):
    groups={}
    for row in merged.values():
        if row['type']=='0':groups.setdefault(row['inode'],[]).append(row['path'])
    output=[]
    for row in merged.values():
        out={'path':'/'+row['path'],'type':{'0':'file','2':'symlink','5':'directory'}[row['type']],
             **{k:row[k] for k in ('mode','uid','gid')}}
        if row['type']=='0':
            paths=sorted(groups[row['inode']]);out.update(bytes=row['size'],sha256=row['sha256'],links=len(paths))
            if len(paths)>1:out['hardlinkGroup']='/'+paths[0]
        elif row['type']=='2':out['target']=row['link']
        output.append(out)
    return sorted(output,key=lambda r:r['path'])

def compare_observation(rows,observed):
    """Report every discrepancy; no exclusions or automatic changed-file waiver."""
    assert isinstance(observed,list) and len(observed)<=1_000_000
    by={r['path']:r for r in rows};seen=set();differences=[]
    for r in observed:
        p=r['path'];assert p not in seen;seen.add(p)
        actual=by.get(p)
        # Compare exactly the ordinary fields actually present in the observation.
        fields=('type','mode','uid','gid','bytes','sha256','target','links','hardlinkGroup')
        old={k:r[k] for k in fields if k in r}
        value=None if actual is None else {k:actual.get(k) for k in old}
        if old!=value:differences.append({'path':p,'observed':old,'layerModel':value})
    differences.extend({'path':p,'observed':None,'layerModel':by[p]} for p in sorted(set(by)-seen))
    return differences

def main():
    # Imported only for root's explicit execution; tests use the pure functions.
    from archive_contract import model,verify_cached_layers,HERE,SETTINGS,OUT,hash_file,MAX_LAYER
    from stage_support import confined
    value=model();verify_cached_layers(value)
    output=HERE/'stage-metadata-proposal-v1';assert not output.exists();output.mkdir()
    produced=[]
    def write(name,obj):
        with (output/name).open('x',encoding='utf8',newline='\n') as f:json.dump(obj,f,ensure_ascii=True,separators=(',',':'));f.write('\n')
        result={'path':name,**pin(output/name)};produced.append(result);return result
    merged={};proofs=[];before=None
    for row in value['layers']:
        compressed=Path(row['sourceFile']);before_hash=hash_file(compressed,MAX_LAYER,row['bytes'])
        assert before_hash[0]==row['digest']
        tarpath=output/('layer-'+str(row['index'])+'.tar');h=hashlib.sha256();total=0
        with compressed.open('rb') as raw,gzip.GzipFile(fileobj=raw,mode='rb') as gz,tarpath.open('xb') as out:
            while block:=gz.read(1024*1024):total+=len(block);assert total<=row['expanded']<=LIMIT;h.update(block);out.write(block)
        assert total==row['expanded'] and 'sha256:'+h.hexdigest()==row['diffId']
        assert hash_file(compressed,MAX_LAYER,row['bytes'])==before_hash
        entries=inspect_tar(tarpath,row['index']);events,roots=merge_layer(merged,entries,row['index'])
        assert pin(tarpath)=={'sha256':h.hexdigest(),'bytes':total}
        record={'index':row['index'],'compressed':{'path':str(compressed),**pin(compressed)},
                'uncompressed':{'path':tarpath.name,'sha256':h.hexdigest(),'bytes':total},
                'entries':write('layer-'+str(row['index'])+'-metadata.json',entries),
                'aliasesWhiteoutsAndRoot':write('layer-'+str(row['index'])+'-events.json',{'events':events,'rootHeaders':roots})}
        proofs.append(record)
        if row['index']+1==SETTINGS['parentLayerCount']:
            before=ordinary(merged);write('parent-inventory.proposed.json',list(merged.values()));write('parent-ordinary.proposed.json',before)
    after=ordinary(merged)
    write('stage-inventory.proposed.json',list(merged.values()));write('stage-ordinary.proposed.json',after)
    obs=SETTINGS['intentBinding']['observation'];path=confined(SETTINGS['evidenceRoot'],obs['path'])
    assert pin(path)=={'sha256':obs['sha256'],'bytes':obs['bytes']} and obs['bytes']<=512*1024**2
    observation=json.loads(path.read_bytes())
    write('ordinary-observation-differences.json',{'before':compare_observation(before,observation['before']),
                                                'after':compare_observation(after,observation['after'])})
    write('metadata-review-required.json',{'accepted':False,'independentReview':False,'scope':'STAGE_FILESYSTEM_METADATA_PROPOSAL',
          'stageDigest':SETTINGS['manifestDigest'],'configDigest':SETTINGS['configDigest'],'source':SETTINGS['source'],
          'parser':{'file':pin(Path(__file__)),'stdlibTarfile':pin(Path(tarfile.__file__)),'python':sys.version,'platform':platform.platform()},
          'layers':proofs,'observation':obs,'oldInventoryExtendedMetadataAccepted':False,
          'extendedMetadataAccepted':False,'completeOciAcceptance':False,'runtimeAccepted':False,'releaseAccepted':False,
          'requiredReview':['raw TAR headers and PAX including xattr/ACL/capability semantics','ordered aliases/whiteouts/root headers',
                            'all actual before/after discrepancies; no implicit exclusions','same-daemon archive and image/raw-log binding',
                            'normalizer and complete filesystem/extended metadata independent acceptance']})
    # The complete-image envelope remains an UNACCEPTED proposal. The existing
    # final-image admission requires actual independent filesystem review and
    # retained per-operation capture; neither is fabricated here.
    def ref(path,known=None):
        p=Path(path).resolve();root=Path(SETTINGS['evidenceRoot']).resolve()
        assert p.is_relative_to(root) and p!=root and not Path(path).is_symlink()
        return {'path':p.relative_to(root).as_posix(),**(known or pin(p))}
    receipt_path=OUT/'local-export-verification.json';available_path=HERE/('stage-'+SETTINGS['role']+'-image-available.json')
    assert receipt_path.is_file() and available_path.is_file(),'Complete actual same-daemon stage materialization required'
    verification=json.loads(receipt_path.read_bytes());available=json.loads(available_path.read_bytes())
    assert verification['manifestDigest']==available['digest']==SETTINGS['manifestDigest']
    assert verification['configDigest']==available['configDigest']==SETTINGS['configDigest']
    assert available['completeLocalContentVerified'] is True and available['runtimeAccepted'] is False
    assert verification['sameDaemonExportEvidence']['daemonId']==available['daemonId']
    assert all(verification[k] is True for k in ('allReferencedBlobsPresent','allDescriptorHashesAndSizesExact','allOrderedDiffIdsExact','exactOriginalManifestAndConfigBytes'))
    archive=Path(verification['archive']);archive_ref=ref(archive)
    assert archive_ref['sha256']==verification['archiveSha256'] and archive_ref['bytes']==verification['archiveBytes']
    order=[{'index':r['index'],'digest':r['digest'],'diffId':r['diffId']} for r in value['layers']]
    write('layer-order.json',order)
    layers=[{'compressed':ref(r['compressed']['path'],{k:r['compressed'][k] for k in ('sha256','bytes')}),
             'uncompressed':ref(output/r['uncompressed']['path'],{k:r['uncompressed'][k] for k in ('sha256','bytes')})} for r in proofs]
    retained=[]
    for proof in available['proofs']:
        actual=ref(proof['path']);assert actual['sha256']==proof['sha256'];retained.append(actual)
    retained.extend(ref(output/r['path'],{k:r[k] for k in ('sha256','bytes')}) for r in produced)
    write('complete-stage-image.proposed.json',{'scope':'COMPLETE_IMMUTABLE_IMAGE','accepted':False,'independentReview':False,
          'image':available['image'],'source':SETTINGS['source'],'artifactPurpose':'sqlite-transaction-stage','runtimeEligible':False,
          'manifest':ref(HERE/'original-manifest.json'),'config':ref(HERE/'original-config.json'),'layers':layers,
          'archive':archive_ref,'verification':ref(receipt_path),'inventory':ref(output/'stage-inventory.proposed.json'),
          'layerOrder':ref(output/'layer-order.json'),'observations':None,'filesystemReview':None,'proofTree':retained,
          'completeOciAcceptance':False,'extendedMetadataAccepted':False,'runtimeAccepted':False,'releaseAccepted':False})

if __name__=='__main__':main()
