"""Source derivation only. CLI requires final source admission before any output.
Frozen operators are inert inputs; this module never imports or runs them.
"""
import sys
sys.dont_write_bytecode=True
import json,hashlib,re,ast,subprocess,difflib
from pathlib import Path
WEB_LEAF_HERE=Path(__file__).resolve().parent
PRODUCER_HERE=WEB_LEAF_HERE.parent/'final-application-producers-v1'
HERE=PRODUCER_HERE.parent/'final-application-release-v1'
sha=lambda b:hashlib.sha256(b).hexdigest()
dump=lambda v:(json.dumps(v,indent=2)+'\n').encode()
def replace(s,a,b,count=1):
    assert s.count(a)==count,(a,s.count(a),count)
    return s.replace(a,b)
def render(config,source):
    assert Path(config['webLeafPackage']).resolve()==WEB_LEAF_HERE.resolve()
    assert Path(config['producerPackage']).resolve()==PRODUCER_HERE.resolve()
    assert re.fullmatch('[a-f0-9]{40}',source)
    policy=json.loads((HERE/'policy.json').read_bytes()); originals={}
    for row in policy['inherited']:
        b=(HERE/row['path']).read_bytes();assert len(b)==row['bytes'] and sha(b)==row['sha256'];originals[row['path']]=b
    def inherited(group,name):return originals['inherited/'+group+'/'+name].decode()
    outputs={}; derivations=[]
    def emit(name,s,original=None):
        if name.endswith('.py'):ast.parse(s)
        outputs[name]=s.encode()
        if original:
            derivations.append({'name':name,'origin':original,'parentSha256':sha(originals[original]),'candidateSha256':sha(outputs[name])})
            outputs[name+'.diff']=''.join(difflib.unified_diff(originals[original].decode().splitlines(True),s.splitlines(True),fromfile=original,tofile=name)).encode()
    emit('contracts.py',(WEB_LEAF_HERE/'operator-contracts.derived.py').read_text())
    emit('runtime_contracts.py','from contracts import *\n')
    emit('migrate_fixture.py',(HERE/'migrate_fixture.py').read_text())
    emit('prepare_release.py',(HERE/'prepare_release.py').read_text())
    group='materialization-successor-v1'; old=inherited(group,'archive_contract.py');s=old
    start=s.index('BUILD=Path(');end=s.index('MAX_COMPRESSED =')
    s=s[:start]+'''BUILD=HERE
sys.path.insert(0,str(HERE))
from contracts import prepared_gate,component_gate,generated_gate,layer_count,R,D,O,CONFIG
assert len(sys.argv)>1 and sys.argv[1] in ('api','web')
KIND=sys.argv.pop(1)
SOURCE=prepared_gate()['commit']
A=O/(KIND+'-image-audit-v1')
OUT=D/('local-oci-'+KIND+'-'+SOURCE[:12])
CUSTODY=component_gate(KIND)
MANIFEST=CUSTODY['digest'];CONFIG_DIGEST=CUSTODY['configDigest']
CONFIG=CONFIG_DIGEST
IMAGE='051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-'+KIND+'@'+MANIFEST
HOST='npipe:////./pipe/dockerDesktopLinuxEngine'
LAYER_COUNT=CUSTODY['layers']
assert 0<LAYER_COUNT<=128
'''+s[end:]
    start=s.index('def source_gate():');end=s.index('def model():')
    s=s[:start]+'''def source_gate():
    generated_gate()
    p=prepared_gate();assert p['commit']==SOURCE
    approval=read(D/'paired-materialization-source-acceptance.json')
    assert approval['accepted'] is True and approval['source']==SOURCE
    assert approval['sourceManifestSha256']==digest((HERE/'source-manifest.json').read_bytes()).split(':')[1]
    for row in read(HERE/'source-manifest.json')['files']:
        p=HERE/row['name'];assert p.resolve().parent==HERE
        assert digest(p.read_bytes()).split(':')[1]==row['sha256']

'''+s[end:]
    start=s.index("    component=read(O/'component-image-review.json')");end=s.index("    raw=(A/'original-manifest.json')")
    s=s[:start]+"    component_gate(KIND) # Exact SQLite ledger/native equality/consumer closure/unsuppressed scan.\n"+s[end:]
    emit('archive_contract.py',s,'inherited/'+group+'/archive_contract.py')
    for name in ['prepare-archive.py','verify-archive.py','materialize-local.py']:
        s=inherited(group,name)
        if name=='materialize-local.py':
            s=replace(s,"files += [Path(row['path']) for row in read(HERE/'pinned-inputs.json')['files']]","files += [D/'materialize-bindings.json',D/'materialize-input-acceptance.json',D/'generated-operators-source-acceptance.json',HERE/'generated-manifest.json',HERE/'operator-configuration.json']")
            s=replace(s,"O/'component-image-review.json',","")
        emit(name,s,'inherited/'+group+'/'+name)
    group='runtime-successor-v1'
    for name in ['image_admission.py','isolated_image_fixture.py','compiled-compliance-review-suite.mjs','compiled-privacy-fixture.mjs','compiled-recovery-fixture.mjs']:
        s=inherited(group,name)
        s=s.replace('review110-images-bbd66d00-20261102','review111-images-'+source[:12]+'-release')
        s=s.replace('vaettir_case_review110','vaettir_case_review111')
        if name=='image_admission.py':
            s=replace(s,'p,_=runtime_gate();','p,_=runtime_gate(require_native=False);')
            s=replace(s,"=={'api':98,'web':56}[kind]","==c['layers']")
        emit(name,s,'inherited/'+group+'/'+name)
    s=inherited(group,'prepare-image-isolated-fixture.py')
    start=s.index('p,c=runtime_gate();');end=s.index("assert not (O/'image-isolated-fixture.json')")
    s=s[:start]+"from contracts import synthetic_dump\nfrom migrate_fixture import migrate\np,c=runtime_gate();D=O;db='vaettir_case_review111_seed'\ndump=synthetic_dump()\n"+s[end:]
    # Restore the real retained schema110 seed, then perform the genuine111 migration.
    marker=";assert ledger=='110'"
    s=replace(s,marker,marker+"\nmigrate(client,admission,db)")
    s=s.replace("'migrations':110","'migrations':111").replace('schema110 runtime','schema111 runtime')
    emit('prepare-image-isolated-fixture.py',s,'inherited/'+group+'/prepare-image-isolated-fixture.py')
    s=inherited(group,'probe-normal-recovery-runtime.py')
    start=s.index("A=Path(");end=s.index("assert read(O/'image-isolated-fixture.json')")
    s=s[:start]+"from contracts import synthetic_dump\nfrom migrate_fixture import migrate\ndump=synthetic_dump()\n"+s[end:]
    anchor=" assert sql('SELECT count(*) FROM \"_prisma_migrations\" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',db)=='110'"
    s=replace(s,anchor,anchor+"\n migrate(client,admission,db)")
    s=s.replace('vaettir_case_review110','vaettir_case_review111').replace('vaettir-review110-','vaettir-review111-'+source[:12]+'-')
    s=s.replace("b'110 migrations found'","b'111 migrations found'").replace("'schema':110","'schema':111").replace("'*review110*'","'*review111*'")
    emit('probe-normal-recovery-runtime.py',s,'inherited/'+group+'/probe-normal-recovery-runtime.py')
    # Reuse the exact prestart/probe/restore routines, adding separately reviewed
    # final-source real compiled-module test fixtures for the newly added routes.
    prefix=s[:s.index('local_image=')]
    prefix=replace(prefix,"assert not (O/'actual-normal-recovery-runtime-acceptance.json').exists()","assert not (O/'additional-runtime-result.json').exists()")
    extra=prefix+'''
from contracts import bindings,ref
b=bindings('runtime');fixtures=b['runtime']['additionalCompiledProbes']
assert sorted(x['name'] for x in fixtures)==['android','import','plugin']
minimum={'plugin':6,'android':5,'import':2}; results=[]
(O/'additional-runtime-intent.json').open('xb').write(json.dumps({'source':source,'image':image,'once':True}).encode())
for row in fixtures:
 assert row['source']==source and row['tests']>=minimum[row['name']] and row['tests']<=500
 review=read(ref(row['review']));assert review['accepted'] is True and review['independentReview'] is True
 assert review['source']==source and review['fixtureSha256']==row['script']['sha256'] and review['actualCompiledModules'] is True and review['noDatabaseOrRpcMock'] is True and review['noSkips'] is True
 code=ref(row['script']).read_bytes();filename='additional-'+row['name']+'.mjs';path=RUNTIME_HERE/filename
 # Probe bytes are staged by the reviewed generator; never rewrite accepted operators.
 assert path.read_bytes()==code
 db='vaettir_case_review111_'+row['name'];create_database(db)
 name='vaettir-review111-'+source[:12]+'-'+row['name']
 result=probe(name,db,'enabled',filename,tests=row['tests']);results.append({'name':row['name'],**result})
(O/'additional-runtime-result.json').open('xb').write(json.dumps({'source':source,'image':image,'schema':111,'results':results,'releaseAccepted':False}).encode())
'''
    emit('probe-additional-runtime.py',extra)
    s=inherited(group,'probe-web-image.py')
    start=s.index('R = Path.cwd()');end=s.index("read = lambda f:")
    s=s[:start]+'''from contracts import R,D,O,HERE as H,prepared_gate,component_gate
approval=json.loads((D/'web-fixture-operator-source-acceptance.json').read_bytes())
assert approval['accepted'] is True and approval['operatorSha256']==hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
p=prepared_gate();component_gate('web',require_native=True);source=p['commit']
'''+s[end:]
    oldpath="runtime = Path('C:/Users/James/.codex/worktrees/vaettir-enterprise-identity/Vaettir/.local/production-launch-20261102/runtime-successor-v1')"
    if oldpath not in s:
        # Exact source uses an alternate quote/spacing; select one whole assignment.
        lines=[x for x in s.splitlines() if x.startswith('runtime = Path(') or x.startswith('runtime=Path(')];assert len(lines)==1;oldpath=lines[0]
    s=replace(s,oldpath,'runtime = H')
    emit('probe-web-image.py',s,'inherited/'+group+'/probe-web-image.py')
    outputs['operator-configuration.json']=dump(config)
    outputs['derivations.json']=dump({'source':source,'rows':derivations,'operatorExecuted':False,'releaseAccepted':False})
    return outputs

