import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Prisma, prisma } from "@vaettir/db";
import type { Context } from "./trpc.js";
import { atlassianQualityRouter } from "./routers/atlassianQuality.js";
import { forgeSharingKey } from "./services/atlassianQualitySharing.js";
import {
  captureJiraRelease,
  readJiraReleaseQuality,
  readSharedClosure,
} from "./services/jiraReleaseEvidence.js";
import type { ForgeIdentity } from "./services/forgeInvocation.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

// Disposable native PostgreSQL proof only. No Jira, model, customer or payment
// calls. Retain the uniquely owned fixture for inspection rather than deleting.
describe("native database quality capture and revocation", () => {
  const tag = `forge-quality-test-${randomUUID()}`,
    connectionId = randomUUID();
  const identity: ForgeIdentity = {
    appId: "ari:cloud:ecosystem::app/743bf96f-0f9f-4fed-981a-ea3fc318d15d",
    installationId:
      "ari:cloud:ecosystem::installation/10000000-0000-4000-8000-000000000001",
    environmentId:
      "ari:cloud:ecosystem::environment/d2844601-7a1f-4e4e-9b77-e0d4d3682c50",
    cloudId: "10000000-0000-4000-8000-000000000002",
    siteOrigin: "https://company.atlassian.net",
    product: "jira",
    targetId: "10",
    principal: "automated-event",
    moduleKey: "release-event",
    apiBaseUrl:
      "https://api.atlassian.com/ex/jira/10000000-0000-4000-8000-000000000002",
  };
  const {
    appId,
    installationId,
    environmentId,
    cloudId,
    siteOrigin,
    product,
    targetId,
  } = identity;
  const binding = {
    appId,
    installationId,
    environmentId,
    cloudId,
    siteOrigin,
    product,
    targetId,
  };
  const version = {
    id: "45",
    projectId: 10,
    name: "Synthetic version",
    released: true,
    archived: false,
  };
  let orgId: string,
    projectId: string,
    caseId: string,
    releaseId: string,
    runId: string,
    resultId: string,
    actorId: string,
    closureId: string;
  let caller: ReturnType<typeof atlassianQualityRouter.createCaller>;
  beforeAll(async () => {
    assertOwnedTestDatabase(process.env.DATABASE_URL);
    vi.stubEnv("VAETTIR_FORGE_APP_ID", appId);
    vi.stubEnv("VAETTIR_FORGE_ENVIRONMENT_ID", environmentId);
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    orgId = (
      await prisma.organization.create({
        data: { name: tag, slug: tag, planTierId: tier.id },
      })
    ).id;
    projectId = (
      await prisma.project.create({
        data: { organizationId: orgId, name: tag, slug: tag },
      })
    ).id;
    const actor = await prisma.user.create({
      data: {
        clerkUserId: tag,
        email: `${tag}@example.com`,
        memberships: {
          create: { organizationId: orgId, role: "OWNER", seatType: "FULL" },
        },
      },
      include: { memberships: true },
    });
    actorId = actor.id;
    const type = await prisma.testPlanType.findFirstOrThrow();
    releaseId = (
      await prisma.release.create({
        data: { projectId, name: "Synthetic release" },
      })
    ).id;
    const plan = await prisma.testPlan.create({
      data: {
        projectId,
        name: "Synthetic plan",
        testPlanTypeId: type.id,
        releaseId,
      },
    });
    caseId = (
      await prisma.testCase.create({
        data: {
          projectId,
          testPlanId: plan.id,
          title: "Synthetic checkout case",
          testType: "FUNCTIONAL",
          background: "PRIVATE_DEFINITION",
          given: [],
          when: [],
          then: [],
          tags: [],
          reviewStatus: "APPROVED",
          steps: {
            create: [
              {
                order: 0,
                action: "Synthetic checkout action",
                expectedResult: "Exactly one charge",
              },
            ],
          },
        },
      })
    ).id;
    runId = (
      await prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date(),
          status: "FAILED",
          manualTestCaseIds: [caseId],
          executionContext: { fixture: "PRIVATE_RUN_CONTEXT" },
        },
      })
    ).id;
    resultId = (
      await prisma.testResult.create({
        data: {
          testRunId: runId,
          testCaseId: caseId,
          status: "FAIL",
          externalTestId: "synthetic-checkout",
        },
      })
    ).id;
    caller = atlassianQualityRouter.createCaller({
      prisma,
      user: actor,
      authenticatedClerkSubject: tag,
    } as unknown as Context);
    await caller.publish({
      projectId,
      organizationId: orgId,
      connectionId,
      expectedVersion: 0,
      requestId: randomUUID(),
      binding,
      shareTicketTests: false,
      snapshotIds: [],
      closureSnapshotIds: [],
      releaseLinks: [{ jiraVersionId: version.id, releaseId, runIds: [runId] }],
      approveTargetSharing: true,
    });
  });
  afterAll(() => vi.unstubAllEnvs());
  it("creates exactly one immutable capture under real concurrent retries, preserving definitions and results", async () => {
    const capture = () =>
      prisma.$transaction(
        (tx) =>
          captureJiraRelease(
            tx,
            forgeSharingKey(connectionId),
            identity,
            version,
            new Date().toISOString(),
          ),
        { timeout: 20000, isolationLevel: "ReadCommitted" },
      );
    const results = await Promise.all([capture(), capture()]);
    expect(results.every((r) => r.captured)).toBe(true);
    const rows = await prisma.auditLog.findMany({
      where: { projectId, entityType: "JiraReleaseClosure" },
    });
    expect(rows).toHaveLength(1);
    closureId = rows[0]!.id;
    const metadata = rows[0]!.metadata as Prisma.JsonObject;
    expect(JSON.stringify(metadata.definitions)).toContain(
      "PRIVATE_DEFINITION",
    );
    expect(JSON.stringify(metadata.definitions)).toContain(
      "PRIVATE_RUN_CONTEXT",
    );
    await prisma.testResult.update({
      where: { id: resultId },
      data: { status: "PASS" },
    });
    const frozen = await prisma.$transaction((tx) =>
      readJiraReleaseQuality(
        tx,
        forgeSharingKey(connectionId),
        identity,
        version,
      ),
    );
    expect(frozen.counts.fail).toBe(1);
    expect(frozen.counts.pass).toBe(0);
    expect(frozen.mode).toBe("FROZEN");
    expect(JSON.stringify(frozen)).not.toMatch(
      /PRIVATE_DEFINITION|PRIVATE_RUN_CONTEXT/,
    );
  });
  it("shares closure metrics with Confluence only after a separate space approval", async () => {
    const confluence = {
      ...identity,
      product: "confluence" as const,
      targetId: "20",
      moduleKey: "vaettir-release-quality",
      resourceId: "30",
    };
    await expect(
      prisma.$transaction((tx) =>
        readSharedClosure(
          tx,
          forgeSharingKey(connectionId),
          confluence,
          closureId,
        ),
      ),
    ).rejects.toThrow();
    const confConnection = randomUUID();
    await caller.publish({
      projectId,
      organizationId: orgId,
      connectionId: confConnection,
      expectedVersion: 0,
      requestId: randomUUID(),
      binding: { ...binding, product: "confluence", targetId: "20" },
      shareTicketTests: false,
      snapshotIds: [],
      closureSnapshotIds: [closureId],
      releaseLinks: [],
      approveTargetSharing: true,
    });
    const shared = await prisma.$transaction((tx) =>
      readSharedClosure(
        tx,
        forgeSharingKey(confConnection),
        confluence,
        closureId,
      ),
    );
    expect(shared.counts.fail).toBe(1);
    await expect(
      prisma.$transaction((tx) =>
        readSharedClosure(
          tx,
          forgeSharingKey(confConnection),
          { ...confluence, targetId: "21" },
          closureId,
        ),
      ),
    ).rejects.toThrow();
  });
  it("rereads revocation after waiting on a real parent lock, before reading any release data", async () => {
    let releaseLock!: () => void,
      ready!: () => void,
      sawInitialRead!: () => void;
    const held = new Promise<void>((r) => {
        ready = r;
      }),
      proceed = new Promise<void>((r) => {
        releaseLock = r;
      }),
      initialRead = new Promise<void>((r) => {
        sawInitialRead = r;
      });
    const revoker = prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT id FROM "Organization" WHERE id=${orgId} FOR UPDATE`;
        ready();
        await proceed;
        const previous = await tx.auditLog.findFirstOrThrow({
          where: {
            projectId,
            entityType: "ForgeQualitySharing",
            entityId: forgeSharingKey(connectionId),
          },
        });
        await tx.auditLog.create({
          data: {
            organizationId: orgId,
            projectId,
            actorId,
            entityType: "ForgeQualitySharing",
            entityId: forgeSharingKey(connectionId),
            action: "CREATE",
            summary: "Synthetic concurrent revocation",
            metadata: {
              ...(previous.metadata as Prisma.JsonObject),
              version: 2,
              state: "REVOKED",
            },
          },
        });
      },
      { timeout: 20000 },
    );
    await held;
    const capture = prisma.$transaction(
      async (tx) => {
        // Observe actual DB results without replacing them or its SQL locks.
        const observedTx = Object.create(tx) as Prisma.TransactionClient;
        observedTx.auditLog = Object.create(tx.auditLog) as typeof tx.auditLog;
        const original = tx.auditLog.findMany.bind(tx.auditLog);
        observedTx.auditLog.findMany = (async (
          ...args: Parameters<typeof original>
        ) => {
          const rows = await original(...args);
          sawInitialRead();
          return rows;
        }) as typeof original;
        return captureJiraRelease(
          observedTx,
          forgeSharingKey(connectionId),
          identity,
          version,
          new Date().toISOString(),
        );
      },
      { timeout: 20000, isolationLevel: "ReadCommitted" },
    );
    const refused = expect(capture).rejects.toThrow(/Sharing unavailable/);
    await initialRead;
    releaseLock();
    await revoker;
    await refused;
    expect(
      await prisma.auditLog.count({
        where: { projectId, entityType: "JiraReleaseClosure" },
      }),
    ).toBe(1);
  });
});
