"""Main-only admission for reviewed source and exact retained TAR reuse.
Pure helpers perform file reads; no network, containers, extraction or cleanup.
"""
from pathlib import Path
import hashlib,json,sys,re
HERE=Path(__file__).resolve().parent
_runs=[]
def pin(path):
    p=Path(path);assert p.is_file() and not p.is_symlink()
    h=hashlib.sha256();n=0
    with p.open('rb') as f:
        while b:=f.read(1024*1024):n+=len(b);assert n<=12_000_000_000;h.update(b)
    return {'sha256':h.hexdigest(),'bytes':n}
def confined(root,name):
    assert isinstance(name,str) and '\\' not in name and ':' not in name
    parts=name.split('/');assert parts and all(p not in ('','.','..') for p in parts)
    root=Path(root).resolve();p=root
    for part in parts:p=p/part;assert not p.is_symlink()
    assert p.resolve().is_relative_to(root) and p.resolve()!=root
    return p
def read(path):
    p=Path(path);assert p.is_file() and not p.is_symlink() and p.stat().st_size<=64*1024**2
    return json.loads(p.read_bytes())
def ref(root,row):
    p=confined(root,row['path']);assert pin(p)=={k:row[k] for k in ('sha256','bytes')};return p
def tree(root,row):
    p=ref(root,row);v=read(p);assert isinstance(v['files'],list) and v['files']
    seen=set();total=0
    for r in v['files']:
        assert r['path'] not in seen;seen.add(r['path']);total+=r['bytes'];assert total<=40*1024**3;ref(root,r)
    return p
def approval(root,path,scope):
    p=confined(root,path);v=read(p)
    assert v['accepted'] is True and v['independentReview'] is True and v['scope']==scope
    tree(root,v['proofTree']);return p,v
def source_rows():
    rows=[]
    for p in sorted(HERE.rglob('*'),key=lambda p:p.relative_to(HERE).as_posix()):
        if '__pycache__' in p.parts:continue
        assert not p.is_symlink()
        if p.is_file():assert p.suffix!='.pyc';rows.append({'path':p.relative_to(HERE).as_posix(),**pin(p)})
    return rows
def preflight(args):
    assert len(args)==5,'role CONTEXT EVIDENCE SOURCE_REVIEW_REL REUSE_REVIEW_REL required'
    role,context,evidence,source_review,reuse_review=args
    assert role=='api','This successor resumes only the reviewed API metadata failure'
    root=Path(evidence).resolve();context_input=Path(context)
    assert context_input.is_absolute() and context_input.resolve().is_relative_to(root)
    context=confined(root,context_input.relative_to(root).as_posix())
    source_path,source=approval(root,source_review,'STAGE_METADATA_PAX_SUCCESSOR_SOURCE')
    manifest_path=ref(root,source['manifest']);assert read(manifest_path)['files']==source_rows()
    reuse_path,reuse=approval(root,reuse_review,'STAGE_METADATA_RETAINED_TAR_REUSE')
    settings=read(context/'stage-config.json');assert settings['role']==role and Path(settings['evidenceRoot']).resolve()==root
    manifest=read(context/'source-manifest.json');old_review=read(context/'paired-stage-materialization-source-acceptance.json')
    assert old_review['accepted'] is True and old_review['independentReview'] is True
    assert old_review['scope']=='TRANSACTION_STAGE_MATERIALIZATION_SOURCE'
    assert old_review['sourceManifestSha256']==pin(context/'source-manifest.json')['sha256']
    assert old_review['source']==settings['source'] and old_review['role']==role and old_review['stageDigest']==settings['manifestDigest']
    tree(root,old_review['proofTree'])
    names=[]
    for row in manifest['files']:
        names.append(row['name']);assert pin(confined(context,row['name']))=={k:row[k] for k in ('sha256','bytes')}
    assert len(names)==len(set(names)) and set(names)==set(settings['operatorFiles'])|{'stage-config.json'}
    assert pin(context/'stage_support.py')['sha256']=='43119832802ffe114b9c77f6a28563ebc08c677885dfba0f0fc32e22d46710f5'
    assert pin(context/'stage_metadata.py')['sha256']=='aec21400c8f4daa44ae4a0a9ddbc07555912ab733192d8b952467e4220603a6d'
    assert reuse['successorManifestSha256']==source['manifest']['sha256']
    assert reuse['stageConfigSha256']==pin(context/'stage-config.json')['sha256']
    assert reuse['stageSourceManifestSha256']==pin(context/'source-manifest.json')['sha256']
    failure=ref(root,reuse['priorFailure']);assert failure.is_file()
    retained=[source_path,reuse_path,manifest_path,failure,context/'stage-config.json',context/'source-manifest.json',context/'paired-stage-materialization-source-acceptance.json']
    run={'context':context,'root':root,'reuse':reuse,'retainedInputs':retained,'receiptRefs':{'sourceReview':{'path':source_review,**pin(source_path)},'reuseReview':{'path':reuse_review,**pin(reuse_path)}}}
    _runs.append(run)
    assert 'archive_contract' not in sys.modules and 'stage_support' not in sys.modules,'Unexpected prior stage module'
    sys.path.insert(0,str(context));sys.argv=[sys.argv[0],role]
    return run
