"""Run the reviewed controller against the immutable Web image on an owned internal network."""
from pathlib import Path
import datetime, hashlib, json, os, subprocess, sys

R = Path.cwd()
D = R / '.local/production-launch-20261102'
O = R / '.local/releases/production-launch-20261102-v1'
H = Path('C:/Users/James/.codex/worktrees/vaettir-enterprise-identity/Vaettir/.local/production-launch-20261102/successor-helpers-v1')
assert hashlib.sha256((H/'helpers-manifest.json').read_bytes()).hexdigest() == json.loads((D/'paired-successor-operator-source-acceptance.json').read_bytes())['manifestSha256']
sys.path.insert(0, str(H))
from contracts import prepared_gate

approval = json.loads((D/'web-fixture-operator-source-acceptance.json').read_bytes())
assert approval['accepted'] is True and approval['operatorSha256'] == hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
p = prepared_gate()
source = 'bbd66d00a968363b5e8e44dbb33172fce61dd454'
assert p['commit'] == source
read = lambda f: json.loads(f.read_bytes())
sha = lambda b: hashlib.sha256(b).hexdigest()
runtime = Path('C:/Users/James/.codex/worktrees/vaettir-enterprise-identity/Vaettir/.local/production-launch-20261102/runtime-successor-v1')
runtime_pin = read(D/'paired-runtime-operator-source-acceptance.json')['manifestSha256']
assert sha((runtime/'runtime-manifest.json').read_bytes()) == runtime_pin
runtime_review = read(D/'paired-runtime-operator-source-acceptance.json')
assert runtime_review['accepted'] is True and runtime_review['manifestSha256'] == runtime_pin
shared = json.loads(subprocess.check_output([sys.executable,str(runtime/'image_admission.py'),'web','--offline'],timeout=600))
assert shared['source'] == source and shared['kind'] == 'web'
c = read(O/'web-candidate-custody.json')
assert c['sourceCommit'] == source and c['status'] == 'SUCCEEDED'
controller = (O/'candidate-web-controller.executed.mjs').read_bytes()
derivation = O/'image-auditor-derivations.json'
approval = read(D/'paired-successor-generated-auditors-acceptance.json')
assert approval['accepted'] and approval['source'] == source and approval['derivationSha256'] == sha(derivation.read_bytes())
for row in read(derivation)['rows']:
    assert sha((O/row['name']).read_bytes()) == row['candidateSha256']
assert b'assert.equal(rows.length,23)' in controller
name = 'vaettir-ui-' + source[:8] + '-fixture'
net = name + '-network'
label = 'vaettir.fixture=ui-' + source[:8]
image = '051722405355.dkr.ecr.us-east-2.amazonaws.com/vaettir-web@' + c['digest']
available_path = O/'candidate-web-image-available.json'
available = read(available_path)
assert available['source'] == source and available['kind'] == 'web' and available['image'] == image
assert available['digest'] == c['digest'] and available['configDigest'] == c['configDigest']
assert available['completeLocalContentVerified'] is True
assert available['dockerHost'] == 'npipe:////./pipe/dockerDesktopLinuxEngine'
assert len(available['proofs']) >= 4
proof_paths = {}
for proof in available['proofs']:
    path=Path(proof['path']); h=hashlib.sha256()
    assert path.resolve() not in proof_paths
    with path.open('rb') as f:
        while block:=f.read(1024*1024): h.update(block)
    assert h.hexdigest() == proof['sha256'], path
    proof_paths[path.resolve()] = proof['sha256']
