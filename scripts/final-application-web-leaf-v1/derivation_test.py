"""Pure source rendering only; no generated operator imports or execution."""
from pathlib import Path
import ast,importlib.util,sys,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
def load(name,p):
 s=importlib.util.spec_from_file_location(name,p);m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
old=load('parent_deriver',HERE.parent/'final-application-producers-v1/derive-operators.derived.py')
new=load('web_deriver',HERE/'derive-operators.derived.py')
class Derivation(unittest.TestCase):
 def setUp(self):self.config={'producerPackage':str(HERE.parent/'final-application-producers-v1'),'webLeafPackage':str(HERE)}
 def test_all_unrelated_generated_bytes_preserved(self):
  a=old.render(self.config,'a'*40);b=new.render(self.config,'a'*40);self.assertEqual(set(a),set(b))
  for p in a:
   if p!='contracts.py':self.assertEqual(a[p],b[p],p)
 def test_contracts_exact_successor(self):self.assertEqual(new.render(self.config,'a'*40)['contracts.py'],(HERE/'operator-contracts.derived.py').read_text().encode())
 def test_generated_python_syntax_without_operator_import(self):
  files=new.render(self.config,'a'*40);count=0
  for name,b in files.items():
   if name.endswith('.py'):ast.parse(b,filename=name);count+=1
  self.assertEqual(count,14)
 def test_wrong_successor_path_refused(self):
  self.config['webLeafPackage']=str(HERE.parent)
  with self.assertRaises(AssertionError):new.render(self.config,'a'*40)
 def test_wrong_parent_path_refused(self):
  self.config['producerPackage']=str(HERE)
  with self.assertRaises(AssertionError):new.render(self.config,'a'*40)
if __name__=='__main__':unittest.main()
