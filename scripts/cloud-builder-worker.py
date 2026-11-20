#!/usr/bin/env python3
"""Run on the dedicated EC2 host, under the shared build lock. No deploy rights."""
import argparse
import base64
import hashlib
import json
import pathlib
import re
import subprocess
import time


def validate_job(job):
    for field, pattern in (("commit", r"[a-f0-9]{40}"),
                           ("archive_sha256", r"[a-f0-9]{64}"),
                           ("run_id", r"[a-f0-9]{32}")):
        if not re.fullmatch(pattern, job.get(field, "")):
            raise ValueError("Invalid " + field)
    if job.get("account") != "051722405355" or job.get("region") != "us-east-2":
        raise ValueError("Wrong AWS destination")
    if job.get("phase") not in ("prepare-native", "build-image"):
        raise ValueError("Invalid phase")
    return job


def build_commands(commit, phase):
    common = ["docker", "buildx", "build", "--builder", "vaettir-cloud",
              "--platform", "linux/amd64", "--progress", "plain",
              "--file", "Dockerfile.api", "--build-arg", "VAETTIR_RELEASE_COMMIT=" + commit]
    commands = [
        common + ["--no-cache-filter", "llvm-build-inputs,llvm-build", "--target",
                  "llvm-build", "--output", "type=cacheonly", "-"],
        common + ["--no-cache-filter", "runtime", "--load", "--tag",
                  "vaettir-api:" + commit, "-"],
    ]
    return [commands[0] if phase == "prepare-native" else commands[1]]


def main():
    import boto3  # Supplied by the host's distribution package, not the source archive.
    parser = argparse.ArgumentParser()
    parser.add_argument("bucket")
    parser.add_argument("run_id")
    args = parser.parse_args()
    if args.bucket != "vaettir-build-source-051722405355" or not re.fullmatch(r"[a-f0-9]{32}", args.run_id):
        parser.error("Invalid job location")
    prefix = "cloud-builder/jobs/" + args.run_id
    session = boto3.Session(region_name="us-east-2")
    s3 = session.client("s3")
    if session.client("sts").get_caller_identity()["Account"] != "051722405355":
        raise RuntimeError("Wrong AWS account")
    job = validate_job(json.loads(s3.get_object(Bucket=args.bucket, Key=prefix + "/job.json")["Body"].read()))
    if job["run_id"] != args.run_id:
        raise ValueError("Job ID mismatch")
    work = pathlib.Path("/var/lib/vaettir-builder/jobs") / args.run_id
    work.mkdir(parents=True, exist_ok=False)
    archive = work / "source.tar"
    log_path = work / "build.log"
    result = {"run_id": args.run_id, "commit": job["commit"], "status": "failed", "deployed": False}
    started = time.monotonic()

    def run(argv, log, **kwargs):
        # One total seven-hour budget, including both native preparation and image assembly.
        remaining = max(1, 25200 - (time.monotonic() - started))
        return subprocess.run(argv, check=True, stdout=log, stderr=subprocess.STDOUT,
                              timeout=remaining, **kwargs)

    try:
        s3.download_file(args.bucket, prefix + "/source.tar", str(archive))
        with archive.open("rb") as source:
            if hashlib.file_digest(source, "sha256").hexdigest() != job["archive_sha256"]:
                raise RuntimeError("Source archive hash mismatch")
        with log_path.open("wb", buffering=0) as log:
            probe = subprocess.run(["docker", "buildx", "inspect", "vaettir-cloud"],
                                   stdout=log, stderr=subprocess.STDOUT, timeout=60)
            if probe.returncode:
                run(["docker", "buildx", "create", "--name", "vaettir-cloud",
                     "--driver", "docker-container"], log)
            run(["docker", "buildx", "inspect", "vaettir-cloud", "--bootstrap"], log)
            for command in build_commands(job["commit"], job["phase"]):
                with archive.open("rb") as source:
                    run(command, log, stdin=source)
            if job["phase"] == "prepare-native":
                result.update(status="native-prepared", runtime_image_produced=False)
                return
            image = "vaettir-api:" + job["commit"]
            metadata = json.loads(subprocess.check_output(["docker", "image", "inspect", image], timeout=60))[0]
            if "VAETTIR_RELEASE_COMMIT=" + job["commit"] not in metadata["Config"]["Env"]:
                raise RuntimeError("Built image identity mismatch")
            ecr = session.client("ecr")
            auth = ecr.get_authorization_token(registryIds=[job["account"]])["authorizationData"][0]
            user, password = base64.b64decode(auth["authorizationToken"]).decode().split(":", 1)
            registry = job["account"] + ".dkr.ecr.us-east-2.amazonaws.com"
            # Keep credentials out of log output and give each run its own image tag.
            run(["docker", "login", "--username", user, "--password-stdin", registry], log,
                input=password.encode())
            try:
                tag = "cloud-" + job["commit"] + "-" + args.run_id
                remote = registry + "/vaettir-api:" + tag
                run(["docker", "tag", image, remote], log)
                run(["docker", "push", remote], log)
                detail = ecr.describe_images(repositoryName="vaettir-api", imageIds=[{"imageTag": tag}])["imageDetails"][0]
                result.update(status="built", image=remote, digest=detail["imageDigest"],
                              scan_and_release_acceptance="pending")
            finally:
                subprocess.run(["docker", "logout", registry], stdout=log, stderr=subprocess.STDOUT, timeout=60)
    except Exception as error:
        result["error"] = str(error)
        raise
    finally:
        result["elapsed_seconds"] = round(time.monotonic() - started)
        (work / "result.json").write_text(json.dumps(result, indent=2) + "\n")
        if log_path.exists():
            s3.upload_file(str(log_path), args.bucket, prefix + "/build.log")
        s3.upload_file(str(work / "result.json"), args.bucket, prefix + "/result.json")
        pathlib.Path("/var/lib/vaettir-builder/last-activity").touch()
        print(json.dumps(result))


if __name__ == "__main__":
    main()
