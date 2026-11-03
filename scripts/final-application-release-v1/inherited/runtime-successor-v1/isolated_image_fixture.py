# Shared live admission for actual image probes. Never trusts a Docker network name alone.
from pathlib import Path
import subprocess,json
NETWORK='vaettir-review110-images-bbd66d00-20261102-net'
POSTGRES='vaettir-review110-images-bbd66d00-20261102-pg'
VOLUME='vaettir-review110-images-bbd66d00-20261102-data'
OWNER='review110-images-bbd66d00-20261102'
POSTGRES_IMAGE='docker.io/library/postgres@sha256:ca0bd484cb98bf4b24eb1010e73fb3fcbd6714d240fbc1a10eea5b7dbecb641d'
CLIENT=None
def configure(client):
 global CLIENT
 CLIENT=client
def inspect(kind,name):
 assert CLIENT is not None
 return json.loads(CLIENT.output(kind,'inspect',name,timeout=30))[0] if kind!='container' else json.loads(CLIENT.output('inspect',name,timeout=30))[0]
def assert_owned_image_fixture(prestart=False):
 net=inspect('network',NETWORK);pg=inspect('container',POSTGRES);volume=inspect('volume',VOLUME)
 assert net['Name']==NETWORK and net['Internal'] is True and net['Labels'].get('vaettir.fixture')==OWNER
 assert pg['Name']=='/'+POSTGRES and (pg['State']['Status']=='created' if prestart else pg['State']['Running']) and pg['Config']['Image']==POSTGRES_IMAGE and pg['Config']['Labels'].get('vaettir.fixture')==OWNER
 assert pg['HostConfig']['NetworkMode']==NETWORK and set(pg['NetworkSettings']['Networks'])=={NETWORK}
 assert not pg['HostConfig'].get('PortBindings') and all(not value for value in pg['NetworkSettings']['Ports'].values())
 assert not pg['HostConfig']['Privileged'] and not pg['HostConfig'].get('CapAdd') and pg['HostConfig'].get('PidMode','')!='host' and pg['HostConfig'].get('IpcMode','')!='host'
 assert pg['HostConfig']['NanoCpus']==500000000 and pg['HostConfig']['Memory']==536870912
 pg_image=inspect('image',POSTGRES_IMAGE);pg_refs=set(pg_image['RepoDigests'])
 assert pg_refs and pg_refs<={POSTGRES_IMAGE,POSTGRES_IMAGE.removeprefix('docker.io/library/')} and pg['Image']==pg_image['Id']
 assert len(pg['Mounts'])==1
 mount=pg['Mounts'][0];assert mount['Type']=='volume' and mount['Name']==VOLUME and mount['Destination']=='/var/lib/postgresql/data'
 assert volume['Name']==VOLUME and volume['Driver']=='local' and not volume.get('Options') and volume['Labels'].get('vaettir.fixture')==OWNER
 for entry in net.get('Containers',{}).values():
  member=inspect('container',entry['Name']);assert member['Config']['Labels'].get('vaettir.fixture')==OWNER
  assert member['HostConfig']['NetworkMode']==NETWORK and set(member['NetworkSettings']['Networks'])=={NETWORK}
  assert not member['HostConfig'].get('PortBindings') and not member['HostConfig']['Privileged'] and not member['HostConfig'].get('CapAdd')
  if entry['Name']!=POSTGRES: assert not member['Mounts']
 return {'networkId':net['Id'],'network':NETWORK,'internal':True,'owner':OWNER,'postgres':POSTGRES,'postgresImage':POSTGRES_IMAGE,'postgresOnlyThisNetwork':True,'postgresPublishedPorts':False,'postgresHostBindMounts':False,'postgresOnlyOwnedLocalDataVolume':VOLUME,'allAttachedContainersOwned':True,'observedNetwork':{k:net[k] for k in ['Id','Name','Internal','Driver','Labels']},'observedPostgres':{'id':pg['Id'],'image':pg['Config']['Image'],'labels':pg['Config']['Labels'],'running':pg['State']['Running'],'networkMode':pg['HostConfig']['NetworkMode'],'networkIds':{k:v['NetworkID'] for k,v in pg['NetworkSettings']['Networks'].items()},'portBindings':pg['HostConfig'].get('PortBindings'),'publishedPorts':pg['NetworkSettings']['Ports'],'privileged':pg['HostConfig']['Privileged'],'capAdd':pg['HostConfig'].get('CapAdd'),'mounts':[{k:m[k] for k in ['Type','Name','Destination','RW']} for m in pg['Mounts']]},'observedVolume':{k:volume.get(k) for k in ['Name','Driver','Options','Labels']}}
