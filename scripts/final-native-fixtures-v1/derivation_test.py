"""Pure source rendering and syntax. Never import a generated operator."""
import ast
import importlib.util
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent

def module(path, name):
    spec = importlib.util.spec_from_file_location(name, path)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result

class Derivation(unittest.TestCase):
    def setUp(self):
        self.parent = module(HERE.parent/'final-application-posix-inventory-v1/derive-operators.derived.py', 'parent_derivation')
        self.current = module(HERE/'derive-operators.derived.py', 'fixture_derivation')
        self.config = {key: str(HERE.parent/name) for key, name in [
            ('nativeFixturePackage','final-native-fixtures-v1'),
            ('posixInventoryPackage','final-application-posix-inventory-v1'),
            ('minimalDeltaPackage','final-application-minimal-delta-v1'),
            ('packageDependencyPackage','final-application-package-dependency-v1'),
            ('webLeafPackage','final-application-web-leaf-v1'),
            ('producerPackage','final-application-producers-v1')]}
    def test_all_non_contract_generated_bytes_unchanged(self):
        old=self.parent.render(self.config,'94cde34624bcc910c5f8c1a19214302ffa04c2bf')
        new=self.current.render(self.config,'94cde34624bcc910c5f8c1a19214302ffa04c2bf')
        self.assertEqual(set(old),set(new))
        for name,raw in new.items():
            if name.endswith('.py'): ast.parse(raw)
            if name!='contracts.py': self.assertEqual(raw,old[name],name)
        self.assertNotEqual(new['contracts.py'],old['contracts.py'])
    def test_wrong_fixture_source_location_refused(self):
        self.config['nativeFixturePackage']=str(HERE.parent/'other')
        with self.assertRaises(AssertionError):self.current.render(self.config,'94cde34624bcc910c5f8c1a19214302ffa04c2bf')
    def test_phase_source_binding_and_gate_remain_mandatory(self):
        source=(HERE/'operator-contracts.derived.py').read_text()
        self.assertIn("'posixInventory','nativeFixtureSource')",source)
        self.assertIn("FIXTURE_PACKAGE/'release-context.derived.mjs'",source)
        self.assertIn("fixture_review['scope']=='FINAL_NATIVE_FIXTURE_SOURCE'",source)

if __name__=='__main__':unittest.main()
