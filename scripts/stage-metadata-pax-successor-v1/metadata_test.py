"""Synthetic TAR/files only. No operator main, Docker or native execution."""
from pathlib import Path
import ast,base64,copy,gzip,hashlib,importlib.util,io,json,sys,tarfile,tempfile,unittest
from unittest.mock import patch
sys.dont_write_bytecode=True
from stage_metadata import inspect_tar,merge_layer,ordinary,compare_observation,hardlink_pax
from metadata_reuse import check_reuse_rows,verify_sources,admit_reuse,pin,preflight,source_rows
from derive import derive,PARENT
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('frozen_metadata',PARENT);old=importlib.util.module_from_spec(spec);spec.loader.exec_module(old)
enc=lambda x:base64.b64encode(x.encode()).decode()
def row(path,typ='0',**kw):
    return dict(path=path,type=typ,size=1 if typ=='0' else 0,mode=420,uid=0,gid=0,pax={},layer=0,layerEntry=1,sha256='a'*64,inode='0:1',**kw)
def make_tar(p,pax=None):
    target='app/'+'a'*110;alias='app/'+'b'*110
    with tarfile.open(p,'w',format=tarfile.PAX_FORMAT) as t:
        f=tarfile.TarInfo(target);f.size=3;f.mode=0o644;t.addfile(f,io.BytesIO(b'abc'))
        h=tarfile.TarInfo(alias);h.type=tarfile.LNKTYPE;h.linkname=target;h.mode=0o644
        if pax is not None:h.pax_headers=pax
        t.addfile(h)
    return target,alias
