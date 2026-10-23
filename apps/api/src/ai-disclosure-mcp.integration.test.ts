import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import { describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import {
  classifyAiProject,
  issueAiGrant,
  changeAiGrant,
} from "./services/aiDisclosureAdmin.js";
import { createAiDisclosureStore } from "./services/aiDisclosureStore.js";
import { registerAiDisclosureRoute } from "./services/aiDisclosureRoute.js";

const db = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const enabled =
  process.env.VAETTIR_AI_MCP_TEST === "1" &&
  db &&
  ["127.0.0.1", "localhost"].includes(db.hostname) &&
  /test/.test(db.pathname) &&
  !db.searchParams.has("host");

// Requires the standalone plugin's dev dependencies and openssl. Explicit opt-in
// keeps the production pnpm dependency graph independent of the plugin package.
describe.skipIf(!enabled)(
  "packaged MCP -> HTTPS -> durable PostgreSQL grant",
  () => {
    it("reads approved counts and stops after the customer revokes the grant", async () => {
      // Resolve from this test file, rather than letting the test runner treat
      // a literal import outside its app root as a root-relative module ID.
      const clientModule = new URL(
        "../../../integrations/ai/node_modules/@modelcontextprotocol/sdk/dist/esm/client/index.js",
        import.meta.url,
      );
      const transportModule = new URL(
        "../../../integrations/ai/node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js",
        import.meta.url,
      );
      const { Client } =
        await import(/* @vite-ignore */ clientModule.href);
      const { StdioClientTransport } =
        await import(/* @vite-ignore */ transportModule.href);
      const proof = new URL(
        "../../../.local/ai-plugin-grants-20261016/tls-" + randomUUID() + "/",
        import.meta.url,
      );
      mkdirSync(proof, { recursive: true });
      const key = fileURLToPath(new URL("key.pem", proof)),
        cert = fileURLToPath(new URL("cert.pem", proof));
      const openssl =
        process.platform === "win32"
          ? "C:\\Program Files\\Git\\usr\\bin\\openssl.exe"
          : "openssl";
      execFileSync(
        openssl,
        [
          "req",
          "-x509",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          key,
          "-out",
          cert,
          "-days",
          "1",
          "-subj",
          "/CN=127.0.0.1",
          "-addext",
          "subjectAltName=IP:127.0.0.1",
        ],
        { stdio: "ignore", windowsHide: true },
      );
      const id = "mcp-" + randomUUID(),
        tier = await prisma.planTier.findUniqueOrThrow({
          where: { key: "free" },
        });
      const org = await prisma.organization.create({
        data: { name: id, slug: id, planTierId: tier.id },
      });
      const user = await prisma.user.create({
        data: {
          clerkUserId: id,
          email: id + "@example.invalid",
          memberships: {
            create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
          },
        },
        include: { memberships: true },
      });
      const project = await prisma.project.create({
        data: {
          organizationId: org.id,
          name: "SYNTHETIC_PROJECT_CANARY",
          slug: id,
        },
      });
      await prisma.testCase.createMany({
        data: Array.from({ length: 10 }, () => ({
          projectId: project.id,
          title: "CUSTOMER_CANARY",
          given: [],
          when: [],
          then: [],
          tags: [],
          testType: "FUNCTIONAL" as const,
        })),
      });
      const actor = {
          prisma,
          user,
          authenticatedClerkSubject: user.clerkUserId,
        },
        scope = { organizationId: org.id, projectId: project.id };
      await classifyAiProject(actor, {
        ...scope,
        requestId: randomUUID(),
        expectedVersion: 0,
        classification: "SYNTHETIC",
        attestSynthetic: true,
      });
      const grant = await issueAiGrant(actor, {
        ...scope,
        requestId: randomUUID(),
        expectedPolicyVersion: 1,
        recipient: "codex",
        scope: "aggregate_counts",
        lifetimeDays: 1,
        approveDisclosure: true,
      });
      const server = Fastify({
        https: { key: readFileSync(key), cert: readFileSync(cert) },
      });
      await server.register(
        async (app) =>
          registerAiDisclosureRoute(
            app,
            createAiDisclosureStore(prisma, {
              VAETTIR_AI_DISCLOSURE_ENABLED: "1",
              VAETTIR_AI_DISCLOSURE_PROJECTS: JSON.stringify([scope]),
            }),
          ),
        { prefix: "/api" },
      );
      const origin = await server.listen({ host: "127.0.0.1", port: 0 });
      const client = new Client({
        name: "vaettir-synthetic-acceptance",
        version: "1.0.0",
      });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          fileURLToPath(
            new URL(
              "../../../integrations/ai/dist/server.mjs",
              import.meta.url,
            ),
          ),
        ],
        env: {
          VAETTIR_AI_BASE_URL: origin,
          VAETTIR_AI_TOKEN: grant.token!,
          NODE_EXTRA_CA_CERTS: cert,
        },
        stderr: "pipe",
      });
      try {
        await client.connect(transport);
        const allowed = await client.callTool({
          name: "vaettir_project_summary",
          arguments: { projectId: project.id },
        });
        expect(allowed.isError).not.toBe(true);
        expect(allowed.structuredContent).toMatchObject({
          counts: { testCases: 10, testPlans: 0, testRuns: 0 },
        });
        expect(JSON.stringify(allowed)).not.toMatch(/CANARY|vai_|tokenHash/);
        await changeAiGrant(
          actor,
          {
            ...scope,
            requestId: randomUUID(),
            grantId: grant.grantId!,
            expectedVersion: 1,
          },
          false,
        );
        const denied = await client.callTool({
          name: "vaettir_project_summary",
          arguments: { projectId: project.id },
        });
        expect(denied.isError).toBe(true);
        expect(JSON.stringify(denied)).not.toMatch(/CANARY|vai_|tokenHash/);
      } finally {
        await client.close();
        await server.close();
      }
    });
  },
);
