"""Synthetic TARs and pure contract tests; never invokes native/container operators."""
import ast,copy,gzip,hashlib,io,json,sys,tarfile,tempfile,unittest
from pathlib import Path
sys.dont_write_bytecode=True
from stage_metadata import inspect_tar,merge_layer,ordinary,compare_observation,safe
from stage_support import validate_stage,confined,file_pin,verify_tree
HERE=Path(__file__).resolve().parent

def row(path,typ='0',**extra):
    return dict(path=path,type=typ,size=1 if typ=='0' else 0,mode=420,uid=0,gid=0,pax={},layer=0,layerEntry=1,sha256='a'*64,inode='0:1',**extra)

class Metadata(unittest.TestCase):
    def test_tar_actual_uid_gid_pax_and_header_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar'
            with tarfile.open(p,'w',format=tarfile.PAX_FORMAT) as t:
                m=tarfile.TarInfo('file');m.size=3;m.uid=123;m.gid=456;m.mode=0o640;m.pax_headers={'SCHILY.xattr.user.review':'value'};t.addfile(m,io.BytesIO(b'abc'))
            r=inspect_tar(p,0)[0]
            self.assertEqual((r['uid'],r['gid'],r['mode']),(123,456,0o640));self.assertIn('SCHILY.xattr.user.review',r['pax'])
            self.assertEqual(r['sha256'],hashlib.sha256(b'abc').hexdigest());self.assertGreater(r['headerBytes'],512)
    def test_trailing_payload_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar'
            with tarfile.open(p,'w') as t:t.addfile(tarfile.TarInfo('file'))
            with p.open('ab') as f:f.write(b'evil')
            with self.assertRaises(AssertionError):inspect_tar(p,0)
    def test_unsafe_paths_refused(self):
        for p in ['../a','/a','a/../b','a\\b','a//b']:
            with self.assertRaises(AssertionError):safe(p)
    def test_whiteout_only_lower_and_opaque_children(self):
        merged={'dir':row('dir','5'),'dir/old':row('dir/old'),'dir/keep':row('dir/keep')}
        white=row('dir/.wh..wh..opq');white['size']=0
        events,_=merge_layer(merged,[row('dir/new'),white],1)
        self.assertEqual(set(merged),{'dir','dir/new'});self.assertEqual(len(events),1)
    def test_hardlink_tracks_inode_after_target_replacement(self):
        merged={};a=row('a');b=row('b','1',link='a')
        merge_layer(merged,[a,b],0)
        replacement=row('a');replacement['inode']='1:1'
        merge_layer(merged,[replacement],1)
        self.assertEqual(merged['b']['inode'],'0:1');self.assertEqual(ordinary(merged)[0]['links'],1)
    def test_hardlink_and_symlink_ambiguity_refused(self):
        with self.assertRaises(AssertionError):merge_layer({},[row('b','1',link='missing')],1)
        with self.assertRaises(AssertionError):merge_layer({'dir':row('dir','2',link='elsewhere')},[row('dir/child')],1)
        m={'a':row('a')};b=row('b','1',link='a');b['uid']=1
        with self.assertRaises(AssertionError):merge_layer(m,[b],1)
    def test_replacing_directory_removes_descendants(self):
        m={'a':row('a','5'),'a/b':row('a/b'),'a/b/c':row('a/b/c')};merge_layer(m,[row('a')],1)
        self.assertEqual(set(m),{'a'})
    def test_observation_mismatches_are_unwaived(self):
        actual=ordinary({'a':row('a')});observed=copy.deepcopy(actual);observed[0]['uid']=12
        self.assertEqual(compare_observation(actual,observed)[0]['observed']['uid'],12)
        self.assertEqual(len(compare_observation(actual,[])),1)
    def test_unknown_inode_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar'
            with tarfile.open(p,'w') as t:
                m=tarfile.TarInfo('pipe');m.type=tarfile.FIFOTYPE;t.addfile(m)
            with self.assertRaises(AssertionError):inspect_tar(p,0)
    def test_pin_and_path_refusal(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'a';p.write_bytes(b'a')
            with self.assertRaises(AssertionError):file_pin(p,{'sha256':'0'*64,'bytes':1})
            with self.assertRaises(AssertionError):confined(d,'../a')
    def test_same_proof_tree_reference_contract_as_final_admission(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);raw=b'proof';(p/'proof').write_bytes(raw)
            tree=json.dumps({'files':[{'path':'proof','sha256':hashlib.sha256(raw).hexdigest(),'bytes':len(raw)}]}).encode();(p/'tree.json').write_bytes(tree)
            ref={'path':'tree.json','sha256':hashlib.sha256(tree).hexdigest(),'bytes':len(tree)}
            verify_tree(p,ref)
            (p/'proof').write_bytes(b'wrong')
            with self.assertRaises(AssertionError):verify_tree(p,ref)

class Contract(unittest.TestCase):
    def fixture(self,d):
        h=lambda b:'sha256:'+hashlib.sha256(b).hexdigest()
        enc=lambda v:json.dumps(v).encode()
        parent={'layers':[{'mediaType':'application/vnd.docker.image.rootfs.diff.tar.gzip','digest':'sha256:'+'1'*64,'size':1}]*98}
        pc={'config':{'Cmd':['node','server.js']},'rootfs':{'type':'layers','diff_ids':['sha256:'+'2'*64]*98},'os':'linux','architecture':'amd64'}
        pcr=enc(pc);parent['config']={'digest':h(pcr),'size':len(pcr)}
        c=copy.deepcopy(pc);c['rootfs']['diff_ids']+=['sha256:'+'3'*64]*4
        m=copy.deepcopy(parent);m['layers']+=copy.deepcopy(parent['layers'][:4])
        raw=enc(m);cr=enc(c);pr=enc(parent)
        for name,data in [('original-manifest.json',raw),('original-config.json',cr),('parent-manifest.json',pr),('parent-config.json',pcr)]:(d/name).write_bytes(data)
        settings={'role':'api','source':'a'*40,'tree':'b'*40,'manifestDigest':h(raw),'configDigest':h(cr),'parentDigest':h(pr),'parentConfigDigest':h(pcr),'parentLayerCount':98,'layerCount':102}
        settings['intentBinding']={k:settings[k] for k in ('source','tree','role','manifestDigest','configDigest','layerCount')}
        settings['intentBinding'].update(target='sqlite_observation',artifactPurpose='sqlite-transaction-stage',runtimeEligible=False)
        return settings
    def test_actual_102_layer_shape_preserves_98_parent_prefix(self):
        with tempfile.TemporaryDirectory() as d:validate_stage(Path(d),self.fixture(Path(d)))
    def test_wrong_parent_prefix_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);c=self.fixture(p);m=json.loads((p/'original-manifest.json').read_bytes());m['layers'][0]['digest']='sha256:'+'4'*64
            raw=json.dumps(m).encode();(p/'original-manifest.json').write_bytes(raw);c['manifestDigest']='sha256:'+hashlib.sha256(raw).hexdigest();c['intentBinding']['manifestDigest']=c['manifestDigest']
            with self.assertRaises(AssertionError):validate_stage(p,c)
    def test_final_application_config_not_admitted_as_stage(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d);s=self.fixture(p);c=json.loads((p/'original-config.json').read_bytes());c['config']['User']='root'
            raw=json.dumps(c).encode();(p/'original-config.json').write_bytes(raw);s['configDigest']='sha256:'+hashlib.sha256(raw).hexdigest();s['intentBinding']['configDigest']=s['configDigest']
            with self.assertRaises(AssertionError):validate_stage(p,s)
    def test_generated_operators_parse_without_import_or_execution(self):
        # Derive source bytes only; generated operator modules are never imported.
        import subprocess
        script="import {deriveStageOperators} from './scripts/final-application-producers-v1/stage-bootstrap.mjs'; console.log(JSON.stringify(Object.fromEntries(Object.entries(deriveStageOperators()).map(([p,b])=>[p,b.toString()]))));"
        result=subprocess.run(['node','--input-type=module','-e',script],cwd=HERE.parent.parent,capture_output=True,check=True)
        sources=json.loads(result.stdout);self.assertEqual(len(sources),6)
        for name,code in sources.items():ast.parse(code,filename=name)
    def test_retained_stream_hash_and_diffid_reject_corruption(self):
        original=HERE.parent/'final-application-release-v1/inherited/materialization-successor-v1/archive_contract.py'
        tree=ast.parse(original.read_bytes())
        selected=[n for n in tree.body if isinstance(n,ast.FunctionDef) and n.name in ('hash_stream','hash_file','verify_cached_layers')]
        env={'Path':Path,'gzip':gzip,'hashlib':hashlib,'MAX_COMPRESSED':3_000_000_000,'MAX_EXPANDED':12_000_000_000,'MAX_LAYER':1_250_000_000,'MAX_LAYER_EXPANDED':8_000_000_000,'CHUNK':1024*1024}
        exec(compile(ast.Module(body=selected,type_ignores=[]),str(original),'exec'),env)
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'synthetic.gz';raw=b'synthetic retained layer';compressed=gzip.compress(raw);p.write_bytes(compressed)
            r={'index':0,'sourceFile':str(p),'bytes':len(compressed),'expanded':len(raw),'digest':'sha256:'+hashlib.sha256(compressed).hexdigest(),'diffId':'sha256:'+hashlib.sha256(raw).hexdigest()}
            self.assertEqual(len(env['verify_cached_layers']({'layers':[r]})),1)
            bad={**r,'diffId':'sha256:'+'0'*64}
            with self.assertRaises(AssertionError):env['verify_cached_layers']({'layers':[bad]})
            p.write_bytes(compressed+b'x')
            with self.assertRaises(AssertionError):env['verify_cached_layers']({'layers':[r]})

if __name__=='__main__':unittest.main()
