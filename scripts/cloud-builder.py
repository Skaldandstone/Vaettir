#!/usr/bin/env python3
"""Submit immutable source to Vaettir's EC2 builder, without local Docker."""
import argparse
import hashlib
import json
import pathlib
import re
import subprocess
import tempfile
import time
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
ACCOUNT = "051722405355"
REGION = "us-east-2"
BUCKET = "vaettir-build-source-051722405355"
STACK = "vaettir-cloud-builder"


def aws(*args):
    return subprocess.check_output(["aws", "--profile", "vaettir-toolkit", "--region", REGION,
                                    "--no-cli-pager", *args], text=True)


def api(*args):
    return json.loads(aws(*args, "--output", "json"))


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def instance():
    stack = api("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]
    if stack["StackStatus"] not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
        raise RuntimeError("Builder stack is not ready: " + stack["StackStatus"])
    return next(output["OutputValue"] for output in stack["Outputs"] if output["OutputKey"] == "InstanceId")


def sha256(path):
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    submit = commands.add_parser("submit")
    submit.add_argument("commit", help="Full committed source SHA; never packages working-tree changes")
    submit.add_argument("--phase", choices=["prepare-native", "build-image"], required=True)
    status = commands.add_parser("status")
    status.add_argument("run_id")
    logs = commands.add_parser("logs")
    logs.add_argument("run_id")
    args = parser.parse_args()
    if args.command == "submit" and not re.fullmatch(r"[a-f0-9]{40}", args.commit):
        parser.error("Commit must be a full lowercase SHA")
    if args.command in ("status", "logs") and not re.fullmatch(r"[a-f0-9]{32}", args.run_id):
        parser.error("Run ID must be 32 lowercase hex characters")
    if api("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("Refusing a different AWS account")
    receipts = ROOT / ".local" / "assistant-history" / "cloud-builder"
    receipts.mkdir(parents=True, exist_ok=True)
    if args.command in ("status", "logs"):
        receipt = json.loads((receipts / (args.run_id + ".json")).read_text())
        if args.command == "logs":
            parameters = json.dumps({"commands": ["tail -n 20 /var/lib/vaettir-builder/jobs/" + args.run_id + "/build.log"]})
            response = api("ssm", "send-command", "--instance-ids", receipt["instance_id"],
                           "--document-name", "AWS-RunShellScript", "--parameters", parameters)
            command_id = response["Command"]["CommandId"]
            # The command may take a moment to become visible to GetCommandInvocation.
            time.sleep(2)
            for _ in range(30):
                command = api("ssm", "get-command-invocation", "--command-id", command_id,
                              "--instance-id", receipt["instance_id"])
                if command["Status"] not in ("Pending", "InProgress", "Delayed"):
                    print(command.get("StandardOutputContent", ""))
                    if command["Status"] != "Success":
                        raise RuntimeError(command.get("StandardErrorContent") or command["Status"])
                    return
                time.sleep(2)
            raise TimeoutError("Log request did not complete; SSM command " + command_id)
        command = api("ssm", "get-command-invocation", "--command-id", receipt["command_id"],
                      "--instance-id", receipt["instance_id"])
        print(json.dumps({key: command.get(key) for key in
                          ("Status", "ResponseCode", "StandardOutputContent", "StandardErrorContent")}, indent=2))
        if command["Status"] in ("Success", "Failed", "TimedOut", "Cancelled"):
            result_path = receipts / (args.run_id + "-result.json")
            aws("s3", "cp", "s3://" + BUCKET + "/cloud-builder/jobs/" + args.run_id + "/result.json", str(result_path))
            print(result_path.read_text())
        return

    resolved = git("rev-parse", "--verify", args.commit + "^{commit}").decode().strip()
    if resolved != args.commit:
        raise RuntimeError("Commit did not resolve exactly")
    worker = git("show", "HEAD:scripts/cloud-builder-worker.py")
    worker_sha = hashlib.sha256(worker).hexdigest()
    # Refuse obvious private session material before any source leaves this machine.
    paths = git("ls-tree", "-r", "--name-only", args.commit).decode().splitlines()
    private = [p for p in paths if ".local/assistant-history/" in p or
               re.search(r"(^|/)(sessions|transcripts)/|(^|/)rollout[^/]*\.jsonl$", p) or
               pathlib.PurePosixPath(p).name in (".env", ".env.local", ".env.production")]
    if private:
        raise RuntimeError("Review tracked private files before upload: " + ", ".join(private))
    host = instance()
    run_id = uuid.uuid4().hex
    prefix = "cloud-builder/jobs/" + run_id
    with tempfile.TemporaryDirectory(prefix="vaettir-cloud-", dir=receipts) as temp:
        directory = pathlib.Path(temp)
        archive = directory / "source.tar"
        subprocess.run(["git", "-C", str(ROOT), "archive", "--format=tar", "--output", str(archive), args.commit], check=True)
        (directory / "worker.py").write_bytes(worker)
        job = {"run_id": run_id, "commit": args.commit, "archive_sha256": sha256(archive),
               "account": ACCOUNT, "region": REGION, "phase": args.phase}
        (directory / "job.json").write_text(json.dumps(job))
        for name in ("source.tar", "worker.py", "job.json"):
            aws("s3", "cp", str(directory / name), "s3://" + BUCKET + "/" + prefix + "/" + name,
                "--sse", "AES256", "--only-show-errors")
    state = api("ec2", "describe-instances", "--instance-ids", host)["Reservations"][0]["Instances"][0]["State"]["Name"]
    if state == "stopped":
        api("ec2", "start-instances", "--instance-ids", host)
    elif state not in ("running", "pending"):
        raise RuntimeError("Builder is " + state + "; wait before retrying")
    deadline = time.monotonic() + 600
    while True:
        instances = api("ssm", "describe-instance-information", "--filters", "Key=InstanceIds,Values=" + host)["InstanceInformationList"]
        if instances and instances[0]["PingStatus"] == "Online":
            break
        if time.monotonic() >= deadline:
            raise TimeoutError("Builder did not become SSM-ready; inspect bootstrap and idle-stop status")
        time.sleep(10)
    # No unvalidated user text is interpolated into the remote shell command.
    download = ("import boto3,hashlib,pathlib; "
                "b=boto3.client('s3',region_name='us-east-2').get_object(Bucket='" + BUCKET +
                "',Key='" + prefix + "/worker.py')['Body'].read(); "
                "assert hashlib.sha256(b).hexdigest()=='" + worker_sha + "'; "
                "pathlib.Path('/var/lib/vaettir-builder/worker.py').write_bytes(b)")
    shell = "\n".join([
        "#!/bin/bash", "set -euo pipefail",
        "exec 9>/var/lock/vaettir-builder.lock", "flock -n 9 || exit 75",
        "for n in $(seq 1 120); do test -f /var/lib/vaettir-builder/ready && break; sleep 5; done",
        "test -f /var/lib/vaettir-builder/ready",
        "trap 'touch /var/lib/vaettir-builder/last-activity' EXIT",
        "python3 -c \"" + download + "\"",
        "timeout --kill-after=60 26000 python3 /var/lib/vaettir-builder/worker.py " + BUCKET + " " + run_id,
    ])
    parameters = json.dumps({"commands": [shell], "executionTimeout": ["27000"]})
    response = api("ssm", "send-command", "--instance-ids", host, "--document-name", "AWS-RunShellScript",
                   "--comment", "Vaettir " + args.phase + " " + args.commit,
                   "--parameters", parameters, "--timeout-seconds", "600")
    receipt = {**job, "instance_id": host, "command_id": response["Command"]["CommandId"],
               "worker_sha256": worker_sha, "log_uri": "s3://" + BUCKET + "/" + prefix + "/build.log"}
    (receipts / (run_id + ".json")).write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps(receipt, indent=2))


if __name__ == "__main__":
    main()
