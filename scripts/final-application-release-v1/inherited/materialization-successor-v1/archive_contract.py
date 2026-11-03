"""Offline, content-addressed archive contract. No subprocess, network or Docker API."""
from pathlib import Path, PurePosixPath
import gzip, hashlib, json, re

HERE = Path(__file__).resolve().parent
import sys
BUILD=Path('C:/Users/James/.codex/worktrees/vaettir-enterprise-identity/Vaettir/.local/production-launch-20261102/successor-helpers-v1')
sys.path.insert(0,str(BUILD))
from contracts import prepared_gate
assert len(sys.argv)>1 and sys.argv[1] in ('api','web'),'First argument must be exact component api or web'
KIND=sys.argv.pop(1)
R=Path('C:/Users/James/.codex/worktrees/vaettir-pr-integration/Vaettir')
D=R/'.local/production-launch-20261102'
O=R/'.local/releases/production-launch-20261102-v1'
A=O/(KIND+'-image-audit-v1')
OUT=D/('local-oci-'+KIND+'-v1')
SOURCE='bbd66d00a968363b5e8e44dbb33172fce61dd454'
CUSTODY=json.loads((O/(KIND+'-candidate-custody.json')).read_bytes())
MANIFEST=CUSTODY['digest'];CONFIG=CUSTODY['configDigest']
IMAGE='051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-'+KIND+'@'+MANIFEST
HOST='npipe:////./pipe/dockerDesktopLinuxEngine'
LAYER_COUNT={'api':98,'web':56}[KIND]
MAX_COMPRESSED = 3_000_000_000
MAX_EXPANDED = 12_000_000_000
MAX_LAYER = 1_250_000_000
MAX_LAYER_EXPANDED = 8_000_000_000
MAX_MEMBERS = 128
CHUNK = 1024*1024

def digest(data):
    return 'sha256:'+hashlib.sha256(data).hexdigest()

def dump(v):
    return (json.dumps(v,indent=2)+'\n').encode()

def read(path):
    assert path.is_file() and path.stat().st_size <= 32*1024*1024
    return json.loads(path.read_bytes())

def hash_stream(stream, bound, expected_size=None):
    h=hashlib.sha256(); count=0
    while True:
        block=stream.read(CHUNK)
        if not block: break
        count+=len(block); assert count<=bound,'Content exceeds bound'; h.update(block)
    if expected_size is not None: assert count==expected_size,'Content size differs'
    return 'sha256:'+h.hexdigest(),count

def hash_file(path, bound=MAX_COMPRESSED+2*1024*1024, size=None):
    assert path.is_file() and not path.is_symlink()
    with path.open('rb') as stream: return hash_stream(stream,bound,size)

def blob_name(value):
    assert re.fullmatch(r'sha256:[0-9a-f]{64}',value)
    return 'blobs/sha256/'+value.split(':')[1]

def source_gate():
    manifest=read(HERE/'source-manifest.json')
    approval=read(D/'paired-materialization-source-acceptance.json')
    p=prepared_gate();assert p['commit']==SOURCE
    assert digest((BUILD/'helpers-manifest.json').read_bytes()).split(':')[1]==read(HERE/'pinned-inputs.json')['buildManifestSha256']
    assert approval['accepted'] is True and approval['source']==SOURCE
    assert approval['sourceManifestSha256']==digest((HERE/'source-manifest.json').read_bytes()).split(':')[1]
    for row in manifest['files']:
        path=HERE/row['name']; assert path.resolve().parent==HERE
        assert digest(path.read_bytes()).split(':')[1]==row['sha256']
    for row in read(HERE/'pinned-inputs.json')['files']:
        value,_=hash_file(Path(row['path']))
        assert value.split(':')[1]==row['sha256'],row['path']

