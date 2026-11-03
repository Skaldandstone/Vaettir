"""Local-only proof gates shared by the successor operators. No network calls."""
from pathlib import Path, PurePosixPath
import hashlib, json, subprocess, sys, tarfile

HERE = Path(__file__).resolve().parent
R = Path("C:/Users/James/.codex/worktrees/vaettir-pr-integration/Vaettir")
D = R / '.local/production-launch-20261102'
OLD_D = R / '.local/compliance-case-review-release-20261030'
P = R / '.local/releases/compliance-case-review-release-20261030-v1'
AP = P
O = R / '.local/releases/production-launch-20261102-v1'
S='bbd66d00a968363b5e8e44dbb33172fce61dd454'; B='62c6645a99e4bfa156b8b242569e3a828a0f48fe'; AB=B; H='3de1f1dc8685e292d9b5683169897e85cc672f19'; T='7fba584f72a85c869436e503910bc97c86e8307d'
ROOT='8726efc25924a37613c3ad1d632617c335881f2d21ce36a393ecc98e362b73f4'; API_ROOT=ROOT
API='sha256:156b02e9cd6d62ea360c63437a22e0143bd0bf8ccb9632f952015dcb1bb289eb'; WEB='sha256:3f615b8ee455c1a1160c9f20de125e310ca26ac6d754f5a56a4c0801f343b2ef'
FAMILY = '.release-runtime/4bcbdb944eaea95f7083baec02f329b4f8e6adbc848b716f73cc07c8d0fc9ec8/'
sha=lambda b:hashlib.sha256(b).hexdigest()
read=lambda p:json.loads(p.read_bytes())
dump=lambda v:(json.dumps(v,indent=2)+'\n').encode()
g=lambda *a:subprocess.check_output(['git',*a],cwd=R,timeout=120)
def file_sha(path):
    h=hashlib.sha256()
    with Path(path).open('rb') as f:
        while b:=f.read(1024*1024):h.update(b)
    return h.hexdigest()
def put(name,value):
    with (O/name).open('xb') as f:f.write(value if isinstance(value,bytes) else dump(value))
def source_approval():
    a=read(D/'paired-successor-operator-source-acceptance.json')
    assert a['accepted'] is True and a['source']==S and a['head']==H
    assert a['manifestSha256']==file_sha(HERE/'helpers-manifest.json')
    for row in read(HERE/'helpers-manifest.json')['files']:
        path=HERE/row['name'];assert path.resolve().parent==HERE
        assert file_sha(path)==row['sha256'],row['name']
    for row in read(HERE/'inherited-sources.json')['files']:assert file_sha(row['path'])==row['sha256'],row['path']
    return a
def parent_gate():
    assert file_sha(P/'root-review.json')==ROOT
    parent=read(P/'root-review.json')
    assert parent['sourceCommit']==B and parent['tree']=='60b947283c827556b022ced930585371d4897a1c'
    assert parent['apiDigest']==API and parent['webDigest']==WEB
    assert len(parent['proofs'])==296
    for row in parent['proofs']:assert file_sha(row['path'])==row['sha256'],row['path']
    b=read(HERE/'release-bindings.json')
    assert file_sha(P/'deployed-runtime-acceptance.json')==b['priorDeployedSha256']
    deployed=read(P/'deployed-runtime-acceptance.json')
    assert deployed['runtimeAccepted'] is True and deployed['source']==B and deployed['schema']==110 and deployed['workers']==7
    for kind,digest,revision in [('api',API,71),('web',WEB,79)]:
        assert file_sha(P/(kind+'-stable.json'))==deployed[kind+'StableSha256']
        stable=read(P/(kind+'-stable.json'))
        for row in stable.get('observerProofs',[]):assert file_sha(row['path'])==row['sha256']
        item=next(x for x in deployed['services'] if x['kind']==kind)
        assert item['source']==B and item['digest']==digest and item['taskDefinition'].endswith(':'+str(revision))
    accepted=read(D/'availability-accepted.json')
    assert file_sha(D/'availability-accepted.json')==b['availabilitySha256']
    assert accepted['alwaysOnSchedules'] is True and accepted['securityOrTargetChanges'] is False
    assert len(accepted['schedules'])==6 and all(x['State']=='DISABLED' for x in accepted['schedules'])
    p=read(P/'prepared.json');assert p['commit']==B
    for n,k in [('runtime-context.tar.gz','compressedSha256'),('transport-inventory.json','indexSha256')]:assert file_sha(P/n)==p[k]
    return p
