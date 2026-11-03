"""Render source only; no generated operator module is imported or executed."""
from pathlib import Path
import ast,importlib.util,sys,unittest
sys.dont_write_bytecode=True
HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
old=load('dependency_deriver',HERE.parent/'final-application-package-dependency-v1/derive-operators.derived.py')
new=load('minimal_deriver',HERE/'derive-operators.derived.py')
class Derivation(unittest.TestCase):
    def setUp(self):
        self.config={'producerPackage':str(HERE.parent/'final-application-producers-v1'),'webLeafPackage':str(HERE.parent/'final-application-web-leaf-v1'),'packageDependencyPackage':str(HERE.parent/'final-application-package-dependency-v1'),'minimalDeltaPackage':str(HERE)}
    def test_unrelated_generated_bytes_unchanged(self):
        a=old.render(self.config,'a'*40);b=new.render(self.config,'a'*40);self.assertEqual(set(a),set(b))
        for name in a:
            if name!='contracts.py':self.assertEqual(a[name],b[name],name)
    def test_contract_exact(self):self.assertEqual(new.render(self.config,'a'*40)['contracts.py'],(HERE/'operator-contracts.derived.py').read_text().encode())
    def test_generated_syntax(self):
        rows=[(n,b) for n,b in new.render(self.config,'a'*40).items() if n.endswith('.py')]
        for n,b in rows:ast.parse(b,filename=n)
        self.assertEqual(len(rows),14)
    def test_wrong_successor(self):
        self.config['minimalDeltaPackage']=str(HERE.parent)
        with self.assertRaises(AssertionError):new.render(self.config,'a'*40)
    def test_wrong_parent(self):
        self.config['packageDependencyPackage']=str(HERE)
        with self.assertRaises(AssertionError):new.render(self.config,'a'*40)
if __name__=='__main__':unittest.main()
