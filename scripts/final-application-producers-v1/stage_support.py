"""Pure stage admission. No Docker, subprocess, network, extraction or acceptance writes."""
from pathlib import Path
import hashlib,json,re

def file_pin(path,expected,limit=12_000_000_000):
    path=Path(path)
    assert path.is_file() and not path.is_symlink()
    h=hashlib.sha256();count=0
    with path.open('rb') as stream:
        while block:=stream.read(1024*1024):
            count+=len(block);assert count<=limit;h.update(block)
    assert count==expected['bytes'] and h.hexdigest()==expected['sha256'],str(path)

def confined(root,name):
    assert isinstance(name,str) and '\\' not in name and ':' not in name
    parts=name.split('/');assert parts and all(p not in ('','..','.') for p in parts)
    root=Path(root).resolve();p=root
    for part in parts:
        p=p/part;assert not p.is_symlink()
    assert p.resolve().is_relative_to(root) and p.resolve()!=root
    return p

def source_gate(here,c):
    assert c['purpose']=='transaction-stage-custody/v1'
    manifest_path=here/'source-manifest.json';manifest=json.loads(manifest_path.read_bytes())
    review=json.loads((here/'paired-stage-materialization-source-acceptance.json').read_bytes())
    assert review['accepted'] is True and review['independentReview'] is True
    assert review['scope']=='TRANSACTION_STAGE_MATERIALIZATION_SOURCE'
    assert review['source']==c['source'] and review['role']==c['role']
    assert review['stageDigest']==c['manifestDigest']
    assert review['sourceManifestSha256']==hashlib.sha256(manifest_path.read_bytes()).hexdigest()
    assert review['proofTree'] and isinstance(review['proofTree'],list)
    for row in review['proofTree']:file_pin(confined(c['evidenceRoot'],row['path']),row)
    names=set()
    for row in manifest['files']:
        assert row['name'] not in names;names.add(row['name'])
        file_pin(confined(here,row['name']),row)
    assert names==set(c['operatorFiles'])|{'stage-config.json'}
    assert manifest['purpose']==c['purpose'] and manifest['source']==c['source']
    for row in c['inputProofs']:file_pin(confined(c['evidenceRoot'],row['path']),row)
    intent=json.loads(confined(c['evidenceRoot'],c['metadataIntent']['path']).read_bytes())
    assert intent['accepted'] is True and intent['independentReview'] is True
    assert intent['scope']=='TRANSACTION_STAGE_BYTE_VERIFICATION_INTENT'
    assert intent['binding']==c['intentBinding']
    assert intent['proofTree']
    for row in intent['proofTree']:file_pin(confined(c['evidenceRoot'],row['path']),row)

def validate_stage(here,c):
    assert c['role'] in ('api','web') and re.fullmatch('[0-9a-f]{40}',c['source'])
    assert re.fullmatch('[0-9a-f]{40}',c['tree'])
    raw=(here/'original-manifest.json').read_bytes();cr=(here/'original-config.json').read_bytes()
    parent_raw=(here/'parent-manifest.json').read_bytes();pc_raw=(here/'parent-config.json').read_bytes()
    assert 'sha256:'+hashlib.sha256(raw).hexdigest()==c['manifestDigest']
    assert 'sha256:'+hashlib.sha256(cr).hexdigest()==c['configDigest']
    assert 'sha256:'+hashlib.sha256(parent_raw).hexdigest()==c['parentDigest']
    assert 'sha256:'+hashlib.sha256(pc_raw).hexdigest()==c['parentConfigDigest']
    m=json.loads(raw);config=json.loads(cr);p=json.loads(parent_raw);pc=json.loads(pc_raw)
    count=c['parentLayerCount'];assert count=={'api':98,'web':56}[c['role']]
    assert len(p['layers'])==count and len(pc['rootfs']['diff_ids'])==count
    assert m['layers'][:count]==p['layers'] and config['rootfs']['diff_ids'][:count]==pc['rootfs']['diff_ids']
    assert count<c['layerCount']<=124 and len(m['layers'])==len(config['rootfs']['diff_ids'])==c['layerCount']
    assert p['config']['digest']==c['parentConfigDigest'] and p['config']['size']==len(pc_raw)
    actual=dict(config['config']);prior=dict(pc['config'])
    labels=actual.pop('Labels',{});old=prior.pop('Labels',{})
    assert actual==prior,'Stage changed parent runtime configuration'
    assert labels==old,'Stage changed parent labels'
    # The frozen recipe has no new labels: validation source and target custody
    # come from the reviewed actual build request/context, never invented labels.
    assert c['intentBinding']['target']=='sqlite_observation'
    assert c['intentBinding']['artifactPurpose']=='sqlite-transaction-stage'
    assert c['intentBinding']['runtimeEligible'] is False
    assert config['os']==pc['os']=='linux' and config['architecture']==pc['architecture']=='amd64'
    assert c['intentBinding']['manifestDigest']==c['manifestDigest']
    assert c['intentBinding']['configDigest']==c['configDigest']
    assert c['intentBinding']['source']==c['source'] and c['intentBinding']['tree']==c['tree']
    assert c['intentBinding']['role']==c['role'] and c['intentBinding']['layerCount']==c['layerCount']