def ci_gate(name,logname,head,main=False):
    ci=read(D/name);raw=(D/logname).read_bytes()
    assert ci['head']==head and ci['tree']==T
    assert ci['ciSuccess'] is True and ci['allApplicationStepsPassed'] is True
    assert ci['status']=='completed' and ci['conclusion']==ci['jobConclusion']=='success' and ci['failedSteps']==[]
    assert ci['migrationCount']==110 and ci['oauthDatabaseTests']==30 and ci['complianceDatabaseTests']==42
    assert ci['apiTestsPassed']==4680 and ci['webTestsPassed']==2503 and ci['allThreeComplianceBrowserHarnessesPassed'] is True
    assert sha(raw)==ci['logSha256']
    for marker in ['node apps/web/e2e/compliance-access-lifecycle.browser.mjs','node apps/web/e2e/compliance-review.browser.mjs','node apps/web/e2e/compliance-picker.browser.mjs','Published Sharp receipt retained:','110 migrations found']:
        assert marker.encode() in raw and marker in ci['requiredLogMarkers']
    actual=ci['actualCheckout']
    assert g('show','-s','--format=%T',actual).decode().strip()==T
    assert g('show','-s','--format=%P',actual).decode().split()==[B,H]
    if main:assert actual==S and head==S
    else:
        assert str(ci['run'])=='41501121445' and ci['base']==B
        assert sha(raw)==read(HERE/'release-bindings.json')['prCiLogSha256']
    return ci
def source_gate(main=False):
    source_approval();b=read(HERE/'release-bindings.json')
    assert g('remote','get-url','origin').decode().strip()=='https://github.com/Skaldandstone/Vaettir.git'
    assert Path(g('rev-parse','--git-common-dir').decode().strip()).resolve()==Path('C:/Users/James/Documents/GitHub/Vaettir/.git').resolve()
    assert g('rev-parse','HEAD').decode().strip()==S and not g('status','--porcelain')
    assert g('branch','--show-current').decode().strip()=='codex/production-launch-20261102'
    assert g('show','-s','--format=%P',S).decode().split()==[B,H]
    assert g('show','-s','--format=%T',S).decode().strip()==T==g('show','-s','--format=%T',H).decode().strip()
    m=read(D/'final-merged-source.json');review=read(D/'reviewed-final-head.json')
    assert m['pr']==108 and m['source']==S and m['prHead']==H and m['tree']==T and m['parents']==[B,H]
    assert m['normalMerge'] is True and m['sourcePrivacyReviewed'] is True
    assert review['source']==H and review['tree']==T and review['sourceReviewed'] is True and review['all13ChangedFilesPrivacyReviewed'] is True
    assert sorted(g('diff','--name-only',B,S).decode().splitlines())==sorted(b['allowedFiles'])
    for row in b['files']:assert sha(g('show',S+':'+row['path']))==row['sha256']
    for path in ['packages','.github','Dockerfile.api','Dockerfile.web','pnpm-lock.yaml','pnpm-workspace.yaml','package.json']:
        assert not g('diff','--name-only',B,S,'--',path),path
    assert sorted(g('diff','--name-only',B,S,'--','scripts').decode().splitlines())==['scripts/private-beta-service-window.mjs','scripts/private-beta-service-window.test.mjs']
    manifests={'package.json','pnpm-lock.yaml','pnpm-workspace.yaml','package-lock.json','npm-shrinkwrap.json','yarn.lock','.npmrc','.pnpmfile.cjs'}
    paths=sorted({p for c in [B,S] for p in g('ls-tree','-r','--name-only',c).decode().splitlines() if PurePosixPath(p).name in manifests})
    for path in paths:assert g('show',B+':'+path)==g('show',S+':'+path)
    assert sum(p.endswith('/migration.sql') for p in g('ls-tree','-r','--name-only',S,'--','packages/db/prisma/migrations').decode().splitlines())==110
    assert 'continue-on-error' not in g('show',S+':.github/workflows/ci.yml').decode().split('  maintained-native-proof:')[0]
    ci=ci_gate('build-ci-tree-acceptance.json','pr108-full-ci.log',H)
    if main:ci_gate('main-ci-acceptance.json','main-ci-original.log',S,True)
    parent_gate();return m,ci,paths
