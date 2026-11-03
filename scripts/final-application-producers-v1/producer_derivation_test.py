"""Pure source rendering only. Never imports generated operator contracts."""
import sys
sys.dont_write_bytecode=True
import ast,importlib.util,unittest
from pathlib import Path
HERE=Path(__file__).resolve().parent
def load(name,path):
    spec=importlib.util.spec_from_file_location(name,path);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
old=load('frozen_source_deriver',HERE.parent/'final-application-release-v1/derive_operators.py')
new=load('producer_source_deriver',HERE/'derive-operators.derived.py')
class SourceDerivation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.config={'producerPackage':str(HERE)};cls.source='a'*40
        cls.before=old.render(cls.config,cls.source);cls.after=new.render(cls.config,cls.source)
    def test_every_unrelated_generated_byte_preserved(self):
        self.assertEqual(set(self.before),set(self.after))
        for p in self.before:
            if p!='contracts.py':self.assertEqual(self.before[p],self.after[p],p)
    def test_new_contracts_are_exact_reviewed_derivation(self):
        self.assertEqual(self.after['contracts.py'],(HERE/'operator-contracts.derived.py').read_text().encode())
    def test_all_python_source_parses_without_operator_import(self):
        count=0
        for p,b in self.after.items():
            if p.endswith('.py'):ast.parse(b,filename=p);count+=1
        self.assertEqual(count,14)
    def test_wrong_producer_directory_refused(self):
        with self.assertRaises(AssertionError):new.render({'producerPackage':str(HERE.parent)},self.source)
    def test_source_identity_and_review_rehashed_before_new_context(self):
        s=self.after['contracts.py'].decode()
        self.assertIn("'purpose','producers'",s)
        self.assertLess(s.index("producer_review=read(ref(b['producers']['approval']))"),s.index("str(PRODUCER_PACKAGE/'release-context.derived.mjs')"))
        self.assertIn("p.stat().st_size==row['bytes'] and file_sha(p)==row['sha256']",s)
        for marker in ["generated_gate(); b=bindings(phase)","configurationSha256", "baseBindingsSha256", "'releaseAccepted'] is False"]:self.assertIn(marker,s)
if __name__=='__main__':unittest.main()
