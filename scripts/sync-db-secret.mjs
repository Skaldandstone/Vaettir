#!/usr/bin/env node
// Re-syncs the app's composed DATABASE_URL secret (vaettir/database-url)
// with the RDS-managed master password after AWS rotates it.
//
// Why this exists: vaettir-postgres uses an RDS-managed master password,
// which AWS rotates automatically every 7 days. The API doesn't read that
// secret directly - Prisma wants one URL, so vaettir/database-url is a
// static composed connection string. Every rotation therefore breaks
// production DB auth until this is run (first observed 2026-09-09; see
// docs/AWS_DEPLOYMENT.md "Secrets Manager").
//
// Usage (from anywhere, with the vaettir-toolkit AWS CLI profile signed in):
//   node scripts/sync-db-secret.mjs            # dry run: reports whether they differ
//   node scripts/sync-db-secret.mjs --apply    # writes the new URL, then force-redeploy vaettir-api
//
// Never prints either secret value - only usernames, host, and a boolean.
import { execFileSync } from "node:child_process";

const REGION = "us-east-2";
const PROFILE = "vaettir-toolkit";
const MANAGED_SECRET_ID = "rds!db-dba51c29-3609-42ea-918d-93601192db7d";
const APP_SECRET_ID = "vaettir/database-url";

function aws(args) {
  return execFileSync("aws", [...args, "--region", REGION, "--profile", PROFILE, "--output", "json"], { encoding: "utf8" });
}
function getSecretString(id) {
  return JSON.parse(aws(["secretsmanager", "get-secret-value", "--secret-id", id])).SecretString;
}

const managed = JSON.parse(getSecretString(MANAGED_SECRET_ID));
const url = new URL(getSecretString(APP_SECRET_ID));

const report = {
  appUser: url.username,
  managedUser: managed.username,
  host: url.hostname,
  port: url.port,
  database: url.pathname,
  query: url.search,
};
if (url.username !== managed.username) {
  console.log(JSON.stringify({ abort: "username mismatch - refusing to write", report }, null, 2));
  process.exit(1);
}
report.passwordDiffered = url.password !== encodeURIComponent(managed.password);

if (process.argv.includes("--apply")) {
  if (!report.passwordDiffered) {
    report.applied = false;
    report.note = "already in sync - nothing written";
  } else {
    url.password = encodeURIComponent(managed.password);
    const out = JSON.parse(aws(["secretsmanager", "put-secret-value", "--secret-id", APP_SECRET_ID, "--secret-string", url.toString()]));
    report.applied = true;
    report.newVersionId = out.VersionId;
    report.next = "aws ecs update-service --cluster vaettir-cluster --service vaettir-api --force-new-deployment --region us-east-2 --profile vaettir-toolkit";
  }
} else if (report.passwordDiffered) {
  report.next = "re-run with --apply, then force a new vaettir-api deployment";
}

console.log(JSON.stringify(report, null, 2));
