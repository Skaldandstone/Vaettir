"""Generated operators import this adapter; no cloud or Docker side effects here."""
import sys
sys.dont_write_bytecode = True
import os, json, hashlib, subprocess, re
from pathlib import Path
HERE = Path(__file__).resolve().parent
sha = lambda b: hashlib.sha256(b).hexdigest()
dump = lambda v: (json.dumps(v, indent=2)+'\n').encode()
def file_sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        while chunk:=f.read(1024*1024): h.update(chunk)
    return h.hexdigest()
def read(path):
    path=Path(path); assert path.is_file() and not path.is_symlink() and path.stat().st_size<=64*1024**2
    return json.loads(path.read_bytes())
CONFIG=read(HERE/'operator-configuration.json')
R=Path(CONFIG['sourceRepo']).resolve(); EVIDENCE=Path(CONFIG['evidenceRoot']).resolve()
D=Path(CONFIG['receipts']).resolve(); O=Path(CONFIG['releaseRoot']).resolve()
P=Path(CONFIG['historicalRoot']).resolve(); AP=P
SOURCE_PACKAGE=Path(CONFIG['sourcePackage']).resolve()
assert O.parent==R/'.local/releases' and O.name.startswith('final-application-release-')
assert D.parent==R/'.local' and D.name.startswith('final-application-release-')
assert D!=O and R!=O and SOURCE_PACKAGE!=O
def ref(row, maximum=12*1024**3):
    assert isinstance(row,dict) and re.fullmatch('[a-f0-9]{64}',row.get('sha256',''))
    value=row['path']; assert isinstance(value,str) and value and '\\' not in value and ':' not in value
    parts=value.split('/');assert all(x not in ('','.','..') for x in parts)
    p=EVIDENCE.joinpath(*parts);assert p.resolve().is_relative_to(EVIDENCE)
    current=EVIDENCE
    for x in parts:current=current/x;assert not current.is_symlink()
    assert isinstance(row['bytes'],int) and 0<=row['bytes']<=maximum and p.is_file() and p.stat().st_size==row['bytes']
    assert file_sha(p)==row['sha256'];return p
def bindings(phase='source'):
    base=read(ref(CONFIG['bindings'],64*1024**2))
    if phase=='source':return base
    assert phase in ('materialize','native','runtime')
    a=read(D/(phase+'-input-acceptance.json'));p=D/(phase+'-bindings.json')
    assert a['accepted'] is True and a['independentReview'] is True and a['bindingsSha256']==file_sha(p)
    assert a['baseBindingsSha256']==CONFIG['bindings']['sha256'] and a['source']==base['nativeBindings']['source']['commit']
    b=read(p)
    for key in ('nativeBindings','repairAcceptance','operatorApproval','operatorManifest','purpose'):assert b[key]==base[key]
    return b
def generated_gate():
    manifest=read(HERE/'generated-manifest.json')
    a=read(D/'generated-operators-source-acceptance.json')
    assert a['accepted'] is True and a['independentReview'] is True and a['manifestSha256']==file_sha(HERE/'generated-manifest.json')
    for row in manifest['files']:
        p=HERE/row['name'];assert p.resolve().parent==HERE and p.is_file() and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    assert a['configurationSha256']==file_sha(HERE/'operator-configuration.json')
def gate(phase='source',kind='api'):
    generated_gate(); b=bindings(phase)
    # Rehash the independently accepted entire source package before invoking
    # its validator, including its frozen native sibling and inherited inputs.
    manifest=read(ref(b['operatorManifest']))
    for row in manifest['files']:
        p=SOURCE_PACKAGE/row['path'];assert p.resolve().is_relative_to(SOURCE_PACKAGE) and not p.is_symlink()
        assert p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']
    for row in read(SOURCE_PACKAGE/'policy.json')['nativeFiles']:
        p=SOURCE_PACKAGE.parent/'production-native-successor-v1'/row['path'];assert file_sha(p)==row['sha256']
    input_path=ref(CONFIG['bindings']) if phase=='source' else D/(phase+'-bindings.json')
    result=subprocess.run(['node',str(SOURCE_PACKAGE/'context.mjs'),phase,str(input_path),str(EVIDENCE),str(R),kind],env=dict(os.environ,PYTHONDONTWRITEBYTECODE='1'),capture_output=True,timeout=1800)
    assert result.returncode==0, result.stderr.decode('utf-8',errors='replace')[-4000:]
    value=json.loads(result.stdout); assert value['releaseAccepted'] is False
    return value
def prepared_gate(main=True):
    value=gate('source'); p=read(O/'prepared.json')
    assert p['commit']==value['source'] and p['tree']==value['tree'] and p['migrationCount']==111 and p['newMigrationCount']==1
    assert p['bindingsSha256']==CONFIG['bindings']['sha256'] and p['releaseAccepted'] is False
    b=bindings();assert p['sourceArchiveSha256']==b['application']['api']['sourceArchive']['sha256']==b['application']['web']['sourceArchive']['sha256']
    assert file_sha(O/'source.zip')==p['sourceArchiveSha256']
    return p
def component_gate(kind, require_native=False):
    p=prepared_gate(); value=gate('runtime' if require_native else 'materialize',kind)
    c=read(O/(kind+'-candidate-custody.json')); f=bindings('runtime' if require_native else 'materialize')['final'][kind]
    assert c['status']=='SUCCEEDED' and c['sourceCommit']==p['commit'] and c['digest']==value['component']['imageDigest']
    assert c['sourceArchiveSha256']==p['sourceArchiveSha256'] and c['configDigest']==read(ref(f['acceptance']))['configDigest']
    for name,key in [(kind+'-original.log','originalLogSha256'),(kind+'-request.json','buildRequestSha256')]:assert file_sha(O/name)==c[key]
    assert 'sha256:'+file_sha(O/(kind+'-original-manifest.json'))==c['digest']
    request=read(O/(kind+'-request.json'))
    if kind=='api':assert 'computeTypeOverride' not in request and read(O/'api-codebuild-terminal.json')['environment']['computeType']=='BUILD_GENERAL1_SMALL'
    assert isinstance(c['layers'],int) and 0<c['layers']<=128
    return c
def source_approval(): return gate('source')
def put(name,value):
    assert Path(name).name==name
    with (O/name).open('xb') as f:f.write(value if isinstance(value,bytes) else dump(value))
def layer_count(kind):return component_gate(kind)['layers']
def runtime_gate(main=True,require_native=True):
    p=prepared_gate();c=component_gate('api',require_native)
    a=read(D/'paired-runtime-operator-source-acceptance.json')
    assert a['accepted'] is True and a['source']==p['commit'] and a['manifestSha256']==file_sha(HERE/'runtime-manifest.json')
    return p,c
def synthetic_dump():
    b=bindings(); p=ref(b['runtime']['synthetic110Dump']); a=read(ref(b['runtime']['synthetic110Acceptance']))
    assert a['actualOwnImageMigrations109to110'] is True and b['runtime']['synthetic110Dump']['sha256'] in a['proofs'].values()
    return p.read_bytes()
RUNTIME_HERE=HERE
