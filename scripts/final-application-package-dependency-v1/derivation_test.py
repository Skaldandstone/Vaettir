"""Pure source rendering and parsing only; generated operators never imported."""
from pathlib import Path
import ast, importlib.util, sys, unittest
sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
def load(name, path):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
old=load('parent_deriver',HERE.parent/'final-application-web-leaf-v1/derive-operators.derived.py')
new=load('dependency_deriver',HERE/'derive-operators.derived.py')
class Derivation(unittest.TestCase):
    def setUp(self):
        self.config={'producerPackage':str(HERE.parent/'final-application-producers-v1'),'webLeafPackage':str(HERE.parent/'final-application-web-leaf-v1'),'packageDependencyPackage':str(HERE)}
    def test_unrelated_generated_bytes_unchanged(self):
        a=old.render(self.config,'a'*40); b=new.render(self.config,'a'*40)
        self.assertEqual(set(a),set(b))
        for name in a:
            if name!='contracts.py': self.assertEqual(a[name],b[name],name)
    def test_exact_contracts(self):
        self.assertEqual(new.render(self.config,'a'*40)['contracts.py'],(HERE/'operator-contracts.derived.py').read_text().encode())
    def test_generated_syntax(self):
        files=new.render(self.config,'a'*40); count=0
        for name,raw in files.items():
            if name.endswith('.py'): ast.parse(raw,filename=name); count+=1
        self.assertEqual(count,14)
    def test_wrong_package(self):
        self.config['packageDependencyPackage']=str(HERE.parent)
        with self.assertRaises(AssertionError): new.render(self.config,'a'*40)
    def test_wrong_parent(self):
        self.config['webLeafPackage']=str(HERE)
        with self.assertRaises(AssertionError): new.render(self.config,'a'*40)
if __name__=='__main__': unittest.main()
