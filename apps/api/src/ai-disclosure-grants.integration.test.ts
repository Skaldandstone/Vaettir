import { createHash, randomUUID } from "node:crypto";
import Fastify from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { aiDisclosureRouter } from "./routers/aiDisclosure.js";
import {
  classifyAiProject,
  issueAiGrant,
  changeAiGrant,
  readAiSettings,
} from "./services/aiDisclosureAdmin.js";
import {
  readAiProjectSummary,
  type AiReadStore,
} from "./services/aiDisclosureGateway.js";
import { createAiDisclosureStore } from "./services/aiDisclosureStore.js";
import { registerAiDisclosureRoute } from "./services/aiDisclosureRoute.js";
import { looksLikeApiKey } from "./services/apiKeyAuth.js";

const url = process.env.DATABASE_URL ? new URL(process.env.DATABASE_URL) : null;
const isolated =
  !!url &&
  ["localhost", "127.0.0.1"].includes(url.hostname) &&
  /test/i.test(url.pathname) &&
  !url.searchParams.has("host");

async function fixture(approved = true) {
  const key = "ai-grant-" + randomUUID();
  const tier = await prisma.planTier.findUniqueOrThrow({
    where: { key: "free" },
  });
  const org = await prisma.organization.create({
    data: { name: key, slug: key, planTierId: tier.id },
  });
  const foreign = await prisma.organization.create({
    data: {
      name: key + "-foreign",
      slug: key + "-foreign",
      planTierId: tier.id,
    },
  });
  const user = await prisma.user.create({
    data: {
      clerkUserId: key,
      email: key + "@example.invalid",
      memberships: {
        create: { organizationId: org.id, role: "OWNER", seatType: "FULL" },
      },
    },
    include: { memberships: true },
  });
  const project = await prisma.project.create({
    data: { organizationId: org.id, name: "SYNTHETIC_TITLE_CANARY", slug: key },
  });
  const otherProject = await prisma.project.create({
    data: { organizationId: foreign.id, name: "FOREIGN_CANARY", slug: key },
  });
  const actor = { prisma, user, authenticatedClerkSubject: user.clerkUserId };
  const scope = { organizationId: org.id, projectId: project.id };
  let token = "";
  let grantId = "";
  if (approved) {
    await classifyAiProject(actor, {
      ...scope,
      requestId: randomUUID(),
      expectedVersion: 0,
      classification: "SYNTHETIC",
      attestSynthetic: true,
    });
    const issued = await issueAiGrant(actor, {
      ...scope,
      requestId: randomUUID(),
      expectedPolicyVersion: 1,
      recipient: "codex",
      scope: "aggregate_counts",
      lifetimeDays: 7,
      approveDisclosure: true,
    });
    token = issued.token!;
    grantId = issued.grantId!;
  }
  const store = createAiDisclosureStore(prisma, {
    VAETTIR_AI_DISCLOSURE_ENABLED: "1",
    VAETTIR_AI_DISCLOSURE_PROJECTS: JSON.stringify([scope]),
  });
  return {
    actor,
    scope,
    org,
    user,
    project,
    otherProject,
    foreign,
    token,
    grantId,
    store,
  };
}

