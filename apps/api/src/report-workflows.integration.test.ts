import { randomUUID } from "node:crypto";
import { readFileSync, realpathSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@vaettir/db";
import { reportWorkflowsRouter } from "./routers/reportWorkflows.js";
import { runDueReportSchedules } from "./jobs/reportScheduleWorker.js";
import { readForgeLiveQuality } from "./services/forgeLiveQuality.js";
import {
  forgeSharingEntityType,
  forgeSharingKey,
} from "./services/atlassianQualitySharing.js";
import type { ForgeIdentity } from "./services/forgeInvocation.js";
import { assertOwnedTestDatabase } from "./testOnlyDatabaseSafety.js";

function assertDatabase() {
  if (!process.env.REPORT_TEST_OWNER_FILE)
    return assertOwnedTestDatabase(process.env.DATABASE_URL);
  const root = realpathSync(resolve(import.meta.dirname, "../../..", ".local"));
  const path = realpathSync(process.env.REPORT_TEST_OWNER_FILE);
  const rel = relative(root, path);
  if (rel.startsWith("..") || rel.includes(":"))
    throw Error("Owned test manifest required");
  const owner = JSON.parse(readFileSync(path, "utf8"));
  const url = new URL(process.env.DATABASE_URL ?? "https://invalid");
  if (
    owner.purpose !== "reporting-parity-disposable" ||
    owner.owner !== "codex/reporting-parity-20261028" ||
    realpathSync(owner.data) !== realpathSync(resolve(dirname(path), "data")) ||
    !/^vaettir_reporting_test_[0-9]{13}$/.test(owner.database) ||
    url.protocol !== "postgresql:" ||
    url.hostname !== "127.0.0.1" ||
    url.port !== String(owner.port) ||
    url.pathname !== `/${owner.database}` ||
    url.search !== "?schema=public&connection_limit=5"
  )
    throw Error("Exact owned test database required");
}
const definition = {
  audience: "stakeholders" as const,
  windowDays: 30 as const,
  sections: ["inventory" as const, "execution" as const],
  summary: "Synthetic report",
  risks: "",
  nextActions: "",
};
const config = {
  definition,
  columns: 2 as const,
  widgets: [{ id: "outcomes" as const, display: "donut" as const }],
};
const scheduleConfig = {
  definition,
  cadence: "daily" as const,
  timeZone: "UTC",
  hour: 9,
  minute: 0,
  weekday: 1,
  monthDay: 1,
};
describe("native reporting workflow transactions", () => {
  const tag = `report-workflow-${randomUUID()}`;
  let orgId: string, projectId: string, userId: string, membershipId: string;
  let owner: ReturnType<typeof reportWorkflowsRouter.createCaller>,
    viewer: typeof owner,
    other: typeof owner,
    service: typeof owner;
  const base = () => ({ projectId, expectedClerkActorId: tag });
  const dashboard = () => ({
    ...base(),
    id: randomUUID(),
    expectedVersion: 0,
    requestId: randomUUID(),
    name: "Synthetic overview",
    config,
    visibility: "private" as const,
    archived: false,
  });
  const schedule = () => ({
    ...base(),
    id: randomUUID(),
    expectedVersion: 0,
    requestId: randomUUID(),
    name: "Synthetic schedule",
    config: scheduleConfig,
    enabled: true,
    approveRecurringCapture: true as const,
  });
  beforeAll(async () => {
    assertDatabase();
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const org = await prisma.organization.create({
      data: { name: tag, slug: tag, planTierId: tier.id },
    });
    orgId = org.id;
    const project = await prisma.project.create({
      data: { organizationId: orgId, name: tag, slug: tag },
    });
    projectId = project.id;
    for (const suffix of ["", "viewer", "other"]) {
      const otherOrg =
        suffix === "other"
          ? await prisma.organization.create({
              data: {
                name: tag + suffix,
                slug: tag + suffix,
                planTierId: tier.id,
              },
            })
          : org;
      const user = await prisma.user.create({
        data: {
          clerkUserId: tag + suffix,
          email: `${tag}${suffix}@example.invalid`,
          memberships: {
            create: {
              organizationId: otherOrg.id,
              role: suffix === "viewer" ? "VIEWER" : "OWNER",
              seatType: "FULL",
            },
          },
        },
        include: { memberships: true },
      });
      const ctx = {
        prisma,
        user,
        authenticatedClerkSubject: tag + suffix,
        workspaceOrganizationId: otherOrg.id,
      };
      const caller = reportWorkflowsRouter.createCaller(ctx);
      if (!suffix) {
        owner = caller;
        userId = user.id;
        membershipId = user.memberships[0]!.id;
        service = reportWorkflowsRouter.createCaller({
          ...ctx,
          authenticatedApiKeyId: "synthetic-service",
        });
      } else if (suffix === "viewer") viewer = caller;
      else other = caller;
    }
  });
  afterAll(async () => {
    await prisma.$disconnect();
  }); // Retain uniquely owned synthetic rows for inspection.
  it("enforces current actor, workspace, human and editor boundaries", async () => {
    await expect(
      owner.list({ ...base(), expectedClerkActorId: "wrong" }),
    ).rejects.toThrow();
    await expect(
      other.list({ ...base(), expectedClerkActorId: tag + "other" }),
    ).rejects.toThrow();
    await expect(service.list(base())).rejects.toThrow();
    await expect(
      viewer.saveDashboard({
        ...dashboard(),
        expectedClerkActorId: tag + "viewer",
      }),
    ).rejects.toThrow();
  });
  it("retains exact retries and refuses stale edits, including private reads", async () => {
    const input = dashboard();
    const result = await owner.saveDashboard(input);
    expect(await owner.saveDashboard(input)).toEqual(result);
    await expect(
      owner.saveDashboard({ ...input, name: "changed" }),
    ).rejects.toThrow();
    await expect(
      owner.saveDashboard({ ...input, requestId: randomUUID() }),
    ).rejects.toThrow();
    await expect(
      viewer.read({
        projectId,
        expectedClerkActorId: tag + "viewer",
        id: input.id,
      }),
    ).rejects.toThrow();
    await owner.saveDashboard({
      ...input,
      requestId: randomUUID(),
      expectedVersion: 1,
      visibility: "project",
    });
    expect(
      (
        await viewer.read({
          projectId,
          expectedClerkActorId: tag + "viewer",
          id: input.id,
        })
      ).widgets,
    ).toHaveLength(1);
    expect(
      await prisma.projectReportSnapshot.count({ where: { projectId } }),
    ).toBe(0);
  });
  it("captures once under concurrent ticks and leaves approval private", async () => {
    const input = schedule();
    await owner.saveSchedule(input);
    const due = new Date(Date.now() - 60000);
    await prisma.projectReportSchedule.update({
      where: { id: input.id },
      data: { nextRunAt: due },
    });
    await Promise.all([
      runDueReportSchedules(prisma),
      runDueReportSchedules(prisma),
    ]);
    const runs = await prisma.projectReportScheduleRun.findMany({
      where: { scheduleId: input.id },
    });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("CAPTURED");
    const captured = await prisma.projectReportSnapshot.findUniqueOrThrow({
      where: { id: runs[0]!.snapshotId! },
    });
    expect((captured.payload as { state: string }).state).toBe("preview");
    expect(
      await prisma.projectReportSnapshot.count({ where: { projectId } }),
    ).toBe(1);
  });
  it("pauses a revoked membership and will not revive a mandate after rejoining", async () => {
    const input = schedule();
    await owner.saveSchedule(input);
    await prisma.projectReportSchedule.update({
      where: { id: input.id },
      data: { nextRunAt: new Date(Date.now() - 60000) },
    });
    await prisma.membership.delete({ where: { id: membershipId } });
    membershipId = (
      await prisma.membership.create({
        data: {
          organizationId: orgId,
          userId,
          role: "OWNER",
          seatType: "FULL",
        },
      })
    ).id;
    await runDueReportSchedules(prisma);
    const row = await prisma.projectReportSchedule.findUniqueOrThrow({
      where: { id: input.id },
      include: { runs: true },
    });
    expect(row.enabled).toBe(false);
    expect(row.pauseReason).toBe("ACCESS_CHANGED");
    expect(row.runs).toHaveLength(0);
  });
  it("returns live aggregate changes, never contents, and denies wrong target or revoked grant", async () => {
    const identity: ForgeIdentity = {
      appId: `ari:cloud:ecosystem::app/${randomUUID()}`,
      installationId: `ari:cloud:ecosystem::installation/${randomUUID()}`,
      environmentId: `ari:cloud:ecosystem::environment/${randomUUID()}`,
      cloudId: randomUUID(),
      siteOrigin: "https://synthetic.atlassian.net",
      product: "confluence",
      targetId: "10",
      principal: "synthetic-viewer",
      moduleKey: "vaettir-release-quality",
      apiBaseUrl: "https://example.invalid",
    };
    const { principal, moduleKey, apiBaseUrl, ...binding } = identity;
    void principal;
    void moduleKey;
    void apiBaseUrl;
    const connectionId = randomUUID(),
      key = forgeSharingKey(connectionId);
    const metadata = {
      connectionId,
      version: 1,
      state: "APPROVED",
      binding,
      snapshotIds: [],
      shareLiveProjectQuality: true,
    };
    const grant = await prisma.auditLog.create({
      data: {
        organizationId: orgId,
        projectId,
        actorId: userId,
        action: "CREATE",
        entityType: forgeSharingEntityType,
        entityId: key,
        summary: "Synthetic live grant",
        metadata,
      },
    });
    const read = (target = identity) =>
      prisma.$transaction((tx) => readForgeLiveQuality(tx, key, target));
    const first = await read();
    expect(first.mode).toBe("LIVE");
    expect(first.snapshot.execution.results).toBe(0);
    const testCase = await prisma.testCase.create({
      data: {
        projectId,
        title: "PRIVATE_CASE_TITLE",
        testType: "FUNCTIONAL",
        given: [],
        when: [],
        then: [],
        tags: [],
      },
    });
    const run = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "synthetic",
        branch: "fixture",
        commitSha: "fixture",
        startedAt: new Date(),
        status: "PARTIAL",
      },
    });
    await prisma.testResult.create({
      data: {
        testRunId: run.id,
        testCaseId: testCase.id,
        status: "FAIL",
        note: "PRIVATE_RESULT_NOTE",
      },
    });
    const live = await read();
    expect(live.snapshot.execution.results).toBe(1);
    expect(live.snapshot.execution.outcomes).toEqual([
      { key: "FAIL", count: 1 },
    ]);
    expect(JSON.stringify(live)).not.toMatch(
      /PRIVATE_CASE_TITLE|PRIVATE_RESULT_NOTE/,
    );
    await expect(read({ ...identity, targetId: "11" })).rejects.toThrow();
    await prisma.auditLog.update({
      where: { id: grant.id },
      data: { metadata: { ...metadata, shareLiveProjectQuality: false } },
    });
    await expect(read()).rejects.toThrow();
    await prisma.auditLog.update({
      where: { id: grant.id },
      data: { metadata: { ...metadata, state: "REVOKED" } },
    });
    await expect(read()).rejects.toThrow();
  });
  it("does not revive schedules after a transient downgrade or suspension", async () => {
    for (const kind of ["role", "suspension"] as const) {
      const input = schedule();
      await owner.saveSchedule(input);
      if (kind === "role") {
        await prisma.membership.update({
          where: { id: membershipId },
          data: { role: "VIEWER" },
        });
        await prisma.membership.update({
          where: { id: membershipId },
          data: { role: "OWNER" },
        });
      } else {
        await prisma.organization.update({
          where: { id: orgId },
          data: { suspendedAt: new Date() },
        });
        await prisma.organization.update({
          where: { id: orgId },
          data: { suspendedAt: null },
        });
      }
      const paused = await prisma.projectReportSchedule.findUniqueOrThrow({
        where: { id: input.id },
      });
      expect(paused.enabled).toBe(false);
      expect(paused.version).toBe(2);
      expect(paused.pauseReason).toBe("ACCESS_CHANGED");
      const retry = await owner.saveSchedule(input);
      expect(retry.enabled).toBe(false);
      const renewed = await owner.saveSchedule({
        ...input,
        expectedVersion: 2,
        requestId: randomUUID(),
      });
      expect(renewed.enabled).toBe(true);
    }
  });
  it("groups source-backed custom metrics and distinguishes missing duration from zero", async () => {
    const request = {
      ...base(),
      config: {
        ...config,
        widgets: [
          {
            id: "custom-1" as const,
            display: "table" as const,
            query: {
              entity: "results" as const,
              dimension: "day" as const,
              operation: "durationMs" as const,
            },
          },
        ],
      },
    };
    const result = await owner.preview(request);
    expect(result.widgets[0]!.visual!.rows).toHaveLength(0);
    expect(result.widgets[0]!.visual!.note).toContain("no recorded duration");
    const run = await prisma.testRun.create({
      data: {
        projectId,
        ciProvider: "synthetic",
        branch: "fixture",
        commitSha: "fixture",
        startedAt: new Date(),
        status: "PARTIAL",
      },
    });
    await prisma.testResult.create({
      data: { testRunId: run.id, status: "BLOCKED", durationMs: 4500 },
    });
    const measured = await owner.preview(request);
    expect(measured.widgets[0]!.visual!.rows[0]!.value).toBe(4500);
    const filtered = await owner.preview({
      ...request,
      config: {
        ...request.config,
        widgets: [
          {
            ...request.config.widgets[0]!,
            query: { ...request.config.widgets[0]!.query, status: "FAIL" },
          },
        ],
      },
    });
    expect(filtered.widgets[0]!.visual!.rows).toHaveLength(0);
    await expect(
      owner.preview({
        ...request,
        config: {
          ...request.config,
          definition: { ...definition, executionScope: { runId: run.id } },
        },
      }),
    ).rejects.toThrow(/project-wide/);
  });
  it("keeps mandates paused after project transfer or subject remap is reversed", async () => {
    const tier = await prisma.planTier.findUniqueOrThrow({
      where: { key: "free" },
    });
    const target = await prisma.organization.create({
      data: {
        name: `${tag}-transfer`,
        slug: `${tag}-transfer`,
        planTierId: tier.id,
      },
    });
    for (const kind of ["transfer", "subject"] as const) {
      const input = schedule();
      await owner.saveSchedule(input);
      if (kind === "transfer") {
        await prisma.project.update({
          where: { id: projectId },
          data: { organizationId: target.id },
        });
        await prisma.project.update({
          where: { id: projectId },
          data: { organizationId: orgId },
        });
      } else {
        await prisma.user.update({
          where: { id: userId },
          data: { clerkUserId: tag + "-remapped" },
        });
        await prisma.user.update({
          where: { id: userId },
          data: { clerkUserId: tag },
        });
      }
      const row = await prisma.projectReportSchedule.findUniqueOrThrow({
        where: { id: input.id },
      });
      expect(row.enabled).toBe(false);
      expect(row.pauseReason).toBe("ACCESS_CHANGED");
    }
  });
  it("rolls back a capture if its run receipt fails, then records a recoverable failure", async () => {
    const input = schedule();
    await owner.saveSchedule(input);
    await prisma.projectReportSchedule.update({
      where: { id: input.id },
      data: { nextRunAt: new Date(Date.now() - 60000) },
    });
    const before = await prisma.projectReportSnapshot.count({
      where: { projectId },
    });
    const name = `report_fault_${randomUUID().replaceAll("-", "")}`;
    // Identifier and literal are generated UUIDs in the admitted disposable DB.
    await prisma.$executeRawUnsafe(
      `CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic reporting receipt failure'; END $$`,
    );
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${name} BEFORE INSERT ON "ProjectReportScheduleRun" FOR EACH ROW WHEN (NEW."scheduleId"='${input.id}' AND NEW.status='CAPTURED') EXECUTE FUNCTION ${name}()`,
    );
    try {
      await runDueReportSchedules(prisma);
      expect(
        await prisma.projectReportSnapshot.count({ where: { projectId } }),
      ).toBe(before);
      const row = await prisma.projectReportSchedule.findUniqueOrThrow({
        where: { id: input.id },
        include: { runs: true },
      });
      expect(row.enabled).toBe(false);
      expect(row.runs).toHaveLength(1);
      expect(row.runs[0]!.failureCode).toBe("CAPTURE_FAILED");
    } finally {
      await prisma.$executeRawUnsafe(
        `DROP TRIGGER ${name} ON "ProjectReportScheduleRun"`,
      );
      await prisma.$executeRawUnsafe(`DROP FUNCTION ${name}()`);
    }
  });
});
