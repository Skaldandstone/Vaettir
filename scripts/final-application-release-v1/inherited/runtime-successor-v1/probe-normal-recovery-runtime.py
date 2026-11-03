from pathlib import Path
import json,subprocess,time,hashlib,datetime,re
from isolated_image_fixture import assert_owned_image_fixture,POSTGRES,NETWORK,OWNER,configure,inspect
from runtime_contracts import runtime_gate,read,sha,O,RUNTIME_HERE
from image_admission import admitted_image,Docker
admission=admitted_image();client=Docker(admission);configure(client)
p,c=runtime_gate();D=O;source=p['commit'];image='051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-api@'+c['digest']
A=Path('C:/Users/James/.codex/worktrees/vaettir-pr-integration/Vaettir/.local/compliance-release-20261030')
upgrade=read(A/'actual-image-upgrade110-acceptance.json');dump=(A/'synthetic110-after-upgrade.dump').read_bytes();assert sha(dump)==upgrade['proofs']['synthetic110-after-upgrade.dump']
assert read(O/'image-isolated-fixture.json')['source']==source
assert not (O/'actual-normal-recovery-runtime-acceptance.json').exists()

def docker(*a):return client.output(*a)
def sql(s,database='postgres'):
 assert_owned_image_fixture()
 return docker('exec',POSTGRES,'psql','-X','-U','oauth_test','-d',database,'-At','-v','ON_ERROR_STOP=1','-c',s).decode().strip()
def create_database(db):
 assert sql("SELECT count(*) FROM pg_database WHERE datname='"+db+"'")=='0';sql('CREATE DATABASE '+db)
 r=client.run('exec','-i',POSTGRES,'pg_restore','-U','oauth_test','-d',db,'--no-owner','--no-privileges',input=dump,capture_output=True,timeout=120);(D/(db+'-restore.log')).open('xb').write(r.stdout+r.stderr);assert r.returncode==0
 assert sql('SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',db)=='110'
def options(db,mode):
 variables=['DATABASE_URL=postgresql://oauth_test:synthetic-local-only@'+POSTGRES+':5432/'+db+'?connection_limit=5','DB_SECRET_ID=','SENTRY_DSN=','CLERK_SECRET_KEY=','WEB_APP_URL=https://app.vaettir.app','API_PORT=8000','NODE_ENV=production','VAETTIR_RELEASE_COMMIT='+source,'VAETTIR_IMAGE_DIGEST='+c['digest'],'ATLASSIAN_OAUTH_CLIENT_ID=','ATLASSIAN_OAUTH_CLIENT_SECRET=','VAETTIR_COMPLIANCE_RECOVERY_MODE='+mode]
 args=['--label','vaettir.fixture='+OWNER,'--network',NETWORK,'--cpus','0.25','--memory','512m']
 for v in variables:args+=['--env',v]
 return args
def prestart(name,db,mode,script=None):
 assert_owned_image_fixture();meta=inspect('container',name);net=inspect('network',NETWORK)
 assert net['Internal'] is True and net['Labels']['vaettir.fixture']==OWNER
 assert meta['State']['Status']=='created' and not meta['State']['Running']
 assert meta['Image']==admission['observedLocalImageId'] and meta['Config']['Image']==image
 assert meta['Config']['Labels']['vaettir.fixture']==OWNER
 assert meta['HostConfig']['NetworkMode']==NETWORK and set(meta['NetworkSettings']['Networks'])=={NETWORK}
 assert not meta['HostConfig']['PortBindings'] and not any(meta['NetworkSettings']['Ports'].values()) and not meta['Mounts']
 assert not meta['HostConfig']['Privileged'] and not meta['HostConfig'].get('CapAdd') and meta['HostConfig'].get('PidMode','')!='host' and meta['HostConfig'].get('IpcMode','')!='host'
 assert meta['HostConfig']['NanoCpus']==250000000 and meta['HostConfig']['Memory']==536870912
 assert 'VAETTIR_COMPLIANCE_RECOVERY_MODE='+mode in meta['Config']['Env']
 assert 'DATABASE_URL=postgresql://oauth_test:synthetic-local-only@'+POSTGRES+':5432/'+db+'?connection_limit=5' in meta['Config']['Env']
 if script is not None:
  assert meta['Config']['Entrypoint']==['node'] and meta['Config']['Cmd']==['--input-type=module','-'] and meta['Config']['OpenStdin'] is True
 (O/(name+'-prestart.json')).open('x').write(json.dumps({'container':meta,'network':net,'daemonId':admission['daemonId'],'scriptSha256':sha(script) if script is not None else None},indent=2)+'\n')
 return meta