def preparation_gate():
    a=read(D/'production-launch-preflight-acceptance.json');p=read(D/'production-launch-source-preflight.json')
    assert a['accepted'] is True and a['source']==S and a['preflightSha256']==file_sha(D/'production-launch-source-preflight.json')
    assert p['source']==S and p['tree']==T and p['cloudMutation'] is False and p['releaseRootAbsent'] is True
    assert p['helperManifestSha256']==file_sha(HERE/'helpers-manifest.json')
    from datetime import datetime,timezone
    assert 0<=(datetime.now(timezone.utc)-datetime.fromisoformat(p['at'].replace('Z','+00:00'))).total_seconds()<1800

def unpack(path):
    data, meta = {}, {}
    expanded = 0
    with tarfile.open(path) as t:
        for m in t:
            p = PurePosixPath(m.name)
            assert m.isfile() and not p.is_absolute() and '..' not in p.parts and '\\' not in m.name
            assert m.name not in data and len(data) < 1200 and 0 <= m.size <= 268435456
            expanded += m.size
            assert expanded < 268435456
            data[m.name] = t.extractfile(m).read()
            assert len(data[m.name]) == m.size
            meta[m.name] = m
    return data, meta

def prepared_gate(main=False):
    m, ci, _ = source_gate(main)
    p = read(O / 'prepared.json')
    assert p['commit'] == m['source'] and p['tree'] == T and p['prHead'] == H and p['prNumber'] == 108
    assert p['apiSource'] == m['source'] and p['baselineApiSource'] == AB and str(p['ciRun']) == str(ci['run'])
    assert p['authorizedBuildKinds'] == ['api','web'] and p['migrationCount'] == 110 and p['newMigrationCount'] == 0
    assert p['mainCiRequiredBeforeRollout'] is True and p['zeroSqlChanges'] is True
    for n,k in [('source.zip','sourceArchiveSha256'),('runtime-context.tar.gz','compressedSha256'),('transport-inventory.json','indexSha256'),('source-root-review.json','sourceRootReviewSha256')]:
        assert sha((O / n).read_bytes()) == p[k]
    review = read(O / 'input-review.json')
    assert review['allInputsReviewed'] is True and review['source'] == p['commit']
    assert review['onlySixBindingDeltas'] is True and review['all717RetainedMembersExact'] is True
    for kind in ['api','web']:
        assert review['requestHashes'][kind] == sha((O/(kind+'-request.json')).read_bytes())
    for row in review['operatorHashes']:
        assert sha(Path(row['path']).read_bytes()) == row['sha256']
    return p

if __name__ == '__main__':
    assert sys.argv[1:] in [['source'],['prepared'],['main']]
    if sys.argv[1] == 'source':
        m,ci,_ = source_gate(); result = {'source':m['source'],'tree':T,'ciRun':ci['run']}
    else:
        result = prepared_gate(main=sys.argv[1] == 'main')
    print(json.dumps(result))


def expected_previous():
    return {'api':{'commit':AB,'digest':API,'revision':71,'recovery':'enabled'},'web':{'commit':B,'digest':WEB,'revision':79}}

def request_template(kind,p,token):
    assert kind in ['api','web']
    origin = AP if kind == 'api' else P
    previous = read(origin/'prepared.json')
    request = read(origin/(kind+'-request.json'))
    request['idempotencyToken'] = token
    request['sourceLocationOverride'] = p['bucket']+'/'+p['prefix']+'/source.zip'
    for before,after in [(previous['prefix'],p['prefix']),(previous['compressedSha256'],p['compressedSha256']),(previous['indexSha256'],p['indexSha256'])]:
        assert before in request['buildspecOverride']
        request['buildspecOverride'] = request['buildspecOverride'].replace(before,after)
    values = {'VAETTIR_RELEASE_COMMIT':p['commit']}
    if kind == 'web': values.update(VAETTIR_PREVIOUS_WEB_COMMIT=B,VAETTIR_PREVIOUS_WEB_IMAGE='051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@'+WEB)
    for name,value in values.items():
        variables = [v for v in request['environmentVariablesOverride'] if v['name'] == name]
        assert len(variables) == 1
        variables[0]['value'] = value
    assert request['autoRetryLimitOverride'] == 0 and request['projectName'] == 'vaettir-'+kind+'-build'
    assert 'total>268435456' in request['buildspecOverride'] and 'rows.length>1200' in request['buildspecOverride']
    return request
