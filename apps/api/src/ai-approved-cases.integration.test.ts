import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { classifyAiProject, changeAiGrant, issueAiGrant } from "./services/aiDisclosureAdmin.js";
import { previewAiCases, issueAiCaseGrant } from "./services/aiCaseDisclosureAdmin.js";
import { readAiApprovedCases } from "./services/aiCaseDisclosureGateway.js";
import { readAiProjectSummary } from "./services/aiDisclosureGateway.js";
import { createAiDisclosureStore } from "./services/aiDisclosureStore.js";
import { registerAiDisclosureRoute } from "./services/aiDisclosureRoute.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated = process.env.VAETTIR_AI_CASE_DB_TEST === "1" && url && ["127.0.0.1", "localhost"].includes(url.hostname) && (/^\/vaettir_ai_approved_\d+_test$/.test(url.pathname) || (process.env.CI === "true" && url.pathname === "/vaettir_test")) && !url.searchParams.has("host");
async function fixture() {
  const key = "ai-selected-" + randomUUID();
  const tier = await prisma.planTier.findUniqueOrThrow({ where: { key: "free" } });
  const org = await prisma.organization.create({ data: { name: key, slug: key, planTierId: tier.id } });
  const user = await prisma.user.create({ data: { clerkUserId: key, email: key + "@example.invalid", memberships: { create: { organizationId: org.id, role: "OWNER", seatType: "FULL" } } }, include: { memberships: true } });
  const project = await prisma.project.create({ data: { organizationId: org.id, name: "Synthetic case disclosure", slug: key } });
  const testCase = await prisma.testCase.create({ data: { projectId: project.id, title: "SYNTHETIC_APPROVED_TITLE", given: ["UNSELECTED_PRIVATE_GIVEN"], when: ["Open synthetic page"], then: ["Page appears"], testType: "FUNCTIONAL", tags: [] } });
  const actor = { prisma, user, authenticatedClerkSubject: user.clerkUserId, workspaceOrganizationId: org.id };
  const scope = { organizationId: org.id, projectId: project.id };
  process.env.VAETTIR_AI_DISCLOSURE_ENABLED = "1";
  process.env.VAETTIR_AI_CASE_DISCLOSURE_ENABLED = "1";
  process.env.VAETTIR_AI_DISCLOSURE_PROJECTS = JSON.stringify([scope]);
  await classifyAiProject(actor, { ...scope, requestId: randomUUID(), expectedVersion: 0, classification: "CUSTOMER_PROPRIETARY", attestSynthetic: false });
  const previewInput = { ...scope, expectedPolicyVersion: 1, caseIds: [testCase.id], fields: ["title" as const, "when" as const] };
  const preview = await previewAiCases(actor, previewInput);
  const input = { ...previewInput, requestId: randomUUID(), previewDigest: preview.digest, lifetimeDays: 1, approveDisclosure: true as const, attestNoRegulatedData: true as const };
  return { org, user, project, testCase, actor, scope, previewInput, input, store: createAiDisclosureStore(prisma) };
}
describe.skipIf(!isolated)("selected-case durable approval on isolated PostgreSQL", () => {
  afterAll(async () => { await prisma.$disconnect(); });
  it("releases the exact projection and persists metadata, never a second content copy", async () => {
    const f = await fixture(), grant = await issueAiCaseGrant(f.actor, f.input);
    const result = await readAiApprovedCases(f.store, grant.token!, f.project.id);
    expect(result.snapshot.cases).toEqual([{ id: f.testCase.id, title: f.testCase.title, when: f.testCase.when }]);
    const stored = await prisma.aiDisclosureCaseSnapshot.findUniqueOrThrow({ where: { grantId: grant.grantId! } });
    expect(JSON.stringify(stored)).not.toMatch(/SYNTHETIC_APPROVED_TITLE|PRIVATE_GIVEN|Open synthetic/);
    const replay = await issueAiCaseGrant(f.actor, f.input);
    expect(replay).toMatchObject({ grantId: grant.grantId, replayed: true, token: null });
    expect(await prisma.aiDisclosureGrant.count({ where: f.scope })).toBe(1);
    await expect(readAiProjectSummary(f.store, grant.token!, f.project.id)).rejects.toThrow();
    await expect(prisma.aiDisclosureCaseSnapshot.update({ where: { grantId: grant.grantId! }, data: { digest: "a".repeat(64) } })).rejects.toThrow();
    const audit = await prisma.aiDisclosureAudit.findMany({ where: f.scope });
    expect(JSON.stringify(audit)).not.toMatch(/SYNTHETIC_APPROVED_TITLE|PRIVATE_GIVEN|vai_/);
  });
  it("refuses stale previews and changed or archived source cases without disclosing new text", async () => {
    const f = await fixture();
    await prisma.testCase.update({ where: { id: f.testCase.id }, data: { title: "CHANGED_BEFORE_ISSUE" } });
    await expect(issueAiCaseGrant(f.actor, f.input)).rejects.toThrow(/Preview|changed/);
    const preview = await previewAiCases(f.actor, f.previewInput);
    const grant = await issueAiCaseGrant(f.actor, { ...f.input, requestId: randomUUID(), previewDigest: preview.digest });
    await prisma.testCase.update({ where: { id: f.testCase.id }, data: { title: "NEVER_APPROVED_TEXT" } });
    await expect(readAiApprovedCases(f.store, grant.token!, f.project.id)).rejects.toThrow();
    await prisma.testCase.update({ where: { id: f.testCase.id }, data: { title: "CHANGED_BEFORE_ISSUE", archived: true } });
    await expect(readAiApprovedCases(f.store, grant.token!, f.project.id)).rejects.toThrow();
    expect(await prisma.aiDisclosureAudit.count({ where: { ...f.scope, event: "DENY" } })).toBe(2);
  });
  it("permanently revokes on administrator withdrawal, even after reinstatement", async () => {
    const f = await fixture(), grant = await issueAiCaseGrant(f.actor, f.input);
    await prisma.membership.update({ where: { organizationId_userId: { userId: f.user.id, organizationId: f.org.id } }, data: { role: "VIEWER" } });
    await prisma.membership.update({ where: { organizationId_userId: { userId: f.user.id, organizationId: f.org.id } }, data: { role: "OWNER" } });
    await expect(readAiApprovedCases(f.store, grant.token!, f.project.id)).rejects.toThrow();
    expect((await prisma.aiDisclosureGrant.findUniqueOrThrow({ where: { id: grant.grantId! } })).revokedAt).not.toBeNull();
  });
  it("enforces exact tenant, explicit attestation, classification and revocation", async () => {
    const f = await fixture();
    await expect(issueAiCaseGrant(f.actor, { ...f.input, attestNoRegulatedData: false } as never)).rejects.toThrow();
    await expect(previewAiCases({ ...f.actor, workspaceOrganizationId: "foreign" }, f.previewInput)).rejects.toThrow();
    const grant = await issueAiCaseGrant(f.actor, f.input);
    await changeAiGrant(f.actor, { ...f.scope, requestId: randomUUID(), grantId: grant.grantId!, expectedVersion: grant.grantVersion! }, false);
    await expect(readAiApprovedCases(f.store, grant.token!, f.project.id)).rejects.toThrow();
    await classifyAiProject(f.actor, { ...f.scope, requestId: randomUUID(), expectedVersion: 1, classification: "REGULATED", attestSynthetic: false });
    await expect(previewAiCases(f.actor, { ...f.previewInput, expectedPolicyVersion: 2 })).rejects.toThrow();
    await expect(issueAiGrant(f.actor, { ...f.scope, requestId: randomUUID(), expectedPolicyVersion: 2, recipient: "codex", scope: "aggregate_counts", lifetimeDays: 1, approveDisclosure: true })).rejects.toThrow();
  }, 20_000);
  it.skipIf(process.env.VAETTIR_AI_MCP_TEST !== "1")("reads through the actual packaged MCP and TLS gateway, then denies after revocation", async () => {
    const f = await fixture(), grant = await issueAiCaseGrant(f.actor, f.input);
    const clientModule = new URL("../../../integrations/ai/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js", import.meta.url);
    const transportModule = new URL("../../../integrations/ai/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js", import.meta.url);
    const { Client } = await import(/* @vite-ignore */ clientModule.href);
    const { StdioClientTransport } = await import(/* @vite-ignore */ transportModule.href);
    const dir = new URL("../../../.local/approved-plugin-20261102/tls-" + randomUUID() + "/", import.meta.url);
    mkdirSync(dir, { recursive: true });
    const key = fileURLToPath(new URL("key.pem", dir)), cert = fileURLToPath(new URL("cert.pem", dir));
    execFileSync(process.platform === "win32" ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe" : "openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", cert, "-days", "1", "-subj", "/CN=127.0.0.1", "-addext", "subjectAltName=IP:127.0.0.1"], { stdio: "ignore", windowsHide: true });
    const server = Fastify({ https: { key: readFileSync(key), cert: readFileSync(cert) }, logger: false });
    await server.register(async app => registerAiDisclosureRoute(app, f.store), { prefix: "/api" });
    const origin = await server.listen({ host: "127.0.0.1", port: 0 });
    const client = new Client({ name: "synthetic-selected-case-acceptance", version: "1.0.0" });
    try {
      await client.connect(new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(new URL("../../../integrations/ai/dist/server.mjs", import.meta.url))], env: { VAETTIR_AI_BASE_URL: origin, VAETTIR_AI_TOKEN: grant.token!, NODE_EXTRA_CA_CERTS: cert }, stderr: "pipe" }));
      const allowed = await client.callTool({ name: "vaettir_approved_cases", arguments: { projectId: f.project.id } });
      expect(allowed.isError).not.toBe(true);
      expect(allowed.structuredContent).toMatchObject({ disclosure: "approved_case_snapshot", snapshot: { cases: [{ id: f.testCase.id, title: f.testCase.title, when: f.testCase.when }] } });
      expect(JSON.stringify(allowed)).not.toMatch(/UNSELECTED_PRIVATE_GIVEN|vai_|tokenHash/);
      await changeAiGrant(f.actor, { ...f.scope, requestId: randomUUID(), grantId: grant.grantId!, expectedVersion: grant.grantVersion! }, false);
      const denied = await client.callTool({ name: "vaettir_approved_cases", arguments: { projectId: f.project.id } });
      expect(denied.isError).toBe(true); expect(JSON.stringify(denied)).not.toMatch(/SYNTHETIC_APPROVED_TITLE|PRIVATE_GIVEN|vai_|tokenHash/);
      expect(await prisma.aiDisclosureAudit.count({ where: { ...f.scope, grantId: grant.grantId!, event: "DENY" } })).toBe(1);
    } finally { await client.close(); await server.close(); }
  }, 20_000);
});
