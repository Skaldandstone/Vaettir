// SOURCE ONLY: these owned loopback PostgreSQL scenarios have NOT been executed.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma, Prisma } from "@vaettir/db";
import { appRouter } from "./router.js";
import type { Context } from "./trpc.js";
import {
  admitManualCaseFixtureSource,
  manualCaseFixtureEnabled,
  reviewedManualCaseFixture,
  seedSyntheticUnversionedManualCase,
  type ManualCaseFixtureOwnership,
} from "./manual-case-reviewed-test-helper.js";

const scopeOptIn =
  process.env.VAETTIR_CASE_HISTORY_SCOPE_NATIVE_FIXTURE === "1";
describe.skipIf(!scopeOptIn || !manualCaseFixtureEnabled())(
  "recorded case history original actor and literal configuration (authored, native NOT RUN)",
  () => {
    const prefix = `manual-case-revision-${Date.now()}-${randomUUID()}`,
      organizations: string[] = [],
      users: string[] = [];
    let projectId: string, actorId: string, viewerId: string;
    let owner: ReturnType<typeof appRouter.createCaller>, viewer: typeof owner;
    const ownerClerk = `${prefix}-owner`,
      viewerClerk = `${prefix}-viewer`;
    const context = (user: NonNullable<Context["user"]>): Context => ({
      prisma,
      user,
      staff: null,
      securityLogger: { warn: () => {} },
      staffAttempt: {
        tokenConfigured: false,
        tokenPresented: false,
        actorHeaderPresented: false,
      },
    });
    beforeAll(async () => {
      admitManualCaseFixtureSource(); // Exact named disposable LOCAL route + helper opt-in BEFORE first DB.
      if (process.env.VAETTIR_CASE_HISTORY_SCOPE_NATIVE_FIXTURE !== "1")
        throw Error("Explicit scope-history native fixture opt-in required");
      const tier = await prisma.planTier.findUniqueOrThrow({
        where: { key: "free" },
      });
      for (let i = 0; i < 2; i++)
        organizations.push(
          (
            await prisma.organization.create({
              data: {
                name: `${prefix}-${i}`,
                slug: `${prefix}-${i}`,
                planTierId: tier.id,
              },
            })
          ).id,
        );
      const u = await prisma.user.create({
        data: {
          email: `${prefix}-owner@example.com`,
          clerkUserId: ownerClerk,
          memberships: {
            create: organizations.map((organizationId) => ({
              organizationId,
              role: "OWNER" as const,
              seatType: "FULL" as const,
            })),
          },
        },
        include: { memberships: true },
      });
      actorId = u.id;
      users.push(u.id);
      owner = appRouter.createCaller(context(u));
      const v = await prisma.user.create({
        data: {
          email: `${prefix}-viewer@example.com`,
          clerkUserId: viewerClerk,
          memberships: {
            create: {
              organizationId: organizations[0]!,
              role: "VIEWER",
              seatType: "READ_ONLY",
            },
          },
        },
        include: { memberships: true },
      });
      viewerId = v.id;
      users.push(v.id);
      viewer = appRouter.createCaller(context(v));
      projectId = (
        await owner.project.create({
          organizationId: organizations[0]!,
          name: `${prefix} synthetic bounded case history`,
          caseKey: "HSCOPE",
        })
      ).id;
    });
    afterAll(async () => {
      // Retain minted rows/users/results/history and failed native evidence.
      // This reader suite is not an organization-erasure scenario.
      await prisma.$disconnect();
    });
    const caseRecord = () =>
      owner.testCases.create({
        projectId,
        title: `${prefix} synthetic history case`,
        testType: "FUNCTIONAL",
        given: ["Setup"],
        when: ["Action"],
        then: ["Outcome"],
      });
    const reviewed = (read: Parameters<typeof reviewedManualCaseFixture>[1]) =>
      reviewedManualCaseFixture(owner.manualCaseResults, read, actorId);
    function historicalOwner(
      read: Parameters<typeof reviewedManualCaseFixture>[1],
    ): ManualCaseFixtureOwnership {
      if (
        read.projectId !== projectId ||
        read.expectedScope.organizationId !== organizations[0] ||
        read.expectedScope.clerkActorId !== ownerClerk ||
        !users.includes(actorId)
      )
        throw Error("Exact minted history fixture scope required");
      return {
        prefix,
        organizationId: organizations[0]!,
        organizationSlug: `${prefix}-0`,
        projectId,
        actorId,
        clerkActorId: ownerClerk,
        testRunId: read.testRunId,
        testCaseId: read.testCaseId,
      };
    }
    const input = (testCaseId: string) => ({
      projectId,
      testCaseId,
      limit: 10,
      originalOrganizationId: organizations[0]!,
      expectedClerkActorId: viewerClerk,
    });
    async function manual(
      testCaseId: string,
      configuration = { platform: "PC", build: "b1", environment: "Lab A" },
      startedAt = new Date("2026-01-02T12:00:00Z"),
    ) {
      // Synthetic projected-summary fixture, not a claim of a real console/device run.
      return prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt,
          manualTestCaseIds: [testCaseId],
          executionContext: {
            version: 1,
            profileHash: "a".repeat(64),
            configuration,
            caseDefinitions: [
              {
                testCaseId,
                title: "Frozen synthetic title",
                given: ["Frozen setup"],
                when: ["Frozen action"],
                then: ["Frozen outcome"],
                steps: [],
                verificationProfile: {},
              },
            ],
          },
        },
      });
    }
    it("Viewer reads scoped echoes without role/seat upgrade; omitted legacy input is still supported", async () => {
      const c = await caseRecord();
      await manual(c.id);
      const scoped = await viewer.caseExecutionHistory.list(input(c.id));
      expect(scoped).toMatchObject({
        projectId,
        organizationId: organizations[0],
        actorClerkUserId: viewerClerk,
        testCase: { id: c.id },
      });
      const old = await viewer.caseExecutionHistory.list({
        projectId,
        testCaseId: c.id,
      });
      expect(old.items).toEqual(scoped.items);
      expect(
        (
          await prisma.membership.findUniqueOrThrow({
            where: {
              organizationId_userId: {
                organizationId: organizations[0]!,
                userId: viewerId,
              },
            },
          })
        ).seatType,
      ).toBe("READ_ONLY");
    });
    it("whole-case correction summary retains immutable recorder metadata and original failure without inventing a new run", async () => {
      await prisma.user.update({
        where: { id: actorId },
        data: { name: "Synthetic original recorder" },
      });
      const c = await caseRecord(),
        run = await owner.manualExecution.start({
          projectId,
          testCaseIds: [c.id],
          idempotencyKey: randomUUID(),
        });
      const read = {
        projectId,
        testRunId: run.testRunId,
        testCaseId: c.id,
        expectedScope: {
          projectId,
          organizationId: organizations[0]!,
          clerkActorId: ownerClerk,
        },
      };
      const first = await reviewed(read);
      await owner.manualCaseResults.recordReviewed({
        ...read,
        mode: "EXACT",
        expectedNativeActorId: actorId,
        expectedFrozenEvidenceHash: first.preview.frozenEvidenceHash,
        expectedRevisionId: first.preview.currentRevisionId,
        expectedCurrentFingerprint: first.preview.currentFingerprint,
        status: "FAIL",
        note: "Retained original failure",
        observations: {},
        correctionReason: null,
        idempotencyKey: randomUUID(),
      });
      const next = await reviewed(read);
      const ack = await owner.manualCaseResults.recordReviewed({
        ...read,
        mode: "EXACT",
        expectedNativeActorId: actorId,
        expectedFrozenEvidenceHash: next.preview.frozenEvidenceHash,
        expectedRevisionId: next.preview.currentRevisionId,
        expectedCurrentFingerprint: next.preview.currentFingerprint,
        status: "PASS",
        note: "Corrected observation, not separate retest",
        observations: {},
        correctionReason: "Synthetic evidence reviewed",
        idempotencyKey: randomUUID(),
      });
      await prisma.user.update({
        where: { id: actorId },
        data: { name: "Changed current profile" },
      });
      const page = await viewer.caseExecutionHistory.list(input(c.id)),
        item = page.items.find((row) => row.runId === run.testRunId)!;
      expect(item.wholeCase).toMatchObject({
        revisionCount: 2,
        correctionCount: 1,
        lastRecorderName: "Synthetic original recorder",
        lastStatus: "PASS",
      });
      const tip = await prisma.manualCaseResultRevision.findUniqueOrThrow({
        where: { id: ack.revisionId },
      });
      expect(item.wholeCase?.lastRecordedAt).toBe(tip.recordedAt.toISOString());
      expect(
        await prisma.manualCaseResultRevision.findMany({
          where: { testRunId: run.testRunId, testCaseId: c.id },
          orderBy: { revisionNumber: "asc" },
          select: { status: true, note: true },
        }),
      ).toEqual([
        { status: "FAIL", note: "Retained original failure" },
        { status: "PASS", note: "Corrected observation, not separate retest" },
      ]);
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: c.id } },
        }),
      ).toBe(1);
    });
    it("captured legacy correction counts only tracked evidence and absence is not zero known revisions", async () => {
      const c = await caseRecord(),
        run = await owner.manualExecution.start({
          projectId,
          testCaseIds: [c.id],
          idempotencyKey: randomUUID(),
        });
      const read = {
        projectId,
        testRunId: run.testRunId,
        testCaseId: c.id,
        expectedScope: {
          projectId,
          organizationId: organizations[0]!,
          clerkActorId: ownerClerk,
        },
      };
      // Explicit synthetic HISTORICAL unversioned native seed, not a current
      // invocation of the retired mutable writer or invented recorder/time.
      await seedSyntheticUnversionedManualCase(prisma, historicalOwner(read), {
        status: "FAIL",
        note: "Unversioned original",
        observations: {
          specimen: "",
          hardwareRevision: "",
          firmwareVersion: "",
          environment: "",
          measurements: [],
        },
      });
      const before = await viewer.caseExecutionHistory.list(input(c.id));
      expect(before.items[0]?.wholeCase).toBeNull();
      const preview = await reviewed(read);
      const ack = await owner.manualCaseResults.recordReviewed({
        ...read,
        mode: "EXACT",
        expectedNativeActorId: actorId,
        expectedFrozenEvidenceHash: preview.preview.frozenEvidenceHash,
        expectedRevisionId: preview.preview.currentRevisionId,
        expectedCurrentFingerprint: preview.preview.currentFingerprint,
        status: "PASS",
        note: "First recorded correction",
        observations: {},
        correctionReason: "Reviewed synthetic legacy observation",
        idempotencyKey: randomUUID(),
      });
      const after = await viewer.caseExecutionHistory.list(input(c.id));
      expect(after.items[0]?.wholeCase).toMatchObject({
        revisionCount: 1,
        correctionCount: 1,
        lastStatus: "PASS",
      });
      expect(
        (
          await prisma.manualCaseResultRevision.findUniqueOrThrow({
            where: { id: ack.revisionId },
          })
        ).legacyPrior,
      ).toMatchObject({
        originalRecorder: null,
        originalRecordedAt: null,
        captured: { status: "FAIL", note: "Unversioned original" },
      });
      expect(after.items[0]?.limitations.join(" ")).toContain(
        "earlier unrecorded changes are not reconstructed",
      );
    });
    it("source/status filters apply before pagination and overall failed run may hold a passing case", async () => {
      const c = await caseRecord(),
        manualFailed = await manual(c.id),
        manualPassed = await manual(c.id);
      await prisma.testRun.update({
        where: { id: manualFailed.id },
        data: {
          status: "FAILED",
          results: { create: { testCaseId: c.id, status: "PASS" } },
        },
      });
      await prisma.testRun.update({
        where: { id: manualPassed.id },
        data: { status: "PASSED" },
      });
      const imported = [];
      for (let n = 0; n < 3; n++)
        imported.push(
          await prisma.testRun.create({
            data: {
              projectId,
              ciProvider: "synthetic-import",
              commitSha: "synthetic",
              branch: "fixture",
              startedAt: new Date("2026-01-03T12:00:00Z"),
              status: "FAILED",
              results: { create: { testCaseId: c.id, status: "PASS" } },
            },
          }),
        );
      const filters = {
        recordedSource: "CI_IMPORT" as const,
        runStatus: "FAILED" as const,
      };
      const first = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        limit: 1,
        filters,
      });
      const second = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        limit: 1,
        filters,
        before: first.nextCursor!,
      });
      expect([first.items[0]!.runId, second.items[0]!.runId]).toEqual(
        imported
          .map((run) => run.id)
          .sort()
          .reverse()
          .slice(0, 2),
      );
      expect(first.items[0]).toMatchObject({
        source: "CI_IMPORT",
        runStatus: "FAILED",
        outcome: "PASS",
      });
      const manualPage = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: { recordedSource: "MANUAL", runStatus: "FAILED" },
      });
      expect(manualPage.items.map((item) => item.runId)).toEqual([
        manualFailed.id,
      ]);
      expect(manualPage.items[0]).toMatchObject({
        runStatus: "FAILED",
        outcome: "PASS",
      });
      expect(
        await prisma.testResult.count({ where: { testCaseId: c.id } }),
      ).toBe(4);
    });
    it("source/status cursor cannot be rebound and run-start interval remains conjunctive", async () => {
      const c = await caseRecord();
      for (let n = 0; n < 2; n++) await manual(c.id);
      const filters = {
        recordedSource: "MANUAL" as const,
        runStatus: "RUNNING" as const,
      };
      const first = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        limit: 1,
        filters,
      });
      expect(first.nextCursor).not.toBeNull();
      for (const changed of [
        { recordedSource: "CI_IMPORT" as const, runStatus: "RUNNING" as const },
        { recordedSource: "MANUAL" as const, runStatus: "PASSED" as const },
      ])
        await expect(
          viewer.caseExecutionHistory.list({
            ...input(c.id),
            limit: 1,
            filters: changed,
            before: first.nextCursor!,
          }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      const empty = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: {
          ...filters,
          interval: { start: "2026-01-04", end: "2026-01-04" },
        },
      });
      expect(empty.items).toEqual([]);
      expect(empty.nextCursor).toBeNull();
    });
    it("manual configuration and recorded source/status share one complete candidate intersection", async () => {
      const c = await caseRecord(),
        kept = await manual(c.id),
        excluded = await manual(c.id);
      await prisma.testRun.update({
        where: { id: kept.id },
        data: { status: "PARTIAL" },
      });
      await prisma.testRun.update({
        where: { id: excluded.id },
        data: { status: "PASSED" },
      });
      const page = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: {
          platform: "PC",
          recordedSource: "MANUAL",
          runStatus: "PARTIAL",
        },
      });
      expect(page.items.map((item) => item.runId)).toEqual([kept.id]);
      const impossible = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: { platform: "PC", recordedSource: "CI_IMPORT" },
      });
      expect(impossible.items).toEqual([]);
      expect(impossible.nextCursor).toBeNull();
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: c.id } },
        }),
      ).toBe(2);
    });
    it("filtered configuration summaries preserve literal whitespace, newlines and known empty values", async () => {
      const c = await caseRecord(),
        exact = { platform: " PC ", build: "  b1", environment: "Lab\n A " };
      const configured = await manual(c.id, exact),
        blank = await manual(c.id, {
          platform: "",
          build: "",
          environment: "",
        });
      const filtered = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: { ...exact, recordedSource: "MANUAL" },
      });
      expect(filtered.items.map((item) => item.runId)).toEqual([configured.id]);
      expect(filtered.items[0]).toMatchObject(exact);
      const all = await viewer.caseExecutionHistory.list(input(c.id));
      expect(all.items.find((item) => item.runId === blank.id)).toMatchObject({
        platform: "",
        build: "",
        environment: "",
      });
      expect(
        (
          await prisma.testRun.findUniqueOrThrow({
            where: { id: configured.id },
          })
        ).executionContext,
      ).toMatchObject({ configuration: exact });
    });
    it("exact valid manual config excludes unsupported/CI snapshots without editing original results", async () => {
      const c = await caseRecord(),
        matching = await manual(c.id),
        different = await manual(c.id, {
          platform: "pc",
          build: "b1",
          environment: "Lab A",
        });
      const malformed = await manual(c.id);
      await prisma.testRun.update({
        where: { id: malformed.id },
        data: {
          executionContext: { version: 2, configuration: { platform: "PC" } },
        },
      });
      const ci = await prisma.testRun.create({
        data: {
          projectId,
          ciProvider: "synthetic-ci",
          commitSha: "b1",
          branch: "synthetic",
          startedAt: new Date("2026-01-02T12:00:00Z"),
          results: {
            create: [
              { testCaseId: c.id, status: "PASS" },
              { testCaseId: c.id, status: "FAIL" },
            ],
          },
        },
      });
      const page = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: { platform: "PC", build: "b1", environment: "Lab A" },
      });
      expect(page.items.map((item) => item.runId)).toEqual([matching.id]);
      expect(page.items[0]).toMatchObject({
        planned: true,
        outcome: "NOT_RECORDED",
        outcomeMode: "PLANNED_ONLY",
      });
      const unfiltered = await viewer.caseExecutionHistory.list(input(c.id));
      expect(unfiltered.items).toHaveLength(4);
      expect(
        unfiltered.items.find((item) => item.runId === ci.id),
      ).toMatchObject({
        outcome: "MIXED",
        outcomeMode: "MULTIPLE_REPORTED_RESULTS",
        build: null,
      });
      expect(unfiltered.items.some((item) => item.runId === different.id)).toBe(
        true,
      );
      expect(
        await prisma.testResult.count({ where: { testRunId: ci.id } }),
      ).toBe(2);
      expect(page.limits?.join(" ")).toContain("CI imports are excluded");
    });
    it("includes both UTC day boundaries by run start and does not substitute completion date", async () => {
      const c = await caseRecord(),
        start = await manual(
          c.id,
          undefined,
          new Date("2026-01-02T00:00:00.000Z"),
        ),
        end = await manual(
          c.id,
          undefined,
          new Date("2026-01-02T23:59:59.999Z"),
        );
      await manual(c.id, undefined, new Date("2026-01-01T23:59:59.999Z"));
      await manual(c.id, undefined, new Date("2026-01-03T00:00:00.000Z"));
      await prisma.testRun.update({
        where: { id: start.id },
        data: { finishedAt: new Date("2026-01-10T00:00:00Z") },
      });
      const page = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: { interval: { start: "2026-01-02", end: "2026-01-02" } },
      });
      expect(page.items.map((item) => item.runId)).toEqual([end.id, start.id]);
      expect(page.window).toEqual({
        start: "2026-01-02T00:00:00.000Z",
        end: "2026-01-02T23:59:59.999Z",
      });
    });
    it("tie ordering is stable and old filter cursors cannot cross case or configuration", async () => {
      const c = await caseRecord(),
        other = await caseRecord();
      const runs = await Promise.all(
        Array.from({ length: 3 }, () => manual(c.id)),
      );
      const first = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        limit: 1,
        filters: { platform: "PC" },
      });
      const second = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        limit: 1,
        filters: { platform: "PC" },
        before: first.nextCursor!,
      });
      expect([first.items[0]!.runId, second.items[0]!.runId]).toEqual(
        runs
          .map((run) => run.id)
          .sort()
          .reverse()
          .slice(0, 2),
      );
      await expect(
        viewer.caseExecutionHistory.list({
          ...input(c.id),
          filters: { platform: "pc" },
          before: first.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        viewer.caseExecutionHistory.list({
          ...input(other.id),
          filters: { platform: "PC" },
          before: first.nextCursor!,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(
        viewer.caseExecutionHistory.list({
          ...input(c.id),
          filters: { platform: "PC" },
          before: { runId: first.items[0]!.runId },
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    });
    it("server actor and current membership gates fail before retained private case metadata", async () => {
      const c = await caseRecord();
      await manual(c.id);
      await expect(
        viewer.caseExecutionHistory.list({
          ...input(c.id),
          expectedClerkActorId: ownerClerk,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await prisma.membership.delete({
        where: {
          organizationId_userId: {
            organizationId: organizations[0]!,
            userId: viewerId,
          },
        },
      });
      try {
        await expect(
          viewer.caseExecutionHistory.list(input(c.id)),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.membership.create({
          data: {
            organizationId: organizations[0]!,
            userId: viewerId,
            role: "VIEWER",
            seatType: "READ_ONLY",
          },
        });
      }
    });
    it("owner of both organizations cannot silently rebind the originally requested history after reparent", async () => {
      const c = await caseRecord();
      await manual(c.id);
      await prisma.project.update({
        where: { id: projectId },
        data: { organizationId: organizations[1]! },
      });
      try {
        await expect(
          owner.caseExecutionHistory.list({
            ...input(c.id),
            expectedClerkActorId: ownerClerk,
          }),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
      } finally {
        await prisma.project.update({
          where: { id: projectId },
          data: { organizationId: organizations[0]! },
        });
      }
    });
    it("configuration population over20k refuses as a whole rather than returning its first page", async () => {
      const c = await caseRecord();
      await prisma.testRun.createMany({
        data: Array.from({ length: 20001 }, (_, index) => ({
          id: `${prefix}-bound-${index}`,
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date("2026-01-02T12:00:00Z"),
          manualTestCaseIds: [c.id],
        })),
      });
      await expect(
        viewer.caseExecutionHistory.list({
          ...input(c.id),
          filters: { platform: "PC" },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: c.id } },
        }),
      ).toBe(20001);
    });
    it("projected metadata above4MiB refuses before ORM or page substitution", async () => {
      const c = await caseRecord();
      const executionContext = {
        version: 1,
        profileHash: "a".repeat(64),
        configuration: { platform: "PC", build: "b1", environment: "Lab A" },
        caseDefinitions: [
          {
            testCaseId: c.id,
            title: "x".repeat(10000),
            given: [],
            when: [],
            then: [],
            steps: [],
            verificationProfile: {},
          },
        ],
      };
      await prisma.testRun.createMany({
        data: Array.from({ length: 450 }, (_, index) => ({
          id: `${prefix}-bytes-${index}`,
          projectId,
          ciProvider: "manual",
          commitSha: "manual",
          branch: "manual",
          startedAt: new Date("2026-01-02T12:00:00Z"),
          manualTestCaseIds: [c.id],
          executionContext,
        })),
      });
      await expect(
        viewer.caseExecutionHistory.list({
          ...input(c.id),
          filters: { platform: "PC" },
        }),
      ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
      expect(
        await prisma.testRun.count({
          where: { projectId, manualTestCaseIds: { has: c.id } },
        }),
      ).toBe(450);
    });
    it("duplicate selected definitions and UTF16-overbound configuration remain unsupported instead of arbitrary matches", async () => {
      const c = await caseRecord(),
        valid = await manual(c.id),
        duplicate = await manual(c.id);
      const stored = await prisma.testRun.findUniqueOrThrow({
        where: { id: duplicate.id },
        select: { executionContext: true },
      });
      const context = stored.executionContext as Prisma.JsonObject;
      if (!Array.isArray(context.caseDefinitions))
        throw Error("Owned synthetic definitions fixture is malformed");
      await prisma.testRun.update({
        where: { id: duplicate.id },
        data: {
          executionContext: {
            ...context,
            caseDefinitions: [
              ...context.caseDefinitions,
              ...context.caseDefinitions,
            ],
          },
        },
      });
      await manual(c.id, {
        platform: "PC",
        build: "b1",
        environment: "😀".repeat(1001),
      });
      const page = await viewer.caseExecutionHistory.list({
        ...input(c.id),
        filters: { platform: "PC" },
      });
      expect(page.items.map((item) => item.runId)).toEqual([valid.id]);
      const full = await viewer.caseExecutionHistory.list(input(c.id));
      expect(full.items).toHaveLength(3);
      expect(
        full.items.find((item) => item.runId === duplicate.id)?.definition
          .source,
      ).toBe("UNSUPPORTED_METADATA");
    });
  },
);
