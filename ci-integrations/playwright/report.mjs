#!/usr/bin/env node
// P5-15: run after `playwright test` (with vaettir-reporter.mjs configured
// as one of its reporters) to do the actual reporting - ingest the JUnit
// XML vaettir-reporter.mjs wrote, then upload every failed test's
// screenshot/video attachments and link them to the right TestResult.
//
// Required env vars: VAETTIR_API_URL, VAETTIR_API_KEY, VAETTIR_PROJECT_ID,
// VAETTIR_COMMIT_SHA, VAETTIR_BRANCH. Optional: VAETTIR_CI_PROVIDER
// (defaults to "playwright"), VAETTIR_JUNIT_PATH / VAETTIR_MANIFEST_PATH
// (must match vaettir-reporter.mjs's options if customized there).
//
// Usage:
//   npx playwright test --reporter=./ci-integrations/playwright/vaettir-reporter.mjs
//   node ci-integrations/playwright/report.mjs
import { readFileSync } from "node:fs";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name}`);
  return value;
}

const apiUrl = requireEnv("VAETTIR_API_URL").replace(/\/$/, "");
const apiKey = requireEnv("VAETTIR_API_KEY");
const projectId = requireEnv("VAETTIR_PROJECT_ID");
const commitSha = requireEnv("VAETTIR_COMMIT_SHA");
const branch = requireEnv("VAETTIR_BRANCH");
const ciProvider = process.env.VAETTIR_CI_PROVIDER ?? "playwright";
const junitPath = process.env.VAETTIR_JUNIT_PATH ?? "vaettir-junit.xml";
const manifestPath = process.env.VAETTIR_MANIFEST_PATH ?? "vaettir-artifacts-manifest.json";

async function trpc(procedure, input, method = "POST") {
  const url = method === "GET" ? `${apiUrl}/trpc/${procedure}?input=${encodeURIComponent(JSON.stringify(input))}` : `${apiUrl}/trpc/${procedure}`;
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: method === "POST" ? JSON.stringify(input) : undefined,
  });
  const body = await res.json();
  if (!res.ok || body.error) throw new Error(body.error?.message ?? `HTTP ${res.status}`);
  return body.result.data;
}

const junitXml = readFileSync(junitPath, "utf8");
const ingestResult = await trpc("testRuns.ingestJUnit", { projectId, ciProvider, commitSha, branch, junitXml });
console.log(`Reported ${ingestResult.totalResults} results to Vaettir (run ${ingestResult.testRunId}).`);

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (manifest.length === 0) {
  console.log("No failed tests with captured artifacts.");
  process.exit(0);
}

const run = await trpc("testRuns.byId", { id: ingestResult.testRunId }, "GET");
const resultIdByExternalId = new Map(run.results.map((r) => [r.externalTestId, r.id]));

let uploaded = 0;
for (const entry of manifest) {
  const testResultId = resultIdByExternalId.get(entry.externalTestId);
  if (!testResultId) {
    console.warn(`No TestResult found for ${entry.externalTestId}, skipping its artifacts.`);
    continue;
  }
  for (const file of entry.files) {
    const { artifactId, uploadUrl } = await trpc("testRuns.requestArtifactUpload", { testResultId, type: file.type });
    const bytes = readFileSync(file.path);
    const putRes = await fetch(uploadUrl, {
      method: "PUT",
      headers: { "Content-Type": file.type === "VIDEO" ? "video/mp4" : "image/png" },
      body: bytes,
    });
    if (!putRes.ok) {
      console.warn(`Upload failed for ${file.path} (artifact ${artifactId}): HTTP ${putRes.status}`);
      continue;
    }
    uploaded++;
  }
}
console.log(`Uploaded ${uploaded} artifact(s).`);
