"""Independently stream-check a prepared tar or a fresh same-daemon OCI re-export."""
from archive_contract import *
import argparse, datetime, tarfile

parser=argparse.ArgumentParser()
parser.add_argument('--kind',choices=['prepared','export'],required=True)
parser.add_argument('--archive',required=True)
parser.add_argument('--receipt',required=True)
parser.add_argument('--capture',help='For export: Main-owned capture receipt binding archive, inspect and daemon')
args=parser.parse_args()
v=model(); archive=local_path(args.archive); output=local_path(args.receipt)
assert not output.exists() and output.parent.is_dir()
assert output!=archive
archive_hash,archive_size=hash_file(archive)
expected=v['blobs']; members={}; directories=set(); total=0; data_end=0
with tarfile.open(archive,mode='r:') as tar:
    for member in tar:
        name=member.name; parsed=PurePosixPath(name)
        assert name==str(parsed) and not parsed.is_absolute() and '..' not in parsed.parts and '\\' not in name
        assert name not in members and name not in directories,'Duplicate archive member'
        assert not member.pax_headers and not member.linkname
        assert len(members)+len(directories)<MAX_MEMBERS
        data_end=max(data_end,member.offset_data+((member.size+511)//512)*512)
        if member.isdir():
            assert args.kind=='export' and name in {'blobs','blobs/sha256'} and member.size==0
            directories.add(name); continue
        assert member.isfile() and 0<=member.size<=MAX_LAYER
        assert name in expected or name in {'oci-layout','index.json'} or (args.kind=='export' and name=='manifest.json')
        total+=member.size; assert total<MAX_COMPRESSED
        members[name]=member
    assert set(expected)<=set(members),'Missing referenced config/layer/manifest blob; metadata-only export refused'
    assert {'oci-layout','index.json'}<=set(members)
    def small(name):
        assert members[name].size<1024*1024
        return tar.extractfile(members[name]).read()
    assert json.loads(small('oci-layout'))==v['layout']
    index=json.loads(small('index.json'))
    assert index['schemaVersion']==2 and index['mediaType']=='application/vnd.oci.image.index.v1+json'
    assert len(index['manifests'])==1
    selected=index['manifests'][0]
    assert selected['digest']==MANIFEST and selected['size']==len((A/'original-manifest.json').read_bytes()) and selected['mediaType']==v['manifest']['mediaType']
    assert set(selected)<={'digest','size','mediaType','platform','annotations'}
    if args.kind=='prepared': assert index==v['index']
    elif 'platform' in selected: assert selected['platform']=={'os':'linux','architecture':'amd64'}
    # Never trust a blob filename, index metadata or daemon inspect instead of its bytes.
    for name,blob in expected.items():
        assert members[name].size==blob['size']
        actual,_=hash_stream(tar.extractfile(members[name]),MAX_LAYER,blob['size'])
        assert actual==blob['digest'],name
    assert small(blob_name(MANIFEST))==(A/'original-manifest.json').read_bytes()
    assert small(blob_name(CONFIG))==(A/'original-config.json').read_bytes()
    if 'manifest.json' in members:
        docker=json.loads(small('manifest.json')); assert len(docker)==1
        assert docker[0]['Config']==blob_name(CONFIG)
        assert docker[0]['Layers']==[blob_name(x['digest']) for x in v['manifest']['layers']]
        assert docker[0].get('RepoTags') in [None,[]],'Do not introduce a tag through materialization'
    layer_proofs=[]; expanded_total=0
    for row,diff in zip(v['layers'],v['config']['rootfs']['diff_ids']):
        with tar.extractfile(members[blob_name(row['digest'])]) as compressed:
            with gzip.GzipFile(fileobj=compressed,mode='rb') as stream:
                actual,size=hash_stream(stream,MAX_LAYER_EXPANDED,row['expanded'])
        assert actual==diff
        expanded_total+=size; assert expanded_total<MAX_EXPANDED
        layer_proofs.append({'index':row['index'],'digest':row['digest'],'bytes':row['bytes'],'diffId':actual,'expanded':size})
assert expanded_total==sum(row['expanded'] for row in v['layers']) and len(layer_proofs)==LAYER_COUNT
# Reject concatenated payload after the first tar end marker as well as visible members.
assert 1024<=archive_size-data_end<=1024*1024
with archive.open('rb') as stream:
    stream.seek(data_end)
    assert not any(stream.read()),'Unexpected trailing content after tar members'
capture_proof=None
if args.kind=='prepared':
    prepared=read(OUT/'prepared.json')
    assert archive==Path(prepared['archive']).resolve()
    assert archive_hash.split(':')[1]==prepared['archiveSha256'] and archive_size==prepared['archiveBytes']
    assert prepared['source']==SOURCE and prepared['manifestDigest']==MANIFEST and prepared['configDigest']==CONFIG
    assert prepared['dockerLoadPerformed'] is False
else:
    assert args.capture,'Fresh export requires original command/inspect provenance from Main'
    capture_path=local_path(args.capture); capture=read(capture_path)
    assert capture['source']==SOURCE and capture['image']==IMAGE and capture['dockerHost']==HOST
    assert capture['saveExitCode']==0 and capture['platform']=='linux/amd64'
    assert Path(capture['archive']).resolve()==archive and capture['archiveSha256']==archive_hash.split(':')[1]
    assert isinstance(capture['daemonId'],str) and capture['daemonId']
    inspect_path=local_path(capture['inspectPath'])
    assert hash_file(inspect_path)[0].split(':')[1]==capture['inspectSha256']
    inspection=read(inspect_path)
    if isinstance(inspection,list): assert len(inspection)==1; inspection=inspection[0]
    assert inspection['Id'] in (MANIFEST,CONFIG)
    id_kind='manifest' if inspection['Id']==MANIFEST else 'config'
    if id_kind=='manifest':
        assert inspection['Descriptor']['digest']==MANIFEST and inspection['Descriptor']['size']==len((A/'original-manifest.json').read_bytes())
        assert inspection['Descriptor']['mediaType']==v['manifest']['mediaType']
    assert IMAGE in inspection['RepoDigests'] and inspection['Os']=='linux' and inspection['Architecture']=='amd64'
    assert inspection['RootFS']['Type']=='layers' and inspection['RootFS']['Layers']==v['config']['rootfs']['diff_ids']
    capture_proof={'path':str(capture_path),'sha256':hash_file(capture_path)[0].split(':')[1],'inspectPath':str(inspect_path),'inspectSha256':capture['inspectSha256'],'dockerHost':HOST,'daemonId':capture['daemonId'],'observedLocalImageId':inspection['Id'],'localIdKind':id_kind}
# Rehash after traversal; a concurrent replacement or write cannot reuse the earlier archive hash.
assert hash_file(archive)==(archive_hash,archive_size)
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'kind':args.kind,'source':SOURCE,'manifestDigest':MANIFEST,'configDigest':CONFIG,'archive':str(archive),'archiveSha256':archive_hash.split(':')[1],'archiveBytes':archive_size,'allReferencedBlobsPresent':True,'allDescriptorHashesAndSizesExact':True,'exactOriginalManifestAndConfigBytes':True,'uniqueBlobs':len(expected),'orderedLayers':layer_proofs,'allOrderedDiffIdsExact':True,'sameDaemonExportEvidence':capture_proof,'localRuntimeAccepted':False,'fixtureExecuted':False,'dockerOrCloudOperationsPerformed':False,'sourceManifestSha256':digest((HERE/'source-manifest.json').read_bytes()).split(':')[1]}
output.open('xb').write(dump(result))
print(json.dumps({'archiveVerified':True,'kind':args.kind,'receipt':str(output),'uniqueBlobs':len(expected),'orderedLayers':LAYER_COUNT,'fixtureExecuted':False}))