class Metadata(unittest.TestCase):
    def test_long_pax_hardlinks_retain_raw_headers_and_alias_identity(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar';target,alias=make_tar(p);entries=inspect_tar(p,28)
            self.assertEqual(entries,old.inspect_tar(p,28))
            self.assertEqual(set(entries[1]['pax']),{'path','linkpath'})
            with self.assertRaises(AssertionError):old.merge_layer({},entries,28)
            merged={};events,_=merge_layer(merged,entries,28)
            self.assertEqual(merged[target]['inode'],merged[alias]['inode'])
            self.assertEqual(merged[alias]['hardlinkHeader'],entries[1]);self.assertEqual(events[0]['header'],entries[1])
            self.assertEqual([r['links'] for r in ordinary(merged)],[2,2])
            self.assertGreater(entries[1]['headerBytes'],512)
    def test_header_reader_optimization_preserves_exact_all_rows(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar';make_tar(p);opened=[];original=Path.open
            def watch(path,*args,**kw):opened.append(path);return original(path,*args,**kw)
            with patch.object(Path,'open',watch):actual=inspect_tar(p,0)
            self.assertEqual(len(opened),2);self.assertEqual(actual,old.inspect_tar(p,0))
    def test_empty_pax_keeps_original_proposals(self):
        entries=[row('a'),row('b','1',link='a')];a={};b={}
        self.assertEqual(merge_layer(a,entries,0),old.merge_layer(b,entries,0));self.assertEqual(a,b)
    def test_trailing_payload_remains_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar';make_tar(p)
            with p.open('ab') as f:f.write(b'unreviewed trailing payload')
            with self.assertRaises(AssertionError):inspect_tar(p,0)
    def test_unknown_inode_and_sparse_semantics_remain_refused(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar'
            with tarfile.open(p,'w') as t:
                m=tarfile.TarInfo('pipe');m.type=tarfile.FIFOTYPE;t.addfile(m)
            with self.assertRaises(AssertionError):inspect_tar(p,0)
            r=row('b','1',link='a');r['pax']={'GNU.sparse.map':enc('0,1')}
            with self.assertRaises(AssertionError):hardlink_pax(r)
    def test_every_other_hardlink_pax_key_refuses(self):
        for key in ['mtime','uid','gid','size','SCHILY.xattr.user.foo','SCHILY.xattr.security.capability','SCHILY.acl.access','GNU.sparse.map','unknown']:
            with self.subTest(key=key):
                r=row('b','1',link='a');r['pax']={key:enc('value')}
                with self.assertRaises(AssertionError):merge_layer({'a':row('a')},[r],0)
    def test_raw_tar_xattr_hardlink_refused_before_proposal(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'layer.tar';make_tar(p,{'SCHILY.xattr.user.foo':'bar'})
            with self.assertRaises(AssertionError):inspect_tar(p,0)
    def test_pax_paths_must_match_safe_resolved_paths(self):
        for key,bad in [('path','other'),('linkpath','other'),('path','../b'),('linkpath','/a'),('path','b\\x'),('path','a//b')]:
            with self.subTest(key=key,bad=bad):
                r=row('b','1',link='a');r['pax']={key:enc(bad)}
                with self.assertRaises(AssertionError):hardlink_pax(r)
    def test_missing_target_and_owner_change_remain_refused(self):
        with self.assertRaises(AssertionError):merge_layer({},[row('b','1',link='a')],0)
        r=row('b','1',link='a');r['uid']=1
        with self.assertRaises(AssertionError):merge_layer({'a':row('a')},[r],0)
    def test_whiteouts_replacements_and_discrepancies_unchanged(self):
        a={'dir':row('dir','5'),'dir/old':row('dir/old')};b=copy.deepcopy(a)
        white=row('dir/.wh..wh..opq');white['size']=0;entries=[row('dir/new'),white]
        self.assertEqual(merge_layer(a,entries,1),old.merge_layer(b,entries,1));self.assertEqual(a,b)
        observed=ordinary(a);observed[0]['uid']=99
        self.assertEqual(compare_observation(ordinary(a),observed),old.compare_observation(old.ordinary(b),observed))
        self.assertTrue(compare_observation(ordinary(a),observed))
    def test_source_derivation_exact_and_syntax(self):
        self.assertEqual(derive(),(HERE/'stage_metadata.py').read_bytes())
        for p in HERE.glob('*.py'):ast.parse(p.read_bytes(),filename=p.name)
    def test_unreviewed_runner_cannot_enter(self):
        with self.assertRaises(AssertionError):admit_reuse({}, {}, {}, HERE,HERE)
class Reuse(unittest.TestCase):
    def fixture(self,d):
        root=Path(d);context=root/'context';prior=context/'stage-metadata-proposal-v1';prior.mkdir(parents=True)
        layers=[];rows=[]
        for i in range(29):
            raw=('synthetic tar '+str(i)).encode();tar=prior/('layer-'+str(i)+'.tar');tar.write_bytes(raw)
            compressed=root/('layer-'+str(i)+'.gz');compressed.write_bytes(gzip.compress(raw));cp=pin(compressed);tp=pin(tar)
            layers.append({'index':i,'sourceFile':str(compressed),'bytes':cp['bytes'],'digest':'sha256:'+cp['sha256'],'expanded':tp['bytes'],'diffId':'sha256:'+tp['sha256']})
            rows.append({'index':i,'compressedSha256':cp['sha256'],'compressedBytes':cp['bytes'],'diffId':'sha256:'+tp['sha256'],'expandedBytes':tp['bytes'],'tar':{'path':tar.relative_to(root).as_posix(),**tp}})
        return root,context,layers,rows
    def test_exact_prefix_reused_without_decompression_and_unreused_delegate_retained(self):
        with tempfile.TemporaryDirectory() as d:
            root,context,layers,rows=self.fixture(d);reuse=check_reuse_rows(rows,layers,root,context);calls=[]
            verify_sources({'layers':layers},reuse,lambda v:calls.append(v))
            self.assertEqual(calls,[{'layers':[]}]);self.assertEqual(len(reuse),29)
            calls.clear();verify_sources({'layers':layers},{},lambda v:calls.append(v));self.assertEqual(calls,[{'layers':layers}])
    def test_missing_extra_reordered_rows_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root,context,layers,rows=self.fixture(d)
            for bad in [rows[:-1],rows+[rows[-1]],list(reversed(rows))]:
                with self.assertRaises(AssertionError):check_reuse_rows(bad,layers,root,context)
    def test_wrong_compressed_diffid_size_or_path_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root,context,layers,rows=self.fixture(d)
            for key,value in [('compressedSha256','a'*64),('compressedBytes',1),('diffId','sha256:'+'a'*64),('expandedBytes',1)]:
                bad=copy.deepcopy(rows);bad[0][key]=value
                with self.assertRaises(AssertionError):check_reuse_rows(bad,layers,root,context)
            bad=copy.deepcopy(rows);bad[0]['tar']['path']='../outside'
            with self.assertRaises(AssertionError):check_reuse_rows(bad,layers,root,context)
    def test_changed_tar_or_compressed_content_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root,context,layers,rows=self.fixture(d);reuse=check_reuse_rows(rows,layers,root,context)
            reuse[0].write_bytes(b'changed')
            with self.assertRaises(AssertionError):verify_sources({'layers':layers},reuse,lambda v:None)
        with tempfile.TemporaryDirectory() as d:
            root,context,layers,rows=self.fixture(d);reuse=check_reuse_rows(rows,layers,root,context)
            Path(layers[0]['sourceFile']).write_bytes(b'changed')
            with self.assertRaises(AssertionError):verify_sources({'layers':layers},reuse,lambda v:None)
class Preflight(unittest.TestCase):
    def fixture(self,d):
        root=Path(d).resolve();context=root/'context';context.mkdir()
        def put(name,value):
            p=root/name;p.parent.mkdir(exist_ok=True,parents=True)
            p.write_bytes(value if isinstance(value,bytes) else json.dumps(value).encode())
            return {'path':name,**pin(p)}
        proof=put('proof.json',{'synthetic':True});proof_tree=put('proof-tree.json',{'files':[proof]})
        manifest=put('successor-manifest.json',{'files':source_rows()})
        put('source-review.json',{'accepted':True,'independentReview':True,'scope':'STAGE_METADATA_PAX_SUCCESSOR_SOURCE','manifest':manifest,'proofTree':proof_tree})
        settings={'role':'api','evidenceRoot':str(root),'source':'a'*40,'manifestDigest':'sha256:'+'b'*64,'operatorFiles':['archive_contract.py','stage_support.py','stage_metadata.py']}
        put('context/archive_contract.py',b'# synthetic, never imported\n')
        put('context/stage_support.py',(HERE.parent/'final-application-stage-labels-v1/stage-support.derived.py').read_bytes())
        put('context/stage_metadata.py',PARENT.read_bytes());put('context/stage-config.json',settings)
        rows=[{'name':name,**pin(context/name)} for name in settings['operatorFiles']+['stage-config.json']]
        put('context/source-manifest.json',{'files':rows})
        put('context/paired-stage-materialization-source-acceptance.json',{'accepted':True,'independentReview':True,'scope':'TRANSACTION_STAGE_MATERIALIZATION_SOURCE','sourceManifestSha256':pin(context/'source-manifest.json')['sha256'],'source':settings['source'],'role':'api','stageDigest':settings['manifestDigest'],'proofTree':proof_tree})
        failure=put('failure.json',{'syntheticFailure':True})
        put('reuse-review.json',{'accepted':True,'independentReview':True,'scope':'STAGE_METADATA_RETAINED_TAR_REUSE','proofTree':proof_tree,'successorManifestSha256':manifest['sha256'],'stageConfigSha256':pin(context/'stage-config.json')['sha256'],'stageSourceManifestSha256':pin(context/'source-manifest.json')['sha256'],'priorFailure':failure})
        return root,context,['api',str(context),str(root),'source-review.json','reuse-review.json']
    def test_source_and_context_preflight_links_without_importing_operator(self):
        with tempfile.TemporaryDirectory() as d:
            root,context,args=self.fixture(d);argv=sys.argv[:];paths=sys.path[:]
            try:
                result=preflight(args);self.assertEqual(result['context'],context)
                self.assertNotIn('archive_contract',sys.modules);self.assertFalse((context/'stage-metadata-proposal-v2').exists())
            finally:sys.argv=argv;sys.path[:]=paths
    def test_unaccepted_source_and_changed_context_refuse_before_output(self):
        for which in ['source-review.json','context/stage_support.py']:
            with self.subTest(which=which),tempfile.TemporaryDirectory() as d:
                root,context,args=self.fixture(d)
                if which.endswith('.py'):(root/which).write_bytes(b'changed')
                else:
                    value=json.loads((root/which).read_bytes());value['accepted']=False;(root/which).write_text(json.dumps(value))
                with self.assertRaises(AssertionError):preflight(args)
                self.assertNotIn('archive_contract',sys.modules);self.assertFalse((context/'stage-metadata-proposal-v2').exists())
if __name__=='__main__':unittest.main()
