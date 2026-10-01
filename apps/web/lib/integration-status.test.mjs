import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { integrationStatus } from "./integration-status.ts";

test("saved integration settings never establish connected or verified access", () => {
  for (const kind of ["slack", "webhook", "tickets", "signal"]) {
    assert.equal(integrationStatus({ configured: false, kind }).label, "Not configured");
    const status = integrationStatus({ configured: true, kind });
    assert.match(status.label, /unverified/);
    assert.equal(status.tone, "neutral");
    assert.doesNotMatch(status.label, /Connected|Access verified/);
  }
});

test("historical evidence is qualified and delivery failure is never hidden", () => {
  const observedAt = "2026-09-30T12:00:00Z";
  assert.equal(integrationStatus({ configured: true, kind: "tickets", observedAt }).label, "Status sync recorded");
  assert.equal(integrationStatus({ configured: true, kind: "slack", observedAt }).label, "Digest sent previously");
  assert.deepEqual(integrationStatus({ configured: true, kind: "webhook", observedAt, deliverySucceeded: false }), { label: "Last delivery failed", tone: "warning" });
  assert.deepEqual(integrationStatus({ configured: true, kind: "webhook", observedAt, deliverySucceeded: true }), { label: "Last delivery succeeded", tone: "success" });
  assert.equal(integrationStatus({ configured: true, kind: "webhook", observedAt, deliverySucceeded: null }).label, "Configured · Delivery unverified");
  assert.equal(integrationStatus({ configured: true, kind: "signal", webhookRequired: true }).label, "Webhook setup required");
  assert.equal(integrationStatus({ configured: true, kind: "tickets", observedAt: "invalid date" }).label, "Configured · Access unverified");
});

test("integration project actions open scoped source modules in place with honest legacy counts", () => {
  const page = readFileSync(new URL("../app/settings/integrations/page.tsx", import.meta.url), "utf8");
  assert.match(page, /<Modal open=\{Boolean\(active\)\}/);
  assert.match(page, /project\.list\.useQuery/);
  assert.match(page, /selectedProject = projectsQuery\.isSuccess \? projectsQuery\.data\?\.find/);
  assert.match(page, /projectsQuery\.isSuccess && projectsQuery\.data\?\.map/);
  assert.match(page, /<SourceConnectionChips projectId=\{selectedProject\.id\}/);
  assert.match(page, /<ProductionSignalChips projectId=\{selectedProject\.id\}/);
  assert.match(page, /Choose another project/);
  assert.match(page, /Could not load projects/);
  assert.match(page, /not included in the legacy counts/);
  assert.doesNotMatch(page, /row\.configured \? "Connected"/);
  assert.doesNotMatch(page, /href=\{row\.href\}/);
});

test("registered repository chips open existing provider flows only for editors", () => {
  const component = readFileSync(new URL("../components/ProjectRepositories.tsx", import.meta.url), "utf8");
  assert.match(component, /canEdit&&knownProvider\?<button/);
  assert.match(component, /onClick=\{\(\)=>setProvider\(knownProvider\)\}/);
  assert.match(component, /Registered · Access unverified/);
  assert.match(component, /<RepositoryConnectionContent key=\{provider\} projectId=\{projectId\}/);
  assert.match(component, /query\.refetch\(\)/);
});