describe.skipIf(!isolated)(
  "durable external-AI approvals against isolated PostgreSQL",
  () => {
    afterAll(async () => {
      await prisma.$disconnect();
    });

    it("starts unclassified and requires a current human admin plus explicit synthetic attestation", async () => {
      const f = await fixture(false);
      expect(await readAiSettings(f.actor, f.scope)).toMatchObject({
        classification: "UNCLASSIFIED",
        version: 0,
        grants: [],
      });
      await expect(
        classifyAiProject(f.actor, {
          ...f.scope,
          requestId: randomUUID(),
          expectedVersion: 0,
          classification: "SYNTHETIC",
          attestSynthetic: false,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        issueAiGrant(f.actor, {
          ...f.scope,
          requestId: randomUUID(),
          expectedPolicyVersion: 1,
          recipient: "codex",
          scope: "aggregate_counts",
          lifetimeDays: 7,
          approveDisclosure: true,
        }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      await expect(
        readAiSettings(
          { ...f.actor, authenticatedClerkSubject: null },
          f.scope,
        ),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      await expect(
        readAiSettings(
          { ...f.actor, authenticatedClerkSubject: "another-human" },
          f.scope,
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("denies a durable approved grant outside the exact deployment scope and commits its audit", async () => {
      const f = await fixture();
      const excluded = createAiDisclosureStore(prisma, {
        VAETTIR_AI_DISCLOSURE_ENABLED: "1",
        VAETTIR_AI_DISCLOSURE_PROJECTS: JSON.stringify([
          { organizationId: f.foreign.id, projectId: f.project.id },
        ]),
      });
      await expect(
        readAiProjectSummary(excluded, f.token, f.project.id),
      ).rejects.toThrow("AI disclosure is not permitted.");
      expect(
        await prisma.aiDisclosureAudit.findFirst({
          where: { grantId: f.grantId },
          orderBy: { createdAt: "desc" },
        }),
      ).toMatchObject({ event: "DENY", reason: "POLICY_DENIED" });
    });

    it("returns a credential once, persists only its hash, and recovers the same receipt without reissuing", async () => {
      const f = await fixture();
      const input = {
        ...f.scope,
        requestId: randomUUID(),
        expectedPolicyVersion: 1,
        recipient: "codex" as const,
        scope: "aggregate_counts" as const,
        lifetimeDays: 1,
        approveDisclosure: true as const,
      };
      const issued = await issueAiGrant(f.actor, input);
      expect(issued.token).toMatch(/^vai_[a-f0-9]{64}$/);
      const row = await prisma.aiDisclosureGrant.findUniqueOrThrow({
        where: { id: issued.grantId! },
      });
      expect(row.tokenHash).toBe(
        createHash("sha256").update(issued.token!).digest("hex"),
      );
      expect(JSON.stringify(row)).not.toContain(issued.token!);
      const again = await issueAiGrant(f.actor, input);
      expect(again).toEqual({ ...issued, token: null, replayed: true });
      expect(await prisma.aiDisclosureGrant.count({ where: f.scope })).toBe(2);
      expect(
        JSON.stringify(
          await prisma.aiDisclosureCommand.findMany({ where: f.scope }),
        ),
      ).not.toContain(issued.token!);
      await expect(
        issueAiGrant(f.actor, { ...input, lifetimeDays: 2 }),
      ).rejects.toMatchObject({ code: "CONFLICT" });
      const settings = await readAiSettings(f.actor, f.scope);
      expect(JSON.stringify(settings)).not.toContain(issued.token!);
      expect(JSON.stringify(settings)).not.toContain(row.tokenHash);
      expect(looksLikeApiKey(issued.token!)).toBe(false);
    });

    it("exposes only scoped counts through the actual HTTP handler and never loads test content", async () => {
      const f = await fixture();
      const type = await prisma.testPlanType.findFirstOrThrow();
      await prisma.testCase.createMany({
        data: Array.from({ length: 10 }, () => ({
          projectId: f.project.id,
          title: "PATIENT_CANARY CUSTOMER_IP_CANARY",
          given: ["SECRET_PROCEDURE"],
          when: [],
          then: [],
          tags: [],
          testType: "FUNCTIONAL" as const,
        })),
      });
      await prisma.testPlan.createMany({
        data: Array.from({ length: 10 }, () => ({
          projectId: f.project.id,
          testPlanTypeId: type.id,
          name: "PLAN_IP_CANARY",
        })),
      });
      await prisma.testRun.createMany({
        data: Array.from({ length: 10 }, () => ({
          projectId: f.project.id,
          ciProvider: "synthetic",
          commitSha: "UNRELEASED_CANARY",
          branch: "PRIVATE_BRANCH_CANARY",
          startedAt: new Date(),
        })),
      });
      await prisma.testRun.createMany({
        data: Array.from({ length: 20 }, () => ({
          projectId: f.otherProject.id,
          ciProvider: "foreign",
          commitSha: "FOREIGN",
          branch: "FOREIGN",
          startedAt: new Date(),
        })),
      });
      const app = Fastify();
      await app.register(
        async (instance) => registerAiDisclosureRoute(instance, f.store),
        { prefix: "/api" },
      );
      try {
        const response = await app.inject({
          url:
            "/api/integrations/ai/v1/project-summary?projectId=" + f.project.id,
          headers: { authorization: "Bearer " + f.token },
        });
        expect(response.statusCode).toBe(200);
        expect(response.json()).toEqual({
          policyVersion: 1,
          disclosure: "aggregate_counts",
          classification: "SYNTHETIC",
          suppressed: false,
          counts: { testCases: 10, testPlans: 10, testRuns: 10 },
        });
        expect(response.body).not.toMatch(/CANARY|vai_|projectId|title|branch/);
        expect(response.headers["cache-control"]).toBe("no-store");
        const records = await prisma.aiDisclosureAudit.findMany({
          where: f.scope,
        });
        expect(records.some((r) => r.event === "ALLOW")).toBe(true);
        expect(JSON.stringify(records)).not.toMatch(
          /CANARY|vai_|testCases|tokenHash/,
        );
      } finally {
        await app.close();
      }
    });

    it("rejects cross-tenant IDs and database FK mismatches without returning foreign data", async () => {
      const f = await fixture();
      await expect(
        readAiProjectSummary(f.store, f.token, f.otherProject.id),
      ).rejects.toThrow("not permitted");
      await expect(
        readAiSettings(f.actor, { ...f.scope, projectId: f.otherProject.id }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        prisma.aiDisclosurePolicy.create({
          data: {
            organizationId: f.org.id,
            projectId: f.otherProject.id,
            updatedByUserId: f.user.id,
          },
        }),
      ).rejects.toMatchObject({ code: "P2003" });
      const policy = await prisma.aiDisclosurePolicy.findUniqueOrThrow({
        where: { projectId: f.project.id },
      });
      expect(policy.organizationId).toBe(f.org.id);
    });

    it.each(["VIEWER", "EDITOR", "COMPLIANCE_AUDITOR"] as const)(
      "rejects a stale %s admin for management and existing disclosure",
      async (role) => {
        const f = await fixture();
        await prisma.membership.update({
          where: {
            organizationId_userId: {
              organizationId: f.org.id,
              userId: f.user.id,
            },
          },
          data: { role },
        });
        await expect(readAiSettings(f.actor, f.scope)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
        await expect(
          readAiProjectSummary(f.store, f.token, f.project.id),
        ).rejects.toThrow("not permitted");
      },
    );

    it.each(["READ_ONLY", "SUSPENDED", "REMOVED", "REMAPPED"])(
      "invalidates grants after %s authorization changes",
      async (mode) => {
        const f = await fixture();
        if (mode === "READ_ONLY")
          await prisma.membership.update({
            where: {
              organizationId_userId: {
                organizationId: f.org.id,
                userId: f.user.id,
              },
            },
            data: { seatType: "READ_ONLY" },
          });
        if (mode === "SUSPENDED")
          await prisma.organization.update({
            where: { id: f.org.id },
            data: { suspendedAt: new Date() },
          });
        if (mode === "REMOVED")
          await prisma.membership.delete({
            where: {
              organizationId_userId: {
                organizationId: f.org.id,
                userId: f.user.id,
              },
            },
          });
        if (mode === "REMAPPED")
          await prisma.user.update({
            where: { id: f.user.id },
            data: { clerkUserId: "remapped-" + randomUUID() },
          });
        await expect(
          readAiProjectSummary(f.store, f.token, f.project.id),
        ).rejects.toThrow("not permitted");
        await expect(readAiSettings(f.actor, f.scope)).rejects.toMatchObject({
          code: "FORBIDDEN",
        });
      },
    );

    it("rotates credentials atomically and uses durable idempotency receipts", async () => {
      const f = await fixture();
      const input = {
        ...f.scope,
        requestId: randomUUID(),
        grantId: f.grantId,
        expectedVersion: 1,
        expectedPolicyVersion: 1,
        lifetimeDays: 7,
        approveDisclosure: true as const,
      };
      const rotated = await changeAiGrant(f.actor, input, true);
      expect(rotated.token).not.toBe(f.token);
      await expect(
        readAiProjectSummary(f.store, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
      expect(
        await readAiProjectSummary(f.store, rotated.token!, f.project.id),
      ).toMatchObject({ counts: { testCases: 0, testPlans: 0, testRuns: 0 } });
      expect(await changeAiGrant(f.actor, input, true)).toEqual({
        ...rotated,
        token: null,
        replayed: true,
      });
      expect(
        (
          await prisma.aiDisclosureGrant.findUniqueOrThrow({
            where: { id: f.grantId },
          })
        ).version,
      ).toBe(2);
    });

    it("does not resurrect a credential when a removed administrator is reinstated", async () => {
      const f = await fixture();
      await prisma.membership.delete({
        where: {
          organizationId_userId: {
            organizationId: f.org.id,
            userId: f.user.id,
          },
        },
      });

      await prisma.membership.create({
        data: {
          organizationId: f.org.id,
          userId: f.user.id,
          role: "OWNER",
          seatType: "FULL",
        },
      });
      expect(
        (
          await prisma.aiDisclosureGrant.findUniqueOrThrow({
            where: { id: f.grantId },
          })
        ).revokedAt,
      ).not.toBeNull();
      await expect(
        readAiProjectSummary(f.store, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
    });

    it.each(["ROLE", "SEAT", "IDENTITY", "SUSPENSION"])(
      "does not resurrect approval after %s is restored",
      async (mode) => {
        const f = await fixture();
        const member = {
          organizationId_userId: {
            organizationId: f.org.id,
            userId: f.user.id,
          },
        };
        if (mode === "ROLE") {
          await prisma.membership.update({
            where: member,
            data: { role: "VIEWER" },
          });
          await prisma.membership.update({
            where: member,
            data: { role: "OWNER" },
          });
        }
        if (mode === "SEAT") {
          await prisma.membership.update({
            where: member,
            data: { seatType: "READ_ONLY" },
          });
          await prisma.membership.update({
            where: member,
            data: { seatType: "FULL" },
          });
        }
        if (mode === "IDENTITY") {
          await prisma.user.update({
            where: { id: f.user.id },
            data: { clerkUserId: "temporary-" + randomUUID() },
          });
          await prisma.user.update({
            where: { id: f.user.id },
            data: { clerkUserId: f.user.clerkUserId },
          });
        }
        if (mode === "SUSPENSION") {
          await prisma.organization.update({
            where: { id: f.org.id },
            data: { suspendedAt: new Date() },
          });
          await prisma.organization.update({
            where: { id: f.org.id },
            data: { suspendedAt: null },
          });
        }
        await expect(
          readAiProjectSummary(f.store, f.token, f.project.id),
        ).rejects.toThrow("not permitted");
        expect(
          (
            await prisma.aiDisclosureGrant.findUniqueOrThrow({
              where: { id: f.grantId },
            })
          ).revokedAt,
        ).not.toBeNull();
      },
    );

    it("denies persisted expired grants", async () => {
      const f = await fixture();
      await prisma.aiDisclosureGrant.update({
        where: { id: f.grantId },
        data: {
          createdAt: new Date(Date.now() - 86400000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      await expect(
        readAiProjectSummary(f.store, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
    });

    it("revokes durably and does not silently resurrect a grant on retry", async () => {
      const f = await fixture();
      const input = {
        ...f.scope,
        requestId: randomUUID(),
        grantId: f.grantId,
        expectedVersion: 1,
      };
      const revoked = await changeAiGrant(f.actor, input, false);
      expect(await changeAiGrant(f.actor, input, false)).toEqual({
        ...revoked,
        replayed: true,
      });
      const freshStore = createAiDisclosureStore(prisma, {
        VAETTIR_AI_DISCLOSURE_ENABLED: "1",
        VAETTIR_AI_DISCLOSURE_PROJECTS: JSON.stringify([f.scope]),
      });
      await expect(
        readAiProjectSummary(freshStore, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
      await expect(
        changeAiGrant(
          f.actor,
          {
            ...input,
            requestId: randomUUID(),
            expectedVersion: 2,
            expectedPolicyVersion: 1,
            lifetimeDays: 7,
            approveDisclosure: true,
          },
          true,
        ),
      ).rejects.toMatchObject({ code: "CONFLICT" });
    });

    it.each([
      "REGULATED",
      "CUSTOMER_PROPRIETARY",
      "UNCLASSIFIED",
      "SYNTHETIC",
    ] as const)(
      "classification save to %s revokes old grants and needs fresh approval",
      async (classification) => {
        const f = await fixture();
        await classifyAiProject(f.actor, {
          ...f.scope,
          requestId: randomUUID(),
          expectedVersion: 1,
          classification,
          attestSynthetic: classification === "SYNTHETIC",
        });
        await expect(
          readAiProjectSummary(f.store, f.token, f.project.id),
        ).rejects.toThrow("not permitted");
        const settings = await readAiSettings(f.actor, f.scope);
        expect(settings.version).toBe(2);
        expect(settings.grants[0].revokedAt).not.toBeNull();
        if (classification !== "SYNTHETIC")
          await expect(
            issueAiGrant(f.actor, {
              ...f.scope,
              requestId: randomUUID(),
              expectedPolicyVersion: 2,
              recipient: "codex",
              scope: "aggregate_counts",
              lifetimeDays: 1,
              approveDisclosure: true,
            }),
          ).rejects.toMatchObject({ code: "CONFLICT" });
      },
    );

    it("checks expiration after acquiring locks, rather than using request-arrival time", async () => {
      const f = await fixture();
      const base = f.store;
      const delayed: AiReadStore = {
        deploymentAllows: f.store.deploymentAllows,
        transaction: (work) =>
          base.transaction(async (tx) =>
            work({
              ...tx,
              resolveGrant: async (hash) => {
                const grant = await tx.resolveGrant(hash);
                if (grant) grant.expiresAt = new Date(Date.now() - 1);
                return grant;
              },
            }),
          ),
      };
      await expect(
        readAiProjectSummary(delayed, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
    });

    it("enforces a persistent per-grant rate window", async () => {
      const f = await fixture();
      await prisma.aiDisclosureGrant.update({
        where: { id: f.grantId },
        data: { readWindowStartedAt: new Date(), readWindowCount: 30 },
      });
      await expect(
        readAiProjectSummary(f.store, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
      await prisma.aiDisclosureGrant.update({
        where: { id: f.grantId },
        data: { readWindowStartedAt: new Date(Date.now() - 61_000) },
      });
      expect(
        await readAiProjectSummary(f.store, f.token, f.project.id),
      ).toHaveProperty("counts");
      expect(
        (
          await prisma.aiDisclosureGrant.findUniqueOrThrow({
            where: { id: f.grantId },
          })
        ).readWindowCount,
      ).toBe(1);
    });

    it("keeps policy decisions and command receipts append-only", async () => {
      const f = await fixture();
      const audit = await prisma.aiDisclosureAudit.findFirstOrThrow({
        where: f.scope,
      });
      const command = await prisma.aiDisclosureCommand.findFirstOrThrow({
        where: f.scope,
      });
      await expect(
        prisma.aiDisclosureAudit.update({
          where: { id: audit.id },
          data: { reason: "POLICY_DENIED" },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.aiDisclosureAudit.delete({ where: { id: audit.id } }),
      ).rejects.toThrow();
      await expect(
        prisma.aiDisclosureCommand.update({
          where: { id: command.id },
          data: { receipt: {} },
        }),
      ).rejects.toThrow();
      expect(await prisma.aiDisclosureAudit.count({ where: f.scope })).toBe(2);
    });

    it("fails closed when durable audit storage fails and rolls back usage changes", async () => {
      const f = await fixture();
      await prisma.$executeRawUnsafe(
        `CREATE FUNCTION ai_fixture_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic audit outage'; END; $$`,
      );
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER ai_fixture_audit_failure BEFORE INSERT ON "AiDisclosureAudit" FOR EACH ROW WHEN (NEW."projectId"='${f.project.id}') EXECUTE FUNCTION ai_fixture_audit_failure()`,
      );
      try {
        await expect(
          readAiProjectSummary(f.store, f.token, f.project.id),
        ).rejects.toThrow();
        expect(
          (
            await prisma.aiDisclosureGrant.findUniqueOrThrow({
              where: { id: f.grantId },
            })
          ).readWindowCount,
        ).toBe(0);
        expect(await prisma.aiDisclosureAudit.count({ where: f.scope })).toBe(
          2,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER ai_fixture_audit_failure ON "AiDisclosureAudit"',
        );
        await prisma.$executeRawUnsafe(
          "DROP FUNCTION ai_fixture_audit_failure()",
        );
      }
    });

    it("serializes a live read against revocation and denies every read after the revoke commits", async () => {
      const f = await fixture();
      let unlock!: () => void, locked!: () => void;
      const gate = new Promise<void>((r) => {
          unlock = r;
        }),
        acquired = new Promise<void>((r) => {
          locked = r;
        });
      const held: AiReadStore = {
        deploymentAllows: f.store.deploymentAllows,
        transaction: (work) =>
          f.store.transaction((tx) =>
            work({
              ...tx,
              countProject: async (...args) => {
                locked();
                await gate;
                return tx.countProject(...args);
              },
            }),
          ),
      };
      const reading = readAiProjectSummary(held, f.token, f.project.id);
      await acquired;
      const revoking = changeAiGrant(
        f.actor,
        {
          ...f.scope,
          requestId: randomUUID(),
          grantId: f.grantId,
          expectedVersion: 1,
        },
        false,
      );
      try {
        let blocked = false;
        for (let i = 0; i < 30 && !blocked; i++) {
          const locks = await prisma.$queryRaw<
            Array<{ n: bigint }>
          >`SELECT count(*) AS n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND pid<>pg_backend_pid()`;
          blocked = Number(locks[0]?.n) > 0;
          if (!blocked) await new Promise((r) => setTimeout(r, 10));
        }
        expect(blocked).toBe(true);
      } finally {
        unlock();
      }
      expect(await reading).toHaveProperty("counts");
      await revoking;
      await expect(
        readAiProjectSummary(f.store, f.token, f.project.id),
      ).rejects.toThrow("not permitted");
    });

    it("the actual router denies non-human credential contexts before grant administration", async () => {
      const f = await fixture();
      const caller = aiDisclosureRouter.createCaller({
        ...f.actor,
        authenticatedClerkSubject: null,
        staff: null,
        securityLogger: undefined,
        staffAttempt: {
          tokenConfigured: false,
          tokenPresented: false,
          actorHeaderPresented: false,
        },
      });
      await expect(caller.settings(f.scope)).rejects.toMatchObject({
        code: "UNAUTHORIZED",
      });
    });
  },
);