def model():
    source_gate()
    custody=read(O/(KIND+'-candidate-custody.json')); audit=read(A/'custody-collection.json')
    assert custody['status']=='SUCCEEDED' and custody['sourceCommit']==SOURCE
    assert custody['digest']==audit['digest']==MANIFEST and custody['configDigest']==audit['configDigest']==CONFIG
    assert audit['sourceCommit']==SOURCE and audit['completeLayers'] is True and audit['layers']==LAYER_COUNT
    component=read(O/'component-image-review.json')['rows']; assert len(component)==2
    component=next(row for row in component if row['kind']==KIND)
    assert component['kind']==KIND and component['sourceCommit']==SOURCE and component['digest']==MANIFEST
    assert component['componentSecurityAccepted'] is True and component['allNativeTuplesByteExactAcceptedParent'] is True
    assert component['dpkgStatusByteExactAcceptedParent'] is True and component['globalWaiver'] is False
    assert component['unhandledFindings']==0 and component['nativeDeltaAllowed'] is False
    parent=R/'.local/releases/compliance-case-review-release-20261030-v1'
    assert read(A/'complete-unsuppressed-findings.json')==read(parent/(KIND+'-image-audit-v1/complete-unsuppressed-findings.json'))
    if KIND=='api':
        assert component['affectedProxyExecutablesAbsent'] is True and component['rawUnsuppressedFindings']==1
        assert [row['name'] for row in component['scanDispositions']]==['CVE-2026-58055']
    else:assert component['rawUnsuppressedFindings']==0 and component['scanDispositions']==[]
    raw=(A/'original-manifest.json').read_bytes(); config_raw=(A/'original-config.json').read_bytes()
    assert raw==(O/(KIND+'-original-manifest.json')).read_bytes()
    assert digest(raw)==MANIFEST
    assert digest(config_raw)==CONFIG
    m=json.loads(raw); config=json.loads(config_raw)
    assert m['schemaVersion']==2 and m['mediaType']=='application/vnd.docker.distribution.manifest.v2+json'
    assert m['config']=={'mediaType':'application/vnd.docker.container.image.v1+json','size':len(config_raw),'digest':CONFIG}
    assert config['os']=='linux' and config['architecture']=='amd64' and config['rootfs']['type']=='layers'
    if KIND=='api':
        labels=config['config']['Labels'];assert labels['vaettir.application-source-commit']==SOURCE and labels['vaettir.application-source-sha256']==prepared_gate()['sourceArchiveSha256']
    layers=read(A/'complete-layers.json'); diffs=config['rootfs']['diff_ids']
    assert len(m['layers'])==len(layers)==len(diffs)==LAYER_COUNT
    unique={blob_name(MANIFEST):{'path':A/'original-manifest.json','digest':MANIFEST,'size':len(raw)},blob_name(CONFIG):{'path':A/'original-config.json','digest':CONFIG,'size':len(config_raw)}}
    for index,(descriptor,row,diff) in enumerate(zip(m['layers'],layers,diffs)):
        assert set(descriptor)=={'mediaType','digest','size'}
        assert descriptor['mediaType']=='application/vnd.docker.image.rootfs.diff.tar.gzip'
        assert row['index']==index and row['digest']==descriptor['digest'] and row['bytes']==descriptor['size']
        assert row['diffId']==diff and 0<row['bytes']<=MAX_LAYER and 0<row['expanded']<=MAX_LAYER_EXPANDED
        name=blob_name(row['digest']); blob_name(diff)
        proposed={'path':Path(row['sourceFile']),'digest':row['digest'],'size':row['bytes']}
        if name in unique:
            assert unique[name]['digest']==proposed['digest'] and unique[name]['size']==proposed['size']
        else: unique[name]=proposed
    assert sum(r['bytes'] for r in layers)==audit['compressedBytes']
    assert sum(r['expanded'] for r in layers)==audit['expandedBytes']
    assert sum(r['expanded'] for r in layers)<MAX_EXPANDED,'Aggregate expanded cache exceeds bound'
    assert sum(v['size'] for v in unique.values())<MAX_COMPRESSED
    assert len(unique)==2+len({row['digest'] for row in layers})
    index={'schemaVersion':2,'mediaType':'application/vnd.oci.image.index.v1+json','manifests':[{'mediaType':m['mediaType'],'digest':MANIFEST,'size':len(raw),'platform':{'os':'linux','architecture':'amd64'}}]}
    return {'manifest':m,'config':config,'layers':layers,'blobs':unique,'index':index,'layout':{'imageLayoutVersion':'1.0.0'}}

def verify_cached_layers(v):
    rows=[]
    for row in v['layers']:
        path=Path(row['sourceFile'])
        value,_=hash_file(path,MAX_LAYER,row['bytes']); assert value==row['digest']
        with path.open('rb') as compressed:
            with gzip.GzipFile(fileobj=compressed,mode='rb') as expanded:
                diff,size=hash_stream(expanded,MAX_LAYER_EXPANDED,row['expanded'])
        assert diff==row['diffId']
        rows.append({'index':row['index'],'digest':value,'size':row['bytes'],'diffId':diff,'expanded':size,'sourceFile':str(path)})
    return rows

def local_path(value):
    path=Path(value).resolve()
    assert path.is_relative_to(D.resolve()) and path!=D.resolve()
    return path
