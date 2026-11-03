"""Pure source derivation and synthetic ZIP tests; never imports an operator."""
import sys
sys.dont_write_bytecode=True
import ast, hashlib, io, unittest, zipfile
from pathlib import Path
from derive_operators import render
from prepare_release import verify_archive

HERE=Path(__file__).resolve().parent
SOURCE='a'*40

def archive(rows):
    out=io.BytesIO()
    with zipfile.ZipFile(out,'w') as z:
        for name,value,mode in rows:
            info=zipfile.ZipInfo(name);info.create_system=3;info.external_attr=mode<<16
            z.writestr(info,value)
    return out.getvalue()

class Derivation(unittest.TestCase):
    @classmethod
    def setUpClass(cls):cls.files=render({},SOURCE)
    def test_all_generated_python_parses_without_import(self):
        count=0
        for name,value in self.files.items():
            if name.endswith('.py'):ast.parse(value,filename=name);count+=1
        self.assertGreaterEqual(count,12)
    def test_archive_verifier_and_preparer_unchanged(self):
        for name in ('prepare-archive.py','verify-archive.py'):
            self.assertEqual(self.files[name],(HERE/'inherited/materialization-successor-v1'/name).read_bytes())
    def test_schema110_restore_precedes_actual111_migration(self):
        for name in ('prepare-image-isolated-fixture.py','probe-normal-recovery-runtime.py','probe-additional-runtime.py'):
            s=self.files[name].decode()
            self.assertLess(s.index("=='110'"),s.index('migrate(client,admission,db)'))
            self.assertIn('synthetic_dump()',s)
        s=self.files['probe-normal-recovery-runtime.py'].decode()
        self.assertIn("b'111 migrations found'",s)
        self.assertIn("'schema':111",s)
        self.assertIn(SOURCE[:12],s)
    def test_additional_probe_independent_intent_and_actual_compiled_tests(self):
        s=self.files['probe-additional-runtime.py'].decode()
        self.assertNotIn("assert not (O/'actual-normal-recovery-runtime-acceptance.json').exists()",s)
        self.assertIn("assert not (O/'additional-runtime-result.json').exists()",s)
        self.assertIn("'additional-runtime-intent.json'",s)
        self.assertIn("['noDatabaseOrRpcMock'] is True",s)
        self.assertIn("minimum={'plugin':6,'android':5,'import':2}",s)
    def test_preserved_prestart_timeout_and_raw_stdin(self):
        s=self.files['probe-normal-recovery-runtime.py'].decode()
        for fragment in ("meta['State']['Status']=='created'",'not meta[\'Mounts\']',"net['Internal'] is True",'input=code',"'mayStillBeRunning':True","'# skipped 0'",'all(not x[\'stale\']'):
            self.assertIn(fragment,s)
    def test_native_structure_precedes_actual_runtime(self):
        self.assertIn('runtime_gate(require_native=False)',self.files['image_admission.py'].decode())
        self.assertIn("component_gate('web',require_native=True)",self.files['probe-web-image.py'].decode())
        s=self.files['archive_contract.py'].decode()
        self.assertIn('component_gate(KIND)',s)
        self.assertIn('0<LAYER_COUNT<=128',s)
        self.assertNotIn("=={'api':98,'web':56}",s)
    def test_genuine_migration_not_a_schema_label_only(self):
        s=self.files['migrate_fixture.py'].decode()
        for fragment in ("'prisma','migrate','deploy'","intent.open('xb')","assert count=='111'",'not meta[\'Mounts\']',"'stdinSha256':sha(code)"):
            self.assertIn(fragment,s)
    def test_wrong_parent_source_hash_refuses_derivation(self):
        # A copy of the policy is never mutated; exercise the frozen hash rule.
        import derive_operators as module
        from unittest.mock import patch
        original=Path.read_bytes
        def changed(path):
            value=original(path)
            return value+b'changed' if path.name=='archive_contract.py' else value
        with patch.object(module.Path,'read_bytes',changed):
            with self.assertRaises(AssertionError):render({},SOURCE)

class SourceZip(unittest.TestCase):
    def setUp(self):
        self.rows=[('source.txt',b'actual Git bytes',0o100644)]
        self.expected={'source.txt':{'sha256':hashlib.sha256(self.rows[0][1]).hexdigest(),'bytes':len(self.rows[0][1]),'mode':0o644}}
    def test_exact_git_bytes_and_mode(self):self.assertEqual(verify_archive(archive(self.rows),self.expected),self.expected)
    def test_changed_member_refused(self):
        with self.assertRaises(AssertionError):verify_archive(archive([('source.txt',b'wrong Git bytes',0o100644)]),self.expected)
    def test_missing_member_refused(self):
        with self.assertRaises(AssertionError):verify_archive(archive([]),self.expected)
    def test_symlink_refused(self):
        with self.assertRaises(AssertionError):verify_archive(archive([('source.txt',self.rows[0][1],0o120644)]),self.expected)
    def test_private_or_traversal_refused(self):
        for name in ('../source.txt','.local/raw.txt','/source.txt','node_modules/raw'):
            with self.subTest(name=name),self.assertRaises(AssertionError):verify_archive(archive([(name,b'a',0o100644)]),self.expected)
    def test_mode_changed_refused(self):
        with self.assertRaises(AssertionError):verify_archive(archive([('source.txt',self.rows[0][1],0o100755)]),self.expected)

if __name__=='__main__':unittest.main(verbosity=2)