def probe(name,db,mode,filename,marker=None,tests=None):
 assert_owned_image_fixture();code=(RUNTIME_HERE/filename).read_bytes()
 retained=O/(name+'-executed.mjs');retained.open('xb').write(code)
 docker('create','--pull=never','-i','--name',name,*options(db,mode),'--workdir','/app/apps/api','--entrypoint','node',image,'--input-type=module','-')
 prestart(name,db,mode,code);assert retained.read_bytes()==code
 try:r=client.run('start','--attach','--interactive',name,input=code,capture_output=True,timeout=900)
 except subprocess.TimeoutExpired as error:
  (D/(name+'-original.log')).open('xb').write((error.stdout or b'')+(error.stderr or b''))
  (D/(name+'-timeout.json')).open('x').write(json.dumps({'noAutomaticRetry':True,'mayStillBeRunning':True})+'\n');raise
 log=r.stdout+r.stderr;(D/(name+'-original.log')).open('xb').write(log);assert r.returncode==0,'Actual compiled probe failed: retain evidence; never blind-retry'
 meta=inspect('container',name)
 assert meta['State']['ExitCode']==0 and not meta['State']['OOMKilled']
 if tests is not None:
  assert re.search(rb'# tests '+str(tests).encode()+rb'\b',log) and re.search(rb'# pass '+str(tests).encode()+rb'\b',log) and b'# fail 0' in log and b'# skipped 0' in log
  return {'tests':tests,'passed':tests,'failed':0,'skipped':0,'actualCompiledModules':True,'logSha256':hashlib.sha256(log).hexdigest(),'probeSha256':hashlib.sha256(code).hexdigest()}
 meta=json.loads(docker('inspect',name))[0];assert meta['Config']['Image']==image and meta['HostConfig']['NetworkMode']==NETWORK and set(meta['NetworkSettings']['Networks'])=={NETWORK} and not meta['HostConfig']['PortBindings'] and not meta['Mounts']
 rows=[line[len(marker):] for line in r.stdout.splitlines() if line.startswith(marker)];assert len(rows)==1;proof=json.loads(rows[0]);assert proof['passed'];return {'proof':proof,'probeSha256':hashlib.sha256(code).hexdigest(),'logSha256':hashlib.sha256(log).hexdigest()}
