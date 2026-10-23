import assert from "node:assert/strict";
import { test } from "node:test";
import { readConfig, readSummary } from "../server/client.mjs";

const token = "vai_" + "a".repeat(64);
const config = readConfig({
  VAETTIR_AI_BASE_URL: "https://vaettir.example",
  VAETTIR_AI_TOKEN: token,
});
const summary = {
  policyVersion: 1,
  disclosure: "aggregate_counts",
  classification: "SYNTHETIC",
  suppressed: false,
  counts: { testCases: 100, testPlans: 20, testRuns: 50 },
};

test("configuration denies missing/general credentials and unsafe origins", () => {
  assert.equal(readConfig({}), null);
  for (const url of [
    "http://vaettir.example",
    "https://user:password@vaettir.example",
    "https://vaettir.example/api",
    "https://vaettir.example?token=secret",
    "https://vaettir.example/#secret",
  ]) {
    assert.equal(
      readConfig({ VAETTIR_AI_BASE_URL: url, VAETTIR_AI_TOKEN: token }),
      null,
    );
  }
  assert.equal(
    readConfig({
      VAETTIR_AI_BASE_URL: "https://vaettir.example",
      VAETTIR_AI_TOKEN: "vt_general",
    }),
    null,
  );
});

test("only calls the dedicated gateway and disallows redirects", async () => {
  const actual = await readSummary(config, "project1", async (url, options) => {
    assert.equal(
      url.href,
      "https://vaettir.example/api/integrations/ai/v1/project-summary?projectId=project1",
    );
    assert.equal(options.method, "GET");
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.redirect, "error");
    assert.equal(options.cache, "no-store");
    return Response.json(summary);
  });
  assert.deepEqual(actual, summary);
});

test("refuses unconfigured calls without making a request", async () => {
  await assert.rejects(
    readSummary(null, "project1", () => assert.fail("network call")),
    /not configured/,
  );
});

test("does not send malformed project identities", async () => {
  for (const id of [
    "p/../trpc/testCases.list",
    "p1&includeContent=true",
    "",
    "a".repeat(101),
  ]) {
    await assert.rejects(
      readSummary(config, id, () => assert.fail("network call")),
    );
  }
});

test("refuses free text, extra keys, unsafe counts, and classification drift", async () => {
  const candidates = [
    { ...summary, title: "CUSTOMER_SECRET" },
    {
      ...summary,
      counts: { ...summary.counts, patientName: "PATIENT_CANARY" },
    },
    { ...summary, counts: { ...summary.counts, testCases: 1 } },
    { ...summary, counts: { ...summary.counts, testCases: -1 } },
    { ...summary, classification: "CUSTOMER_PROPRIETARY" },
    { ...summary, suppressed: true },
    { ...summary, policyVersion: 2 },
  ];
  for (const body of candidates) {
    await assert.rejects(
      readSummary(config, "project1", async () => Response.json(body)),
      { message: "Vaettir AI read unavailable or not permitted." },
    );
  }
});

test("does not surface error bodies or transport exceptions", async () => {
  for (const response of [
    () =>
      new Response("PATIENT_CANARY CUSTOMER_SECRET " + token, { status: 403 }),
    () =>
      new Response("PATIENT_CANARY", {
        headers: { "content-type": "text/html" },
      }),
    () =>
      new Response("x".repeat(4097), {
        headers: { "content-type": "application/json" },
      }),
    () => {
      throw new Error("Authorization: " + token);
    },
    () =>
      new Response("bad JSON CUSTOMER_SECRET", {
        headers: { "content-type": "application/json" },
      }),
  ]) {
    await assert.rejects(
      readSummary(config, "project1", async () => response()),
      { message: "Vaettir AI read unavailable or not permitted." },
    );
  }
});

test("accepts a suppressed response without reconstructing counts", async () => {
  const body = { ...summary, suppressed: true, counts: null };
  assert.deepEqual(
    await readSummary(config, "project1", async () => Response.json(body)),
    body,
  );
});
