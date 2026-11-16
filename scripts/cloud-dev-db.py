#!/usr/bin/env python3
"""Run a local Vaettir command against the isolated cloud development database."""
import argparse
import json
import os
import pathlib
import re
import shutil
import socket
import subprocess
import time
import urllib.parse
import uuid

ROOT = pathlib.Path(__file__).resolve().parents[1]
PROFILE = "vaettir-toolkit"
REGION = "us-east-2"
ACCOUNT = "051722405355"
STACK = "vaettir-dev-database"
PORT = 15432


def aws(*args):
    return subprocess.check_output(["aws", "--profile", PROFILE, "--region", REGION,
                                    "--no-cli-pager", *args], text=True)


def api(*args):
    return json.loads(aws(*args, "--output", "json"))


def validate_database(cluster, outputs):
    tags = {tag["Key"]: tag["Value"] for tag in cluster.get("TagList", [])}
    if (cluster.get("DatabaseName") != "vaettir_dev" or tags.get("Environment") != "development"
            or tags.get("Project") != "Vaettir" or cluster.get("Engine") != "aurora-postgresql"
            or cluster.get("Endpoint") != outputs["DatabaseHost"]
            or cluster.get("MasterUserSecret", {}).get("SecretArn") != outputs["SecretArn"]):
        raise RuntimeError("Refusing a database that is not the isolated Vaettir development cluster")


def connection_url(secret):
    if secret.get("username") != "vaettir_dev_admin" or not secret.get("password"):
        raise ValueError("Unexpected development credential shape")
    user = urllib.parse.quote(secret["username"], safe="")
    password = urllib.parse.quote(secret["password"], safe="")
    return f"postgresql://{user}:{password}@127.0.0.1:{PORT}/vaettir_dev?sslmode=require&connect_timeout=60&pool_timeout=60"


def child_environment(base, secret):
    environment = base.copy()
    environment["DATABASE_URL"] = connection_url(secret)
    environment["DB_SECRET_ID"] = ""
    environment["NODE_ENV"] = "development"
    return environment


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("action", choices=["run"])
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()
    command = args.command[1:] if args.command[:1] == ["--"] else args.command
    if not command:
        parser.error("Supply a command after run --")
    origin = subprocess.check_output(["git", "remote", "get-url", "origin"], text=True).strip()
    if origin not in ("https://github.com/Skaldandstone/Vaettir.git", "https://github.com/Skaldandstone/Vaettir",
                      "git@github.com:Skaldandstone/Vaettir.git"):
        raise RuntimeError("Run this helper from the verified Vaettir checkout")
    if api("sts", "get-caller-identity")["Account"] != ACCOUNT:
        raise RuntimeError("Wrong AWS account")
    plugin = shutil.which("session-manager-plugin")
    if not plugin and os.name == "nt":
        candidate = pathlib.Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Amazon/SessionManagerPlugin/bin/session-manager-plugin.exe"
        if candidate.is_file():
            plugin = str(candidate)
    if not plugin:
        raise RuntimeError("Install the official AWS Session Manager plugin before connecting")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", PORT))
    stack = api("cloudformation", "describe-stacks", "--stack-name", STACK)["Stacks"][0]
    if stack["StackStatus"] not in ("CREATE_COMPLETE", "UPDATE_COMPLETE"):
        raise RuntimeError("Development stack is not ready")
    outputs = {value["OutputKey"]: value["OutputValue"] for value in stack["Outputs"]}
    cluster = api("rds", "describe-db-clusters", "--db-cluster-identifier", outputs["ClusterId"])["DBClusters"][0]
    validate_database(cluster, outputs)
    host = outputs["AccessInstanceId"]
    instance = api("ec2", "describe-instances", "--instance-ids", host)["Reservations"][0]["Instances"][0]
    state = instance["State"]["Name"]
    if state == "stopped":
        api("ec2", "start-instances", "--instance-ids", host)
    elif state not in ("running", "pending"):
        raise RuntimeError("Access host is " + state + "; wait before retrying")
    if state in ("stopped", "pending"):
        aws("ec2", "wait", "instance-status-ok", "--instance-ids", host)
    deadline = time.monotonic() + 600
    while True:
        info = api("ssm", "describe-instance-information", "--filters", "Key=InstanceIds,Values=" + host)["InstanceInformationList"]
        if info and info[0]["PingStatus"] == "Online":
            break
        if time.monotonic() > deadline:
            raise TimeoutError("Development access host did not become ready")
        time.sleep(10)
    environment = os.environ.copy()
    environment["PATH"] = str(pathlib.Path(plugin).parent) + os.pathsep + environment.get("PATH", "")
    parameters = json.dumps({"host": [outputs["DatabaseHost"]], "portNumber": ["5432"], "localPortNumber": [str(PORT)]})
    log_dir = ROOT / ".local/assistant-history/cloud-dev-db"
    log_dir.mkdir(parents=True, exist_ok=True)
    log_path = log_dir / (uuid.uuid4().hex + "-tunnel.log")
    tunnel = None
    session_id = None
    try:
        with log_path.open("w") as log:
            tunnel = subprocess.Popen(["aws", "--profile", PROFILE, "--region", REGION,
                "ssm", "start-session", "--target", host, "--document-name",
                "AWS-StartPortForwardingSessionToRemoteHost", "--parameters", parameters],
                env=environment, stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT)
            deadline = time.monotonic() + 120
            while True:
                text = log_path.read_text(errors="replace")
                match = re.search(r"Starting session with SessionId:\s*([\w-]+)", text)
                if match:
                    session_id = match.group(1)
                if tunnel.poll() is not None:
                    raise RuntimeError("Tunnel exited; inspect " + str(log_path))
                if session_id:
                    try:
                        with socket.create_connection(("127.0.0.1", PORT), timeout=1):
                            break
                    except OSError:
                        pass
                if time.monotonic() > deadline:
                    raise TimeoutError("Tunnel did not open; inspect " + str(log_path))
                time.sleep(1)
            # Credentials are read into memory and passed only to this child process.
            # They are never printed, written to .env, or placed in command arguments.
            secret = json.loads(api("secretsmanager", "get-secret-value", "--secret-id", outputs["SecretArn"])["SecretString"])
            environment = child_environment(environment, secret)
            print("Using the isolated cloud development database via localhost:" + str(PORT), flush=True)
            executable = shutil.which(command[0])
            if not executable:
                raise RuntimeError("Command is not installed: " + command[0])
            result = subprocess.run([executable, *command[1:]], env=environment)
            raise SystemExit(result.returncode)
    finally:
        if session_id:
            try:
                api("ssm", "terminate-session", "--session-id", session_id)
            except subprocess.CalledProcessError:
                print("Session cleanup failed; inspect active SSM session " + session_id)
        if tunnel and tunnel.poll() is None:
            try:
                tunnel.wait(timeout=10)
            except subprocess.TimeoutExpired:
                if os.name == "nt":
                    subprocess.run(["taskkill", "/PID", str(tunnel.pid), "/T", "/F"],
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                else:
                    tunnel.terminate()


if __name__ == "__main__":
    main()
