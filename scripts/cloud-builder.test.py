import importlib.util
import pathlib
import json
import hashlib
import io
import subprocess
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("worker", ROOT / "scripts/cloud-builder-worker.py")
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


class CloudBuilderTest(unittest.TestCase):
    def job(self):
        return dict(commit="a" * 40, archive_sha256="b" * 64, run_id="c" * 32,
                    account="051722405355", region="us-east-2", phase="build-image")

    def test_rejects_shell_injection_and_wrong_destination(self):
        for field, value in (("commit", "a" * 40 + "; whoami"), ("run_id", "../other"),
                             ("archive_sha256", "b" * 63), ("account", "000000000000"),
                             ("region", "us-west-2"), ("phase", "deploy")):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    worker.validate_job({**self.job(), field: value})

    def test_native_preparation_uses_production_target(self):
        command, = worker.build_commands("a" * 40, "prepare-native")
        self.assertEqual(command[command.index("--target") + 1], "llvm-build")
        self.assertEqual(command[command.index("--no-cache-filter") + 1], "llvm-build-inputs,llvm-build")
        self.assertNotIn("--push", command)
        self.assertEqual(command[-1], "-")

    def test_regular_build_keeps_native_cache_and_rechecks_runtime(self):
        command, = worker.build_commands("a" * 40, "build-image")
        self.assertEqual(command[command.index("--no-cache-filter") + 1], "runtime")
        self.assertNotIn("--target", command)
        self.assertIn("--load", command)
        self.assertIn("VAETTIR_RELEASE_COMMIT=" + "a" * 40, command)
        self.assertNotIn("--push", command)

    def test_glibc_preparation_cannot_publish_or_deploy(self):
        command, = worker.build_commands("a" * 40, "prepare-glibc")
        self.assertEqual(command[command.index("--target") + 1], "glibc-security")
        self.assertNotIn("--load", command)
        result, clients, commands = self.run_worker("prepare-glibc")
        self.assertEqual(result["status"], "native-prepared")
        self.assertFalse(result["deployed"])
        self.assertFalse(any(c[:2] == ["docker", "push"] for c in commands))
        self.assertTrue(any(c[:2] == ["docker", "logout"] for c in commands))

    def test_native_artifact_is_not_a_runtime_release(self):
        command, = worker.build_commands("a" * 40, "publish-glibc")
        self.assertEqual(command[command.index("--target") + 1], "glibc-runtime-artifact")
        result, _, _ = self.run_worker("publish-glibc")
        self.assertEqual(result["status"], "native-artifact-built")
        self.assertFalse(result["runtime_image_produced"])
        self.assertFalse(result["deployed"])
        self.assertIn("/vaettir-api:native-glibc-", result["image"])
        result, clients, commands = self.run_worker("publish-glibc", bad_identity=True)
        self.assertFalse(any(c[:2] == ["docker", "push"] for c in commands))
        self.assertTrue(any(c[:2] == ["docker", "logout"] for c in commands))

    def run_worker(self, phase, fail_build=False, bad_hash=False, bad_identity=False):
        archive = b"synthetic source archive"
        job = {**self.job(), "phase": phase, "archive_sha256": hashlib.sha256(archive).hexdigest()}
        if bad_hash:
            job["archive_sha256"] = "0" * 64
        uploads = {}
        clients = []
        commands = []
        actual_path = pathlib.Path
        with tempfile.TemporaryDirectory() as temp:
            def mapped_path(value):
                return actual_path(temp) / str(value).removeprefix("/var/lib/vaettir-builder/")

            class S3:
                def get_object(self, **kwargs):
                    return {"Body": io.BytesIO(json.dumps(job).encode())}

                def download_file(self, bucket, key, destination):
                    actual_path(destination).write_bytes(archive)

                def upload_file(self, source, bucket, key):
                    uploads[key.rsplit("/", 1)[-1]] = actual_path(source).read_bytes()

            def client(service):
                clients.append(service)
                if service == "s3":
                    return S3()
                if service == "sts":
                    return types.SimpleNamespace(get_caller_identity=lambda: {"Account": "051722405355"})
                if service == "ecr":
                    return types.SimpleNamespace(
                        get_authorization_token=lambda **kwargs: {"authorizationData": [{"authorizationToken": "QVdTOnN5bnRoZXRpYw=="}]},
                        describe_images=lambda **kwargs: {"imageDetails": [{"imageDigest": "sha256:" + "d" * 64}]},
                    )
                raise AssertionError("Unexpected cloud call: " + service)

            def run(argv, **kwargs):
                commands.append(argv)
                if fail_build and argv[:3] == ["docker", "buildx", "build"]:
                    raise subprocess.CalledProcessError(124, argv)
                return types.SimpleNamespace(returncode=0)

            boto = types.SimpleNamespace(Session=lambda **kwargs: types.SimpleNamespace(client=client))
            image = [{"Config": {"Env": ["VAETTIR_RELEASE_COMMIT=" + ("0" * 40 if bad_identity else job["commit"])],
                       "Labels": {"vaettir.artifact-purpose": "glibc-native-packages", "vaettir.runtime-eligible": "false",
                                  "org.opencontainers.image.revision": "0" * 40 if bad_identity else job["commit"]}}}]
            with patch.dict(sys.modules, boto3=boto), patch.object(sys, "argv", ["worker", "vaettir-build-source-051722405355", job["run_id"]]), \
                    patch.object(worker.pathlib, "Path", mapped_path), patch.object(worker.subprocess, "run", run), \
                    patch.object(worker.subprocess, "check_output", return_value=json.dumps(image).encode()):
                if fail_build or bad_hash or bad_identity:
                    with self.assertRaises((subprocess.CalledProcessError, RuntimeError)):
                        worker.main()
                else:
                    worker.main()
        return json.loads(uploads["result.json"]), clients, commands

    def test_failed_native_build_uploads_failure_and_cannot_publish(self):
        result, clients, commands = self.run_worker("build-image", fail_build=True)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(result["deployed"])
        self.assertFalse(any(c[:2] == ["docker", "push"] for c in commands))
        self.assertTrue(any(c[:2] == ["docker", "logout"] for c in commands))

    def test_archive_mismatch_stops_before_docker(self):
        result, _, commands = self.run_worker("build-image", bad_hash=True)
        self.assertEqual(commands, [])
        self.assertIn("hash mismatch", result["error"])

    def test_preparation_success_is_not_an_image_or_release(self):
        result, clients, commands = self.run_worker("prepare-native")
        self.assertEqual(result["status"], "native-prepared")
        self.assertFalse(result["runtime_image_produced"])
        self.assertFalse(result["deployed"])
        self.assertFalse(any(c[:2] == ["docker", "push"] for c in commands))
        self.assertTrue(any(c[:2] == ["docker", "logout"] for c in commands))

    def test_wrong_image_identity_cannot_publish(self):
        result, clients, commands = self.run_worker("build-image", bad_identity=True)
        self.assertEqual(result["status"], "failed")
        self.assertFalse(any(c[:2] == ["docker", "push"] for c in commands))
        self.assertTrue(any(c[:2] == ["docker", "logout"] for c in commands))

    def test_success_publishes_unique_tag_without_deploying(self):
        result, _, commands = self.run_worker("build-image")
        self.assertEqual(result["status"], "built")
        login = next(i for i, c in enumerate(commands) if c[:2] == ["docker", "login"])
        build = next(i for i, c in enumerate(commands) if c[:3] == ["docker", "buildx", "build"])
        self.assertLess(login, build)
        self.assertFalse(result["deployed"])
        self.assertEqual(result["scan_and_release_acceptance"], "pending")
        pushed = next(c[2] for c in commands if c[:2] == ["docker", "push"])
        self.assertTrue(pushed.endswith("/vaettir-api:cloud-" + "a" * 40 + "-" + "c" * 32))
        self.assertTrue(any(c[:2] == ["docker", "logout"] for c in commands))


if __name__ == "__main__":
    unittest.main()