local_image=json.loads(docker('image','inspect',image))[0]
assert local_image['Id']==admission['observedLocalImageId'] and image in local_image['RepoDigests']
assert local_image['Config']['Labels']['vaettir.application-source-commit']==source and local_image['Config']['Labels']['vaettir.application-source-sha256']==p['sourceArchiveSha256']
isolation=assert_owned_image_fixture();(O/'image-runtime-probe-intent.json').open('x').write(json.dumps({'source':source,'image':image,'once':True})+'\n');testdb='vaettir_case_review110_test';create_database(testdb)
suite=probe('vaettir-review110-compiled-suite-20261102',testdb,'enabled','compiled-compliance-review-suite.mjs',tests=42)
results=[]
for mode in ['normal','disabled','unknown']:
 db='vaettir_case_review110_runtime_'+mode;create_database(db);setting={'normal':'enabled','disabled':'disabled','unknown':'invalid-nonempty-setting'}[mode];prefix='vaettir-review110-'+mode+'-20261102'
 privacy=probe(prefix+'-privacy',db,setting,'compiled-privacy-fixture.mjs',marker=b'VAETTIR_COMPILED_PRIVACY_PROOF ');assert privacy['proof']['externalProviderCalls']==0
 recovery=probe(prefix+'-guard',db,setting,'compiled-recovery-fixture.mjs',marker=b'VAETTIR_COMPILED_RECOVERY_PROOF ') if mode!='normal' else None
 catalogQuery="SELECT json_build_object('frameworks',(SELECT json_agg(to_jsonb(t) ORDER BY id) FROM \"ComplianceFramework\" t),'controls',(SELECT json_agg(to_jsonb(t) ORDER BY id) FROM \"ComplianceControl\" t),'drafts',(SELECT json_agg(to_jsonb(t) ORDER BY id) FROM \"ComplianceReviewDraft\" t))::text"
 catalogBefore=sql(catalogQuery,db)
 assert client.run('inspect',prefix,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode!=0
 docker('create','--pull=never','--name',prefix,*options(db,setting),image);meta=json.loads(docker('inspect',prefix))[0]
 assert meta['Config']['Image']==image and meta['Config']['Labels']['vaettir.application-source-commit']==source and meta['HostConfig']['NanoCpus']==250000000 and meta['HostConfig']['Memory']==536870912
 assert meta['HostConfig']['NetworkMode']==NETWORK and set(meta['NetworkSettings']['Networks'])=={NETWORK} and not meta['HostConfig']['PortBindings'] and not meta['Mounts']
 prestart(prefix,db,setting);docker('start',prefix);health=None
 for _ in range(180):
  meta=json.loads(docker('inspect',prefix))[0]
  if not meta['State']['Running']:break
  r=client.run('exec',prefix,'node','-e',"fetch('http://127.0.0.1:8000/health/detailed').then(async r=>{if(!r.ok)process.exit(1);process.stdout.write(await r.text())}).catch(()=>process.exit(1))",capture_output=True,timeout=15)
  if r.returncode==0:
   candidate=json.loads(r.stdout)
   if candidate['healthy']:health=candidate;break
  time.sleep(.5)
 r=client.run('logs',prefix,capture_output=True,timeout=30);log=r.stdout+r.stderr;(D/(prefix+'-startup.log')).open('xb').write(log)
 assert health and health['release']['commit']==source and health['release']['imageDigest']==c['digest'] and health['release']['verifiable'] and health['db']['ok']
 assert sorted(x['name'] for x in health['pollers'])==sorted(['aiCreditGrantScheduler','caseAnalysisQueueWorker','readinessChangeScheduler','readinessDigestScheduler','reverseEngineerWorker','reportScheduleWorker','atlassianPrivacyWorker']) and all(not x['stale'] for x in health['pollers'])
 assert b'110 migrations found' in log and b'No pending migrations to apply' in log and not meta['State']['OOMKilled'] and meta['RestartCount']==0
 assert sql(catalogQuery,db)==catalogBefore,'Server startup or workers changed catalogs/drafts unexpectedly'
 results.append({'configuration':setting,'container':prefix,'database':db,'sameImmutableImage':image,'privacy':privacy,'recovery':recovery,'health':health,'nanoCpus':250000000,'memoryBytes':536870912,'noOomOrRestart':True,'noPublishedPortsOrMounts':True,'startupAndWorkersPreservedCatalogsAndDrafts':True,'catalogSnapshotSha256':hashlib.sha256(catalogBefore.encode()).hexdigest(),'startupSha256':hashlib.sha256(log).hexdigest()})
v={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':source,'actualImage':image,'schema':110,'compiled42Tests':suite,'normalDisabledAndUnknownConfigurations':results,'sameDigestAllConfigurations':True,'sevenWorkersAllConfigurations':True,'privacyGuardsAllConfigurations':True,'explicitDisabledAll25AndRiskGuard':True,'isolationBefore':isolation,'isolationAfter':assert_owned_image_fixture(),'productionCpuAndMemoryMatched':True,'customerDataOrCredentialsUsed':False,'externalProviderCalls':0,'fixturesRetained':True}
v['imageAdmissionSha256']=admission['proofs'][0]['sha256']
v['dockerHost']=admission['dockerHost'];v['daemonId']=admission['daemonId']
v['proofs']=admission['proofs']+[{'path':str(q),'sha256':sha(q.read_bytes())} for q in sorted(q for q in O.glob('*review110*') if q.is_file() and q.suffix in ('.log','.json','.mjs'))]+[{'path':str(q),'sha256':sha(q.read_bytes())} for q in sorted(RUNTIME_HERE.iterdir()) if q.is_file()]+[{'path':str(O/'image-isolated-fixture.json'),'sha256':sha((O/'image-isolated-fixture.json').read_bytes())}]
(D/'actual-normal-recovery-runtime-acceptance.json').open('x').write(json.dumps(v,indent=2)+'\n');print(json.dumps({'actualImageBothConfigurationsPassed':True,'compiledComplianceTests':42,'sevenWorkers':7,'privacyAllModes':True,'all25RecoveryRoutesAndRiskRefused':True,'customerDataUsed':False}))
