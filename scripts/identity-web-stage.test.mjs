import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, linkSync, symlinkSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { prepareIdentityWebStage, verifyIdentityWebStage } from "./identity-web-stage.mjs";

const sha256 = value => createHash("sha256").update(value).digest("hex");
const rejection = /^Error: Identity web staging refused\. Review the candidate, target pins and clean environment\.$/;

function fixture() {
  const base = mkdtempSync(path.join(os.tmpdir(), "vaettir-identity-web-stage-"));
  const sourceRoot = path.join(base, "candidate");
  mkdirSync(sourceRoot);
  const content = {
    "apps/web/package.json": '{"name":"synthetic-not-the-app"}',
    "apps/web/next.config.mjs": "export default {};",
    "apps/web/app/layout.tsx": "// synthetic source; never imported",
    "apps/web/middleware.ts": "// synthetic source; never imported",
    "apps/web/node_modules/next/dist/bin/next": "throw new Error('must never execute');",
  };
  const files = Object.entries(content).map(([name, value]) => {
    mkdirSync(path.dirname(path.join(sourceRoot, name)), { recursive: true });
    writeFileSync(path.join(sourceRoot, name), value);
    return { path: name, sha256: sha256(value) };
  });
  const issuer = "https://identity-stage-synthetic.clerk.accounts.dev";
  // These strings are deliberately synthetic, not keys obtained from a provider.
  const secret = "sk_test_SyntheticNeverACredential";
  const publishable = `pk_test_${Buffer.from(`${new URL(issuer).hostname}$`).toString("base64")}`;
  const manifest = { version: 1, reviewReference: "synthetic-local-test-only", sourceCommit: "1".repeat(40),
    applicationId: "app_synthetic", developmentInstanceId: "ins_synthetic", organizationId: "org_synthetic",
    nativeOrganizationId: "syntheticWorkspace", issuer,
    secretKeySha256: sha256(secret), publishableKeySha256: sha256(publishable), files };
  const environment = {
    NODE_ENV: "development", NEXT_TELEMETRY_DISABLED: "1", NEXT_PUBLIC_API_URL: "http://127.0.0.1:4208",
    VAETTIR_PUBLIC_ORIGIN: "http://localhost:3208", NEXT_PUBLIC_CLERK_SIGN_IN_URL: "/sign-in",
    NEXT_PUBLIC_CLERK_SIGN_UP_URL: "/sign-up", NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED: "0",
    NEXT_PUBLIC_VAETTIR_WORKSPACE_AUTH_ENABLED: "0", CLERK_SECRET_KEY: secret,
    NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: publishable,
  };
  function input() {
    const manifestText = JSON.stringify(manifest);
    return { sourceRoot, destinationRoot: path.join(base, "stage"), manifestText,
      approvedManifestSha256: sha256(manifestText), environment };
  }
  return { base, sourceRoot, manifest, environment, input };
}

test("copies only pinned materialized bytes, returns loopback argv, never starts the executable or leaks keys", () => {
  const f = fixture();
  const before = { ...f.environment };
  const receipt = prepareIdentityWebStage(f.input());
  assert.equal(receipt.runtimeStarted, false);
  assert.equal(receipt.filesVerified, 5);
  assert.deepEqual(receipt.nextArguments.slice(-4), ["--hostname", "127.0.0.1", "--port", "3208"]);
  assert.equal(receipt.organizationId, f.manifest.organizationId);
  assert.equal(receipt.sourceCommit, f.manifest.sourceCommit);
  assert.deepEqual(f.environment, before);
  assert.ok(!JSON.stringify(receipt).includes(f.environment.CLERK_SECRET_KEY));
  assert.ok(!JSON.stringify(receipt).includes(f.environment.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY));
  for (const file of f.manifest.files) assert.equal(sha256(readFileSync(path.join(f.input().destinationRoot, file.path))), file.sha256);
});

test("refuses inherited secrets, loaders, proxy, SDK settings and case aliases before staging", () => {
  for (const name of ["NODE_OPTIONS", "NODE_PATH", "DATABASE_URL", "AWS_PROFILE", "GOOGLE_APPLICATION_CREDENTIALS",
    "SENTRY_AUTH_TOKEN", "HTTPS_PROXY", "HOME", "USERPROFILE", "__NEXT_PROCESSED_ENV", "NEXT_PUBLIC_CLERK_PROXY_URL", "node_env"]) {
    const f = fixture();
    f.environment[name] = "";
    assert.throws(() => prepareIdentityWebStage(f.input()), rejection, name);
    assert.equal(existsSync(f.input().destinationRoot), false);
  }
  const f = fixture();
  f.environment.NODE_OPTIONS = undefined;
  assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
});

