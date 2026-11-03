"""Main-only once-per-new-database migration on an already owned isolated PG."""
import json, re
from contracts import O,sha,prepared_gate
from isolated_image_fixture import POSTGRES,NETWORK,OWNER,assert_owned_image_fixture,inspect
def migrate(client,admission,db):
    assert re.fullmatch('vaettir_[a-z0-9_]+',db)
    assert_owned_image_fixture();p=prepared_gate();image=admission['image'];name='vaettir-migrate-'+p['commit'][:12]+'-'+db
    intent=O/(name+'-intent.json');intent.open('xb').write(json.dumps({'database':db,'image':image,'once':True}).encode())
    assert client.run('inspect',name,capture_output=True,timeout=30).returncode!=0
    url='postgresql://oauth_test:synthetic-local-only@'+POSTGRES+':5432/'+db+'?connection_limit=5'
    code=b"const {execFileSync}=require('node:child_process');execFileSync('pnpm',['--filter','@vaettir/db','exec','prisma','migrate','deploy'],{stdio:'inherit',timeout:120000});"
    (O/(name+'-executed.cjs')).open('xb').write(code)
    args=['create','--pull=never','-i','--name',name,'--label','vaettir.fixture='+OWNER,'--network',NETWORK,'--cpus','0.25','--memory','512m','--workdir','/app','--entrypoint','node']
    for value in ['DATABASE_URL='+url,'DB_SECRET_ID=','CLERK_SECRET_KEY=','SENTRY_DSN=','ATLASSIAN_OAUTH_CLIENT_ID=','ATLASSIAN_OAUTH_CLIENT_SECRET=','NODE_ENV=production']:args+=['--env',value]
    client.output(*args,image,'-');meta=inspect('container',name)
    assert meta['State']['Status']=='created' and not meta['State']['Running'] and meta['Image']==admission['observedLocalImageId']
    assert meta['Config']['Image']==image and meta['Config']['Entrypoint']==['node'] and meta['Config']['Cmd']==['-'] and meta['Config']['OpenStdin'] is True
    assert meta['Config']['WorkingDir']=='/app' and 'DATABASE_URL='+url in meta['Config']['Env']
    assert meta['Config']['Labels']['vaettir.fixture']==OWNER and meta['HostConfig']['NetworkMode']==NETWORK and set(meta['NetworkSettings']['Networks'])=={NETWORK}
    assert not meta['HostConfig']['PortBindings'] and not any(meta['NetworkSettings']['Ports'].values()) and not meta['Mounts']
    assert not meta['HostConfig']['Privileged'] and not meta['HostConfig'].get('CapAdd') and meta['HostConfig'].get('PidMode','')!='host' and meta['HostConfig'].get('IpcMode','')!='host'
    assert meta['HostConfig']['NanoCpus']==250000000 and meta['HostConfig']['Memory']==536870912
    (O/(name+'-prestart.json')).open('xb').write(json.dumps({'container':meta,'daemonId':admission['daemonId'],'stdinSha256':sha(code)}).encode())
    # Unknown/timeout outcomes leave the intent and resource for reconciliation.
    import subprocess
    try:r=client.run('start','--attach','--interactive',name,input=code,capture_output=True,timeout=150)
    except subprocess.TimeoutExpired as e:
        (O/(name+'-original.log')).open('xb').write((e.stdout or b'')+(e.stderr or b''));raise
    (O/(name+'-original.log')).open('xb').write(r.stdout+r.stderr)
    assert r.returncode==0
    after=inspect('container',name);assert after['State']['ExitCode']==0 and not after['State']['OOMKilled'] and after['RestartCount']==0
    count=client.output('exec',POSTGRES,'psql','-X','-U','oauth_test','-d',db,'-At','-v','ON_ERROR_STOP=1','-c','SELECT count(*) FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL').decode().strip()
    assert count=='111'
    (O/(name+'-result.json')).open('xb').write(json.dumps({'schema':111,'source':p['commit'],'image':image,'exitCode':0,'logSha256':sha(r.stdout+r.stderr),'releaseAccepted':False}).encode())
