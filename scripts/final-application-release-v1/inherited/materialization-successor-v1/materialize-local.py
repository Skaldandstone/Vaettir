"""Main-only one-shot exact pull/load/re-export; no tag, rebuild or service change."""
from archive_contract import *
import os,subprocess,tempfile,datetime,base64
env=dict(os.environ,AWS_MAX_ATTEMPTS='1',PYTHONDONTWRITEBYTECODE='1',PYTHONUTF8='1',PYTHONIOENCODING='utf-8')
for key in ('DOCKER_CONTEXT','DOCKER_HOST','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH','DOCKER_CONFIG'):env.pop(key,None)
docker=['docker','--host',HOST]
v=model()
assert not OUT.exists(),'Reconcile any prior materialization; never replay'
def save(name,value):
 (OUT/name).open('xb').write(value if isinstance(value,bytes) else dump(value))
def daemon():
 value=json.loads(subprocess.check_output([*docker,'info','--format','{{json .ID}}'],env=env,timeout=30));assert isinstance(value,str) and value;return value
identity=daemon()
def call(args,timeout=300):
 assert daemon()==identity
 r=subprocess.run([*docker,*args],env=env,capture_output=True,timeout=timeout)
 assert daemon()==identity
 return r
def helper(name,*args):subprocess.run([sys.executable,str(HERE/name),KIND,*args],env=env,check=True)
helper('prepare-archive.py')
archive=OUT/(KIND+'-exact-oci.tar')
helper('verify-archive.py','--kind','prepared','--archive',str(archive),'--receipt',str(OUT/'verification.json'))
prepared=read(OUT/'verification.json');assert prepared['source']==SOURCE and prepared['manifestDigest']==MANIFEST and prepared['configDigest']==CONFIG and prepared['allOrderedDiffIdsExact']
assert prepared['archiveSha256']==hash_file(archive)[0].split(':')[1]
save('materialize-intent.json',{'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':KIND,'source':SOURCE,'image':IMAGE,'dockerHost':HOST,'daemonId':identity,'archiveSha256':prepared['archiveSha256'],'once':True})
aws_identity=json.loads(subprocess.check_output(['aws','sts','get-caller-identity','--profile','vaettir-toolkit','--region','us-east-2','--output','json','--no-cli-pager'],env=env,timeout=60))
assert aws_identity['Account']=='051722405355' and ':assumed-role/AccountFullAccessRole/' in aws_identity['Arn']
save('aws-identity.json',aws_identity)
registry='051722405355.dkr.ecr.us-east-2.amazonaws.com'
auth=Path(tempfile.mkdtemp(prefix='vaettir-exact-image-auth-')).resolve()
assert auth.parent==Path(tempfile.gettempdir()).resolve() and auth.name.startswith('vaettir-exact-image-auth-')
auth_env=dict(env,DOCKER_CONFIG=str(auth))
token=None
try:
 token=subprocess.check_output(['aws','ecr','get-login-password','--profile','vaettir-toolkit','--region','us-east-2','--no-cli-pager'],env=env,timeout=60)
 token=token.rstrip(b'\r\n');assert token and b'\n' not in token and b'\r' not in token
 auth_bytes=dump({'auths':{registry:{'auth':base64.b64encode(b'AWS:'+token).decode('ascii')}}})
 descriptor=os.open(str(auth/'config.json'),os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
 with os.fdopen(descriptor,'wb') as credentials:credentials.write(auth_bytes);credentials.flush();os.fsync(credentials.fileno())
 token=None;auth_bytes=None
 assert daemon()==identity
 try:pull=subprocess.run([*docker,'pull','--platform','linux/amd64',IMAGE],env=auth_env,capture_output=True,timeout=600)
 except subprocess.TimeoutExpired as error:
  save('pull-original.log',(error.stdout or b'')+(error.stderr or b''));save('pull-timeout.json',{'noAutomaticRetry':True,'timeoutSeconds':600});raise
 save('pull-original.log',pull.stdout+pull.stderr);save('pull-result.json',{'exitCode':pull.returncode,'daemonUnchanged':daemon()==identity})
 assert pull.returncode==0 and daemon()==identity,'Retain failed pull; no automatic retry'
finally:
 token=None;auth_bytes=None
 credential=auth/'config.json'
 if credential.exists():
  assert credential.resolve().parent==auth and not credential.is_symlink();credential.unlink()
 removed=not credential.exists()
 if not any(auth.iterdir()):auth.rmdir()
 save('temporary-auth-disposal.json',{'temporaryAuthFileRemoved':removed,'credentialEmitted':False})
 assert removed
assert hash_file(archive)[0].split(':')[1]==prepared['archiveSha256']
save('load-intent.json',{'archive':str(archive),'archiveSha256':prepared['archiveSha256'],'dockerHost':HOST,'daemonId':identity,'once':True})
try:loaded=call(['image','load','--input',str(archive)])
except subprocess.TimeoutExpired as error:
 save('load-original.log',(error.stdout or b'')+(error.stderr or b''));save('load-timeout.json',{'noAutomaticRetry':True});raise
save('load-original.log',loaded.stdout+loaded.stderr);save('load-result.json',{'exitCode':loaded.returncode,'daemonUnchanged':daemon()==identity})
assert loaded.returncode==0 and hash_file(archive)[0].split(':')[1]==prepared['archiveSha256'],'Load failed; preserve and reconcile'
result=call(['image','inspect',IMAGE]);result.check_returncode();save('postload-inspect.json',result.stdout)
inspection=json.loads(result.stdout);assert len(inspection)==1
i=inspection[0];assert i['Id'] in (MANIFEST,CONFIG) and IMAGE in i['RepoDigests']
if i['Id']==MANIFEST:assert i['Descriptor']['digest']==MANIFEST
assert i['Os']=='linux' and i['Architecture']=='amd64' and i['RootFS']['Layers']==v['config']['rootfs']['diff_ids']
output=OUT/'postload-amd64-export.tar';assert not output.exists()
save('export-intent.json',{'source':SOURCE,'image':IMAGE,'dockerHost':HOST,'daemonId':identity,'platform':'linux/amd64','output':str(output),'once':True})
try:export=call(['image','save','--platform','linux/amd64','--output',str(output),IMAGE],timeout=600)
except subprocess.TimeoutExpired as error:
 save('export-original.log',(error.stdout or b'')+(error.stderr or b''));save('export-timeout.json',{'noAutomaticRetry':True});raise
save('export-original.log',export.stdout+export.stderr);save('export-result.json',{'exitCode':export.returncode,'daemonUnchanged':daemon()==identity})
assert export.returncode==0,'Retain failed export; no fallback metadata-only admission'
capture={'source':SOURCE,'image':IMAGE,'dockerHost':HOST,'daemonId':identity,'platform':'linux/amd64','saveExitCode':0,'archive':str(output.resolve()),'archiveSha256':hash_file(output)[0].split(':')[1],'inspectPath':str((OUT/'postload-inspect.json').resolve()),'inspectSha256':digest(result.stdout).split(':')[1]}
save('postload-export-capture.json',capture)
helper('verify-archive.py','--kind','export','--archive',str(output),'--receipt',str(OUT/'local-export-verification.json'),'--capture',str(OUT/'postload-export-capture.json'))
verified=read(OUT/'local-export-verification.json');assert verified['sameDaemonExportEvidence']['daemonId']==identity
fresh=call(['image','inspect',IMAGE]);fresh.check_returncode();assert json.loads(fresh.stdout)==inspection
save('final-inspect.json',fresh.stdout)
def ref(path):return {'path':str(path.resolve()),'sha256':hash_file(path,MAX_EXPANDED)[0].split(':')[1]}
files=[q for q in OUT.iterdir() if q.is_file()]
files += [HERE/'source-manifest.json',*[HERE/row['name'] for row in read(HERE/'source-manifest.json')['files']],D/'paired-materialization-source-acceptance.json']
files += [Path(row['path']) for row in read(HERE/'pinned-inputs.json')['files']]
files += [O/'prepared.json',O/(KIND+'-candidate-custody.json'),O/(KIND+'-original-manifest.json'),O/'component-image-review.json',A/'custody-collection.json',A/'original-manifest.json',A/'original-config.json',A/'complete-layers.json',A/'complete-unsuppressed-findings.json']
proofs=[ref(q) for q in dict.fromkeys(q.resolve() for q in files)]
available={'source':SOURCE,'kind':KIND,'image':IMAGE,'digest':MANIFEST,'configDigest':CONFIG,'dockerHost':HOST,'daemonId':identity,'observedLocalImageId':i['Id'],'localIdKind':'manifest' if i['Id']==MANIFEST else 'config','completeLocalContentVerified':True,'localContentReceipt':ref(OUT/'local-export-verification.json'),'inspect':ref(OUT/'postload-inspect.json'),'materializationSourceManifest':ref(HERE/'source-manifest.json'),'materializationSourceApproval':ref(D/'paired-materialization-source-acceptance.json'),'proofs':proofs,'temporaryAuthFileRemoved':True,'containersStarted':False,'productionChanged':False}
(O/('candidate-'+KIND+'-image-available.json')).open('xb').write(dump(available))
print(json.dumps({'kind':KIND,'completeSameDaemonContentVerified':True,'source':SOURCE,'fixtureExecuted':False}))