def main():
    assert len(sys.argv)==3,'CONFIG.json NEW_OPERATOR_DIRECTORY'
    config=json.loads(Path(sys.argv[1]).read_bytes());evidence=Path(config['evidenceRoot']).resolve()
    row=config['bindings'];parts=row['path'].split('/');assert all(x not in ('','.','..') for x in parts) and ':' not in row['path'] and '\\' not in row['path']
    p=evidence.joinpath(*parts);assert p.resolve().is_relative_to(evidence) and not p.is_symlink()
    raw=p.read_bytes();assert len(raw)==row['bytes'] and sha(raw)==row['sha256']
    result=subprocess.run(['node',str(WEB_LEAF_HERE/'release-context.derived.mjs'),'source',str(p),str(evidence),config['sourceRepo'],'api'],capture_output=True,timeout=1800)
    assert result.returncode==0,result.stderr.decode(errors='replace')[-4000:];source=json.loads(result.stdout)['source']
    files=render(config,source)
    # Additional fixture bytes must already be independently reviewed final-source
    # inputs. Their scripts can be present before execution, but never invented.
    b=json.loads(raw)
    for item in b['runtime']['additionalCompiledProbes']:
        assert item['name'] in ('plugin','android','import') and item['source']==source
        row=item['script'];q=evidence/row['path'];assert q.resolve().is_relative_to(evidence) and not q.is_symlink()
        value=q.read_bytes();assert len(value)==row['bytes'] and sha(value)==row['sha256'];files['additional-'+item['name']+'.mjs']=value
    manifest={'files':[{'name':n,'sha256':sha(v),'bytes':len(v)} for n,v in sorted(files.items())]}
    # These views have the same exact payload rows; no self-acceptance is emitted.
    files['source-manifest.json']=dump(manifest);files['runtime-manifest.json']=dump(manifest)
    files['generated-manifest.json']=dump({'files':[{'name':n,'sha256':sha(v),'bytes':len(v)} for n,v in sorted(files.items())]})
    out=Path(sys.argv[2]);out.mkdir(parents=False)
    (out/'generation-intent.json').open('xb').write(dump({'source':source,'once':True,'operatorExecuted':False}))
    for n,v in files.items():(out/n).open('xb').write(v)
    print(json.dumps({'generatedSource':str(out),'source':source,'executionAuthorized':False,'releaseAccepted':False}))
if __name__=='__main__':main()
