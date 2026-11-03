"""Synthetic configs only; no operator/native/cloud or actual image execution."""
from pathlib import Path
import sys,importlib.util,tempfile,json,hashlib,unittest,ast
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent;PARENT=HERE.parent/'final-application-producers-v1';sys.path.insert(0,str(PARENT))
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
old=load('old_stage',PARENT/'stage_support.py');new=load('label_stage',HERE/'stage-support.derived.py')
fixtures=load('synthetic_fixtures',PARENT/'stage_metadata_test.py')
class Labels(unittest.TestCase):
 def fixture(self,d):
  c=fixtures.Contract().fixture(d);config=json.loads((d/'original-config.json').read_bytes());parent=json.loads((d/'parent-config.json').read_bytes())
  added={'vaettir.artifact-purpose':'sqlite-transaction-stage','vaettir.runtime-eligible':'false','vaettir.validation-source':c['source']}
  parent['config']['Labels']={'kept':'value'};config['config']['Labels']={'kept':'value',**added}
  c['intentBinding'].update(stageLabels=added,buildDriver=json.loads((HERE/'policy.json').read_bytes())['driver'])
  self.write(d,c,'parent-config.json',parent,'parentConfigDigest');self.write(d,c,'original-config.json',config,'configDigest')
  for path,conf,key in [('parent-manifest.json','parent-config.json','parentDigest'),('original-manifest.json','original-config.json','manifestDigest')]:
   m=json.loads((d/path).read_bytes());raw=(d/conf).read_bytes();m['config'].update(digest='sha256:'+hashlib.sha256(raw).hexdigest(),size=len(raw));self.write(d,c,path,m,key)
  return c
 def write(self,d,c,path,value,key):
  b=json.dumps(value).encode();(d/path).write_bytes(b);c[key]='sha256:'+hashlib.sha256(b).hexdigest()
  if key in ('configDigest','manifestDigest'):c['intentBinding'][key]=c[key]
 def change(self,fn):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);c=self.fixture(d);v=json.loads((d/'original-config.json').read_bytes());fn(v,c);self.write(d,c,'original-config.json',v,'configDigest')
   with self.assertRaises(AssertionError):new.validate_stage(d,c)
 def test_exact_three_labels_admitted_old_validator_refuses(self):
  with tempfile.TemporaryDirectory() as tmp:
   d=Path(tmp);c=self.fixture(d)
   with self.assertRaises(AssertionError):old.validate_stage(d,c)
   new.validate_stage(d,c)
 def test_missing_label(self):self.change(lambda v,c:v['config']['Labels'].pop('vaettir.artifact-purpose'))
 def test_wrong_purpose(self):self.change(lambda v,c:v['config']['Labels'].update({'vaettir.artifact-purpose':'runtime'}))
 def test_wrong_runtime_eligibility(self):self.change(lambda v,c:v['config']['Labels'].update({'vaettir.runtime-eligible':'true'}))
 def test_cross_source_label(self):self.change(lambda v,c:v['config']['Labels'].update({'vaettir.validation-source':'b'*40}))
 def test_extra_label(self):self.change(lambda v,c:v['config']['Labels'].update({'extra':'waiver'}))
 def test_changed_parent_label(self):self.change(lambda v,c:v['config']['Labels'].update({'kept':'other'}))
 def test_changed_user(self):self.change(lambda v,c:v['config'].update(User='root'))
 def test_wrong_reviewed_driver(self):self.change(lambda v,c:c['intentBinding']['buildDriver'].update(sha256='0'*64))
 def test_wrong_driver_size(self):self.change(lambda v,c:c['intentBinding']['buildDriver'].update(bytes=1))
 def test_wrong_intent_labels(self):self.change(lambda v,c:c['intentBinding']['stageLabels'].update({'vaettir.validation-source':'b'*40}))
 def test_python_source_parses(self):ast.parse((HERE/'stage-support.derived.py').read_bytes())
if __name__=='__main__':unittest.main()
