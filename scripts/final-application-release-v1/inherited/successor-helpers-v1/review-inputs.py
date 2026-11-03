"""Independent local review of all transport deltas and both paired requests."""
from contracts import *
import datetime, uuid
m, ci, _ = source_gate()
p = read(O/'prepared.json'); source = m['source']; parent = parent_gate()
assert p['commit'] == source and p['authorizedBuildKinds'] == ['api','web']
assert p['apiSource'] == source and p['baselineApiSource'] == AB and p['migrationCount'] == 110 and p['newMigrationCount'] == 0
for n,k in [('source.zip','sourceArchiveSha256'),('runtime-context.tar.gz','compressedSha256'),('transport-inventory.json','indexSha256'),('source-root-review.json','sourceRootReviewSha256')]:
    assert sha((O/n).read_bytes()) == p[k]
assert (O/'source.zip').read_bytes() == g('-c','core.autocrlf=false','-c','core.eol=lf','archive','--format=zip',source)
assert read(O/'source-archive-git-blob-review.json')['everyGitBlobExact'] is True
old,om = unpack(P/'runtime-context.tar.gz'); new,nm = unpack(O/'runtime-context.tar.gz')
assert len(new) == 723 and set(new) == set(old)
for name in old:
    assert (om[name].mode,om[name].uid,om[name].gid,om[name].mtime,om[name].pax_headers) == (nm[name].mode,nm[name].uid,nm[name].gid,nm[name].mtime,nm[name].pax_headers)
allowed=set()
for kind in ['api','web']:
    sp = FAMILY+kind+'/transition-seal.json'; bp = FAMILY+kind+'/application-binding.json'; recipe = 'Dockerfile.'+kind+'.application'
    seal = json.loads(old[sp]); seal[kind]['sourceCommit'] = source; assert json.loads(new[sp]) == seal
    binding = json.loads(old[bp]); original_binding = dict(binding); binding.update(sourceCommit=source,ciRun=str(ci['run']),applicationArchiveSha256=p['sourceArchiveSha256'],transitionSealSha256=sha(new[sp]),rootReviewSha256=p['sourceRootReviewSha256'])
    assert json.loads(new[bp]) == binding
    assert old[recipe].count(sha(old[sp]).encode()) == 3
    expected_recipe = old[recipe].replace(sha(old[sp]).encode(),sha(new[sp]).encode())
    if kind == 'api':
        before = ('LABEL vaettir.application-source-commit="'+original_binding['sourceCommit']+'" vaettir.application-source-sha256="'+original_binding['applicationArchiveSha256']+'"').encode()
        after = ('LABEL vaettir.application-source-commit="'+source+'" vaettir.application-source-sha256="'+p['sourceArchiveSha256']+'"').encode()
        assert expected_recipe.count(before) == 1
        expected_recipe = expected_recipe.replace(before,after)
    assert new[recipe] == expected_recipe
    allowed.update([sp,bp,recipe])
assert {n for n in old if old[n] != new[n]} == allowed
assert sum(old[n] == new[n] for n in old) == 717
for kind in ['api','web']:
    for n,pin in json.loads(new[FAMILY+kind+'/application-binding.json'])['sourceHashes'].items():
        assert sha(new[n] if n.startswith('.release-runtime/') else g('show',source+':'+n)) == pin
assert sum(map(len,new.values())) == p['transportExpandedBytes'] < 268435456
assert read(O/'transport-inventory.json') == [{'path':n,'bytes':len(v),'sha256':sha(v)} for n,v in new.items()]
assert p['changes'] == [{'path':n,'beforeSha256':sha(old[n]),'afterSha256':sha(v)} for n,v in new.items() if v != old[n]]
for kind in ['api','web']:
    request = read(O/(kind+'-request.json'))
    origin = AP if kind == 'api' else P
    assert request['idempotencyToken'] != read(origin/(kind+'-request.json'))['idempotencyToken']
    assert str(uuid.UUID(request['idempotencyToken'])) == request['idempotencyToken']
    assert request == request_template(kind,p,request['idempotencyToken'])
assert read(O/'api-request.json')['idempotencyToken'] != read(O/'web-request.json')['idempotencyToken']
assert p['previous'] == expected_previous() and p['assetParentWeb'] == p['previous']['web']
put('input-review.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':source,'allInputsReviewed':True,'validationOnly':True,'all723MembersVerified':True,'all717NativeProofPayloadsExact':True,'all717RetainedMembersExact':True,'onlySixBindingDeltas':True,'sourceArchiveEveryGitBlobExact':True,'all110SqlPreserved':True,'zeroSqlChanges':True,'requestOnlySourceTransportAndPreviousWebPinsChanged':True,'requestHashes':{k:sha((O/(k+'-request.json')).read_bytes()) for k in ['api','web']},'operatorHashes':[{'path':str(HERE/row['name']),'sha256':row['sha256']} for row in read(HERE/'helpers-manifest.json')['files']],'cloudOperationsPerformed':False})
print(json.dumps({'reviewed':True,'source':source,'cloudMutation':False}))