test("rejects endpoint, issuer/key and fixture target drift including a modified manifest", () => {
  for (const [key, value] of Object.entries({ NODE_ENV: "production", NEXT_PUBLIC_API_URL: "https://example.invalid/api",
    VAETTIR_PUBLIC_ORIGIN: "http://localhost:3000", NEXT_PUBLIC_VAETTIR_PRIMARY_AUTH_ENABLED: "1",
    CLERK_SECRET_KEY: "sk_live_NoCredential", NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_test_YW5vdGhlciQ=" })) {
    const f = fixture(); f.environment[key] = value;
    assert.throws(() => prepareIdentityWebStage(f.input()), rejection, key);
  }
  const f = fixture(); const original = f.input();
  f.manifest.organizationId = "org_another";
  assert.throws(() => prepareIdentityWebStage({ ...f.input(), approvedManifestSha256: original.approvedManifestSha256 }), rejection);
  f.manifest.nativeOrganizationId = 12345678;
  assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
});

test("refuses any project environment file even when it is included in the reviewed inventory", () => {
  for (const filename of [".env", "apps/web/.env.local", "apps/web/.env.development", "apps/web/.env.development.local", "apps/web/.ENV.local"]) {
    const f = fixture(); const value = "NEXT_PUBLIC_API_URL=https://not-approved.invalid\n";
    writeFileSync(path.join(f.sourceRoot, filename), value);
    f.manifest.files.push({ path: filename, sha256: sha256(value) });
    assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
    assert.equal(existsSync(f.input().destinationRoot), false);
  }
});

test("does not reuse a build, hidden credential directory, unlisted byte or edited source", () => {
  for (const directory of [".next", ".aws", ".git", ".local", ".config"]) {
    const f = fixture(); mkdirSync(path.join(f.sourceRoot, "apps/web", directory));
    assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
  }
  const f = fixture(); writeFileSync(path.join(f.sourceRoot, "unlisted.txt"), "no");
  assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
  const g = fixture(); writeFileSync(path.join(g.sourceRoot, g.manifest.files[0].path), "changed");
  assert.throws(() => prepareIdentityWebStage(g.input()), rejection);
});

test("rejects traversal, Windows aliases, duplicate case paths and incomplete or unexpected manifest fields", () => {
  for (const filename of ["../escape", "C:/escape", "apps\\web\\escape", "apps/web/CON", "apps/web/name.", "apps/web/name ", "apps//web/foo", "apps/web/key:stream", "/absolute"]) {
    const f = fixture(); f.manifest.files[0].path = filename;
    assert.throws(() => prepareIdentityWebStage(f.input()), rejection, filename);
  }
  const f = fixture(); f.manifest.files.push({ ...f.manifest.files[0], path: "APPS/WEB/PACKAGE.JSON" });
  assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
  const g = fixture(); delete g.manifest.organizationId;
  assert.throws(() => prepareIdentityWebStage(g.input()), rejection);
  const h = fixture(); h.manifest.allowProduction = true;
  assert.throws(() => prepareIdentityWebStage(h.input()), rejection);
  const i = fixture(); i.manifest.files.pop();
  assert.throws(() => prepareIdentityWebStage(i.input()), rejection);
});

test("refuses symlinked candidates, linked dependencies and hardlinked bytes", () => {
  const f = fixture(); const linked = path.join(f.base, "linked");
  symlinkSync(f.sourceRoot, linked, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => prepareIdentityWebStage({ ...f.input(), sourceRoot: linked }), rejection);
  const g = fixture();
  symlinkSync(g.base, path.join(g.sourceRoot, "store"), process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => prepareIdentityWebStage(g.input()), rejection);
  const h = fixture(); linkSync(path.join(h.sourceRoot, h.manifest.files[0].path), path.join(h.base, "hardlink"));
  assert.throws(() => prepareIdentityWebStage(h.input()), rejection);
});

test("never overwrites or stages inside the source, and detects post-copy drift on re-verification", () => {
  const f = fixture(); const input = f.input(); mkdirSync(input.destinationRoot);
  const sentinel = path.join(input.destinationRoot, "preserved"); writeFileSync(sentinel, "retain");
  assert.throws(() => prepareIdentityWebStage(input), rejection);
  assert.equal(readFileSync(sentinel, "utf8"), "retain");
  assert.throws(() => prepareIdentityWebStage({ ...input, destinationRoot: path.join(f.sourceRoot, "stage") }), rejection);
  const g = fixture(); const ready = g.input(); prepareIdentityWebStage(ready);
  writeFileSync(path.join(ready.destinationRoot, "apps/web/.env.local"), "SYNTHETIC_POISON=1");
  assert.throws(() => verifyIdentityWebStage({ ...ready, stageRoot: ready.destinationRoot }), rejection);
});

test("refuses fallback dependencies and environment files in stage ancestors", () => {
  for (const name of ["node_modules", ".env.local"]) {
    const f = fixture();
    if (name === "node_modules") mkdirSync(path.join(f.base, name));
    else writeFileSync(path.join(f.base, name), "SYNTHETIC_POISON=1");
    assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
    assert.equal(existsSync(f.input().destinationRoot), false);
  }
});

test("actual installed Next env loader demonstrates contamination; stage gate refuses it without importing Next", () => {
  const f = fixture();
  const webRequire = createRequire(new URL("../apps/web/package.json", import.meta.url));
  const nextRequire = createRequire(webRequire.resolve("next/package.json"));
  const envModule = nextRequire.resolve("@next/env");
  const marker = "synthetic-foreign-environment";
  writeFileSync(path.join(f.sourceRoot, "apps/web/.env.development.local"), `VAETTIR_SYNTHETIC_ENV_PROBE=${marker}\n`);
  const script = `const {loadEnvConfig}=require(${JSON.stringify(envModule)});loadEnvConfig(${JSON.stringify(path.join(f.sourceRoot, "apps/web"))},true,{info(){},error(){}});process.stdout.write(process.env.VAETTIR_SYNTHETIC_ENV_PROBE || 'absent');`;
  const child = spawnSync(process.execPath, ["-e", script], { env: { NODE_ENV: "development" }, encoding: "utf8" });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, marker);
  assert.throws(() => prepareIdentityWebStage(f.input()), rejection);
  assert.equal(existsSync(f.input().destinationRoot), false);
});