local_path = Path(available['localContentReceipt']['path'])
local_hash = sha(local_path.read_bytes())
assert local_hash == available['localContentReceipt']['sha256']
local = read(local_path)
assert proof_paths[local_path.resolve()] == local_hash
assert proof_paths[Path(local['archive']).resolve()] == local['archiveSha256']
assert local['kind'] == 'export' and local['source'] == source and local['manifestDigest'] == c['digest'] and local['configDigest'] == c['configDigest']
for key in ['allReferencedBlobsPresent','allDescriptorHashesAndSizesExact','exactOriginalManifestAndConfigBytes','allOrderedDiffIdsExact']: assert local[key] is True
assert len(local['orderedLayers']) == c['layers']
local_id = available['observedLocalImageId']
assert local_id in [c['digest'],c['configDigest']]
assert available['localIdKind'] == ('manifest' if local_id==c['digest'] else 'config')
assert local['sameDaemonExportEvidence']['observedLocalImageId'] == local_id
assert local['sameDaemonExportEvidence']['daemonId'] == available['daemonId']
assert local['sameDaemonExportEvidence']['dockerHost'] == available['dockerHost']
assert local['sameDaemonExportEvidence']['localIdKind'] == available['localIdKind']
assert available['inspect']['path'] == local['sameDaemonExportEvidence']['inspectPath']
assert sha(Path(available['inspect']['path']).read_bytes()) == available['inspect']['sha256'] == local['sameDaemonExportEvidence']['inspectSha256']
assert proof_paths[Path(available['inspect']['path']).resolve()] == available['inspect']['sha256']
export_evidence = local['sameDaemonExportEvidence']
capture_path = Path(export_evidence['path'])
assert proof_paths[capture_path.resolve()] == export_evidence['sha256'] == sha(capture_path.read_bytes())
capture = read(capture_path)
assert capture['source'] == source and capture['image'] == image
assert capture['dockerHost'] == available['dockerHost'] and capture['daemonId'] == available['daemonId']
assert capture['saveExitCode'] == 0 and capture['platform'] == 'linux/amd64'
assert Path(capture['archive']).resolve() == Path(local['archive']).resolve()
assert capture['archiveSha256'] == local['archiveSha256']
assert capture['inspectPath'] == available['inspect']['path'] and capture['inspectSha256'] == available['inspect']['sha256']

docker_command = ['docker','--host','npipe:////./pipe/dockerDesktopLinuxEngine']
env = dict(os.environ)
env.pop('DOCKER_CONTEXT',None)
env.pop('DOCKER_HOST',None)
env.pop('DOCKER_TLS_VERIFY',None)
env.pop('DOCKER_CERT_PATH',None)

def docker(*args):
    return subprocess.check_output([*docker_command, *args], timeout=180, env=env)

def admit_network():
    n = json.loads(docker('network','inspect',net))[0]
    assert n['Name'] == net and n['Internal'] and n['Driver'] == 'bridge'
    assert n['Labels'].get('vaettir.fixture') == 'ui-'+source[:8]
    return n

def admit_container(container):
    v = json.loads(docker('inspect',container))[0]
    assert v['Config']['Image'] == image and v['Image'] == local_id
    assert v['Config']['Labels'].get('vaettir.fixture') == 'ui-'+source[:8]
    assert not v['HostConfig']['PortBindings'] and not v['Mounts']
    assert not v['HostConfig']['Privileged'] and not v['HostConfig'].get('CapAdd')
    assert v['HostConfig'].get('PidMode','') != 'host' and v['HostConfig'].get('IpcMode','') != 'host'
    assert v['HostConfig']['NetworkMode'] == net
    assert list(v['NetworkSettings']['Networks']) == [net]
    admit_network()
    return v

current = json.loads(docker('image','inspect',image))[0]
recorded = read(Path(local['sameDaemonExportEvidence']['inspectPath']))[0]
for field in ['Id','Descriptor','RepoDigests','Os','Architecture','RootFS']:
    assert current[field] == recorded[field]
