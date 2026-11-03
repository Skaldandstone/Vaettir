"""Write a separate OCI-layout tar from pinned cached bytes. Does not load or run it."""
from archive_contract import *
import datetime, io, tarfile

v=model()
assert not OUT.exists(),'Existing output is reconciliation-only; never overwrite a prior attempt'
# All descriptor/config/ordered layer and DiffID checks happen before writing any archive.
layer_proofs=verify_cached_layers(v)
for blob in v['blobs'].values():
    actual,_=hash_file(blob['path'],MAX_LAYER,blob['size']); assert actual==blob['digest']
OUT.mkdir()
archive=OUT/(KIND+'-exact-oci.tar')

class CheckedReader:
    def __init__(self,stream,expected):
        self.stream=stream; self.expected=expected; self.sha=hashlib.sha256(); self.count=0
    def read(self,size=-1):
        data=self.stream.read(size); self.count+=len(data)
        assert self.count<=self.expected['size']; self.sha.update(data); return data
    def finish(self):
        assert not self.stream.read(1),'Source grew during archive copy'
        assert self.count==self.expected['size']
        assert 'sha256:'+self.sha.hexdigest()==self.expected['digest'],'Source changed during archive copy'

def info(name,size):
    entry=tarfile.TarInfo(name); entry.size=size; entry.mode=0o644
    entry.uid=entry.gid=entry.mtime=0; entry.uname=entry.gname=''; return entry

with archive.open('xb') as output:
    with tarfile.open(fileobj=output,mode='w',format=tarfile.USTAR_FORMAT) as tar:
        for name,data in [('oci-layout',dump(v['layout'])),('index.json',dump(v['index']))]:
            tar.addfile(info(name,len(data)),io.BytesIO(data))
        for name,blob in sorted(v['blobs'].items()):
            with blob['path'].open('rb') as source:
                checked=CheckedReader(source,blob); tar.addfile(info(name,blob['size']),checked); checked.finish()
value,size=hash_file(archive)
receipt={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':SOURCE,'manifestDigest':MANIFEST,'configDigest':CONFIG,'archive':str(archive),'archiveSha256':value.split(':')[1],'archiveBytes':size,'uniqueBlobs':len(v['blobs']),'orderedLayers':LAYER_COUNT,'orderedLayerProofs':layer_proofs,'manifestAndConfigUnchanged':True,'platformMetadataAddedOnlyToIndex':True,'blobFilenamesDeduplicatedOnly':True,'noTagsAdded':True,'noExternalFetch':True,'dockerLoadPerformed':False,'localRuntimeAccepted':False,'productionChanged':False,'sourceManifestSha256':digest((HERE/'source-manifest.json').read_bytes()).split(':')[1]}
(OUT/'prepared.json').open('xb').write(dump(receipt))
print(json.dumps({'archivePrepared':True,'path':str(archive),'sha256':receipt['archiveSha256'],'uniqueBlobs':len(v['blobs']),'orderedLayers':LAYER_COUNT,'dockerLoadPerformed':False}))
