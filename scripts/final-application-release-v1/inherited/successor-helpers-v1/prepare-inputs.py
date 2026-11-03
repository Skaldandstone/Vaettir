"""Prepare Paired inputs after exact PR108 merge proof; never contacts cloud."""
from contracts import *
import copy, datetime, gzip, io, uuid, zipfile

m, ci, manifests = source_gate()
S = m['source']
parent = parent_gate()
preparation_gate()
assert not O.exists(), 'Existing output requires reconciliation; never overwrite or retry preparation'
O.mkdir()
archive = g('-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=zip',S)
entries = {}
for row in g('ls-tree','-rz','--full-tree',S).split(b'\0'):
    if row:
        meta,path = row.split(b'\t',1); mode,kind,oid = meta.split()
        assert kind == b'blob'
        entries[path.decode()] = oid
batch = subprocess.check_output(['git','cat-file','--batch'],cwd=R,input=b'\n'.join(entries.values())+b'\n')
offset = 0
with zipfile.ZipFile(io.BytesIO(archive)) as z:
    assert set(n for n in z.namelist() if not n.endswith('/')) == set(entries)
    for path,oid in entries.items():
        end = batch.index(b'\n',offset); actual,kind,size = batch[offset:end].split(); size = int(size); start = end+1
        assert actual == oid and kind == b'blob' and z.read(path) == batch[start:start+size], path
        assert not any(part in ['.local','assistant-history','node_modules'] for part in PurePosixPath(path).parts)
        offset = start+size+1
assert offset == len(batch)
put('source.zip',archive); archive_sha = sha(archive)
put('source-archive-git-blob-review.json',{'source':S,'tree':T,'entries':len(entries),'everyGitBlobExact':True,'sha256':archive_sha})
old, infos = unpack(P/'runtime-context.tar.gz'); payload = dict(old)
assert len(old) == 723
assert read(P/'transport-inventory.json') == [{'path':n,'bytes':len(v),'sha256':sha(v)} for n,v in old.items()]
for kind in ['api','web']:
    for path,pin in json.loads(old[FAMILY+kind+'/application-binding.json'])['sourceHashes'].items():
        assert sha(old[path] if path.startswith('.release-runtime/') else g('show',S+':'+path)) == pin
put('source-root-review.json',{
    'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'sourceCommit':S,'sourceTree':T,
    'apiSource':S,'baselineApiSource':AB,'baselineApiDigest':API,'prHead':H,'prNumber':108,'ciRun':str(ci['run']),
    'ciCheckout':ci['actualCheckout'],'ciTree':T,'actualCiGitObjectParentsAndTreeVerified':True,
    'ciProofSha256':sha((D/'build-ci-tree-acceptance.json').read_bytes()),
    'mergedSourceSha256':sha((D/'final-merged-source.json').read_bytes()),
    'sourceReviewSha256':sha((D/'reviewed-final-head.json').read_bytes()),
    'operatorReviewSha256':sha((D/'paired-successor-operator-source-acceptance.json').read_bytes()),
    'helperManifestSha256':sha((HERE/'helpers-manifest.json').read_bytes()),
    'parentRootReviewSha256':ROOT,'runtimeBaselineSha256':sha((P/'deployed-runtime-acceptance.json').read_bytes()),
    'all110SqlPreserved':True,'candidateMigrations':110,'newMigrations':0,
    'noDependencyOrNativeRecipeChanges':True,'onlyReviewedServiceWindowScriptsChanged':True,
    'allConsumedManifestPaths':manifests,'applicationArchiveSha256':archive_sha,
    'validationOnly':True,'mainCiRequiredBeforeRollout':True,'zeroSqlChanges':True,'cloudOperationsPerformed':False})
review_sha = sha((O/'source-root-review.json').read_bytes())
allowed = set()
for kind in ['api','web']:
    sp = FAMILY+kind+'/transition-seal.json'; bp = FAMILY+kind+'/application-binding.json'; recipe = 'Dockerfile.'+kind+'.application'
    seal = json.loads(old[sp]); seal[kind]['sourceCommit'] = S; payload[sp] = dump(seal)
    binding = json.loads(old[bp]); original_binding = dict(binding); binding.update(sourceCommit=S,ciRun=str(ci['run']),applicationArchiveSha256=archive_sha,transitionSealSha256=sha(payload[sp]),rootReviewSha256=review_sha); payload[bp] = dump(binding)
    assert old[recipe].count(sha(old[sp]).encode()) == 3
    payload[recipe] = old[recipe].replace(sha(old[sp]).encode(),sha(payload[sp]).encode())
    if kind == 'api':
        before = ('LABEL vaettir.application-source-commit="'+original_binding['sourceCommit']+'" vaettir.application-source-sha256="'+original_binding['applicationArchiveSha256']+'"').encode()
        after = ('LABEL vaettir.application-source-commit="'+S+'" vaettir.application-source-sha256="'+archive_sha+'"').encode()
        assert payload[recipe].count(before) == 1
        payload[recipe] = payload[recipe].replace(before,after)
    allowed.update([sp,bp,recipe])
changes = [{'path':n,'beforeSha256':sha(old[n]),'afterSha256':sha(v)} for n,v in payload.items() if v != old[n]]
assert {r['path'] for r in changes} == allowed
assert sum(old[n] == payload[n] for n in old) == 717
with (O/'runtime-context.tar.gz').open('xb') as f:
    with gzip.GzipFile(fileobj=f,mode='wb',mtime=0) as gz:
        with tarfile.open(fileobj=gz,mode='w') as t:
            for name,value in payload.items():
                info = copy.copy(infos[name]); info.size = len(value); t.addfile(info,io.BytesIO(value))
put('transport-inventory.json',[{'path':n,'bytes':len(v),'sha256':sha(v)} for n,v in payload.items()])
compressed = sha((O/'runtime-context.tar.gz').read_bytes()); index = sha((O/'transport-inventory.json').read_bytes()); transport = sha((compressed+index).encode())
prefix = 'candidate-validation/'+S+'/'+transport
previous = expected_previous()
p = {'purpose':'production-launch-paired/v1','commit':S,'tree':T,'prHead':H,'prNumber':108,'ciRun':str(ci['run']),
     'apiSource':S,'baselineApiSource':AB,'baselineApiDigest':API,'baselineSource':B,'bucket':parent['bucket'],'prefix':prefix,
     'sourceArchiveSha256':archive_sha,'compressedSha256':compressed,'indexSha256':index,'transportSha256':transport,
     'transportMembers':723,'transportExpandedBytes':sum(map(len,payload.values())),'changes':changes,'unchangedMembers':717,
     'sourceRootReviewSha256':review_sha,'authorizedBuildKinds':['api','web'],'migrationCount':110,'newMigrationCount':0,
     'previous':previous,'assetParentWeb':previous['web'],'validationOnly':True,'mainCiRequiredBeforeRollout':True,
     'zeroSqlChanges':True,'old67Or68RollbackAfterTenantWritesForbidden':True,'noProductionRollout':True,'deployed':False}
assert p['transportExpandedBytes'] < 268435456
put('prepared.json',p)
for kind in ['api','web']:
    put(kind+'-request.json',request_template(kind,p,str(uuid.uuid4())))
print(json.dumps({'prepared':str(O),'source':S,'unchangedMembers':717,'bindingChanges':6,'cloudMutation':False}))