assert json.loads(docker('info','--format','{{json .ID}}')) == local['sameDaemonExportEvidence']['daemonId']
assert subprocess.run([*docker_command,'inspect',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env).returncode != 0
assert subprocess.run([*docker_command,'network','inspect',net],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env).returncode != 0
assert subprocess.run([*docker_command,'inspect',name+'-controller'],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env).returncode != 0
(O/'candidate-web-fixture.executed.py').open('xb').write(Path(__file__).read_bytes())
(O/'candidate-web-fixture-source-acceptance.json').open('xb').write((D/'web-fixture-operator-source-acceptance.json').read_bytes())
(O/'web-fixture-create-intent.json').open('xb').write((json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':source,'image':image,'network':net,'once':True,'imageAdmissionSha256':sha(available_path.read_bytes()),'localContentReceiptSha256':local_hash,'operatorSha256':sha(Path(__file__).read_bytes())})+'\n').encode())
docker('network','create','--internal','--label',label,net)
admit_network()
args = ['create','--pull=never','--name',name,'--label',label,'--network',net,'--cpus','0.25','--memory','512m']
for v in ['NODE_ENV=production','PORT=3000','HOSTNAME=0.0.0.0','NEXT_TELEMETRY_DISABLED=1','NODE_OPTIONS=--dns-result-order=ipv4first','CLERK_SECRET_KEY=sk_test_synthetic_offline_diagnostic_not_a_credential','VAETTIR_DOMAIN_INGRESS_SECRET='+'synthetic-isolated-ingress-fixture-'*3]:
    args += ['--env',v]
docker(*args,image)
created = admit_container(name)
assert created['State']['Status'] == 'created' and not created['State']['Running']
assert created['Config']['Entrypoint'] == current['Config']['Entrypoint'] and created['Config']['Cmd'] == current['Config']['Cmd']
assert created['HostConfig']['Memory'] == 536870912 and created['HostConfig']['NanoCpus'] == 250000000
docker('start',name)
admit_container(name)
docker('create','--pull=never','-i','--name',name+'-controller','--label',label,'--network',net,'--cpus','1','--memory','512m','--entrypoint','node',image,'--input-type=module','-')
controller_meta = admit_container(name+'-controller')
assert controller_meta['State']['Status'] == 'created' and not controller_meta['State']['Running']
assert controller_meta['Config']['Entrypoint'] == ['node'] and controller_meta['Config']['Cmd'] == ['--input-type=module','-']
assert controller_meta['Config']['OpenStdin'] is True
assert controller_meta['HostConfig']['NanoCpus']==1000000000 and controller_meta['HostConfig']['Memory']==536870912
try:
    run = subprocess.run([*docker_command,'start','--attach','--interactive',name+'-controller'],input=controller,capture_output=True,timeout=180,env=env)
except subprocess.TimeoutExpired as error:
    (O/'candidate-web-controller-original.log').open('xb').write((error.stdout or b'')+(error.stderr or b''))
    (O/'candidate-web-controller-timeout.json').open('xb').write((json.dumps({'timeoutSeconds':180,'noAutomaticRetry':True,'controllerMayStillBeRunning':True})+'\n').encode())
    raise
else:
    (O/'candidate-web-controller-original.log').open('xb').write(run.stdout+run.stderr)
finally:
    logs = subprocess.run([*docker_command,'logs',name],capture_output=True,timeout=30,env=env)
    (O/'candidate-web-startup.log').open('xb').write(logs.stdout+logs.stderr)
assert run.returncode == 0, 'Preserve and reconcile the original failure; do not replay the fixture blindly'
marker = b'VAETTIR_DOCKER_PRIMARY_RESULT '
matches = [line[len(marker):] for line in run.stdout.splitlines() if line.startswith(marker)]
assert len(matches) == 1
v = json.loads(matches[0])
assert v['passed'] and v['checks'] == 23 and v['sourceCommit'] == source and v['imageDigest'] == c['digest']
assert not v['productionCredentialsUsed'] and not v['customerWrites']
v.update(at=datetime.datetime.now(datetime.timezone.utc).isoformat(),controllerSha256=sha(controller),originalLogSha256=sha((O/'candidate-web-controller-original.log').read_bytes()),fixturesRetained=True,localContentReceiptSha256=local_hash,localImageAdmissionSha256=sha(available_path.read_bytes()))
(O/'candidate-web-actual-route-acceptance.json').open('xb').write((json.dumps(v,indent=2)+'\n').encode())
network = admit_network()
members = []
for cid in network['Containers']:
    info = admit_container(cid)
    assert info['Config']['Labels'].get('vaettir.fixture') == 'ui-'+source[:8]
    assert not info['Mounts'] and not info['HostConfig']['PortBindings']
    assert list(info['NetworkSettings']['Networks']) == [net]
    members.append({'name':info['Name'].lstrip('/'),'image':info['Config']['Image'],'running':info['State']['Running'],'mounts':info['Mounts'],'hostPorts':info['HostConfig']['PortBindings'] or {},'networks':list(info['NetworkSettings']['Networks'])})
assert any(x['name'] == name and x['running'] and x['image'] == image for x in members)
proof = {'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'onlyInternalNetwork':True,'noPublishedPortsOrHostMounts':True,'allMembersOwned':True,'members':members,'actualExecutedControllerSha256':sha(controller),'routeAcceptanceSha256':sha((O/'candidate-web-actual-route-acceptance.json').read_bytes()),'fixturesRetained':True,'localContentReceiptSha256':local_hash,'localImageAdmissionSha256':sha(available_path.read_bytes())}
(O/'candidate-web-network-inspection.json').open('xb').write((json.dumps(proof,indent=2)+'\n').encode())
print(json.dumps({'actualWebRoutesPassed':True,'checks':23,'source':source,'imageDigest':c['digest'],'internalOwnedNetwork':True,'customerWrites':False}))
