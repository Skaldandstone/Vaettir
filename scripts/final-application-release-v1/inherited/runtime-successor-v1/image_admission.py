"""Full proof-tree admission; explicit Docker daemon, never ambient context."""
from pathlib import Path
import os,sys,json,hashlib,subprocess
from runtime_contracts import runtime_gate,read,O
HOST='npipe:////./pipe/dockerDesktopLinuxEngine'
ENV=dict(os.environ)
for key in ('DOCKER_CONTEXT','DOCKER_HOST','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'): ENV.pop(key,None)
PREFIX=['docker','--host',HOST]
def file_sha(path):
 h=hashlib.sha256()
 with Path(path).open('rb') as f:
  while block:=f.read(1024*1024):h.update(block)
 return h.hexdigest()
def proof_rows(rows):
 assert isinstance(rows,list) and rows
 result={}
 for row in rows:
  path=Path(row['path']);assert path.is_absolute() and path.is_file() and not path.is_symlink()
  key=str(path.resolve());assert key not in result,'Duplicate proof path'
  assert file_sha(path)==row['sha256'],key
  result[key]=row['sha256']
 return result
def admitted_image(kind='api',live=True):
 assert kind in ('api','web')
 p,_=runtime_gate();c=read(O/(kind+'-candidate-custody.json'))
 a_path=O/('candidate-'+kind+'-image-available.json');a=read(a_path)
 image='051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-'+kind+'@'+c['digest']
 assert a['source']==c['sourceCommit']==p['commit'] and a['kind']==kind and a['image']==image
 assert a['digest']==c['digest'] and a['configDigest']==c['configDigest']
 assert a['dockerHost']==HOST and isinstance(a['daemonId'],str) and a['daemonId']
 assert a['completeLocalContentVerified'] is True and a['localIdKind'] in ('manifest','config')
 assert a['observedLocalImageId']==c['digest' if a['localIdKind']=='manifest' else 'configDigest']
 rows=proof_rows(a['proofs'])
 def ref(row):
  path=Path(row['path']);assert rows[str(path.resolve())]==row['sha256'];return read(path)
 sm=ref(a['materializationSourceManifest']);approval=ref(a['materializationSourceApproval'])
 assert approval['accepted'] is True and approval['source']==p['commit'] and approval['sourceManifestSha256']==a['materializationSourceManifest']['sha256']
 for entry in sm['files']:
  q=Path(a['materializationSourceManifest']['path']).parent/entry['name'];assert q.resolve().parent==Path(a['materializationSourceManifest']['path']).resolve().parent
  assert rows[str(q.resolve())]==entry['sha256']
 v=ref(a['localContentReceipt']);recorded=ref(a['inspect']);assert len(recorded)==1;recorded=recorded[0]
 assert v['kind']=='export' and v['source']==p['commit'] and v['manifestDigest']==c['digest'] and v['configDigest']==c['configDigest']
 for key in ('allReferencedBlobsPresent','allDescriptorHashesAndSizesExact','exactOriginalManifestAndConfigBytes','allOrderedDiffIdsExact'):assert v[key] is True
 evidence=v['sameDaemonExportEvidence']
 for key in ('dockerHost','daemonId','observedLocalImageId','localIdKind'):assert evidence[key]==a[key]
 assert rows[str(Path(v['archive']).resolve())]==v['archiveSha256']
 assert rows[str(Path(evidence['path']).resolve())]==evidence['sha256']
 assert rows[str(Path(evidence['inspectPath']).resolve())]==evidence['inspectSha256']==a['inspect']['sha256']
 capture=read(Path(evidence['path']))
 assert capture['source']==p['commit'] and capture['image']==image and capture['daemonId']==a['daemonId'] and capture['dockerHost']==HOST
 assert capture['saveExitCode']==0 and capture['platform']=='linux/amd64'
 assert Path(capture['archive']).resolve()==Path(v['archive']).resolve() and capture['archiveSha256']==v['archiveSha256']
 manifest=read(O/(kind+'-original-manifest.json'));config=read(O/(kind+'-image-audit-v1/original-config.json'))
 assert 'sha256:'+file_sha(O/(kind+'-original-manifest.json'))==c['digest']
 assert 'sha256:'+file_sha(O/(kind+'-image-audit-v1/original-config.json'))==c['configDigest']
 assert len(v['orderedLayers'])==len(manifest['layers'])==len(config['rootfs']['diff_ids'])=={'api':98,'web':56}[kind]
 for i,(row,desc,diff) in enumerate(zip(v['orderedLayers'],manifest['layers'],config['rootfs']['diff_ids'])):
  assert row['index']==i and row['digest']==desc['digest'] and row['bytes']==desc['size'] and row['diffId']==diff
 assert recorded['Id']==a['observedLocalImageId'] and image in recorded['RepoDigests']
 assert recorded['Os']=='linux' and recorded['Architecture']=='amd64'
 assert recorded['RootFS']['Type']=='layers' and recorded['RootFS']['Layers']==config['rootfs']['diff_ids']
 if a['localIdKind']=='manifest':assert recorded['Descriptor']['digest']==c['digest']
 if live:
  assert json.loads(subprocess.check_output([*PREFIX,'info','--format','{{json .ID}}'],env=ENV,timeout=30))==a['daemonId']
  current=json.loads(subprocess.check_output([*PREFIX,'image','inspect',image],env=ENV,timeout=30));assert len(current)==1
  for key in ('Id','Descriptor','RepoDigests','Os','Architecture','RootFS','Config'):assert current[0].get(key)==recorded.get(key),key
 a['observedInspect']=recorded
 a['proofs']=[{'path':str(a_path),'sha256':file_sha(a_path)},*a['proofs']]
 return a
class Docker:
 def __init__(self,admission):self.admission=admission
 def run(self,*args,**kwargs):
  assert json.loads(subprocess.check_output([*PREFIX,'info','--format','{{json .ID}}'],env=ENV,timeout=30))==self.admission['daemonId']
  current=json.loads(subprocess.check_output([*PREFIX,'image','inspect',self.admission['image']],env=ENV,timeout=30))[0]
  for key in ('Id','Descriptor','RepoDigests','Os','Architecture','RootFS','Config'):assert current.get(key)==self.admission['observedInspect'].get(key),key
  return subprocess.run([*PREFIX,*args],env=ENV,**kwargs)
 def output(self,*args,timeout=90):
  r=self.run(*args,capture_output=True,timeout=timeout);r.check_returncode();return r.stdout
if __name__=='__main__':
 assert len(sys.argv)==3 and sys.argv[2]=='--offline'
 a=admitted_image(sys.argv[1],live=False);print(json.dumps({'source':a['source'],'kind':a['kind'],'proofs':a['proofs']}))
