from pathlib import Path
import subprocess,json,hashlib,datetime,time
from isolated_image_fixture import NETWORK,POSTGRES,VOLUME,OWNER,POSTGRES_IMAGE,assert_owned_image_fixture,configure
from runtime_contracts import runtime_gate,read,sha,O,AP,RUNTIME_HERE
from image_admission import admitted_image,Docker
admission=admitted_image();client=Docker(admission);configure(client)
p,c=runtime_gate();D=O;A=Path('C:/Users/James/.codex/worktrees/vaettir-pr-integration/Vaettir/.local/compliance-release-20261030');db='vaettir_case_review110_seed'
prepared=read(A/'actual-image-upgrade110-acceptance.json');dump=(A/'synthetic110-after-upgrade.dump').read_bytes()
assert prepared['actualOwnImageMigrations109to110'] is True
assert sha(dump)==prepared['proofs']['synthetic110-after-upgrade.dump']
assert not (O/'image-isolated-fixture.json').exists()

def docker(*a):return client.output(*a)
for kind,name in [('network',NETWORK),('volume',VOLUME),('container',POSTGRES)]:
 args=[kind,'inspect',name] if kind!='container' else ['inspect',name]
 assert client.run(*args,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0,'Preserve existing resource; inspect before retry'
(O/'image-fixture-create-intent.json').open('x').write(json.dumps({'source':p['commit'],'network':NETWORK,'postgres':POSTGRES,'volume':VOLUME,'once':True})+'\n')
docker('network','create','--internal','--label','vaettir.fixture='+OWNER,NETWORK)
docker('volume','create','--label','vaettir.fixture='+OWNER,VOLUME)
docker('create','--pull=never','--name',POSTGRES,'--label','vaettir.fixture='+OWNER,'--network',NETWORK,'--cpus','0.5','--memory','512m','--mount','type=volume,source='+VOLUME+',target=/var/lib/postgresql/data','--env','POSTGRES_USER=oauth_test','--env','POSTGRES_PASSWORD=synthetic-local-only','--env','POSTGRES_DB='+db,POSTGRES_IMAGE)
before=assert_owned_image_fixture(prestart=True)
(O/'postgres-prestart-inspection.json').open('x').write(json.dumps(before,indent=2)+'\n')
docker('start',POSTGRES)
for _ in range(120):
 r=client.run('exec',POSTGRES,'pg_isready','-U','oauth_test','-d',db,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,timeout=10)
 if r.returncode==0:break
 time.sleep(.5)
else:raise RuntimeError('Owned isolated PostgreSQL startup failed')
isolation=assert_owned_image_fixture()
r=client.run('exec','-i',POSTGRES,'pg_restore','-U','oauth_test','-d',db,'--no-owner','--no-privileges',input=dump,capture_output=True,timeout=90);(D/'isolated110-restore-original.log').open('xb').write(r.stdout+r.stderr);assert r.returncode==0
ledger=docker('exec',POSTGRES,'psql','-X','-U','oauth_test','-d',db,'-At','-c','SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').decode().strip();assert ledger=='110'
v={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'owner':'codex 01a146b4','purpose':'Actual immutable image schema110 runtime tests; synthetic only','source':p['commit'],'database':db,'migrations':110,'sourceSynthetic110DumpSha256':hashlib.sha256(dump).hexdigest(),'isolation':isolation,'daemonId':admission['daemonId'],'dockerHost':admission['dockerHost'],'imageAdmissionProofs':admission['proofs'],'originalFixtureAndHostBridgeUntouched':True,'customerDataOrCredentialsUsed':False,'retirement':'Retain named owned network/container/data volume and private dump evidence; no automatic deletion'}
(D/'image-isolated-fixture.json').open('x').write(json.dumps(v,indent=2)+'\n');print(json.dumps({'isolatedFixtureReady':True,'migrations':110,'internalOnly':True,'publishedPorts':False,'hostBindMounts':False,'originalFixtureUntouched':True}))