def check_reuse_rows(rows,layers,root,context):
    assert isinstance(rows,list) and [r['index'] for r in rows]==list(range(29)),'Only complete retained API prefix0..28 may be reused'
    result={}
    for item,row in zip(rows,layers[:29]):
        assert item['index']==row['index'] and item['compressedSha256']=='%s'%row['digest'].split(':',1)[1]
        assert item['compressedBytes']==row['bytes'] and item['diffId']==row['diffId'] and item['expandedBytes']==row['expanded']
        tarpath=ref(root,item['tar'])
        assert tarpath==context/'stage-metadata-proposal-v1'/('layer-'+str(row['index'])+'.tar')
        assert item['tar']['sha256']==row['diffId'].split(':',1)[1] and item['tar']['bytes']==row['expanded']
        result[row['index']]=tarpath
    assert len(result)==29
    return result
def admit_reuse(run,value,settings,context,out):
    assert any(run is r for r in _runs),'Reviewed runner preflight required'
    assert context.resolve()==run['context'].resolve() and settings['role']=='api'
    v=run['reuse'];root=run['root']
    assert v['source']==settings['source'] and v['stageDigest']==settings['manifestDigest'] and v['configDigest']==settings['configDigest']
    available_path=ref(root,v['availability']);verification_path=ref(root,v['verification'])
    assert available_path==context/'stage-api-image-available.json' and verification_path==out/'local-export-verification.json'
    available=read(available_path);verification=read(verification_path)
    assert available['completeLocalContentVerified'] is True and available['runtimeAccepted'] is False
    assert available['digest']==verification['manifestDigest']==v['stageDigest']
    assert available['configDigest']==verification['configDigest']==v['configDigest']
    assert available['daemonId']==verification['sameDaemonExportEvidence']['daemonId']==v['daemonId'] and v['daemonId']
    assert all(verification[k] is True for k in ('allReferencedBlobsPresent','allDescriptorHashesAndSizesExact','allOrderedDiffIdsExact','exactOriginalManifestAndConfigBytes'))
    run['retainedInputs'].extend([available_path,verification_path])
    return check_reuse_rows(v['layers'],value['layers'],root,context)
def verify_sources(value,reuse,verify_cached_layers):
    remaining=[]
    for row in value['layers']:
        assert re.fullmatch('sha256:[a-f0-9]{64}',row['digest']) and re.fullmatch('sha256:[a-f0-9]{64}',row['diffId'])
        assert pin(row['sourceFile'])=={'sha256':row['digest'].split(':',1)[1],'bytes':row['bytes']}
        if row['index'] in reuse:
            assert pin(reuse[row['index']])=={'sha256':row['diffId'].split(':',1)[1],'bytes':row['expanded']}
        else:remaining.append(row)
    # Exact retained compressed and expanded hashes replace redundant gzip work
    # only for independently reviewed already materialized TARs. All remaining
    # layers still use the unchanged admitted decompression/DiffID verifier.
    verify_cached_layers({'layers':remaining})
