import importlib.util
import pathlib
import unittest
import urllib.parse

spec = importlib.util.spec_from_file_location("dev", pathlib.Path(__file__).with_name("cloud-dev-db.py"))
dev = importlib.util.module_from_spec(spec)
spec.loader.exec_module(dev)


class DevelopmentDatabaseTest(unittest.TestCase):
    def test_rejects_production_or_mismatched_database(self):
        outputs = {"DatabaseHost": "synthetic.example", "SecretArn": "synthetic-secret"}
        cluster = {"DatabaseName": "vaettir_dev", "Engine": "aurora-postgresql", "Endpoint": "synthetic.example",
                   "MasterUserSecret": {"SecretArn": "synthetic-secret"},
                   "TagList": [{"Key": "Environment", "Value": "development"}, {"Key": "Project", "Value": "Vaettir"}]}
        dev.validate_database(cluster, outputs)
        for change in ({"DatabaseName": "production"}, {"TagList": []}, {"Endpoint": "other.example"},
                       {"MasterUserSecret": {"SecretArn": "wrong-secret"}}):
            with self.assertRaises(RuntimeError):
                dev.validate_database({**cluster, **change}, outputs)

    def test_secret_characters_cannot_change_url_destination(self):
        secret = {"username": "vaettir_dev_admin", "password": "synthetic@evil.example:9999/path?#%"}
        value = urllib.parse.urlparse(dev.connection_url(secret))
        self.assertEqual(value.hostname, "127.0.0.1")
        self.assertEqual(value.port, 15432)
        self.assertEqual(value.path, "/vaettir_dev")
        self.assertEqual(urllib.parse.unquote(value.password), secret["password"])

    def test_child_environment_cannot_inherit_production_database_selection(self):
        original = {"DB_SECRET_ID": "production-secret", "DATABASE_URL": "production", "NODE_ENV": "production"}
        child = dev.child_environment(original, {"username": "vaettir_dev_admin", "password": "synthetic"})
        self.assertEqual(child["DB_SECRET_ID"], "")
        self.assertEqual(child["NODE_ENV"], "development")
        self.assertEqual(urllib.parse.urlparse(child["DATABASE_URL"]).path, "/vaettir_dev")
        self.assertEqual(original["DATABASE_URL"], "production")

    def test_rejects_wrong_user_or_missing_password(self):
        for secret in ({"username": "production", "password": "synthetic"}, {"username": "vaettir_dev_admin"}):
            with self.assertRaises(ValueError):
                dev.connection_url(secret)


if __name__ == "__main__":
    unittest.main()
